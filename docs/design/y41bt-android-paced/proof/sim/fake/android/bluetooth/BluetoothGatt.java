package android.bluetooth;

import android.os.Build;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import sim.World;

/**
 * A pretend phone Bluetooth + a pretend printer, for the simulation only. It is a MODEL — not a Samsung A52
 * and not a real Y41BT. What it models:
 *   - the phone answers "taken" for a piece while fewer than phoneQueueBytes are still waiting to travel;
 *   - bytes travel to the printer one after the other at linkBytesPerSec;
 *   - when the app closes the link, bytes that have not travelled yet are LOST;
 *   - a read is answered only after every byte handed over before it has arrived (Bluetooth keeps the order).
 */
public class BluetoothGatt {
    public static final int GATT_SUCCESS = 0;

    public static class Printer {
        public String deviceName = "";
        public final List<BluetoothGattService> services = new ArrayList<>();
        public int grantMtu = 512;          // what the printer grants; 0 = the request cannot be made; -1 = never answered
        public long connectMs = 300, discoverMs = 200, descriptorMs = 20, mtuMs = 30;
        public long writeAnswerMs = 2;
        public int linkBytesPerSec = 20000;
        public int phoneQueueBytes = 4000;
        public int failWriteAt = -1;        // the answer for this hand-over (0-based) is an error
        public int refuseEvery = 0;         // every Nth hand-over is refused once ("busy")
        public long dropLinkAtMs = -1;      // the link closes by itself at this time
        public boolean closesLinkAfterPrinting; // the printer closes the link 400 ms after the last byte arrived
        public boolean answersRead = true;
        public int readStatus = 0;
        public String notifyWhenArrived;    // e.g. "SSGETPRINTING:DONE"
        public int expectBytes;             // the job's size (to know when everything arrived)
        // what really happened
        public final ByteArrayOutputStream arrived = new ByteArrayOutputStream();
        public int handedOver, lost;
        public long everythingArrivedAt = -1;
    }

    private final Printer p;
    private final BluetoothGattCallback cb;
    private boolean linkUp, closed, busy;
    private long lastArriveAt;
    private int writes, refusals;
    private final List<World.Ev> travelling = new ArrayList<>();
    private BluetoothGattCharacteristic notifyChar;

    BluetoothGatt(Printer p, BluetoothGattCallback cb) {
        this.p = p;
        this.cb = cb;
        World.later(p.connectMs, () -> {
            if (closed) return;
            linkUp = true;
            cb.onConnectionStateChange(this, GATT_SUCCESS, BluetoothProfile.STATE_CONNECTED);
        });
        if (p.dropLinkAtMs >= 0) World.later(p.dropLinkAtMs, this::linkDrops);
    }

    private void linkDrops() {
        if (!linkUp || closed) return;
        linkUp = false;
        loseTravelling();
        World.say("LINK closed by itself (printer has " + p.arrived.size() + " of " + p.expectBytes + " bytes)");
        cb.onConnectionStateChange(this, 8, BluetoothProfile.STATE_DISCONNECTED);
    }

    private void loseTravelling() {
        for (World.Ev e : travelling) World.cancel(e);
        travelling.clear();
        p.lost = p.handedOver - p.arrived.size();
    }

    public boolean discoverServices() {
        World.say("APP discoverServices");
        World.later(p.discoverMs, () -> { if (linkUp) cb.onServicesDiscovered(this, GATT_SUCCESS); });
        return true;
    }
    public List<BluetoothGattService> getServices() { return p.services; }

    public boolean setCharacteristicNotification(BluetoothGattCharacteristic c, boolean on) {
        World.say("APP setNotification " + shortId(c.getUuid()) + " " + on);
        if (on) notifyChar = c;
        return true;
    }
    public boolean writeDescriptor(BluetoothGattDescriptor d) { descriptor(d); return true; }
    public int writeDescriptor(BluetoothGattDescriptor d, byte[] value) { descriptor(d); return BluetoothStatusCodes.SUCCESS; }
    private void descriptor(BluetoothGattDescriptor d) {
        World.say("APP writeDescriptor " + shortId(d.getUuid()));
        World.later(p.descriptorMs, () -> { if (linkUp) cb.onDescriptorWrite(this, d, GATT_SUCCESS); });
    }

    public boolean requestMtu(int mtu) {
        World.say("APP requestMtu " + mtu);
        if (p.grantMtu == 0) return false;
        if (p.grantMtu > 0) World.later(p.mtuMs, () -> { if (linkUp) cb.onMtuChanged(this, Math.min(mtu, p.grantMtu), GATT_SUCCESS); });
        return true;
    }

