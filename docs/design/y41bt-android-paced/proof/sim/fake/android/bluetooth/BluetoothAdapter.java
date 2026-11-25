package android.bluetooth;
public class BluetoothAdapter {
    public BluetoothDevice device;
    public boolean isEnabled() { return true; }
    public BluetoothDevice getRemoteDevice(String address) { return device; }
}
