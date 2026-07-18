package com.sellerflow.live;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.Charset;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "SellerFlowPrinter")
public class SellerFlowPrinterPlugin extends Plugin {
    private static final String TAG = "SellerFlowPrinter";
    private static final String PREFS = "sellerflow_printer";
    private static final String PREF_HOST = "lan_host";
    private static final String PREF_PORT = "lan_port";
    // Bluetooth sticker printer (AIMO D520BT / TSPL). SEPARATE prefs keys from
    // LAN so saving a BT printer never touches the WiFi/LAN config.
    private static final String PREF_BT_ADDR = "bt_label_addr";
    private static final String PREF_BT_NAME = "bt_label_name";
    private static final int DEFAULT_PORT = 9100;
    private static final int CONNECT_TIMEOUT_MS = 5000;
    // Receipt printer (XP-N160II) resident character set is Big5 (Traditional
    // Chinese, confirmed on its self-test page) -- NOT GBK. The AIMO TSPL sticker
    // path is a DIFFERENT printer and stays GBK (TsplBuilder has its own encoding).
    private static final Charset PRINTER_CHARSET = Charset.forName("Big5");
    // Classic Bluetooth SPP (Serial Port Profile) UUID — universal for ESC/POS
    // and TSPL thermal/label printers. AIMO D520BT, Xprinter, GP-, RPP all use this.
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    // Default label dimensions for AIMO D520BT sticker stock.
    private static final int LABEL_WIDTH_MM = 100;
    private static final int LABEL_HEIGHT_MM = 60;
    // Phomemo 241 ORDER GUARD — Phase 2 ENABLED (Jeff hardware-verified the 241
    // over Classic-SPP: v3 60x40 layout approved incl. the left-edge experiment,
    // CJK bands clean, BITMAP-over-SPP confirmed). Real 241 orders (1-Click,
    // reprint, raffle, Enterprise, Auto Mode, batch) now flow through the SAME
    // forStickerNative241 builder + Phomemo241Raster renderer + label size + CJK
    // band path as the Test Print — only the payload content differs (real buyer
    // vs the fixed verification sticker). Flip back to false to re-gate if needed;
    // `if (!CONSTANT)` still compiles either way (Java does NOT constant-fold `if`
    // for reachability). AIMO is entirely unaffected.
    private static final boolean PHOMEMO_241_ORDERS_ENABLED = true;
    // P1 RULER TEST MODE — MEASUREMENT COMPLETE (2026-07-18, Jeff's PM-241, 3-print
    // drift-envelope protocol: reading-left worst 16 [16/16/12], reading-right worst
    // 8 [8/8/8]). The measured guards now live in Phomemo241Builder
    // (LEFT_GUARD_MEASURED = 24, EDGE_GUARD = 16) and the Test Print is back to the
    // CJK verification sticker. Flip to true only for a future re-measurement (new
    // unit / suspected drift change); the ruler pattern itself stays in the tree
    // (Phomemo241Builder.rulerTestPage).
    private static final boolean RULER_TEST_MODE = false;
    // P3 BOLD SAMPLER — TUNING COMPLETE (2026-07-18, Jeff's hardware verdict was
    // PER-SCRIPT: ASCII best = row 3 [stroke 1.5, thr 128]; CJK best = row 2
    // [stroke 0, thr 160] — heavier strokes weld CJK together; the double-strike
    // row 7 was not chosen). The tuning now lives in the pure
    // Phomemo241Builder.boldStrokeFor/boldThresholdFor (per-script, mixed → CJK)
    // and the Test Print is back to the CJK verification sticker (now with the
    // bold hierarchy live). Flip to true only for a future re-tune; the sampler
    // stays in the tree (build241BoldSampler).
    private static final boolean BOLD_SAMPLER_MODE = false;
    // P3.7 FONT STYLE SAMPLER — TUNING COMPLETE (2026-07-18, Jeff's verdict:
    // ROW 2's MECHANISM — ROM-emulation, regular weight + pixel stretch — at
    // ROW C's WEIGHT — threshold 160, zero stroke — so the whole sticker carries
    // ONE consistent stroke weight and the hierarchy comes from SIZE). The style
    // now lives in the production path (Phomemo241Raster ASCII branch +
    // Phomemo241Builder.ROM_BAND_THRESHOLD / stretchGrayNearest) and the Test
    // Print is back to the CJK verification sticker. Flip to true only for a
    // future re-tune; the sampler stays in the tree (build241FontSampler — note
    // its row 1 "current bold" reference now renders the shipped ROM style too,
    // since production itself moved to it).
    private static final boolean FONT_SAMPLER_MODE = false;

    /**
     * ESC/POS character-size mode (GS ! n) applied to prominent slip fields:
     * buyer #, name, handle, order details, grand total.
     *
     * Byte format: upper nibble = vertical scale - 1, lower nibble = horizontal scale - 1.
     *   0x11 -> 2W x 2H  (current: dialed down from 3x after physical test
     *                     showed 3x was too large on 80mm paper)
     *   0x22 -> 3W x 3H  (previous: tested, decisive but too big)
     *   0x00 -> normal   (off)
     *
     * SINGLE SOURCE OF TRUTH. Edit this one byte to change every prominent line
     * in both buildEscPosSlip implementations (this file + MainActivity.java
     * dead-code path). Recompile APK -> reinstall -> reprint to compare sizes.
     */
    public static final int ESC_POS_IMPORTANT_SIZE = 0x11;

