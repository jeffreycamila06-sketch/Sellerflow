package com.sellerflow.live;

import android.annotation.SuppressLint;
import android.app.Application;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.util.Base64;
import android.util.Log;
import com.gengcon.www.jcprintersdk.JCPrintApi;
import com.gengcon.www.jcprintersdk.callback.Callback;
import com.gengcon.www.jcprintersdk.callback.PrintCallback;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Niimbot label printers (B1 / B21 / D11 / D110 / …) through the vendor SDK
 * (libs/4.1.1-release.aar + image-1.9.5.aar). Printer setup v2, Part 8 — a SEPARATE
 * transport: the D520BT (BleStickerTransport), generic BLE (GenericBleTransport) and
 * classic SPP paths are untouched.
 *
 * Job = the SAME sticker image the app renders (1-bit, bit 1 = ink), printed as a label:
 *   resolve the printer's CLASSIC (BR/EDR) device → pair over BR/EDR (system prompt) if
 *   needed → connectBluetoothPrinter(classic address) →
 *   startPrintJob(density, 1 copy, paper 1 = gap) → onBufferFree: drawEmptyLabel +
 *   drawLabelImage(PNG) + generateLabelJson + commitData → onProgress(1,1): endPrintJob →
 *   done. The SDK's error codes become seller-level codes (NIIMBOT_NO_PAPER, …).
 * Single-flight. ⚠️ Mirrors the call sequence of the zh4dev/niimbot-printer reference
 * (MIT); the SDK itself is NIIMBOT's — usage permission requested separately.
 */
final class NiimbotTransport {
    private static final String TAG = "SellerFlowNiimbot";
    private static final long PAIR_TIMEOUT_MS = 20_000L;
    private static final long PRINT_TIMEOUT_MS = 30_000L;
    /** Classic inquiry budget (an Android inquiry cycle is ~12 s; ends early when the printer shows up). */
    static final long CLASSIC_DISCOVERY_MS = 12_500L;
    // Bond-wait outcomes (pure, see bondOutcome)
    static final int BOND_WAIT = 0, BOND_DONE = 1, BOND_DECLINED = 2;
    /** Dots per mm of the B-series 203 dpi head (the SDK's printMultiple for a B1 = 8). */
    static final int DOTS_PER_MM = 8;
    /**
     * The label image is drawn into a frame inset this much on every side (x=y=1, w=label−2,
     * h=label−2 on a 50×30 → 48×28 mm): the iOS twin is NiimbotImage.frameInsetMm, the web twin
     * printing.ts NIIMBOT_FRAME_INSET_MM. The web renders the sticker at EXACTLY the frame's dots
     * (384×224), so the SDK scales by 1.0 — a full-bleed frame made it rescale + re-threshold the
     * image and thin CJK strokes merged into blobs. The three MUST agree.
     */
    static final float FRAME_INSET_MM = 1f;

    /** The frame's size in dots for a label — what the image must measure for a true 1:1 print. */
    static int[] frameDots(float wMm, float hMm) {
        return new int[] { Math.round((wMm - 2 * FRAME_INSET_MM) * DOTS_PER_MM), Math.round((hMm - 2 * FRAME_INSET_MM) * DOTS_PER_MM) };
    }
    /** null when the image is exactly the frame's dots; otherwise the SIZE MISMATCH line to log (the SDK will scale). */
    static String sizeMismatch(int w, int h, float wMm, float hMm) {
        int[] f = frameDots(wMm, hMm);
        if (w == f[0] && h == f[1]) return null;
        return String.format(Locale.US, "SIZE MISMATCH image %dx%d != frame %dx%d dots (label %.0fx%.0f mm, inset %.0f mm) - the SDK will scale it",
            w, h, f[0], f[1], wMm, hMm, FRAME_INSET_MM);
    }

    static final class Result {
        final boolean ok; final String code; final String message;
        Result(boolean ok, String code, String message) { this.ok = ok; this.code = code; this.message = message; }
    }
    interface Done { void onResult(Result r); }

