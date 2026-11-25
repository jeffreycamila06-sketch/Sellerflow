package android.bluetooth;
import java.util.UUID;
public class BluetoothGattDescriptor {
    public static final byte[] ENABLE_NOTIFICATION_VALUE = {0x01, 0x00};
    private final UUID uuid;
    public BluetoothGattDescriptor(UUID uuid) { this.uuid = uuid; }
    public UUID getUuid() { return uuid; }
    public boolean setValue(byte[] v) { return true; }
}
