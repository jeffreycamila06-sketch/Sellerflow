package android.bluetooth;
import java.util.UUID;
public class BluetoothGattCharacteristic {
    public static final int PROPERTY_READ = 0x02;
    public static final int WRITE_TYPE_NO_RESPONSE = 1;
    public static final int WRITE_TYPE_DEFAULT = 2;
    private final UUID uuid; private final int props; private final boolean hasCccd;
    public int writeType = WRITE_TYPE_DEFAULT; public byte[] value;
    public BluetoothGattCharacteristic(UUID uuid, int props, boolean hasCccd) { this.uuid = uuid; this.props = props; this.hasCccd = hasCccd; }
    public UUID getUuid() { return uuid; }
    public int getProperties() { return props; }
    public BluetoothGattDescriptor getDescriptor(UUID u) { return hasCccd ? new BluetoothGattDescriptor(u) : null; }
    public void setWriteType(int t) { writeType = t; }
    public boolean setValue(byte[] v) { value = v; return true; }
    public byte[] getValue() { return value; }
}
