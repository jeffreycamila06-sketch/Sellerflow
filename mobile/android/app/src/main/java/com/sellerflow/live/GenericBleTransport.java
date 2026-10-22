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
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Phase 1 (test-gated): BLE transport for a GENERIC label printer that speaks TSPL
 * like the D520BT but has its own GATT layout (e.g. FLASHLABEL Y41BT). Separate from
 * BleStickerTransport so the D520BT print path stays byte-for-byte untouched.
 *
 * Job: connect the address (TRANSPORT_LE, no bonding) → discover services →
 * BleStickerLogic.pickWriteTarget (null → BT_NOT_SUPPORTED) → subscribe every NOTIFY
 * characteristic of that service (none / failures are fine) → request MTU 512 → the
 * same chunking as the D520BT (clampChunkSize, write-without-response when the
 * characteristic supports it, else write with response) → after the last chunk wait
 * SETTLE_MS → success. confirmed = the printer sent "PRINTING:DONE" in that time.
 * Always disconnects after the job (no warm link). Single-flight per instance.
 */
final class GenericBleTransport {
    private static final String TAG = "SellerFlowPrinterGen";
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");

    private static final long CONNECT_TIMEOUT_MS = 8000;
    private static final long SERVICES_TIMEOUT_MS = 6000;
    private static final long SUBSCRIBE_TIMEOUT_MS = 3000; // per characteristic; a slow one is skipped, not fatal
    private static final long MTU_TIMEOUT_MS = 3000;
    private static final long SETTLE_MS = 1500;
    private static final long OVERALL_CAP_MS = 30000;
    private static final long PACING_MS = 8;
    private static final int REQUEST_MTU = 512;
    private static final int SDK_TIRAMISU = 33;
    private static final int MAX_NOTIFY_BYTES = 4096;
    static final int STATUS_HEX_MAX = 256;

    static final class Result {
        BleStickerTransport.BtError error;
        boolean confirmed;
        String statusHex = "";
        String service = "";
        String characteristic = "";
        int chunks;
        int mtu;
    }

    interface Callback { void onResult(Result r); }

    private final Context context;
    private final Handler handler;
    private BluetoothAdapter adapter;

    private boolean jobActive;
    private Callback cb;
    private byte[] payload = new byte[0];
    private String deviceName = "";
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private boolean writeNoResponse;
    private final List<BluetoothGattCharacteristic> toSubscribe = new ArrayList<>();
    private final Set<UUID> notifyUuids = new HashSet<>();
    private final ByteArrayOutputStream notifyBytes = new ByteArrayOutputStream();
    private List<byte[]> chunks = new ArrayList<>();
    private int nextChunk;
    private boolean writesStarted;
    private boolean allSent;
    private String pickedService = "";
    private String pickedChar = "";
    private int mtu;
    private Runnable overallTimer, phaseTimer, pacingTimer, settleTimer;
    private long lastWriteProgressAt; // uptime of the last chunk the stack accepted (stall watchdog)

    GenericBleTransport(Context context) {
        this.context = context.getApplicationContext();
        HandlerThread thread = new HandlerThread("sellerflow-ble-generic");
        thread.start();
        this.handler = new Handler(thread.getLooper());
    }

    private boolean ensureAdapter() {
        if (adapter == null) {
            BluetoothManager mgr = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
            adapter = mgr != null ? mgr.getAdapter() : null;
        }
        return adapter != null;
    }

