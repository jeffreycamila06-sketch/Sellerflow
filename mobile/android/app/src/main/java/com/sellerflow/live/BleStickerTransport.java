package com.sellerflow.live;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.ParcelUuid;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Android BLE (GATT) transport for the AIMO D520BT dual-mode label printer —
 * the mirror of the iOS {@code BleStickerTransport} (CoreBluetooth). Job
 * pipeline: ensure adapter on → connect the saved MAC (TRANSPORT_LE, no
 * bonding) → discover FF00 → FF02/FF03 → subscribe FF03 FIRST (CCCD) → chunked
 * write-without-response to FF02 (negotiated MTU clamped, backpressure gated) →
 * success ONLY when FF03 reports "PRINTING:DONE" → ALWAYS disconnect()+close()
 * (single-connection etiquette — never hold the printer). Honest phase timeouts
 * + a 30s overall cap; there is no fake success path.
 *
 * SINGLE-FLIGHT: scan XOR job (either busy → BT_BUSY), mirroring the iOS entry-
 * point guards. All state is mutated on one serial handler thread; GATT/scan
 * callbacks hop onto it before touching state.
 *
 * ADDITIVE — the Classic SPP path in SellerFlowPrinterPlugin (getBondedDevices +
 * createRfcommSocketToServiceRecord + sendViaBluetoothSpp) is untouched. The
 * plugin routes here ONLY when the saved printer's transport tag is "ble".
 */
final class BleStickerTransport {
    private static final String TAG = "SellerFlowPrinterBLE";

    private static final UUID SERVICE_FF00 = UUID.fromString("0000FF00-0000-1000-8000-00805F9B34FB");
    private static final UUID CHAR_FF02_WRITE = UUID.fromString("0000FF02-0000-1000-8000-00805F9B34FB");
    private static final UUID CHAR_FF03_NOTIFY = UUID.fromString("0000FF03-0000-1000-8000-00805F9B34FB");
    // Client Characteristic Configuration Descriptor — enables FF03 notifications.
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");

    private static final long CONNECT_TIMEOUT_MS = 8000;
    private static final long SERVICES_TIMEOUT_MS = 6000;
    private static final long DONE_TIMEOUT_MS = 10000;
    private static final long OVERALL_CAP_MS = 30000;
    private static final long PACING_MS = 8;
    private static final int SDK_TIRAMISU = 33; // Build.VERSION_CODES.TIRAMISU

    static final class Discovered {
        final String address;
        final String name;
        final int rssi;
        Discovered(String address, String name, int rssi) { this.address = address; this.name = name; this.rssi = rssi; }
    }

    /** Honest, code-tagged failure — codes mirror the plugin/iOS reject codes. */
    static final class BtError {
        final String message;
        final String code;
        BtError(String message, String code) { this.message = message; this.code = code; }
    }

    /**
     * DEV timing visibility (Phase-1 bitmap speed diagnosis): phase timings +
     * negotiated chunk size of the LAST completed job. connectMs = job start →
     * first write (GATT connect + discover + subscribe + MTU); writeMs = first
     * write → all chunks queued; doneMs = all sent → FF03 PRINTING:DONE. Read by
     * the plugin right after a job resolves (same serial callback), attached to
     * the resolve so the web toast can show WHERE the time went.
     */
    static final class JobStats {
        volatile int chunkSize;
        volatile int chunks;
        volatile long connectMs;
        volatile long writeMs;
        volatile long doneMs;
    }
    private volatile JobStats lastStats;
    JobStats lastJobStats() { return lastStats; }
    // per-job phase timestamps (handler-thread writes only)
    private long tJobStart, tWriteStart, tAllSent;
    private int statChunkSize, statChunks;

    interface ScanCallbackFn { void onResult(List<Discovered> printers, BtError error); }
    interface JobCallbackFn { void onResult(BtError error); } // null error == success

    private final Context context;
    private final HandlerThread thread;
    private final Handler handler;
    private BluetoothAdapter adapter;

    // scan-only state
    private boolean scanning;
    private ScanCallbackFn scanCb;
    private final Map<String, Discovered> scanFound = new LinkedHashMap<>();
    private Runnable scanTimer;
    private ScanCallback activeScanCallback;

