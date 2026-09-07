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
 * success ONLY when FF03 reports "PRINTING:DONE". Honest phase timeouts + a 30s
 * overall cap; there is no fake success path.
 *
 * WARM LINK (2026-09-07 speed fix — the supplier-SDK/Labelife model): after a
 * SUCCESSFUL job the GATT connection, FF03 subscription and negotiated chunk
 * are KEPT for IDLE_RELEASE_MS. A back-to-back print to the same saved printer
 * skips connect/discover/subscribe/MTU entirely (connectMs ≈ 0 — this was the
 * per-sticker second the old per-job teardown burned; the decompiled SDK
 * connects once and only ever write()s per print). The link is released on: any
 * job FAILURE (full teardown, as before), the idle timer, a remote disconnect,
 * an address change, scan start (so the printer advertises for the picker), and
 * shutdown. Holding the link between prints means another phone/app cannot
 * connect until idle release — intended during live selling (Labelife behaves
 * the same while open).
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
    private static final long WRITE_TIMEOUT_MS = 12000; // chunk stream stalled (also catches a dead warm link fast)
    private static final long DONE_TIMEOUT_MS = 10000;
    private static final long OVERALL_CAP_MS = 30000;
    private static final long PACING_MS = 8;
    /** How long a successful job's connection is kept warm for the next print. */
    private static final long IDLE_RELEASE_MS = 180000;
    /** Ask for the SDK's MTU (512 → 509-byte chunks; both boards grant it — the supplier SDK gates connect on it). */
    private static final int REQUEST_MTU = 512;
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
    // warm-link state (survives BETWEEN jobs; all handler-thread only)
    private boolean linkReady;      // gatt+chars+FF03 subscription live from a prior successful job
    private String heldAddress;     // the printer the warm link belongs to
    private int heldChunkSize;      // MTU-derived chunk negotiated when the link was built
    private Runnable idleTimer;

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
            // A held (idle) connection stops the printer advertising — release it
            // so the picker can actually find the device.
            releaseLink();
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
            overallTimer = () -> finishJob(new BtError("Print timed out.", "BT_PRINT_FAILED"));
            handler.postDelayed(overallTimer, OVERALL_CAP_MS);
            // WARM PATH: a prior successful job left the connection + FF03
            // subscription live for this same printer → go straight to the chunk
            // pump (connectMs ≈ 0). A dead-but-undetected link fails at
            // WRITE_TIMEOUT_MS / on the DISCONNECTED callback, tears down fully,
            // and the NEXT print reconnects cold — honest, never a fake success.
            if (linkReady && gatt != null && writeChar != null && notifyChar != null
                && preferredAddress.equalsIgnoreCase(heldAddress)) {
                cancelIdle();
                beginWrites(heldChunkSize > 0 ? heldChunkSize : BleStickerLogic.MIN_CHUNK);
                return;
            }
            releaseLink(); // different printer, or no warm link — start cold (also nulls gatt/chars)
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
            releaseLink(); // drop any warm connection so the printer is freed
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
                if (g != gatt) return;
                if (!jobActive) {
                    // Warm link dropped between jobs (printer off, out of range,
                    // another device took it) — clean up quietly; the next print
                    // simply reconnects cold.
                    if (newState == BluetoothProfile.STATE_DISCONNECTED) releaseLink();
                    return;
                }
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
                // Negotiate the MTU; onMtuChanged drives the pump. Ask for 512 —
                // the supplier SDK's own request (chunk 509 = MTU−3); it gates
                // connect on the grant succeeding, so both board generations are
                // proven to accept it. clampChunkSize caps at MAX_CHUNK (509) and
                // a smaller grant just means smaller chunks — never a failure.
                boolean requested = false;
                try { requested = g.requestMtu(REQUEST_MTU); } catch (Exception ignored) {}
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
        // AUDIT F1: accept DONE only after every chunk is queued. A legitimate
        // DONE can only follow the final PRINT bytes; with the warm link, a
        // stale/duplicate DONE from the PREVIOUS job could otherwise arrive
        // during the next job's write phase and finish it prematurely (fake
        // success + truncated payload). Strictly tightening.
        if (allChunksSent && BleStickerLogic.containsPrintDone(notifyBuffer.toString())) finishJob(null);
    }

    // ── chunk pump (backpressure: onCharacteristicWrite on API33+, else 8ms pacing) ──

    private void beginWrites(int chunkSize) {
        if (!jobActive) return;
        heldChunkSize = chunkSize; // remembered for warm-path reuse
        pendingChunks = BleStickerLogic.chunks(payload, chunkSize);
        nextChunk = 0;
        allChunksSent = false;
        tWriteStart = System.currentTimeMillis();
        statChunkSize = chunkSize;
        statChunks = pendingChunks.size();
        // A stalled stream (incl. a dead warm link the stack hasn't reported yet)
        // fails here instead of waiting out the 30s overall cap.
        armPhase(WRITE_TIMEOUT_MS, "Printer stopped accepting data.");
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
        // (armPhase replaces the WRITE_TIMEOUT phase.)
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
        if (error != null || gatt == null || writeChar == null || notifyChar == null) {
            // Failure (or nothing usable to keep) → full teardown, as before the
            // warm-link change. The next print reconnects cold.
            releaseLink();
        } else {
            // SUCCESS → keep the connection + FF03 subscription warm so the next
            // back-to-back print skips the whole connect phase (the SDK/Labelife
            // model). Released after IDLE_RELEASE_MS without a print.
            linkReady = true;
            heldAddress = preferredAddress;
            armIdle();
        }
        pendingChunks = new ArrayList<>();
        payload = new byte[0];
        notifyBuffer.setLength(0);
        JobCallbackFn cb = jobCb;
        jobCb = null;
        if (error != null) Log.w(TAG, "job failed: " + error.code + " " + error.message);
        if (cb != null) cb.onResult(error);
    }

    // ── warm-link lifecycle (handler-thread only) ──

    /** Tear down any connection — held or mid-job remnants. Idempotent. */
    @SuppressLint("MissingPermission")
    private void releaseLink() {
        linkReady = false;
        heldAddress = null;
        heldChunkSize = 0;
        cancelIdle();
        BluetoothGatt g = gatt;
        gatt = null;
        if (g != null) {
            try { if (notifyChar != null) g.setCharacteristicNotification(notifyChar, false); } catch (Exception ignored) {}
            try { g.disconnect(); } catch (Exception ignored) {}
            try { g.close(); } catch (Exception ignored) {}
        }
        writeChar = null;
        notifyChar = null;
    }

    private void armIdle() {
        cancelIdle();
        idleTimer = () -> { if (!jobActive) releaseLink(); };
        handler.postDelayed(idleTimer, IDLE_RELEASE_MS);
    }

    private void cancelIdle() {
        if (idleTimer != null) { handler.removeCallbacks(idleTimer); idleTimer = null; }
    }
}
