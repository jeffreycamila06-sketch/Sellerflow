package android.bluetooth;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
public class BluetoothGattService {
    private final UUID uuid; public final List<BluetoothGattCharacteristic> chars = new ArrayList<>();
    public BluetoothGattService(UUID uuid) { this.uuid = uuid; }
    public UUID getUuid() { return uuid; }
    public List<BluetoothGattCharacteristic> getCharacteristics() { return chars; }
}