    // print-job state (single-flight with scan)
    private boolean jobActive;
    private JobCallbackFn jobCb;
    private byte[] payload = new byte[0];
    private String preferredAddress;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private BluetoothGattCharacteristic notifyChar;
    private List<byte[]> pendingChunks = new ArrayList<>();
    private int nextChunk;
    private boolean allChunksSent;
    private final StringBuilder notifyBuffer = new StringBuilder();
    private Runnable overallTimer;
    private Runnable phaseTimer;
    private Runnable pacingTimer;

    BleStickerTransport(Context context) {
        this.context = context.getApplicationContext();
        this.thread = new HandlerThread("sellerflow-ble");
        this.thread.start();
        this.handler = new Handler(this.thread.getLooper());
    }

    private boolean ensureAdapter() {
        if (adapter == null) {
            BluetoothManager mgr = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
            adapter = mgr != null ? mgr.getAdapter() : null;
        }
        return adapter != null;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Public API — callable from any thread; all work + callbacks run on the
    // serial handler thread. The plugin gates permissions before calling.
    // ────────────────────────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    void scan(final long timeoutMs, final ScanCallbackFn cb) {
        handler.post(() -> {
            if (!ensureAdapter()) { cb.onResult(null, new BtError("Bluetooth not supported on this device", "BT_UNAVAILABLE")); return; }
            if (!adapter.isEnabled()) { cb.onResult(null, new BtError("Bluetooth is off. Turn it on then try again.", "BT_OFF")); return; }
            if (jobActive || scanning) { cb.onResult(null, new BtError("Bluetooth is busy with another printer task.", "BT_BUSY")); return; }
            BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
            if (scanner == null) { cb.onResult(null, new BtError("Bluetooth LE scan unavailable.", "BT_UNAVAILABLE")); return; }
            scanning = true;
            scanCb = cb;
            scanFound.clear();
            activeScanCallback = new ScanCallback() {
                @Override public void onScanResult(int callbackType, ScanResult result) {
                    handler.post(() -> handleScanResult(result));
                }
                @Override public void onBatchScanResults(List<ScanResult> results) {
                    handler.post(() -> { if (results != null) for (ScanResult r : results) handleScanResult(r); });
                }
                @Override public void onScanFailed(int errorCode) {
                    handler.post(() -> finishScan(new BtError("Bluetooth scan failed (" + errorCode + ")", "BT_SCAN_FAILED")));
                }
            };
            try {
                ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .build();
                // null filters (like iOS scanForPeripherals withServices:nil) — filter in the callback via isTargetPrinter.
                scanner.startScan(null, settings, activeScanCallback);
            } catch (SecurityException e) {
                finishScan(new BtError("Bluetooth permission denied: " + e.getMessage(), "BT_PERMISSION"));
                return;
            } catch (Exception e) {
                finishScan(new BtError("Bluetooth scan failed: " + e.getMessage(), "BT_SCAN_FAILED"));
                return;
            }
            scanTimer = () -> finishScan(null);
            handler.postDelayed(scanTimer, timeoutMs);
        });
    }

    @SuppressLint("MissingPermission")
    void printJob(final byte[] data, final String address, final JobCallbackFn cb) {
        handler.post(() -> {
            if (!ensureAdapter()) { cb.onResult(new BtError("Bluetooth not supported", "BT_UNAVAILABLE")); return; }
            if (!adapter.isEnabled()) { cb.onResult(new BtError("Bluetooth is off", "BT_OFF")); return; }
            if (jobActive || scanning) { cb.onResult(new BtError("Another printer task is still in progress.", "BT_BUSY")); return; }
            if (address == null || address.trim().isEmpty()) { cb.onResult(new BtError("No Bluetooth printer saved.", "BT_NOT_SET")); return; }
            jobActive = true;
            jobCb = cb;
            tJobStart = System.currentTimeMillis();
            tWriteStart = 0;
            tAllSent = 0;
            statChunkSize = 0;
            statChunks = 0;
            payload = data != null ? data : new byte[0];
            preferredAddress = address.trim();
            notifyBuffer.setLength(0);
            pendingChunks = new ArrayList<>();
            nextChunk = 0;
            allChunksSent = false;
            writeChar = null;
            notifyChar = null;
            gatt = null;
            overallTimer = () -> finishJob(new BtError("Print timed out.", "BT_PRINT_FAILED"));
            handler.postDelayed(overallTimer, OVERALL_CAP_MS);
            BluetoothDevice device;
            try {
                // Saved MAC → direct connect. Android MACs are stable (unlike the
                // iOS CBPeripheral UUID), so no scan-to-resolve is needed; an
                // absent printer just times out honestly at CONNECT_TIMEOUT_MS.
                device = adapter.getRemoteDevice(preferredAddress);
            } catch (Exception e) {
                finishJob(new BtError("Invalid printer address.", "BT_PRINT_FAILED"));
                return;
            }
            connect(device);
        });
    }

