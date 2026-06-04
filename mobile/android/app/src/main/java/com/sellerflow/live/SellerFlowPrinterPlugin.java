package com.sellerflow.live;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
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
import java.util.Locale;
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
    private static final Charset PRINTER_CHARSET = Charset.forName("GBK");
    // Classic Bluetooth SPP (Serial Port Profile) UUID — universal for ESC/POS
    // and TSPL thermal/label printers. AIMO D520BT, Xprinter, GP-, RPP all use this.
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    // Default label dimensions for AIMO D520BT sticker stock.
    private static final int LABEL_WIDTH_MM = 100;
    private static final int LABEL_HEIGHT_MM = 60;

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
                    for (BluetoothDevice device : bonded) {
                        JSObject d = bluetoothDeviceJson(device, true);
                        if (looksLikeLabelPrinter(d.optString("name", ""))) {
                            printers.put(d);
                        }
                    }
                    // If no obvious printer-named devices, surface ALL paired
                    // devices so the seller can still pick one (helpful for
                    // generic names like "BT-Printer" or unbranded clones).
                    if (printers.length() == 0) {
                        for (BluetoothDevice device : bonded) printers.put(bluetoothDeviceJson(device, true));
                    }
                }
                ret.put("ok", true);
                ret.put("printers", printers);
                ret.put("savedPrinter", savedBluetoothPrinter());
                ret.put("message", printers.length() == 0
                    ? "No paired Bluetooth printer found. Pair the printer in Android Settings first."
                    : "Found " + printers.length() + " paired Bluetooth printer" + (printers.length() == 1 ? "" : "s"));
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

    @PluginMethod
    public void printSticker(PluginCall call) {
        String bitmapBase64 = call.getString("bitmapBase64", "");
        int widthDots = call.getInt("widthDots", 800);
        int heightDots = call.getInt("heightDots", 480);
        String address = prefs().getString(PREF_BT_ADDR, "");
        Log.i(TAG, "printSticker start widthDots=" + widthDots + " heightDots=" + heightDots + " address=" + address);

        if (address == null || address.isEmpty()) {
            call.reject("No Bluetooth printer saved. Tap Scan in Settings and pick a printer first.", "BT_NOT_SET");
            return;
        }
        if (bitmapBase64 == null || bitmapBase64.isEmpty()) {
            call.reject("bitmapBase64 payload is required", "BITMAP_REQUIRED");
            return;
        }
        if (!hasBluetoothConnectPermission()) {
            requestBluetoothPermissions();
            call.reject("Bluetooth permission needed. Allow it then tap Print again.", "BT_PERMISSION");
            return;
        }

        executor.execute(() -> {
            try {
                byte[] tspl = TsplBuilder.forSticker(bitmapBase64, widthDots, heightDots, LABEL_WIDTH_MM, LABEL_HEIGHT_MM);
                sendViaBluetoothSpp(address, tspl);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("bytes", tspl.length);
                ret.put("savedPrinter", savedBluetoothPrinter());
                ret.put("message", "Printed sticker via Bluetooth (" + tspl.length + " bytes)");
                Log.i(TAG, "printSticker success bytes=" + tspl.length);
                call.resolve(ret);
            } catch (IllegalArgumentException e) {
                Log.e(TAG, "printSticker bitmap rejected", e);
                call.reject(e.getMessage(), "BITMAP_INVALID", e);
            } catch (SecurityException e) {
                Log.e(TAG, "printSticker permission denied", e);
                call.reject("Bluetooth permission denied: " + e.getMessage(), "BT_PERMISSION", e);
            } catch (Exception e) {
                Log.e(TAG, "printSticker failed", e);
                call.reject("Bluetooth print failed: " + e.getMessage(), "BT_PRINT_FAILED", e);
            }
        });
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

    private boolean looksLikeLabelPrinter(String rawName) {
        String name = rawName == null ? "" : rawName.toLowerCase(Locale.ROOT);
        return name.contains("aimo")
            || name.contains("tsc")
            || name.contains("label")
            || name.contains("sticker")
            || name.contains("thermal")
            || name.contains("printer")
            || name.contains("xprinter")
            || name.contains("xp-")
            || name.contains("gprinter")
            || name.contains("gp-")
            || name.contains("rpp")
            || name.contains("mpt")
            || name.contains("pos")
            || name.contains("d520")
            || name.contains("munbyn")
            || name.contains("netum")
            || name.contains("58")
            || name.contains("80");
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

        out.init();
        out.alignCenter();
        out.bold(true);
        out.text(storeName);                                            // normal -- header
        out.bold(false);
        out.text("SellerFlowLive");                                     // normal -- subtitle
        out.line();                                                     // normal -- divider
        out.alignLeft();

        out.setCharSize(ESC_POS_IMPORTANT_SIZE);                        // === IMPORTANT ===
        out.text("Buyer #" + buyer.optInt("num", buyer.optInt("bNum", 0)));
        out.text("Name: " + buyer.optString("name", ""));
        out.text("Handle: " + buyer.optString("handle", ""));
        out.setCharSize(0x00);                                          // === END IMPORTANT ===

        out.text("Platform: " + buyer.optString("platform", ""));       // normal -- header info
        out.text("Session: " + payload.optString("sessionDate", ""));   // normal -- header info
        out.line();                                                     // normal -- divider

        if (orders != null && orders.length() > 0) {
            for (int i = 0; i < orders.length(); i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;

                out.setCharSize(ESC_POS_IMPORTANT_SIZE);                // === IMPORTANT ===
                out.bold(true);
                out.text("Order #" + order.optInt("orderNum", i + 1));
                out.bold(false);
                out.text(order.optString("item", ""));
                out.text("Qty: " + order.optInt("qty", 1));
                double price = order.optDouble("price", 0);
                double total = order.optDouble("total", price);
                if (price > 0) out.text("Price: " + currency + " " + money(price));
                if (total > 0) out.text("Total: " + currency + " " + money(total));
                out.setCharSize(0x00);                                  // === END IMPORTANT ===

                String time = order.optString("time", "");
                if (!time.isEmpty()) out.text(time);                    // normal -- timestamp
                out.line();                                             // normal -- divider
            }
        } else {
            out.setCharSize(ESC_POS_IMPORTANT_SIZE);                    // === IMPORTANT ===
            out.text("Order:");
            out.text(buyer.optString("lastComment", buyer.optString("comment", "")));
            out.setCharSize(0x00);                                      // === END IMPORTANT ===
            out.line();
        }

        double totalSpent = buyer.optDouble("totalSpent", 0);
        if (totalSpent > 0) {
            out.setCharSize(ESC_POS_IMPORTANT_SIZE);                    // === IMPORTANT ===
            out.bold(true);
            out.text("TOTAL: " + currency + " " + money(totalSpent));
            out.bold(false);
            out.setCharSize(0x00);                                      // === END IMPORTANT ===
        }
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

        void init() {
            write(0x1B, 0x40);
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
            byte[] bytes = text.getBytes(PRINTER_CHARSET);
            out.write(bytes, 0, bytes.length);
            out.write(0x0A);
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