    // Order item/comment size on the receipt: 0x11 = 2W x 2H -- same prominence
    // as the buyer name, so the item is the most readable line on the slip. Only
    // the item uses this; Qty/Price/Total stay normal. GS ! n: high nibble =
    // vertical scale-1, low nibble = horizontal scale-1. Mirrors the iOS constant.
    public static final int ESC_POS_ORDER_SIZE = 0x11;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void setPrinter(PluginCall call) {
        String host = cleanHost(call.getString("host", ""));
        int port = call.getInt("port", DEFAULT_PORT);
        Log.i(TAG, "setPrinter host=" + host + " port=" + port);
        if (host.isEmpty()) {
            call.reject("Printer IP address is required", "HOST_REQUIRED");
            return;
        }
        if (port <= 0 || port > 65535) {
            call.reject("Printer port must be between 1 and 65535", "PORT_INVALID");
            return;
        }
        prefs().edit().putString(PREF_HOST, host).putInt(PREF_PORT, port).apply();
        JSObject ret = printerConfig(host, port);
        ret.put("ok", true);
        ret.put("message", "Saved WiFi printer " + host + ":" + port);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPrinter(PluginCall call) {
        String host = getSavedHost();
        int port = getSavedPort();
        Log.i(TAG, "getPrinter host=" + host + " port=" + port);
        JSObject ret = printerConfig(host, port);
        ret.put("ok", !host.isEmpty());
        ret.put("message", host.isEmpty() ? "No WiFi printer saved" : "Saved WiFi printer " + host + ":" + port);
        call.resolve(ret);
    }

    @PluginMethod
    public void testConnection(PluginCall call) {
        String host = cleanHost(call.getString("host", getSavedHost()));
        int port = call.getInt("port", getSavedPort());
        Log.i(TAG, "testConnection host=" + host + " port=" + port);
        if (host.isEmpty()) {
            call.reject("Printer IP address is required", "HOST_REQUIRED");
            return;
        }
        if (port <= 0 || port > 65535) {
            call.reject("Printer port must be between 1 and 65535", "PORT_INVALID");
            return;
        }
        executor.execute(() -> {
            try {
                openAndClose(host, port);
                JSObject ret = printerConfig(host, port);
                ret.put("ok", true);
                ret.put("online", true);
                ret.put("message", "Printer reachable at " + host + ":" + port);
                Log.i(TAG, "testConnection success host=" + host + " port=" + port);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "testConnection failed host=" + host + " port=" + port, e);
                call.reject("Printer unreachable at " + host + ":" + port + " - " + e.getMessage(), "CONNECTION_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void printSlip(PluginCall call) {
        String host = getSavedHost();
        int port = getSavedPort();
        Log.i(TAG, "printSlip start host=" + host + " port=" + port);
        if (host.isEmpty()) {
            call.reject("No WiFi printer saved. Enter printer IP and tap Test Connection first.", "PRINTER_NOT_SET");
            return;
        }
        final JSObject payload = call.getData();
        executor.execute(() -> {
            try {
                byte[] data = buildEscPosSlip(new JSONObject(payload.toString()));
                writeTcp(host, port, data);
                JSObject ret = printerConfig(host, port);
                ret.put("ok", true);
                ret.put("online", true);
                ret.put("bytes", data.length);
                ret.put("message", "Printed to WiFi printer " + host + ":" + port);
                Log.i(TAG, "printSlip success host=" + host + " port=" + port + " bytes=" + data.length);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "printSlip failed host=" + host + " port=" + port, e);
                call.reject("Print failed at " + host + ":" + port + " - " + e.getMessage(), "PRINT_FAILED", e);
            }
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // BLUETOOTH STICKER PRINTER (additive — independent of all LAN methods above)
    // Backs the frontend's printerType="bluetooth" path. Saved BT printer is
    // stored in SEPARATE SharedPreferences keys (bt_label_addr / bt_label_name)
    // so the WiFi/LAN host/port is never overwritten. printSticker decodes the
    // base64 1-bit bitmap rendered by the frontend (html2canvas), wraps it via
    // TsplBuilder.forSticker, and writes the byte stream to the printer over
    // Classic Bluetooth SPP. 1-click in-app — no Android system print dialog.
    // ────────────────────────────────────────────────────────────────────────

    @PluginMethod
    public void scanBluetoothLabelPrinters(PluginCall call) {
        Log.i(TAG, "scanBluetoothLabelPrinters start");
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Bluetooth not supported on this device", "BT_NO_ADAPTER");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on in Android Settings then try again.", "BT_DISABLED");
            return;
        }
        if (!hasBluetoothConnectPermission()) {
            requestBluetoothPermissions();
            call.reject("Bluetooth permission needed. Allow it in the system prompt and tap Scan again.", "BT_PERMISSION");
            return;
        }
        executor.execute(() -> {
            try {
                JSObject ret = new JSObject();
                JSONArray printers = new JSONArray();
                @SuppressLint("MissingPermission")
                Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                if (bonded != null) {
                    // No name-keyword filter: printer model names are wildly
                    // inconsistent (e.g., AIMO D520BT may advertise as
                    // "d520bt-z", unbranded clones as "BT-Printer", and some
                    // Android Bluetooth stacks return the MAC address as the
                    // name on first read). Showing every paired device lets the
                    // seller pick reliably regardless of the printer brand.
                    for (BluetoothDevice device : bonded) {
                        printers.put(bluetoothDeviceJson(device, true));
                    }
                }
                ret.put("ok", true);
                ret.put("printers", printers);
                ret.put("savedPrinter", savedBluetoothPrinter());
                ret.put("message", printers.length() == 0
                    ? "No paired Bluetooth devices found. Pair your printer in Android Settings first."
                    : "Found " + printers.length() + " paired device" + (printers.length() == 1 ? "" : "s") + ". Pick your printer from the list.");
                Log.i(TAG, "scanBluetoothLabelPrinters success count=" + printers.length());
                call.resolve(ret);
            } catch (SecurityException e) {
                Log.e(TAG, "scanBluetoothLabelPrinters permission denied", e);
                call.reject("Bluetooth permission denied: " + e.getMessage(), "BT_PERMISSION", e);
            } catch (Exception e) {
                Log.e(TAG, "scanBluetoothLabelPrinters failed", e);
                call.reject("Bluetooth scan failed: " + e.getMessage(), "BT_SCAN_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void getBluetoothLabelPrinter(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("savedPrinter", savedBluetoothPrinter());
        call.resolve(ret);
    }

    @PluginMethod
    public void setBluetoothLabelPrinter(PluginCall call) {
        String address = call.getString("address", "");
        String name = call.getString("name", "");
        if (address == null || address.trim().isEmpty()) {
            call.reject("Bluetooth address is required", "BT_ADDR_REQUIRED");
            return;
        }
        prefs().edit()
            .putString(PREF_BT_ADDR, address.trim())
            .putString(PREF_BT_NAME, name == null ? "" : name.trim())
            .apply();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("savedPrinter", savedBluetoothPrinter());
        ret.put("message", "Saved Bluetooth printer: " + (name == null || name.isEmpty() ? address : name));
        Log.i(TAG, "setBluetoothLabelPrinter saved address=" + address + " name=" + name);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearBluetoothLabelPrinter(PluginCall call) {
        prefs().edit().remove(PREF_BT_ADDR).remove(PREF_BT_NAME).apply();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("savedPrinter", JSObject.NULL);
        ret.put("message", "Bluetooth printer cleared");
        Log.i(TAG, "clearBluetoothLabelPrinter cleared");
        call.resolve(ret);
    }

    /**
     * NEARBY discovery for in-app pairing — lets a seller find an UNPAIRED printer
     * (e.g. a brand-new PM-241) without leaving for Android Settings. This is a
     * SEPARATE, additive method: {@link #scanBluetoothLabelPrinters} stays bonded-only
     * and byte-unchanged, so the AIMO scan flow is untouched (a seller whose AIMO is
     * already paired keeps using Scan exactly as before). Mirrors the proven receiver
     * pattern in {@code MainActivity.discoverNearbyBluetooth}: register an ACTION_FOUND
     * receiver, startDiscovery, collect for a fixed window, then stop + unregister.
     * Returns only UNPAIRED devices (paired:false) not already bonded — bonded ones
     * are already offered by the normal Scan.
     */
    @PluginMethod
    public void discoverBluetoothPrinters(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Bluetooth not supported on this device", "BT_NO_ADAPTER");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on then tap Find nearby again.", "BT_DISABLED");
            return;
        }
        if (!hasBluetoothScanPermission()) {
            requestBluetoothScanPermissions();
            call.reject("Bluetooth permission needed. Allow it in the system prompt and tap Find nearby again.", "BT_PERMISSION");
            return;
        }
        executor.execute(() -> {
            final java.util.List<JSObject> found = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
            final java.util.Set<String> seen = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
            // Skip already-bonded devices — they're returned by the normal Scan.
            try {
                @SuppressLint("MissingPermission")
                Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                if (bonded != null) for (BluetoothDevice d : bonded) { String a = d.getAddress(); if (a != null) seen.add(a); }
            } catch (Exception ignored) {}
            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                @SuppressLint("MissingPermission")
                public void onReceive(Context context, Intent intent) {
                    if (!BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) return;
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device == null) return;
                    String addr = device.getAddress();
                    if (addr == null || !seen.add(addr)) return;   // dedup + skip bonded
                    found.add(bluetoothDeviceJson(device, false));
                }
            };
            boolean denied = false;
            try {
                getContext().registerReceiver(receiver, new IntentFilter(BluetoothDevice.ACTION_FOUND));
                try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
                adapter.startDiscovery();
                Thread.sleep(8000);   // classic BT inquiry window (~8s covers a full inquiry)
            } catch (SecurityException e) {
                Log.e(TAG, "discoverBluetoothPrinters permission denied", e);
                denied = true;
            } catch (Exception e) {
                Log.w(TAG, "discoverBluetoothPrinters discovery error: " + e.getMessage());
            } finally {
                try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
                try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) {}
            }
            if (denied) { call.reject("Bluetooth permission denied. Allow it then tap Find nearby again.", "BT_PERMISSION"); return; }
            JSObject ret = new JSObject();
            JSONArray printers = new JSONArray();
            synchronized (found) { for (JSObject d : found) printers.put(d); }
            ret.put("ok", true);
            ret.put("printers", printers);
            ret.put("message", printers.length() == 0
                ? "No new nearby devices found. Make sure the printer is ON and in range, then try again."
                : "Found " + printers.length() + " nearby device" + (printers.length() == 1 ? "" : "s") + ". Tap yours to pair it.");
            Log.i(TAG, "discoverBluetoothPrinters count=" + printers.length());
            call.resolve(ret);
        });
    }

    /**
     * In-app pairing — {@code createBond()} triggers the system pairing dialog inside
     * the app, so the seller never has to open Android Settings. Blocks (on the
     * executor thread) on an ACTION_BOND_STATE_CHANGED receiver until BONDED / NONE /
     * timeout. On success the web then calls {@link #setBluetoothLabelPrinter} to save
     * it. AIMO is unaffected (this is only called for freshly-discovered, unpaired
     * devices; already-bonded devices skip straight to save).
     */
    @PluginMethod
    public void bondBluetoothDevice(PluginCall call) {
        String addressRaw = call.getString("address", "");
        final String address = addressRaw == null ? "" : addressRaw.trim();
        if (address.isEmpty()) {
            call.reject("Bluetooth address is required", "BT_ADDR_REQUIRED");
            return;
        }
        if (!hasBluetoothConnectPermission()) {
            requestBluetoothPermissions();
            call.reject("Bluetooth permission needed. Allow it then tap Pair again.", "BT_PERMISSION");
            return;
        }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Bluetooth not supported on this device", "BT_NO_ADAPTER");
            return;
        }
        executor.execute(() -> {
            BroadcastReceiver receiver = null;
            try {
                try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
                @SuppressLint("MissingPermission")
                BluetoothDevice device = adapter.getRemoteDevice(address);
                if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                    resolveBond(call, device, true, "Already paired.");
                    return;
                }
                final Object lock = new Object();
                final boolean[] settled = {false};
                final boolean[] bonded = {false};
                receiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        if (!BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(intent.getAction())) return;
                        BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                        if (d == null || !address.equals(d.getAddress())) return;
                        int state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                        if (state == BluetoothDevice.BOND_BONDED || state == BluetoothDevice.BOND_NONE) {
                            synchronized (lock) { bonded[0] = state == BluetoothDevice.BOND_BONDED; settled[0] = true; lock.notifyAll(); }
                        }
                    }
                };
                getContext().registerReceiver(receiver, new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED));
                @SuppressLint("MissingPermission")
                boolean started = device.createBond();
                if (!started && device.getBondState() != BluetoothDevice.BOND_BONDING) {
                    boolean already = device.getBondState() == BluetoothDevice.BOND_BONDED;
                    resolveBond(call, device, already, already ? "Already paired." : "Couldn't start pairing. Make sure the printer is on and in range.");
                    return;
                }
                // Wait for the user to complete the system pairing dialog (30s cap).
                synchronized (lock) {
                    long end = System.currentTimeMillis() + 30000;
                    long remaining;
                    while (!settled[0] && (remaining = end - System.currentTimeMillis()) > 0) {
                        lock.wait(remaining);
                    }
                }
                boolean ok = bonded[0] || device.getBondState() == BluetoothDevice.BOND_BONDED;
                resolveBond(call, device, ok, ok ? "Paired successfully." : "Pairing timed out or was cancelled. Try again.");
            } catch (SecurityException e) {
                Log.e(TAG, "bondBluetoothDevice permission denied", e);
                call.reject("Bluetooth permission denied: " + e.getMessage(), "BT_PERMISSION", e);
            } catch (Exception e) {
                Log.e(TAG, "bondBluetoothDevice failed", e);
                call.reject("Pairing failed: " + e.getMessage(), "BT_BOND_FAILED", e);
            } finally {
                if (receiver != null) try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) {}
            }
        });
    }

    @SuppressLint("MissingPermission")
    private void resolveBond(PluginCall call, BluetoothDevice device, boolean bonded, String message) {
        JSObject ret = new JSObject();
        ret.put("ok", bonded);
        ret.put("bonded", bonded);
        ret.put("address", device.getAddress());
        String name;
        try { name = device.getName(); } catch (Exception e) { name = null; }
        ret.put("name", name == null || name.trim().isEmpty() ? device.getAddress() : name);
        ret.put("message", message);
        Log.i(TAG, "bondBluetoothDevice result address=" + device.getAddress() + " bonded=" + bonded);
        call.resolve(ret);
    }

    /**
     * Primary sticker print path for printers (like the AIMO D520BT) that
     * accept TSPL TEXT + BAR but ignore BITMAP. The frontend hands over
     * structured slip data (storeName / sessionDate / currency / buyer with
     * num/name/handle/orders/totalSpent / printer settings flags) and the
     * native side builds the TSPL command stream via TsplBuilder.forStickerNative
     * — no bitmap rendering, no html2canvas, no BITMAP command. Same SPP
     * write path as printSticker so all the connection/permission/retry
     * plumbing is shared.
     */
    @PluginMethod
    public void printStickerNative(PluginCall call) {
        String address = prefs().getString(PREF_BT_ADDR, "");
        Log.i(TAG, "printStickerNative start address=" + address);
        if (address == null || address.isEmpty()) {
            call.reject("No Bluetooth printer saved. Tap Scan in Settings and pick a printer first.", "BT_NOT_SET");
            return;
        }
        if (!hasBluetoothConnectPermission()) {
            requestBluetoothPermissions();
            call.reject("Bluetooth permission needed. Allow it then tap Print again.", "BT_PERMISSION");
            return;
        }
        final JSObject jsPayload = call.getData();
        // Saved printer NAME picks the builder profile (read on the main thread,
        // like `address`): a name starting "PM-241" routes to the Phomemo 241 fork,
        // everything else (incl. AIMO D520BT) stays the golden-locked AIMO path.
        final String savedName = prefs().getString(PREF_BT_NAME, "");
        executor.execute(() -> {
            try {
                JSONObject payload = jsPayload == null
                    ? new JSONObject()
                    : new JSONObject(jsPayload.toString());
                // Label size comes from the web payload (parsed from the seller's
                // stickerSize setting); fall back to the AIMO default if absent.
                int labelWidthMm = payload.optInt("labelWidthMm", LABEL_WIDTH_MM);
                int labelHeightMm = payload.optInt("labelHeightMm", LABEL_HEIGHT_MM);

                // ── Phomemo 241 profile (isolated fork; AIMO untouched below) ──
                if (Phomemo241Builder.isPhomemo241(savedName)) {
                    print241(call, payload, address, labelWidthMm, labelHeightMm);
                    return;
                }

                byte[] tspl = TsplBuilder.forStickerNative(payload, labelWidthMm, labelHeightMm);
                sendViaBluetoothSpp(address, tspl);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("bytes", tspl.length);
                ret.put("savedPrinter", savedBluetoothPrinter());
                ret.put("message", "Printed sticker via Bluetooth (TEXT+BAR, " + tspl.length + " bytes)");
                Log.i(TAG, "printStickerNative success bytes=" + tspl.length);
                call.resolve(ret);
            } catch (SecurityException e) {
                Log.e(TAG, "printStickerNative permission denied", e);
                call.reject("Bluetooth permission denied: " + e.getMessage(), "BT_PERMISSION", e);
            } catch (Exception e) {
                Log.e(TAG, "printStickerNative failed", e);
                call.reject("Bluetooth print failed: " + e.getMessage(), "BT_PRINT_FAILED", e);
            }
        });
    }

    /**
     * Phomemo 241 sticker print (isolated from the AIMO path). Runs on the
     * executor thread; the caller wraps it in the shared SPP/permission try/catch.
     *
     *  - isTest → a fixed CJK VERIFICATION sticker (陳小美 name band + 紅色洋裝 x2
     *    product band = multiple BITMAPs + Latin lines) so a device photo proves
     *    the Noto CJK raster path. Mirrors iOS run241VerificationPrint.
     *  - real order → gated by {@link #PHOMEMO_241_ORDERS_ENABLED} (Phase 1). When
     *    enabled: ORDER-PER-STICKER on EVERY size (all sizes are one-row as of
     *    2026-07-18) — a >1-order buyer prints N single-order labels concatenated on
     *    ONE SPP write (SPP has no DONE notify, so sequencing is stream + tail-out,
     *    not DONE-gated). Live flows pass a single-order buyer → N=1 (byte-identical
     *    to the single path).
     */
    private void print241(PluginCall call, JSONObject payload, String address, int labelWidthMm, int labelHeightMm) throws Exception {
        Phomemo241Builder.BandRenderer renderer = new Phomemo241Raster();

        if (payload.optBoolean("isTest", false)) {
            // P3.7 style window: the font sampler replaces the verification sticker
            // while FONT_SAMPLER_MODE is on (see the constant's doc).
            if (FONT_SAMPLER_MODE) {
                byte[] fs = build241FontSampler(labelWidthMm, labelHeightMm);
                sendViaBluetoothSpp(address, fs);
                JSObject fret = new JSObject();
                fret.put("ok", true);
                fret.put("fontSampler", true);
                fret.put("bytes", fs.length);
                fret.put("savedPrinter", savedBluetoothPrinter());
                fret.put("message", "FONT STYLE SAMPLER sent (" + fs.length + " bytes) — pick the row (1-5) that matches the AIMO look.");
                Log.i(TAG, "print241 FONT sampler bytes=" + fs.length);
                call.resolve(fret);
                return;
            }
            // P3 tuning window: the bold sampler replaces the verification sticker
            // while BOLD_SAMPLER_MODE is on (see the constant's doc).
            if (BOLD_SAMPLER_MODE) {
                byte[] sampler = build241BoldSampler(labelWidthMm, labelHeightMm);
                sendViaBluetoothSpp(address, sampler);
                JSObject sret = new JSObject();
                sret.put("ok", true);
                sret.put("sampler", true);
                sret.put("bytes", sampler.length);
                sret.put("savedPrinter", savedBluetoothPrinter());
                sret.put("message", "BOLD SAMPLER sent (" + sampler.length + " bytes) — pick the best-looking row number (1-7).");
                Log.i(TAG, "print241 BOLD sampler bytes=" + sampler.length);
                call.resolve(sret);
                return;
            }
            // P1 measurement window: the ruler pattern replaces the verification
            // sticker while RULER_TEST_MODE is on (see the constant's doc).
            if (RULER_TEST_MODE) {
                byte[] ruler = Phomemo241Builder.rulerTestPage(labelWidthMm, labelHeightMm);
                sendViaBluetoothSpp(address, ruler);
                JSObject rret = new JSObject();
                rret.put("ok", true);
                rret.put("ruler", true);
                rret.put("bytes", ruler.length);
                rret.put("savedPrinter", savedBluetoothPrinter());
                rret.put("message", "RULER test print sent (" + ruler.length + " bytes) — pen-mark the print number, note the smallest surviving tick on each edge.");
                Log.i(TAG, "print241 RULER test bytes=" + ruler.length);
                call.resolve(rret);
                return;
            }
            byte[] tspl = Phomemo241Builder.forStickerNative241(build241VerificationPayload(payload, labelWidthMm, labelHeightMm), labelWidthMm, labelHeightMm, renderer);
            sendViaBluetoothSpp(address, tspl);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("phase1", true);
            ret.put("bytes", tspl.length);
            ret.put("savedPrinter", savedBluetoothPrinter());
            ret.put("message", "241 verification sticker sent (" + tspl.length + " bytes) — check: HEADER exits first + upright, Latin sharp, \u9673\u5C0F\u7F8E + \u7D05\u8272\u6D0B\u88DD legible.");
            Log.i(TAG, "print241 verification bytes=" + tspl.length);
            call.resolve(ret);
            return;
        }

        // PHASE 1 ORDER GUARD — see PHOMEMO_241_ORDERS_ENABLED. Flip that constant to
        // true (one line) once the device Test Print passes photo review.
        if (!PHOMEMO_241_ORDERS_ENABLED) {
            Log.i(TAG, "print241 real order gated (PROFILE_NOT_READY) — order already saved by caller");
            call.reject("Phomemo 241 sticker printing is being verified — run a Test Print first.", "PROFILE_NOT_READY");
            return;
        }

        JSONObject buyer = payload.optJSONObject("buyer");
        JSONArray orders = buyer == null ? null : buyer.optJSONArray("orders");
        byte[] tspl;
        int labels = 1;
        // P2.5: the vertical planner reports any dropped rows here (extreme case only)
        // — logged for now; a P4 preview warning will surface it to the seller.
        java.util.List<String> dropped = new java.util.ArrayList<>();
        // ORDER-PER-STICKER on EVERY size now (Jeff, 2026-07-18: all sizes are one-row).
        // A >1-order buyer prints N single-order labels concatenated on ONE SPP write
        // (SPP has no DONE notify, so sequencing is stream + tail-out). Live flows pass
        // a single-order buyer → N=1 (byte-identical to the single path).
        if (orders != null && orders.length() > 1) {
            ByteArrayOutputStream combined = new ByteArrayOutputStream();
            for (int i = 0; i < orders.length(); i++) {
                JSONObject o = orders.optJSONObject(i);
                if (o == null) continue;
                JSONObject singlePayload = new JSONObject(payload.toString());
                JSONObject singleBuyer = new JSONObject(buyer.toString());
                JSONArray one = new JSONArray();
                one.put(o);
                singleBuyer.put("orders", one);
                singlePayload.put("buyer", singleBuyer);
                byte[] part = Phomemo241Builder.forStickerNative241(singlePayload, labelWidthMm, labelHeightMm, renderer, dropped);
                combined.write(part, 0, part.length);
            }
            tspl = combined.toByteArray();
            labels = orders.length();
        } else {
            tspl = Phomemo241Builder.forStickerNative241(payload, labelWidthMm, labelHeightMm, renderer, dropped);
        }
        if (!dropped.isEmpty()) {
            Log.w(TAG, "print241 vertical planner dropped rows (extreme layout): " + dropped);
        }
        sendViaBluetoothSpp(address, tspl);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("bytes", tspl.length);
        ret.put("labels", labels);
        ret.put("savedPrinter", savedBluetoothPrinter());
        ret.put("message", "Printed " + labels + " sticker(s) via Bluetooth (" + tspl.length + " bytes)");
        Log.i(TAG, "print241 success labels=" + labels + " bytes=" + tspl.length);
        call.resolve(ret);
    }

    /**
     * Fixed CJK verification payload for the 241 Test Print — 陳小美 name band +
     * 紅色洋裝 x2 (CJK product band) + a Latin order, at the seller's own label size
     * + store name. Deterministic content so the CJK render stays a repeatable proof,
     * but the seller's LIVE print-pattern settings + decimal size adjusters are now
     * carried through (was dropped) so the Test Print reflects the pattern the seller
     * is editing — matching the AIMO test-print behaviour. Without this the pattern
     * toggles/sizes had no effect on the 241 test ("LIVE print pattern not working").
     */
    private JSONObject build241VerificationPayload(JSONObject src, int labelWidthMm, int labelHeightMm) throws org.json.JSONException {
        JSONObject buyer = new JSONObject();
        buyer.put("num", 88);
        buyer.put("name", "\u9673\u5C0F\u7F8E");   // 陳小美
        buyer.put("handle", "sellerflow");
        buyer.put("totalSpent", 1200);
        JSONArray orders = new JSONArray();
        JSONObject o1 = new JSONObject();
        o1.put("item", "\u7D05\u8272\u6D0B\u88DD x2");   // 紅色洋裝 x2
        o1.put("time", "20:15");
        JSONObject o2 = new JSONObject();
        o2.put("item", "Blue jeans M");
        o2.put("time", "20:18");
        orders.put(o1);
        orders.put(o2);
        buyer.put("orders", orders);

        JSONObject p = new JSONObject();
        p.put("buyer", buyer);
        p.put("storeName", src.optString("storeName", "SellerFlowLive"));
        p.put("currency", "NT$");
        p.put("sessionDate", "07/17/2026");
        p.put("labelWidthMm", labelWidthMm);
        p.put("labelHeightMm", labelHeightMm);
        // Carry the seller's LIVE print-pattern settings + decimal scalesRaw so the
        // Test Print honours the pattern (field toggles + per-field sizes) exactly
        // like a real order / the AIMO test. Absent → builder defaults (unchanged).
        JSONObject settings = src.optJSONObject("settings");
        if (settings != null) p.put("settings", settings);
        JSONObject scalesRaw = src.optJSONObject("scalesRaw");
        if (scalesRaw != null) p.put("scalesRaw", scalesRaw);
        // P4: per-field weight routing rides along too (absent -> fork defaults).
        JSONObject weightsRaw = src.optJSONObject("weightsRaw");
        if (weightsRaw != null) p.put("weightsRaw", weightsRaw);
        return p;
    }

    /**
     * P3 BOLD SAMPLER — one label, 7 numbered rows of "Buyer #88" + 陳小美 at
     * candidate weight settings, so ONE print tunes the bold rendering:
     *   row 1: stroke 0.0, threshold 128   row 2: stroke 0.0, threshold 160
     *   row 3: stroke 1.5, threshold 128   row 4: stroke 1.5, threshold 160
     *   row 5: stroke 2.5, threshold 128   row 6: stroke 2.5, threshold 160
     *   row 7: DOUBLE-STRIKE TEXT experiment (font 4 printed twice, +1 dot) — ASCII
     *          only; the 241 has no CJK ROM so 陳小美 cannot appear on this row.
     * Rows 1-6 use Phomemo241Raster.renderTuning (bold typeface always) at the
     * production primary size (4/3 mul = 32-dot cell). Reading-space layout with
     * the same guard-free DIR0+180 flip as the ruler (content sits well inboard).
     * Jeff picks the best row; its stroke/threshold become BOLD_STROKE_DOTS /
     * BOLD_THRESHOLD, then BOLD_SAMPLER_MODE flips back to false.
     */
    private byte[] build241BoldSampler(int labelWidthMm, int labelHeightMm) throws Exception {
        final int W = labelWidthMm * 8, H = labelHeightMm * 8;
        final Phomemo241Raster raster = new Phomemo241Raster();
        ByteArrayOutputStream out = new ByteArrayOutputStream(4096);
        Charset ascii = Charset.forName("US-ASCII");
        for (String cmd : new String[]{
                "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm",
                "GAP 2 mm, 0", "DIRECTION 0", "REFERENCE 0,0", "DENSITY 8", "CLS"}) {
            out.write(cmd.getBytes(ascii)); out.write('\r'); out.write('\n');
        }
        float[] strokes = {0f, 0f, 1.5f, 1.5f, 2.5f, 2.5f};
        int[] thresholds = {128, 160, 128, 160, 128, 160};
        double mul = 4.0 / 3.0;   // the production primary cell (32-dot) at scale 1
        int maxAsciiW = 200, maxCjkW = 140;
        for (int row = 1; row <= 7; row++) {
            int ay = 24 + (row - 1) * 40;
            // row-number label (reading x=24)
            out.write(("TEXT " + (W - 24) + "," + (H - ay) + ",\"2\",180,1,1,\"" + row + "\"").getBytes(ascii));
            out.write('\r'); out.write('\n');
            if (row <= 6) {
                Phomemo241Builder.Band a = raster.renderTuning("Buyer #88", mul, maxAsciiW, strokes[row - 1], thresholds[row - 1]);
                if (a != null) writeSamplerBand(out, ascii, W, H, 64, ay, a);
                Phomemo241Builder.Band c = raster.renderTuning("陳小美", mul, maxCjkW, strokes[row - 1], thresholds[row - 1]);
                if (c != null) writeSamplerBand(out, ascii, W, H, 300, ay, c);
            } else {
                // double-strike TEXT experiment: the same font-4 line twice, +1 dot.
                out.write(("TEXT " + (W - 64) + "," + (H - ay) + ",\"4\",180,1,1,\"Buyer #88\"").getBytes(ascii));
                out.write('\r'); out.write('\n');
                out.write(("TEXT " + (W - 65) + "," + (H - ay) + ",\"4\",180,1,1,\"Buyer #88\"").getBytes(ascii));
                out.write('\r'); out.write('\n');
            }
        }
        out.write("PRINT 1".getBytes(ascii)); out.write('\r'); out.write('\n');
        return out.toByteArray();
    }

    /**
     * P3.7 FONT STYLE SAMPLER — one label, numbered rows of "Buyer #16" in candidate
     * enlarged-ASCII renderings (the AIMO "sexy" hunt):
     *   row 1: CURRENT production bold band (reference — the "buntis" look)
     *   row 2: ROM-EMULATION — regular weight @32-cell, x2 column stretch (thin
     *          strokes that WIDEN, the AIMO x2 mechanism; ~37-dot chars — the
     *          closest integer-stretch match to the AIMO geometry)
     *   row 3: ROM-emulation + letter-spacing 0.1em (extra air between chars)
     *   row 4: NATURAL — regular weight @48-cell, no stretch (~28-dot chars, tall+thin)
     *   row 5: ROM-emulation + very light stroke 0.5 (gitna)
     *   row 6: "150 250 600" price digits in ROM-emulation (the price-marquee look)
     *   row C: 陳小美 at the APPROVED P3 CJK tuning — REFERENCE ONLY, CJK unchanged.
     * VERDICT (2026-07-18): ROW 2's mechanism at ROW C's weight — now the shipped
     * production style (see FONT_SAMPLER_MODE doc). Retained as a diagnostic.
     */
    private byte[] build241FontSampler(int labelWidthMm, int labelHeightMm) throws Exception {
        final int W = labelWidthMm * 8, H = labelHeightMm * 8;
        final Phomemo241Raster raster = new Phomemo241Raster();
        ByteArrayOutputStream out = new ByteArrayOutputStream(4096);
        Charset ascii = Charset.forName("US-ASCII");
        for (String cmd : new String[]{
                "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm",
                "GAP 2 mm, 0", "DIRECTION 0", "REFERENCE 0,0", "DENSITY 8", "CLS"}) {
            out.write(cmd.getBytes(ascii)); out.write('\r'); out.write('\n');
        }
        int maxW = W - 60 - 16 - 44;   // sample column budget (label x=24, sample x=60, right inset)
        String sample = "Buyer #16";
        for (int row = 1; row <= 7; row++) {
            int ay = 14 + (row - 1) * 42;
            String label = row == 7 ? "C" : String.valueOf(row);
            out.write(("TEXT " + (W - 24) + "," + (H - ay) + ",\"2\",180,1,1,\"" + label + "\"").getBytes(ascii));
            out.write('\r'); out.write('\n');
            Phomemo241Builder.Band b;
            switch (row) {
                case 1:  b = raster.render(sample, Phomemo241Builder.AIMO_CHAR48_X, 2.0, maxW, true); break;      // current bold
                case 2:  b = raster.renderRom(sample, 32, 2, 0f, 0f, 128, maxW); break;                            // ROM-emu x2
                case 3:  b = raster.renderRom(sample, 32, 2, 0.1f, 0f, 128, maxW); break;                          // + spacing
                case 4:  b = raster.renderRom(sample, 48, 1, 0f, 0f, 128, maxW); break;                            // natural 48
                case 5:  b = raster.renderRom(sample, 32, 2, 0f, 0.5f, 128, maxW); break;                          // + light stroke
                case 6:  b = raster.renderRom("150 250 600", 32, 2, 0f, 0f, 128, maxW); break;                     // price digits
                default: b = raster.render("陳小美", 2.0, 2.0, maxW, true); break;                     // CJK reference
            }
            if (b != null) writeSamplerBand(out, ascii, W, H, 60, ay, b);
        }
        out.write("PRINT 1".getBytes(ascii)); out.write('\r'); out.write('\n');
        return out.toByteArray();
    }

    /** Sampler band emit — the guard-free reading-space flip (bands are pre-rotated). */
    private static void writeSamplerBand(ByteArrayOutputStream out, Charset ascii, int W, int H, int ax, int ay, Phomemo241Builder.Band b) throws Exception {
        int bx = Math.max(0, W - ax - b.widthBytes * 8);
        int by = Math.max(0, H - ay - b.height);
        out.write(("BITMAP " + bx + "," + by + "," + b.widthBytes + "," + b.height + ",0,").getBytes(ascii));
        out.write(b.bytes);
        out.write('\r'); out.write('\n');
    }

    @PluginMethod
    public void testStickerPrint(PluginCall call) {
        String address = prefs().getString(PREF_BT_ADDR, "");
        Log.i(TAG, "testStickerPrint start address=" + address);
        if (address == null || address.isEmpty()) {
            call.reject("No Bluetooth printer saved. Tap Scan in Settings and pick a printer first.", "BT_NOT_SET");
            return;
        }
        if (!hasBluetoothConnectPermission()) {
            requestBluetoothPermissions();
            call.reject("Bluetooth permission needed. Allow it then tap Test again.", "BT_PERMISSION");
            return;
        }
        String storeName = call.getString("storeName", "SellerFlowLive");
        executor.execute(() -> {
            try {
                byte[] tspl = TsplBuilder.textTestPage(storeName, LABEL_WIDTH_MM, LABEL_HEIGHT_MM);
                sendViaBluetoothSpp(address, tspl);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("bytes", tspl.length);
                ret.put("message", "Test sticker sent (" + tspl.length + " bytes)");
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "testStickerPrint failed", e);
                call.reject("Test sticker failed: " + e.getMessage(), "BT_PRINT_FAILED", e);
            }
        });
    }


    // ── Bluetooth helpers ───────────────────────────────────────────────────

    private JSObject savedBluetoothPrinter() {
        String address = prefs().getString(PREF_BT_ADDR, "");
        if (address == null || address.isEmpty()) return null;
        String name = prefs().getString(PREF_BT_NAME, "");
        JSObject p = new JSObject();
        p.put("id", "bluetooth:" + address);
        p.put("address", address);
        p.put("name", name == null || name.isEmpty() ? "Bluetooth printer" : name);
        p.put("paired", true);
        return p;
    }

    @SuppressLint("MissingPermission")
    private JSObject bluetoothDeviceJson(BluetoothDevice device, boolean paired) {
        JSObject d = new JSObject();
        String address = device.getAddress();
        String name = "Bluetooth printer";
        try {
            String fetched = device.getName();
            if (fetched != null && !fetched.trim().isEmpty()) name = fetched;
            else name = address;
        } catch (Exception ignored) {}
        d.put("id", "bluetooth:" + address);
        d.put("address", address);
        d.put("name", name);
        d.put("paired", paired);
        return d;
    }

    private boolean hasBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        // Pre-Android 12 — BLUETOOTH + BLUETOOTH_ADMIN are normal perms auto-
        // granted at install; runtime ACCESS_FINE_LOCATION only matters for
        // discovery, not bonded-device read which we do here.
        return true;
    }

    private void requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                getActivity().runOnUiThread(() -> getActivity().requestPermissions(
                    new String[]{Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN},
                    8588
                ));
            } catch (Exception e) {
                Log.w(TAG, "requestBluetoothPermissions failed: " + e.getMessage());
            }
        }
    }

    // Scan/discovery permission (distinct from CONNECT): Android 12+ = BLUETOOTH_SCAN;
    // Android 6–11 (discovery still needs location) = ACCESS_FINE_LOCATION. Only the
    // NEW nearby-discovery path calls these — the bonded-only Scan + print flows keep
    // using hasBluetoothConnectPermission (unchanged), so AIMO users get no extra prompt.
    private boolean hasBluetoothScanPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }
        return true;   // pre-M: install-time permissions
    }

    private void requestBluetoothScanPermissions() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getActivity().runOnUiThread(() -> getActivity().requestPermissions(
                    new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT}, 8589));
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                getActivity().runOnUiThread(() -> getActivity().requestPermissions(
                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, 8589));
            }
        } catch (Exception e) {
            Log.w(TAG, "requestBluetoothScanPermissions failed: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    private void sendViaBluetoothSpp(String address, byte[] data) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new Exception("Bluetooth not supported");
        if (!adapter.isEnabled()) throw new Exception("Bluetooth is off");
        try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
        BluetoothDevice device = adapter.getRemoteDevice(address);
        // SPP socket via the universal Serial Port Profile UUID. Many TSPL/ESC-
        // POS printers also support insecure variant; we try secure first.
        BluetoothSocket socket = null;
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
            OutputStream output = socket.getOutputStream();
            output.write(data);
            output.flush();
            // Some printers need a brief tail-out window before the socket
            // closes, otherwise the last bytes get truncated on slow links.
            try { Thread.sleep(180); } catch (InterruptedException ignored) {}
        } finally {
            if (socket != null) {
                try { socket.close(); } catch (Exception ignored) {}
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        executor.shutdownNow();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String getSavedHost() {
        return cleanHost(prefs().getString(PREF_HOST, ""));
    }

    private int getSavedPort() {
        return prefs().getInt(PREF_PORT, DEFAULT_PORT);
    }

    private String cleanHost(String host) {
        return host == null ? "" : host.trim();
    }

    private JSObject printerConfig(String host, int port) {
        JSObject ret = new JSObject();
        ret.put("host", host);
        ret.put("port", port);
        ret.put("savedPrinter", savedPrinter(host, port));
        return ret;
    }

    private JSObject savedPrinter(String host, int port) {
        JSObject printer = new JSObject();
        if (host == null || host.isEmpty()) return printer;
        printer.put("id", "lan:" + host + ":" + port);
        printer.put("type", "lan");
        printer.put("name", "WiFi/LAN ESC-POS " + host);
        printer.put("host", host);
        printer.put("port", port);
        printer.put("online", true);
        printer.put("hint", "Raw TCP port " + port);
        return printer;
    }

    private void openAndClose(String host, int port) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        }
    }

    private void writeTcp(String host, int port, byte[] data) throws Exception {
        Log.i(TAG, "writeTcp connecting host=" + host + " port=" + port + " bytes=" + data.length);
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setSoTimeout(CONNECT_TIMEOUT_MS);
            OutputStream output = socket.getOutputStream();
            output.write(data);
            output.flush();
        }
        Log.i(TAG, "writeTcp complete host=" + host + " port=" + port);
    }

    private byte[] buildEscPosSlip(JSONObject payload) throws Exception {
        EscPos out = new EscPos();
        JSONObject buyer = payload.optJSONObject("buyer");
        if (buyer == null) buyer = new JSONObject();
        JSONArray orders = buyer.optJSONArray("orders");
        String storeName = payload.optString("storeName", "SellerFlowLive");
        String currency = payload.optString("currency", "PHP");

        // "Printer output" on/off toggles. Mirror of the iOS buildEscPosSlip and
        // the TSPL sticker builders, and of the web iframe in App.tsx printSlip.
        // Canonical contract: src/lib/slipFields.ts (slipFieldVisibility). Default
        // true so a payload without settings prints everything (backwards-compat).
        // NOTE: buyer Name has no toggle and always prints (matches every path).
        JSONObject settings        = payload.optJSONObject("settings");
        boolean printStoreName     = settings == null || settings.optBoolean("printStoreName", true);
        boolean printBuyerNumber   = settings == null || settings.optBoolean("printBuyerNumber", true);
        boolean printBuyerUsername = settings == null || settings.optBoolean("printBuyerUsername", true);
        boolean printOrderItems    = settings == null || settings.optBoolean("printOrderItems", true);
        // (slip TOTAL removed below — printTotal no longer read for the slip)

        out.init();
        out.alignCenter();
        out.bold(true);
        if (printStoreName) out.text(storeName);                        // normal -- header (gated)
        out.bold(false);
        out.text("SellerFlowLive");                                     // normal -- subtitle
        out.line();                                                     // normal -- divider
        out.alignLeft();

        out.setCharSize(ESC_POS_IMPORTANT_SIZE);                        // === IMPORTANT ===
        if (printBuyerNumber) out.text("Buyer #" + buyer.optInt("num", buyer.optInt("bNum", 0)));
        out.text("Name: " + buyer.optString("name", ""));              // buyer name -- no toggle, always
        if (printBuyerUsername) out.text("Handle: " + buyer.optString("handle", ""));
        out.setCharSize(0x00);                                          // === END IMPORTANT ===

        out.text("Platform: " + buyer.optString("platform", ""));       // normal -- header info
        out.text("Session: " + payload.optString("sessionDate", ""));   // normal -- header info
        out.line();                                                     // normal -- divider

        if (printOrderItems) {
            if (orders != null && orders.length() > 0) {
                for (int i = 0; i < orders.length(); i++) {
                    JSONObject order = orders.optJSONObject(i);
                    if (order == null) continue;

                    out.setCharSize(ESC_POS_ORDER_SIZE);                // === 2x (2Wx2H) -- item only ===
                    out.text(order.optString("item", ""));
                    out.setCharSize(0x00);                              // === normal -- order details ===
                    out.text("Qty: " + order.optInt("qty", 1));
                    // Per-order "Price:" + per-row "Total:" permanently removed (redundant
                    // with the item/price-code line above; slip de-cluttered, all slips).

                    String time = order.optString("time", "");
                    if (!time.isEmpty()) out.text(time);                // normal -- timestamp
                    out.line();                                         // normal -- divider
                }
            } else {
                out.text("Order:");                                    // normal -- label
                out.setCharSize(ESC_POS_ORDER_SIZE);                    // === 2x (2Wx2H) -- comment ===
                out.text(buyer.optString("lastComment", buyer.optString("comment", "")));
                out.setCharSize(0x00);                                  // === normal ===
                out.line();
            }
        }

        // Grand "TOTAL:" permanently removed (fixed; no setting can re-enable it).
        out.text("Created: " + payload.optString("createdAt", ""));     // normal -- timestamp
        out.feed(4);
        out.cut();
        return out.bytes();
    }

    private String money(double value) {
        if (Math.rint(value) == value) return String.valueOf((long) value);
        return String.format(java.util.Locale.US, "%.2f", value);
    }

    private static class EscPos {
        private final ByteArrayOutputStream out = new ByteArrayOutputStream();
        // One reusable encoder for the Big5-encodability test in text(). A print
        // job runs single-threaded, so reuse is safe.
        private final java.nio.charset.CharsetEncoder charsetEncoder = PRINTER_CHARSET.newEncoder();

        void init() {
            write(0x1B, 0x40);   // ESC @ -- reset to power-on defaults
            // FS & -- enter Kanji/Chinese double-byte mode so the printer renders
            // the GBK bytes with its internal Chinese font ROM (covers Traditional
            // + Simplified). Without it the XP-N160II reads each GBK byte as a
            // single-byte PC437 char and prints garbage. This is the ESC/POS analog
            // of the TSPL sticker selecting a Chinese font (TSS24.BF2) per line.
            // iOS receipt init sends the identical byte for parity.
            write(0x1C, 0x26);   // FS &
        }

        void alignLeft() {
            write(0x1B, 0x61, 0x00);
        }

        void alignCenter() {
            write(0x1B, 0x61, 0x01);
        }

        void bold(boolean enabled) {
            write(0x1B, 0x45, enabled ? 0x01 : 0x00);
        }

        // GS ! n -- character size. Use ESC_POS_IMPORTANT_SIZE for prominent
        // fields, 0x00 to return to normal. See constant comment for byte format.
        void setCharSize(int size) {
            write(0x1D, 0x21, size);
        }

        void text(String text) {
            if (text == null) text = "";
            byte[] bytes = stripUnencodable(text).getBytes(PRINTER_CHARSET);
            out.write(bytes, 0, bytes.length);
            out.write(0x0A);
        }

        // Drop any codepoint the receipt charset (Big5) cannot encode -- emoji,
        // flags (regional-indicator pairs), ZWJ, variation selectors, and any
        // non-Big5 symbol -- BEFORE encoding, so they never reach the printer as
        // '?' or garbage. ASCII and Traditional Chinese are Big5-encodable and
        // pass through untouched. Iterating by codepoint (not char) removes every
        // half of a surrogate-pair emoji and every joiner, leaving no fragment.
        private String stripUnencodable(String s) {
            StringBuilder sb = new StringBuilder(s.length());
            int i = 0;
            while (i < s.length()) {
                int cp = s.codePointAt(i);
                String ch = new String(Character.toChars(cp));
                if (charsetEncoder.canEncode(ch)) sb.append(ch);
                i += Character.charCount(cp);
            }
            return sb.toString();
        }

        void line() {
            text("--------------------------------");
        }

        void feed(int lines) {
            write(0x1B, 0x64, Math.max(1, Math.min(lines, 8)));
        }

        void cut() {
            write(0x1D, 0x56, 0x42, 0x00);
        }

        byte[] bytes() {
            return out.toByteArray();
        }

        private void write(int... values) {
            for (int value : values) out.write(value);
        }
    }
}