    /** Release everything and stop the worker thread (plugin onDestroy). */
    void shutdown() {
        handler.post(() -> {
            if (jobActive) finishJob(new BtError("Shutting down.", "BT_PRINT_FAILED"));
            if (scanning) finishScan(new BtError("Shutting down.", "BT_SCAN_FAILED"));
        });
        thread.quitSafely();
    }

    // ── scanning ──

    @SuppressLint("MissingPermission")
    private void handleScanResult(ScanResult result) {
        if (!scanning || result == null) return;
        BluetoothDevice device = result.getDevice();
        if (device == null) return;
        String name = null;
        List<String> services = new ArrayList<>();
        if (result.getScanRecord() != null) {
            name = result.getScanRecord().getDeviceName();
            List<ParcelUuid> uuids = result.getScanRecord().getServiceUuids();
            if (uuids != null) for (ParcelUuid pu : uuids) if (pu != null) services.add(pu.getUuid().toString());
        }
        if (name == null) { try { name = device.getName(); } catch (Exception ignored) {} }
        if (!BleStickerLogic.isTargetPrinter(name, services)) return;
        String addr = device.getAddress();
        if (addr == null) return;
        String key = addr.toUpperCase(Locale.US);
        Discovered prev = scanFound.get(key);
        int rssi = result.getRssi();
        if (prev == null || rssi > prev.rssi) {
            scanFound.put(key, new Discovered(addr, name != null && !name.isEmpty() ? name : addr, rssi));
        }
    }

    @SuppressLint("MissingPermission")
    private void finishScan(BtError error) {
        if (!scanning) return;
        scanning = false;
        if (scanTimer != null) { handler.removeCallbacks(scanTimer); scanTimer = null; }
        try {
            BluetoothLeScanner scanner = adapter != null ? adapter.getBluetoothLeScanner() : null;
            if (scanner != null && activeScanCallback != null) scanner.stopScan(activeScanCallback);
        } catch (Exception ignored) {}
        activeScanCallback = null;
        ScanCallbackFn cb = scanCb;
        scanCb = null;
        List<Discovered> list = new ArrayList<>(scanFound.values());
        Collections.sort(list, (a, b) -> Integer.compare(b.rssi, a.rssi));
        scanFound.clear();
        if (cb != null) cb.onResult(error != null ? null : list, error);
    }

    // ── connect + GATT ──

