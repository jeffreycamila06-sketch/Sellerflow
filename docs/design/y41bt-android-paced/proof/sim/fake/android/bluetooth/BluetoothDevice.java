package android.bluetooth;
import android.content.Context;
import sim.World;
public class BluetoothDevice {
    public static final int TRANSPORT_LE = 2;
    public final BluetoothGatt.Printer printer;
    public BluetoothDevice(BluetoothGatt.Printer printer) { this.printer = printer; }
    public String getName() { return printer.deviceName; }
    public BluetoothGatt connectGatt(Context c, boolean auto, BluetoothGattCallback cb) { return connectGatt(c, auto, cb, 0); }
    public BluetoothGatt connectGatt(Context c, boolean auto, BluetoothGattCallback cb, int transport) {
        World.say("APP connectGatt transport=" + transport);
        return new BluetoothGatt(printer, cb);
    }
}
