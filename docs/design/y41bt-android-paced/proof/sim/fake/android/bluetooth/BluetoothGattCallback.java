package android.bluetooth;
/** Same methods and defaults as Android's (the 4-argument read / changed versions call the old ones). */
public abstract class BluetoothGattCallback {
    public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {}
    public void onServicesDiscovered(BluetoothGatt gatt, int status) {}
    public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {}
    public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {}
    public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {}
    public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {}
    public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) { onCharacteristicChanged(gatt, characteristic); }
    public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {}
    public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value, int status) { onCharacteristicRead(gatt, characteristic, status); }
}
