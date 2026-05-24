package com.sellerflow.live;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "SellerFlowPrinter",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            }
        )
    }
)
public class SellerFlowPrinterPlugin extends Plugin {
    private static final String TAG = "SellerFlowPrinter";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PREFS = "sellerflow_printer";
    private static final String PREF_SELECTED_ADDRESS = "selected_printer_address";
    private static final String PREF_SELECTED = "selected_printer";
    private static final String DEFAULT_PRINTER_ADDRESS = "8C:C6:A4:D7:35:A1";
    private static final Charset PRINTER_CHARSET = Charset.forName("GBK");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        Log.i(TAG, "requestPermissions start");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            resolveOk(call, "Bluetooth permission granted", null);
            return;
        }
        if (hasBluetoothPermission()) {
            resolveOk(call, "Bluetooth permission granted", null);
            return;
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPermsCallback");
    }

    @PermissionCallback
    private void bluetoothPermsCallback(PluginCall call) {
        if (hasBluetoothPermission()) {
            Log.i(TAG, "requestPermissions granted");
            resolveOk(call, "Bluetooth permission granted", null);
        } else {
            Log.w(TAG, "requestPermissions denied");
            call.reject("Bluetooth permission denied", "PERMISSION_DENIED");
        }
    }

    @PluginMethod
    public void listPairedPrinters(PluginCall call) {
        Log.i(TAG, "listPairedPrinters start");
        if (!hasBluetoothPermission()) {
            call.reject("Bluetooth permission not granted. Call requestPermissions first.", "PERMISSION_REQUIRED");
            return;
        }
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Bluetooth is not available on this device", "BLUETOOTH_UNAVAILABLE");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth is turned off", "BLUETOOTH_DISABLED");
                return;
            }

            JSArray printers = new JSArray();
            for (BluetoothDevice device : getBondedDevices(adapter)) {
                printers.put(deviceToJson(device));
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("printers", printers);
            ret.put("savedAddress", getSavedAddress());
            ret.put("message", "Found " + printers.length() + " paired printer" + (printers.length() == 1 ? "" : "s"));
            Log.i(TAG, "listPairedPrinters success count=" + printers.length());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "listPairedPrinters failed", e);
            call.reject("List paired printers failed: " + e.getMessage(), "LIST_FAILED", e);
        }
    }

    @PluginMethod
    public void savePrinter(PluginCall call) {
        String address = normalizeAddress(call.getString("address", ""));
        Log.i(TAG, "savePrinter address=" + address);
        if (address.isEmpty()) {
            call.reject("Printer address is required", "ADDRESS_REQUIRED");
            return;
        }
        try {
            JSONObject saved = buildSavedPrinter(address);
            prefs().edit()
                .putString(PREF_SELECTED_ADDRESS, address)
                .putString(PREF_SELECTED, saved.toString())
                .apply();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("address", address);
            ret.put("savedPrinter", JSObject.fromJSONObject(saved));
            ret.put("message", "Saved printer " + saved.optString("name", address));
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "savePrinter failed", e);
            call.reject("Save printer failed: " + e.getMessage(), "SAVE_FAILED", e);
        }
    }

    @PluginMethod
    public void printSlip(PluginCall call) {
        Log.i(TAG, "printSlip start");
        if (!hasBluetoothPermission()) {
            call.reject("Bluetooth permission not granted. Call requestPermissions first.", "PERMISSION_REQUIRED");
            return;
        }

        final JSObject payload = call.getData();
        executor.execute(() -> {
            try {
                String address = chooseAddress(payload);
                if (address.isEmpty()) {
                    throw new Exception("No saved printer address. Pair D520BT-Z, then save printer first.");
                }
                byte[] data = buildEscPosSlip(new JSONObject(payload.toString()));
                writeBluetooth(address, data);

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("address", address);
                ret.put("bytes", data.length);
                ret.put("message", "Printed to " + printerName(address));
                Log.i(TAG, "printSlip success address=" + address + " bytes=" + data.length);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "printSlip failed", e);
                call.reject("Print failed: " + e.getMessage(), "PRINT_FAILED", e);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        executor.shutdownNow();
    }

    private boolean hasBluetoothPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String getSavedAddress() {
        String address = prefs().getString(PREF_SELECTED_ADDRESS, "");
        if (address != null && !address.trim().isEmpty()) return normalizeAddress(address);
        String saved = prefs().getString(PREF_SELECTED, "");
        if (saved == null || saved.trim().isEmpty()) return "";
        try {
            return normalizeAddress(new JSONObject(saved).optString("address", ""));
        } catch (Exception ignored) {
            return "";
        }
    }

    private String chooseAddress(JSONObject payload) {
        String address = getSavedAddress();
        if (!address.isEmpty()) return address;
        JSONObject settings = payload.optJSONObject("settings");
        if (settings != null) {
            address = normalizeAddress(settings.optString("printerAddress", ""));
            if (!address.isEmpty()) return address;
        }
        return DEFAULT_PRINTER_ADDRESS;
    }

    private String normalizeAddress(String address) {
        return address == null ? "" : address.trim().toUpperCase();
    }

    @SuppressLint("MissingPermission")
    private Set<BluetoothDevice> getBondedDevices(BluetoothAdapter adapter) {
        return adapter.getBondedDevices();
    }

    @SuppressLint("MissingPermission")
    private JSObject deviceToJson(BluetoothDevice device) {
        JSObject out = new JSObject();
        out.put("id", "bluetooth:" + device.getAddress());
        out.put("type", "bluetooth");
        out.put("name", safeName(device));
        out.put("address", device.getAddress());
        out.put("paired", true);
        out.put("online", true);
        return out;
    }

    @SuppressLint("MissingPermission")
    private JSONObject buildSavedPrinter(String address) throws Exception {
        JSONObject out = new JSONObject();
        out.put("id", "bluetooth:" + address);
        out.put("type", "bluetooth");
        out.put("name", printerName(address));
        out.put("address", address);
        out.put("paired", true);
        out.put("online", true);
        return out;
    }

    @SuppressLint("MissingPermission")
    private String printerName(String address) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter != null && hasBluetoothPermission()) {
                for (BluetoothDevice device : getBondedDevices(adapter)) {
                    if (address.equalsIgnoreCase(device.getAddress())) return safeName(device);
                }
            }
        } catch (Exception ignored) {
        }
        return "D520BT-Z";
    }

    @SuppressLint("MissingPermission")
    private String safeName(BluetoothDevice device) {
        String name = device.getName();
        return name == null || name.trim().isEmpty() ? "Bluetooth Printer" : name.trim();
    }

    @SuppressLint("MissingPermission")
    private void writeBluetooth(String address, byte[] data) throws Exception {
        Log.i(TAG, "writeBluetooth connecting address=" + address + " bytes=" + data.length);
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new Exception("Bluetooth is not available on this device");
        if (!adapter.isEnabled()) throw new Exception("Bluetooth is turned off");

        BluetoothDevice device = adapter.getRemoteDevice(address);
        adapter.cancelDiscovery();
        try (BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP_UUID)) {
            socket.connect();
            OutputStream output = socket.getOutputStream();
            output.write(data);
            output.flush();
        }
        Log.i(TAG, "writeBluetooth complete address=" + address);
    }

    private byte[] buildEscPosSlip(JSONObject payload) throws Exception {
        EscPos out = new EscPos();
        JSONObject buyer = payload.optJSONObject("buyer");
        if (buyer == null) buyer = new JSONObject();
        JSONArray orders = buyer.optJSONArray("orders");
        String storeName = payload.optString("storeName", "SellerFlowLive");
        String currency = payload.optString("currency", "PHP");

        out.init();
        out.alignCenter();
        out.bold(true);
        out.text(storeName);
        out.bold(false);
        out.text("SellerFlowLive");
        out.line();
        out.alignLeft();
        out.text("Buyer #" + buyer.optInt("num", buyer.optInt("bNum", 0)));
        out.text("Name: " + buyer.optString("name", ""));
        out.text("Handle: " + buyer.optString("handle", ""));
        out.text("Platform: " + buyer.optString("platform", ""));
        out.text("Session: " + payload.optString("sessionDate", ""));
        out.line();

        if (orders != null && orders.length() > 0) {
            for (int i = 0; i < orders.length(); i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;
                out.bold(true);
                out.text("Order #" + order.optInt("orderNum", i + 1));
                out.bold(false);
                out.text(order.optString("item", ""));
                out.text("Qty: " + order.optInt("qty", 1));
                double price = order.optDouble("price", 0);
                double total = order.optDouble("total", price);
                if (price > 0) out.text("Price: " + currency + " " + money(price));
                if (total > 0) out.text("Total: " + currency + " " + money(total));
                String time = order.optString("time", "");
                if (!time.isEmpty()) out.text(time);
                out.line();
            }
        } else {
            out.text("Order:");
            out.text(buyer.optString("lastComment", buyer.optString("comment", "")));
            out.line();
        }

        double totalSpent = buyer.optDouble("totalSpent", 0);
        if (totalSpent > 0) {
            out.bold(true);
            out.text("TOTAL: " + currency + " " + money(totalSpent));
            out.bold(false);
        }
        out.text("Created: " + payload.optString("createdAt", ""));
        out.feed(4);
        out.cut();
        return out.bytes();
    }

    private String money(double value) {
        if (Math.rint(value) == value) return String.valueOf((long) value);
        return String.format(java.util.Locale.US, "%.2f", value);
    }

    private void resolveOk(PluginCall call, String message, JSObject extra) {
        JSObject ret = extra == null ? new JSObject() : extra;
        ret.put("ok", true);
        ret.put("message", message);
        call.resolve(ret);
    }

    private static class EscPos {
        private final ByteArrayOutputStream out = new ByteArrayOutputStream();

        void init() {
            write(0x1B, 0x40);
        }

        void alignLeft() {
            write(0x1B, 0x61, 0x00);
        }

        void alignCenter() {
            write(0x1B, 0x61, 0x01);
        }

        void bold(boolean enabled) {
            write(0x1B, 0x45, enabled ? 0x01 : 0x00);
        }

        void text(String text) {
            if (text == null) text = "";
            byte[] bytes = text.getBytes(PRINTER_CHARSET);
            out.write(bytes, 0, bytes.length);
            out.write(0x0A);
        }

        void line() {
            text("--------------------------------");
        }

        void feed(int lines) {
            write(0x1B, 0x64, Math.max(1, Math.min(lines, 8)));
        }

        void cut() {
            write(0x1D, 0x56, 0x42, 0x00);
        }

        byte[] bytes() {
            return out.toByteArray();
        }

        private void write(int... values) {
            for (int value : values) out.write(value);
        }
    }
}
