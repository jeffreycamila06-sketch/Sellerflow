package android.content;
public class Context {
    public static final String BLUETOOTH_SERVICE = "bluetooth";
    public android.bluetooth.BluetoothManager manager = new android.bluetooth.BluetoothManager();
    public Context getApplicationContext() { return this; }
    public Object getSystemService(String name) { return manager; }
}