    private static JCPrintApi api;
    private static String connectedAddress = "";
    private final Application app;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);

    NiimbotTransport(Context context) { this.app = (Application) context.getApplicationContext(); }

    /** True when the SDK classes are in this build (the AARs are shipped). */
    static boolean isAvailable() {
        try { Class.forName("com.gengcon.www.jcprintersdk.JCPrintApi"); return true; } catch (Throwable t) { return false; }
    }

    // ── Classic-device resolution (pure helpers, JVM-tested) ─────────────────────────────────
    // THE BUG (Oct 26, Samsung A31 + B1, logcat): the scan list's Niimbot row comes from the BLE
    // scan, so the stack caches the B1 as an LE-only device (BTM_SecAddBleDevice dev_type=0x2);
    // createBond() on it pairs over LE (smp_send_pair_req) and the B1 answers PAIRING_FAILED in
    // ~100 ms — the SDK talks classic SPP only (UUID 00001101, no GATT), so the job never
    // started and the seller waited out the 20 s bond timeout. Fix = the zh4dev reference's
    // rule: give the SDK a CLASSIC/DUAL BluetoothDevice — an already-bonded device with the
    // printer's name (paired in phone settings), else a short classic discovery by name — and
    // pair THAT over BR/EDR. The BR/EDR address may differ from the LE-scan address.
    /** Same printer name, ignoring case/whitespace (the LE and BR/EDR names of a Niimbot match). */
    static boolean sameDeviceName(String a, String b) {
        if (a == null || b == null) return false;
        String x = a.trim(), y = b.trim();
        return !x.isEmpty() && x.equalsIgnoreCase(y);
    }
    /** BluetoothDevice.getType(): CLASSIC (1) or DUAL (3) can carry an RFCOMM/SPP link; LE (2) / UNKNOWN (0) cannot. */
    static boolean isClassicType(int deviceType) {
        return deviceType == BluetoothDevice.DEVICE_TYPE_CLASSIC || deviceType == BluetoothDevice.DEVICE_TYPE_DUAL;
    }
    /** A found device is OUR printer when it is classic-capable and matches by name (or by the row's address). */
    static boolean isOurClassicPrinter(int deviceType, String foundName, String foundAddress, String wantName, String wantAddress) {
        if (!isClassicType(deviceType)) return false;
        if (foundAddress != null && wantAddress != null && foundAddress.equalsIgnoreCase(wantAddress)) return true;
        return sameDeviceName(foundName, wantName);
    }
    /**
     * Bond-wait step: BONDED → done; BONDING → NONE (the phone or printer declined / the stack
     * gave up) → declined AT ONCE — never a silent wait to the timeout; else keep waiting.
     */
    static int bondOutcome(boolean sawBonding, int bondState) {
        if (bondState == BluetoothDevice.BOND_BONDED) return BOND_DONE;
        if (sawBonding && bondState == BluetoothDevice.BOND_NONE) return BOND_DECLINED;
        return BOND_WAIT;
    }

    /** An already-bonded device for this printer (paired in phone settings) — by address, else by name. */
    @SuppressLint("MissingPermission")
    static BluetoothDevice bondedClassicDevice(BluetoothAdapter adapter, String address, String name) {
        Set<BluetoothDevice> bonded;
        try { bonded = adapter.getBondedDevices(); } catch (Exception e) { return null; }
        if (bonded == null) return null;
        BluetoothDevice byName = null;
        for (BluetoothDevice d : bonded) {
            if (!isClassicType(d.getType())) continue;
            if (d.getAddress() != null && d.getAddress().equalsIgnoreCase(address)) return d;
            if (byName == null && sameDeviceName(d.getName(), name)) byName = d;
        }
        return byName;
    }

    /** Classic inquiry (startDiscovery) until the printer is seen by name/address, or the budget ends. */
    @SuppressLint("MissingPermission")
    private BluetoothDevice discoverClassicDevice(BluetoothAdapter adapter, String address, String name) {
        final AtomicReference<BluetoothDevice> found = new AtomicReference<>();
        final CountDownLatch done = new CountDownLatch(1);
        final BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent intent) {
                String action = intent.getAction();
                if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) { done.countDown(); return; }
                if (!BluetoothDevice.ACTION_FOUND.equals(action) && !BluetoothDevice.ACTION_NAME_CHANGED.equals(action)) return;
                BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (d == null) return;
                String n = d.getName();
                if (n == null) n = intent.getStringExtra(BluetoothDevice.EXTRA_NAME);
                if (isOurClassicPrinter(d.getType(), n, d.getAddress(), name, address) && found.compareAndSet(null, d)) done.countDown();
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothDevice.ACTION_NAME_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        try {
            app.registerReceiver(receiver, filter);
            try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
            if (!adapter.startDiscovery()) { Log.w(TAG, "classic discovery could not start"); return null; }
            done.await(CLASSIC_DISCOVERY_MS, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            Log.w(TAG, "classic discovery failed: " + e.getMessage());
        } finally {
            try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
            try { app.unregisterReceiver(receiver); } catch (Exception ignored) {}
        }
        return found.get();
    }

    /** The CLASSIC device the SDK can connect to, or null = not found nearby. */
    @SuppressLint("MissingPermission")
    private BluetoothDevice resolveClassicDevice(BluetoothAdapter adapter, String address, String name) {
        BluetoothDevice bonded = bondedClassicDevice(adapter, address, name);
        if (bonded != null) { Log.i(TAG, "classic device: bonded " + bonded.getAddress() + " type=" + bonded.getType()); return bonded; }
        BluetoothDevice known = adapter.getRemoteDevice(address);
        if (isClassicType(known.getType())) { Log.i(TAG, "classic device: known " + address + " type=" + known.getType()); return known; }
        Log.i(TAG, "classic device: " + address + " is type=" + known.getType() + " (LE/unknown) — classic discovery by name \"" + name + "\"");
        long t0 = System.currentTimeMillis();
        BluetoothDevice d = discoverClassicDevice(adapter, address, name);
        Log.i(TAG, "classic discovery " + (d == null ? "found nothing" : "found " + d.getAddress() + " type=" + d.getType()) + " in " + (System.currentTimeMillis() - t0) + " ms");
        return d;
    }

    /** Pair over BR/EDR only: createBond(TRANSPORT_BREDR) when the platform exposes it, else the public createBond() on a classic-typed device (= BR/EDR). */
    @SuppressLint("MissingPermission")
    private static boolean createBondBredr(BluetoothDevice device) {
        try {
            java.lang.reflect.Method m = BluetoothDevice.class.getMethod("createBond", int.class);
            Object r = m.invoke(device, 1 /* BluetoothDevice.TRANSPORT_BREDR */);
            Log.i(TAG, "createBond(TRANSPORT_BREDR) → " + r);
            return Boolean.TRUE.equals(r);
        } catch (Throwable t) {
            Log.i(TAG, "createBond(TRANSPORT_BREDR) unavailable (" + t.getClass().getSimpleName() + ") — createBond() on the classic device");
            return device.createBond();
        }
    }

    /** Print density: only B-series 50 mm models are listed (SDK docs: B-series 1–5, default 3). */
    static int densityFor(String name) {
        return 3;
    }

    /** SDK print error code → our seller-level code (the message stays the SDK's wording for the log). */
    static String codeFor(int sdkCode) {
        switch (sdkCode) {
            case 1: return "NIIMBOT_COVER_OPEN";
            case 2: return "NIIMBOT_NO_PAPER";
            case 3: case 4: return "NIIMBOT_LOW_BATTERY";
            case 16: case 28: return "NIIMBOT_PAPER_TYPE";
            case 23: return "BT_NOT_FOUND";
            case 9: return "BT_BUSY";
            default: return "NIIMBOT_ERROR";
        }
    }

    private static final Callback CALLBACK = new Callback() {
        @Override public void onConnectSuccess(String name, int status) {}
        @Override public void onDisConnect() { connectedAddress = ""; }
        @Override public void onElectricityChange(int electricity) {}
        @Override public void onCoverStatus(int status) {}
        @Override public void onPaperStatus(int status) {}
        @Override public void onRfidReadStatus(int status) {}
        @Override public void onRibbonStatus(int status) {}
        @Override public void onRibbonRfidReadStatus(int status) {}
        @Override public void onFirmErrors() {}
    };

    private synchronized JCPrintApi api() {
        if (api == null) {
            api = JCPrintApi.getInstance(CALLBACK);
            api.initSdk(app);
        }
        return api;
    }

    /** Packed 1-bit rows (MSB first, bit 1 = ink) → PNG → base64, the form drawLabelImage takes. */
    static String imageBase64(byte[] packed, int w, int h, int rowBytes) {
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                boolean ink = (packed[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) != 0;
                px[y * w + x] = ink ? 0xFF000000 : 0xFFFFFFFF;
            }
        }
        Bitmap bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
        bmp.recycle();
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    @SuppressLint("MissingPermission")
    void printImage(final String address, final String name, final byte[] packed, final int w, final int h, final int rowBytes,
                    final float wMm, final float hMm, final Done done) {
        if (!busy.compareAndSet(false, true)) { done.onResult(new Result(false, "BT_BUSY", "Another printer task is still in progress.")); return; }
        executor.execute(() -> {
            final AtomicBoolean completed = new AtomicBoolean(false);
            final Done finish = r -> { if (completed.compareAndSet(false, true)) { busy.set(false); done.onResult(r); } };
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null) { finish.onResult(new Result(false, "BT_UNAVAILABLE", "Bluetooth not supported")); return; }
                if (!adapter.isEnabled()) { finish.onResult(new Result(false, "BT_OFF", "Bluetooth is off")); return; }
                try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
                // The SDK talks classic Bluetooth (SPP): resolve the printer's CLASSIC device — the
                // scan row's address is usually the LE one (see the comment above the helpers).
                BluetoothDevice device = resolveClassicDevice(adapter, address, name);
                if (device == null) { finish.onResult(new Result(false, "NIIMBOT_NOT_FOUND", "Printer not found nearby")); return; }
                final String classicAddress = device.getAddress();
                if (device.getBondState() != BluetoothDevice.BOND_BONDED) {
                    if (!createBondBredr(device)) { finish.onResult(new Result(false, "NIIMBOT_PAIR_FAILED", "Could not start pairing")); return; }
                    long deadline = System.currentTimeMillis() + PAIR_TIMEOUT_MS;
                    boolean sawBonding = false;
                    int outcome = BOND_WAIT;
                    while (outcome == BOND_WAIT && System.currentTimeMillis() < deadline) {
                        Thread.sleep(250L);
                        int state = device.getBondState();
                        if (state == BluetoothDevice.BOND_BONDING) sawBonding = true;
                        outcome = bondOutcome(sawBonding, state);
                    }
                    Log.i(TAG, "bond " + classicAddress + " → " + (outcome == BOND_DONE ? "bonded" : outcome == BOND_DECLINED ? "DECLINED" : "timeout") + " (sawBonding=" + sawBonding + ")");
                    if (outcome == BOND_DECLINED) { finish.onResult(new Result(false, "NIIMBOT_PAIR_DECLINED", "Pairing was declined")); return; }
                    if (outcome != BOND_DONE) { finish.onResult(new Result(false, "NIIMBOT_PAIR_FAILED", "Pairing was not confirmed")); return; }
                }

                JCPrintApi a = api();
                if (!classicAddress.equalsIgnoreCase(connectedAddress) || a.isConnection() != 0) {
                    if (!connectedAddress.isEmpty()) { try { a.close(); } catch (Exception ignored) {} connectedAddress = ""; }
                    int rc = a.connectBluetoothPrinter(classicAddress);
                    Log.i(TAG, "connectBluetoothPrinter(" + classicAddress + ") rc=" + rc);
                    if (rc == -1) { finish.onResult(new Result(false, "BT_NOT_FOUND", "Could not connect to the printer")); return; }
                    if (rc != 0) { finish.onResult(new Result(false, "BT_NOT_SUPPORTED", "This printer model is not supported by the driver")); return; }
                    connectedAddress = classicAddress;
                }

                final String png = imageBase64(packed, w, h, rowBytes);
                final String mismatch = sizeMismatch(w, h, wMm, hMm);
                if (mismatch != null) Log.w(TAG, mismatch); else Log.i(TAG, "image " + w + "x" + h + " = the frame's dots (1:1)");
                final int density = densityFor(name);
                final AtomicBoolean committed = new AtomicBoolean(false);
                a.setTotalPrintQuantity(1);
                a.startPrintJob(density, 1, 1, new PrintCallback() {
                    @Override public void onProgress(int pageIndex, int quantityIndex, HashMap<String, Object> details) {
                        if (pageIndex == 1 && quantityIndex == 1) {
                            boolean ended = api().endPrintJob();
                            finish.onResult(ended ? new Result(true, "", "Sent to printer") : new Result(false, "NIIMBOT_ERROR", "End of print not confirmed"));
                        }
                    }
                    @Override public void onError(int errorCode) { finish.onResult(new Result(false, codeFor(errorCode), "Printer error " + errorCode)); }
                    @Override public void onError(int errorCode, int printState) { finish.onResult(new Result(false, codeFor(errorCode), "Printer error " + errorCode)); }
                    @Override public void onCancelJob(boolean success) { finish.onResult(new Result(false, "NIIMBOT_ERROR", "Print job was cancelled")); }
                    @Override public void onPause(boolean success) {}
                    @Override public void onPausing() {}
                    @Override public void onResume(boolean success) {}
                    @Override public void onBufferFree(int pageIndex, int bufferSize) {
                        if (completed.get() || bufferSize < 1 || !committed.compareAndSet(false, true)) return;
                        try {
                            JCPrintApi p = api();
                            p.drawEmptyLabel(wMm, hMm, 0, "");
                            // the inset frame: the image's pixels == the frame's dots → drawn 1:1, never scaled
                            p.drawLabelImage(png, FRAME_INSET_MM, FRAME_INSET_MM, wMm - 2 * FRAME_INSET_MM, hMm - 2 * FRAME_INSET_MM, 0, 1, 127f);
                            String labelJson = new String(p.generateLabelJson(), StandardCharsets.UTF_8);
                            float multiple = p.getMultiple();
                            if (multiple <= 0f) multiple = 8f; // 203 dpi
                            String info = "{\"printerImageProcessingInfo\":{\"orientation\":0,\"margin\":[0,0,0,0],\"printQuantity\":1,"
                                + "\"horizontalOffset\":0,\"verticalOffset\":0,\"width\":" + wMm + ",\"height\":" + hMm
                                + ",\"printMultiple\":" + multiple + ",\"epc\":\"\"}}";
                            Log.i(TAG, "commit: labelJson=" + labelJson.length() + " chars, getMultiple()=" + p.getMultiple() + " → printMultiple=" + multiple + ", info=" + info);
                            p.commitData(Collections.singletonList(labelJson), Collections.singletonList(info));
                        } catch (Throwable t) {
                            Log.e(TAG, "commit failed", t);
                            finish.onResult(new Result(false, "NIIMBOT_ERROR", "Could not prepare the label"));
                        }
                    }
                });
                // Watchdog: the SDK never answered.
                long until = System.currentTimeMillis() + PRINT_TIMEOUT_MS;
                while (!completed.get() && System.currentTimeMillis() < until) Thread.sleep(100L);
                if (!completed.get()) {
                    try { a.cancelJob(); } catch (Exception ignored) {}
                    finish.onResult(new Result(false, "BT_PRINT_FAILED", "Print timed out"));
                }
            } catch (Throwable t) {
                Log.e(TAG, "niimbot print failed", t);
                finish.onResult(new Result(false, "BT_PRINT_FAILED", t.getMessage() == null ? "Print failed" : t.getMessage()));
            }
        });
    }
}