    // Android 13+: the bytes and the type are given with the call
    public int writeCharacteristic(BluetoothGattCharacteristic c, byte[] value, int type) {
        return handOver(c, value, type) ? BluetoothStatusCodes.SUCCESS : BluetoothStatusCodes.ERROR_GATT_WRITE_REQUEST_BUSY;
    }
    // before Android 13: the bytes and the type were put on the characteristic first
    public boolean writeCharacteristic(BluetoothGattCharacteristic c) {
        return handOver(c, c.value, c.writeType);
    }

    private boolean handOver(BluetoothGattCharacteristic c, byte[] value, int type) {
        if (!linkUp || closed) { World.say("APP write REFUSED (no link)"); return false; }
        if (busy) { World.say("APP write REFUSED (busy)"); return false; }
        if (p.refuseEvery > 0 && (writes + refusals + 1) % p.refuseEvery == 0) { refusals++; World.say("APP write REFUSED (busy)"); return false; }
        final int n = writes++;
        final byte[] bytes = value.clone();
        busy = true;
        p.handedOver += bytes.length;
        long travelMs = Math.max(1, bytes.length * 1000L / p.linkBytesPerSec);
        long arriveAt = Math.max(World.now, lastArriveAt) + travelMs;
        lastArriveAt = arriveAt;
        World.say("APP write #" + n + " len=" + bytes.length + " type=" + (type == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE ? "noResponse" : "withResponse") + " " + digest(bytes));
        travelling.add(World.later(arriveAt - World.now, () -> {
            p.arrived.write(bytes, 0, bytes.length);
            if (p.arrived.size() >= p.expectBytes && p.everythingArrivedAt < 0) everythingArrived();
        }));
        // "taken": at once while the phone's queue has room, else when enough of the earlier bytes have travelled.
        // A piece that needs the printer's own answer (with response) is answered only after it arrived.
        long room = arriveAt - p.phoneQueueBytes * 1000L / p.linkBytesPerSec;
        long answerAt = type == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE ? Math.max(World.now + p.writeAnswerMs, room) : arriveAt + p.writeAnswerMs;
        World.later(answerAt - World.now, () -> {
            busy = false;
            if (!linkUp || closed) return;
            cb.onCharacteristicWrite(this, c, n == p.failWriteAt ? 133 : GATT_SUCCESS);
        });
        return true;
    }

    private void everythingArrived() {
        p.everythingArrivedAt = World.now;
        World.say("PRINTER has every byte (" + p.arrived.size() + ")");
        if (p.notifyWhenArrived != null && notifyChar != null) {
            final byte[] text = p.notifyWhenArrived.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
            World.later(300, () -> {
                if (!linkUp || closed) return;
                if (Build.VERSION.SDK_INT >= 33) cb.onCharacteristicChanged(this, notifyChar, text);
                else { notifyChar.value = text; cb.onCharacteristicChanged(this, notifyChar); }
            });
        }
        if (p.closesLinkAfterPrinting) World.later(400, this::linkDrops);
    }

    public boolean readCharacteristic(BluetoothGattCharacteristic c) {
        if (!linkUp || closed || busy) { World.say("APP read REFUSED"); return false; }
        World.say("APP read " + shortId(c.getUuid()));
        if (!p.answersRead) return true;
        long answerAt = Math.max(World.now, lastArriveAt) + 20; // after every byte handed over before it
        World.later(answerAt - World.now, () -> {
            if (!linkUp || closed) return;
            if (Build.VERSION.SDK_INT >= 33) cb.onCharacteristicRead(this, c, new byte[] {'Y'}, p.readStatus);
            else cb.onCharacteristicRead(this, c, p.readStatus);
        });
        return true;
    }

    public void disconnect() {
        if (closed) return;
        boolean was = linkUp;
        linkUp = false;
        if (was) loseTravelling();
        World.say("APP disconnect (printer has " + p.arrived.size() + " of " + p.expectBytes + " bytes" + (p.lost > 0 ? ", " + p.lost + " LOST" : "") + ")");
    }
    public void close() { closed = true; World.say("APP close"); }

    private static String shortId(UUID u) {
        String s = u.toString().toUpperCase();
        return s.startsWith("0000") && s.endsWith("-0000-1000-8000-00805F9B34FB") ? s.substring(4, 8) : s;
    }
    private static String digest(byte[] b) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(b);
            return String.format("sha=%02x%02x%02x%02x", d[0], d[1], d[2], d[3]);
        } catch (Exception e) { return "sha=?"; }
    }
}
