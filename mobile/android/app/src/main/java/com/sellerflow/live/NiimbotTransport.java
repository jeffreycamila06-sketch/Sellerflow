package com.sellerflow.live;

import android.annotation.SuppressLint;
import android.app.Application;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Niimbot label printers (B1 / B21 / D11 / D110 / …) through the vendor SDK
 * (libs/4.1.1-release.aar + image-1.9.5.aar). Printer setup v2, Part 8 — a SEPARATE
 * transport: the D520BT (BleStickerTransport), generic BLE (GenericBleTransport) and
 * classic SPP paths are untouched.
 *
 * Job = the SAME sticker image the app renders (1-bit, bit 1 = ink), printed as a label:
 *   pair (system prompt) if needed → connectBluetoothPrinter(address) →
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

    /** Print density per model family (SDK docs: B-series 1–5 default 3; D-series / B18 1–3 default 2). */
    static int densityFor(String name) {
        String n = name == null ? "" : name.trim().toUpperCase(Locale.US);
        if (n.startsWith("D11") || n.startsWith("D110") || n.startsWith("D101") || n.startsWith("B18")) return 2;
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
                BluetoothDevice device = adapter.getRemoteDevice(address);
                // The SDK talks classic Bluetooth: the phone must be paired first (system prompt).
                if (device.getBondState() == BluetoothDevice.BOND_NONE && !device.createBond()) {
                    finish.onResult(new Result(false, "NIIMBOT_PAIR_FAILED", "Could not pair with the printer")); return;
                }
                long deadline = System.currentTimeMillis() + PAIR_TIMEOUT_MS;
                while (device.getBondState() != BluetoothDevice.BOND_BONDED && System.currentTimeMillis() < deadline) Thread.sleep(250L);
                if (device.getBondState() != BluetoothDevice.BOND_BONDED) { finish.onResult(new Result(false, "NIIMBOT_PAIR_FAILED", "Pairing was not confirmed")); return; }

                JCPrintApi a = api();
                if (!address.equalsIgnoreCase(connectedAddress) || a.isConnection() != 0) {
                    if (!connectedAddress.isEmpty()) { try { a.close(); } catch (Exception ignored) {} connectedAddress = ""; }
                    int rc = a.connectBluetoothPrinter(address);
                    if (rc == -1) { finish.onResult(new Result(false, "BT_NOT_FOUND", "Could not connect to the printer")); return; }
                    if (rc != 0) { finish.onResult(new Result(false, "BT_NOT_SUPPORTED", "This printer model is not supported by the driver")); return; }
                    connectedAddress = address;
                }

                final String png = imageBase64(packed, w, h, rowBytes);
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
                            p.drawLabelImage(png, 0f, 0f, wMm, hMm, 0, 1, 127f);
                            String labelJson = new String(p.generateLabelJson(), StandardCharsets.UTF_8);
                            float multiple = p.getMultiple();
                            if (multiple <= 0f) multiple = 8f; // 203 dpi
                            String info = "{\"printerImageProcessingInfo\":{\"orientation\":0,\"margin\":[0,0,0,0],\"printQuantity\":1,"
                                + "\"horizontalOffset\":0,\"verticalOffset\":0,\"width\":" + wMm + ",\"height\":" + hMm
                                + ",\"printMultiple\":" + multiple + ",\"epc\":\"\"}}";
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