    @SuppressLint("MissingPermission")
    void printJob(final byte[] data, final String address, final Callback callback) {
        handler.post(() -> {
            if (!ensureAdapter()) { callback.onResult(errorResult("Bluetooth not supported", "BT_UNAVAILABLE")); return; }
            if (!adapter.isEnabled()) { callback.onResult(errorResult("Bluetooth is off", "BT_OFF")); return; }
            if (jobActive) { callback.onResult(errorResult("Another printer task is still in progress.", "BT_BUSY")); return; }
            if (address == null || address.trim().isEmpty()) { callback.onResult(errorResult("No Bluetooth printer saved.", "BT_NOT_SET")); return; }
            BluetoothDevice device;
            try {
                device = adapter.getRemoteDevice(address.trim());
            } catch (Exception e) {
                callback.onResult(errorResult("Invalid printer address.", "BT_PRINT_FAILED"));
                return;
            }
            jobActive = true;
            cb = callback;
            payload = data != null ? data : new byte[0];
            deviceName = "";
            try { String n = device.getName(); deviceName = n != null ? n : ""; } catch (Exception ignored) {}
            writeChar = null;
            writeNoResponse = false;
            toSubscribe.clear();
            notifyUuids.clear();
            notifyBytes.reset();
            chunks = new ArrayList<>();
            nextChunk = 0;
            writesStarted = false;
            allSent = false;
            pickedService = "";
            pickedChar = "";
            mtu = 0;
            overallTimer = () -> finish(new BleStickerTransport.BtError("Print timed out.", "BT_PRINT_FAILED"));
            handler.postDelayed(overallTimer, OVERALL_CAP_MS);
            armPhase(CONNECT_TIMEOUT_MS, "Could not connect to the printer.");
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
                } else {
                    gatt = device.connectGatt(context, false, gattCallback);
                }
            } catch (SecurityException e) {
                finish(new BleStickerTransport.BtError("Bluetooth permission denied.", "BT_PERMISSION"));
                return;
            } catch (Exception e) {
                finish(new BleStickerTransport.BtError("Could not connect: " + e.getMessage(), "BT_PRINT_FAILED"));
                return;
            }
            if (gatt == null) finish(new BleStickerTransport.BtError("Could not start printer connection.", "BT_PRINT_FAILED"));
        });
    }

    private static Result errorResult(String msg, String code) {
        Result r = new Result();
        r.error = new BleStickerTransport.BtError(msg, code);
        return r;
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            handler.post(() -> {
                if (!jobActive || g != gatt) return;
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    armPhase(SERVICES_TIMEOUT_MS, "Printer services did not respond.");
                    try { g.discoverServices(); }
                    catch (SecurityException e) { finish(new BleStickerTransport.BtError("Bluetooth permission denied.", "BT_PERMISSION")); }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    // Every byte was already sent → the job is done (some printers drop the link after printing).
                    if (allSent) finishOk();
                    else finish(new BleStickerTransport.BtError("Printer disconnected during printing.", "BT_PRINT_FAILED"));
                }
            });
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt) return;
                cancelPhase();
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    finish(new BleStickerTransport.BtError("Service discovery failed.", "BT_PRINT_FAILED"));
                    return;
                }
                List<BleStickerLogic.Svc> layout = new ArrayList<>();
                for (BluetoothGattService s : g.getServices()) {
                    List<BleStickerLogic.Chr> cs = new ArrayList<>();
                    for (BluetoothGattCharacteristic c : s.getCharacteristics()) cs.add(new BleStickerLogic.Chr(c.getUuid().toString(), c.getProperties()));
                    layout.add(new BleStickerLogic.Svc(s.getUuid().toString(), cs));
                }
                BleStickerLogic.WriteTarget t = BleStickerLogic.pickWriteTarget(layout);
                if (t == null) {
                    finish(new BleStickerTransport.BtError("This printer is not supported yet.", "BT_NOT_SUPPORTED"));
                    return;
                }
                for (BluetoothGattService s : g.getServices()) {
                    if (!t.service.equals(BleStickerLogic.normUuid(s.getUuid().toString()))) continue;
                    for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                        String cu = BleStickerLogic.normUuid(c.getUuid().toString());
                        if (writeChar == null && cu.equals(t.writeChar) && (c.getProperties() & (BleStickerLogic.PROP_WRITE | BleStickerLogic.PROP_WRITE_NO_RESPONSE)) != 0) writeChar = c;
                        if (t.notifyChars.contains(cu)) { toSubscribe.add(c); notifyUuids.add(c.getUuid()); }
                    }
                    if (writeChar != null) break;
                    toSubscribe.clear();
                    notifyUuids.clear();
                }
                if (writeChar == null) {
                    finish(new BleStickerTransport.BtError("This printer is not supported yet.", "BT_NOT_SUPPORTED"));
                    return;
                }
                pickedService = t.service;
                pickedChar = t.writeChar;
                writeNoResponse = t.writeNoResponse();
                subscribeNext(g);
            });
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt || writesStarted) return;
                if (descriptor == null || !CCCD.equals(descriptor.getUuid())) return;
                cancelPhase();
                subscribeNext(g); // a failed subscription is not fatal
            });
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int newMtu, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt || writesStarted) return;
                int usable = (status == BluetoothGatt.GATT_SUCCESS && newMtu > 3) ? (newMtu - 3) : BleStickerLogic.MIN_CHUNK;
                if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu;
                beginWrites(BleStickerLogic.clampChunkSize(usable));
            });
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic ch, int status) {
            handler.post(() -> {
                if (!jobActive || g != gatt || allSent) return;
                // Write-without-response below API 33 is paced by a timer, not this callback.
                if (writeNoResponse && Build.VERSION.SDK_INT < SDK_TIRAMISU) return;
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    finish(new BleStickerTransport.BtError("Printer write failed.", "BT_PRINT_FAILED"));
                    return;
                }
                pump();
            });
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch, byte[] value) {
            handler.post(() -> onNotify(g, ch, value));
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch) {
            handler.post(() -> onNotify(g, ch, ch != null ? ch.getValue() : null));
        }
    };

    @SuppressLint("MissingPermission")
    private void subscribeNext(BluetoothGatt g) {
        if (!jobActive) return;
        while (!toSubscribe.isEmpty()) {
            BluetoothGattCharacteristic c = toSubscribe.remove(0);
            try {
                if (!g.setCharacteristicNotification(c, true)) continue;
            } catch (Exception e) {
                continue;
            }
            BluetoothGattDescriptor cccd = c.getDescriptor(CCCD);
            if (cccd == null) continue;
            try {
                if (Build.VERSION.SDK_INT >= SDK_TIRAMISU) {
                    g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                } else {
                    cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    g.writeDescriptor(cccd);
                }
            } catch (Exception e) {
                continue;
            }
            // Wait for onDescriptorWrite; a printer that never answers is skipped.
            cancelPhase();
            phaseTimer = () -> subscribeNext(g);
            handler.postDelayed(phaseTimer, SUBSCRIBE_TIMEOUT_MS);
            return;
        }
        requestMtu(g);
    }

    @SuppressLint("MissingPermission")
    private void requestMtu(BluetoothGatt g) {
        boolean requested = false;
        try { requested = g.requestMtu(REQUEST_MTU); } catch (Exception ignored) {}
        if (!requested) { beginWrites(BleStickerLogic.MIN_CHUNK); return; }
        cancelPhase();
        phaseTimer = () -> beginWrites(BleStickerLogic.MIN_CHUNK);
        handler.postDelayed(phaseTimer, MTU_TIMEOUT_MS);
    }

    private void onNotify(BluetoothGatt g, BluetoothGattCharacteristic ch, byte[] value) {
        if (!jobActive || g != gatt || ch == null || !notifyUuids.contains(ch.getUuid())) return;
        if (value == null || value.length == 0) return;
        int room = MAX_NOTIFY_BYTES - notifyBytes.size();
        if (room > 0) notifyBytes.write(value, 0, Math.min(room, value.length));
    }

    private void beginWrites(int chunkSize) {
        if (!jobActive || writesStarted) return;
        writesStarted = true;
        chunks = BleStickerLogic.chunks(payload, chunkSize);
        nextChunk = 0;
        lastWriteProgressAt = SystemClock.uptimeMillis();
        armWriteStall();
        pump();
    }

    // Stall watchdog (audit item 2): the write phase fails only when NO chunk was accepted for
    // BleStickerLogic.WRITE_STALL_MS — never because the whole transfer took longer than that.
    private void armWriteStall() {
        cancelPhase();
        phaseTimer = this::checkWriteStall;
        handler.postDelayed(phaseTimer, BleStickerLogic.WRITE_STALL_MS);
    }

    private void checkWriteStall() {
        if (!jobActive || allSent || phaseTimer == null) return;
        long wait = BleStickerLogic.stallWaitMs(SystemClock.uptimeMillis(), lastWriteProgressAt, BleStickerLogic.WRITE_STALL_MS);
        if (wait > 0) { handler.postDelayed(phaseTimer, wait); return; } // progress since the last check → keep waiting
        finish(new BleStickerTransport.BtError("Printer stopped accepting data.", "BT_PRINT_FAILED"));
    }

    @SuppressLint("MissingPermission")
    private void pump() {
        if (!jobActive || gatt == null || writeChar == null || allSent) return;
        if (nextChunk >= chunks.size()) { onAllSent(); return; }
        byte[] chunk = chunks.get(nextChunk);
        int type = writeNoResponse ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
        boolean started;
        try {
            if (Build.VERSION.SDK_INT >= SDK_TIRAMISU) {
                started = gatt.writeCharacteristic(writeChar, chunk, type) == BluetoothStatusCodes.SUCCESS;
            } else {
                writeChar.setWriteType(type);
                writeChar.setValue(chunk);
                started = gatt.writeCharacteristic(writeChar);
            }
        } catch (SecurityException e) {
            finish(new BleStickerTransport.BtError("Bluetooth permission denied.", "BT_PERMISSION"));
            return;
        } catch (Exception e) {
            finish(new BleStickerTransport.BtError("Printer write failed: " + e.getMessage(), "BT_PRINT_FAILED"));
            return;
        }
        if (!started) { schedulePacing(); return; } // stack busy — retry the SAME chunk
        nextChunk++;
        lastWriteProgressAt = SystemClock.uptimeMillis(); // a chunk went out: the stall clock restarts
        if (writeNoResponse && Build.VERSION.SDK_INT < SDK_TIRAMISU) {
            if (nextChunk < chunks.size()) schedulePacing();
            else onAllSent();
        } else if (nextChunk >= chunks.size()) {
            onAllSent(); // the rest was driven by onCharacteristicWrite
        }
    }

    private void schedulePacing() {
        if (pacingTimer != null) handler.removeCallbacks(pacingTimer);
        pacingTimer = this::pump;
        handler.postDelayed(pacingTimer, PACING_MS);
    }

    private void onAllSent() {
        if (allSent) return;
        allSent = true;
        cancelPhase();
        settleTimer = this::finishOk;
        handler.postDelayed(settleTimer, SETTLE_MS);
    }

    private void finishOk() {
        if (!jobActive) return;
        Result r = new Result();
        byte[] status = notifyBytes.toByteArray();
        r.confirmed = BleStickerLogic.containsPrintDone(new String(status, StandardCharsets.US_ASCII));
        r.statusHex = BleStickerLogic.toHexCapped(status, STATUS_HEX_MAX);
        Log.i(TAG, "generic print name=" + deviceName + " service=" + pickedService + " char=" + pickedChar
            + " chunks=" + chunks.size() + " mtu=" + mtu + " confirmed=" + r.confirmed);
        complete(r);
    }

    private void finish(BleStickerTransport.BtError error) {
        if (!jobActive) return;
        Result r = new Result();
        r.error = error;
        Log.w(TAG, "generic print failed name=" + deviceName + " code=" + error.code + " " + error.message);
        complete(r);
    }

    @SuppressLint("MissingPermission")
    private void complete(Result r) {
        jobActive = false;
        r.service = pickedService;
        r.characteristic = pickedChar;
        r.chunks = chunks.size();
        r.mtu = mtu;
        if (overallTimer != null) { handler.removeCallbacks(overallTimer); overallTimer = null; }
        if (settleTimer != null) { handler.removeCallbacks(settleTimer); settleTimer = null; }
        if (pacingTimer != null) { handler.removeCallbacks(pacingTimer); pacingTimer = null; }
        cancelPhase();
        BluetoothGatt g = gatt;
        gatt = null;
        if (g != null) {
            try { g.disconnect(); } catch (Exception ignored) {}
            try { g.close(); } catch (Exception ignored) {}
        }
        writeChar = null;
        toSubscribe.clear();
        payload = new byte[0];
        Callback c = cb;
        cb = null;
        if (c != null) c.onResult(r);
    }

    private void armPhase(long ms, final String failMsg) {
        cancelPhase();
        phaseTimer = () -> finish(new BleStickerTransport.BtError(failMsg, "BT_PRINT_FAILED"));
        handler.postDelayed(phaseTimer, ms);
    }

    private void cancelPhase() {
        if (phaseTimer != null) { handler.removeCallbacks(phaseTimer); phaseTimer = null; }
    }
}