    @SuppressLint("MissingPermission")
    private void connect(BluetoothDevice device) {
        if (!jobActive) return;
        armPhase(CONNECT_TIMEOUT_MS, "Could not connect to the printer.");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            } else {
                gatt = device.connectGatt(context, false, gattCallback);
            }
        } catch (SecurityException e) {
            finishJob(new BtError("Bluetooth permission denied: " + e.getMessage(), "BT_PERMISSION"));
            return;
        } catch (Exception e) {
            finishJob(new BtError("Could not connect: " + e.getMessage(), "BT_PRINT_FAILED"));
            return;
        }
        if (gatt == null) finishJob(new BtError("Could not start printer connection.", "BT_PRINT_FAILED"));
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            handler.post(() -> {
                if (!jobActive || g != gatt) return;
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    armPhase(SERVICES_TIMEOUT_MS, "Printer services did not respond.");
                    try {
                        g.discoverServices();
                    } catch (SecurityException e) {
                        finishJob(new BtError("Bluetooth permission denied.", "BT_PERMISSION"));
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    finishJob(new BtError("Printer disconnected during printing.", "BT_PRINT_FAILED"));
                }
            });
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt) return;
                cancelPhase();
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    finishJob(new BtError("Service discovery failed.", "BT_PRINT_FAILED"));
                    return;
                }
                BluetoothGattService svc = g.getService(SERVICE_FF00);
                if (svc == null) {
                    finishJob(new BtError("This device is not a supported label printer (service FF00 missing).", "BT_PRINT_FAILED"));
                    return;
                }
                writeChar = svc.getCharacteristic(CHAR_FF02_WRITE);
                notifyChar = svc.getCharacteristic(CHAR_FF03_NOTIFY);
                if (writeChar == null || notifyChar == null) {
                    finishJob(new BtError("Printer write/status channels (FF02/FF03) not found.", "BT_PRINT_FAILED"));
                    return;
                }
                // Subscribe to status FIRST — never write before notifications are live.
                subscribeNotify(g);
            });
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt) return;
                if (descriptor == null || !CCCD.equals(descriptor.getUuid())) return;
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    finishJob(new BtError("Could not subscribe to printer status.", "BT_PRINT_FAILED"));
                    return;
                }
                cancelPhase();
                // Negotiate a larger MTU for fewer chunks; onMtuChanged drives the pump.
                // Ask for the BLE 4.2 max (247) — some stacks refuse odd values or
                // round down; clampChunkSize still caps the usable chunk at MAX_CHUNK,
                // so a bigger grant costs nothing and a 23-grant (chunk=20) is the
                // 7KB-in-5s failure mode the JobStats now make visible.
                boolean requested = false;
                try { requested = g.requestMtu(247); } catch (Exception ignored) {}
                if (!requested) beginWrites(BleStickerLogic.MIN_CHUNK);
            });
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt) return;
                int usable = (status == BluetoothGatt.GATT_SUCCESS && mtu > 3) ? (mtu - 3) : BleStickerLogic.MIN_CHUNK;
                beginWrites(BleStickerLogic.clampChunkSize(usable));
            });
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic ch, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt) return;
                if (Build.VERSION.SDK_INT < SDK_TIRAMISU) return; // <33 paces via timer, not this callback
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    finishJob(new BtError("Printer write failed.", "BT_PRINT_FAILED"));
                    return;
                }
                pump();
            });
        }

        // API 33+ notify delivery (value passed directly)
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch, byte[] value) {
            handler.post(() -> onNotify(g, ch, value));
        }

        // < API 33 notify delivery (read via getValue on the handler thread)
        @SuppressWarnings("deprecation")
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch) {
            handler.post(() -> onNotify(g, ch, ch != null ? ch.getValue() : null));
        }
    };

    @SuppressLint("MissingPermission")
    private void subscribeNotify(BluetoothGatt g) {
        armPhase(SERVICES_TIMEOUT_MS, "Could not subscribe to printer status.");
        boolean ok;
        try {
            ok = g.setCharacteristicNotification(notifyChar, true);
        } catch (SecurityException e) {
            finishJob(new BtError("Bluetooth permission denied.", "BT_PERMISSION"));
            return;
        }
        if (!ok) {
            finishJob(new BtError("Could not enable printer status notifications.", "BT_PRINT_FAILED"));
            return;
        }
        BluetoothGattDescriptor cccd = notifyChar.getDescriptor(CCCD);
        if (cccd == null) {
            finishJob(new BtError("Printer status descriptor (CCCD) missing.", "BT_PRINT_FAILED"));
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= SDK_TIRAMISU) {
                g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            } else {
                cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                g.writeDescriptor(cccd);
            }
        } catch (SecurityException e) {
            finishJob(new BtError("Bluetooth permission denied.", "BT_PERMISSION"));
        }
    }

    private void onNotify(BluetoothGatt g, BluetoothGattCharacteristic ch, byte[] value) {
        if (!jobActive || g != gatt) return;
        if (ch == null || !CHAR_FF03_NOTIFY.equals(ch.getUuid())) return;
        if (value != null && value.length > 0) notifyBuffer.append(new String(value, StandardCharsets.UTF_8));
        if (BleStickerLogic.containsPrintDone(notifyBuffer.toString())) finishJob(null);
    }

    // ── chunk pump (backpressure: onCharacteristicWrite on API33+, else 8ms pacing) ──

    private void beginWrites(int chunkSize) {
        if (!jobActive) return;
        pendingChunks = BleStickerLogic.chunks(payload, chunkSize);
        nextChunk = 0;
        allChunksSent = false;
        tWriteStart = System.currentTimeMillis();
        statChunkSize = chunkSize;
        statChunks = pendingChunks.size();
        pump();
    }

    @SuppressLint("MissingPermission")
    private void pump() {
        if (!jobActive || gatt == null || writeChar == null) return;
        if (nextChunk >= pendingChunks.size()) { onAllSent(); return; }
        byte[] chunk = pendingChunks.get(nextChunk);
        boolean started;
        try {
            if (Build.VERSION.SDK_INT >= SDK_TIRAMISU) {
                int r = gatt.writeCharacteristic(writeChar, chunk, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                started = (r == BluetoothStatusCodes.SUCCESS);
            } else {
                writeChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                writeChar.setValue(chunk);
                started = gatt.writeCharacteristic(writeChar);
            }
        } catch (SecurityException e) {
            finishJob(new BtError("Bluetooth permission denied.", "BT_PERMISSION"));
            return;
        } catch (Exception e) {
            finishJob(new BtError("Printer write failed: " + e.getMessage(), "BT_PRINT_FAILED"));
            return;
        }
        if (!started) {
            // Stack congested — retry the SAME chunk shortly (do NOT advance).
            schedulePacing();
            return;
        }
        nextChunk++;
        if (Build.VERSION.SDK_INT >= SDK_TIRAMISU) {
            // Next write is driven by onCharacteristicWrite; arm DONE once the last is queued.
            if (nextChunk >= pendingChunks.size()) onAllSent();
        } else {
            if (nextChunk < pendingChunks.size()) schedulePacing();
            else onAllSent();
        }
    }

    private void schedulePacing() {
        if (pacingTimer != null) handler.removeCallbacks(pacingTimer);
        pacingTimer = this::pump;
        handler.postDelayed(pacingTimer, PACING_MS);
    }

    private void onAllSent() {
        if (allChunksSent) return;
        allChunksSent = true;
        tAllSent = System.currentTimeMillis();
        // All TSPL bytes are out — success requires the printer's own FF03 DONE.
        armPhase(DONE_TIMEOUT_MS, "Printer did not confirm within 10s — check the printer.");
    }

    // ── timers + finish (idempotent; ALWAYS releases the printer) ──

    private void armPhase(long ms, final String failMsg) {
        cancelPhase();
        phaseTimer = () -> finishJob(new BtError(failMsg, "BT_PRINT_FAILED"));
        handler.postDelayed(phaseTimer, ms);
    }

    private void cancelPhase() {
        if (phaseTimer != null) { handler.removeCallbacks(phaseTimer); phaseTimer = null; }
    }

    @SuppressLint("MissingPermission")
    private void finishJob(BtError error) {
        if (!jobActive) return;
        jobActive = false;
        // Record phase stats for the plugin's resolve (success or failure — the
        // partial phases are still diagnostic on a timeout).
        long now = System.currentTimeMillis();
        JobStats stats = new JobStats();
        stats.chunkSize = statChunkSize;
        stats.chunks = statChunks;
        stats.connectMs = tWriteStart > 0 ? tWriteStart - tJobStart : now - tJobStart;
        stats.writeMs = (tWriteStart > 0 && tAllSent > 0) ? tAllSent - tWriteStart : 0;
        stats.doneMs = tAllSent > 0 ? now - tAllSent : 0;
        lastStats = stats;
        if (overallTimer != null) { handler.removeCallbacks(overallTimer); overallTimer = null; }
        cancelPhase();
        if (pacingTimer != null) { handler.removeCallbacks(pacingTimer); pacingTimer = null; }
        BluetoothGatt g = gatt;
        gatt = null;
        if (g != null) {
            try { if (notifyChar != null) g.setCharacteristicNotification(notifyChar, false); } catch (Exception ignored) {}
            try { g.disconnect(); } catch (Exception ignored) {}
            try { g.close(); } catch (Exception ignored) {}
        }
        writeChar = null;
        notifyChar = null;
        pendingChunks = new ArrayList<>();
        payload = new byte[0];
        notifyBuffer.setLength(0);
        JobCallbackFn cb = jobCb;
        jobCb = null;
        if (error != null) Log.w(TAG, "job failed: " + error.code + " " + error.message);
        if (cb != null) cb.onResult(error);
    }
}
