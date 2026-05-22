package com.sellerflow.live;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_BLUETOOTH_CONNECT = 8588;
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private SellerFlowPrinterBridge printerBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        printerBridge = new SellerFlowPrinterBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(printerBridge, "SellerFlowPrinterAndroid");
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    injectPrinterBridge(webView);
                }

                @Override
                public void onPageCommitVisible(WebView webView, String url) {
                    injectPrinterBridge(webView);
                }
            });
            injectPrinterBridge(bridge.getWebView());
        }
    }

    private void injectPrinterBridge(WebView webView) {
        String js = "(function(){"
            + "window.SellerFlowPrinter=window.SellerFlowPrinter||{};"
            + "window.SellerFlowPrinter.printSlip=function(payload){return window.SellerFlowPrinterAndroid.printSlip(JSON.stringify(payload));};"
            + "window.SellerFlowPrinter.status=function(){return window.SellerFlowPrinterAndroid.status();};"
            + "})();";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private boolean hasBluetoothConnectPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQUEST_BLUETOOTH_CONNECT));
        }
    }

    private class SellerFlowPrinterBridge {
        @JavascriptInterface
        public String status() {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) return "Bluetooth not supported on this device";
            if (!adapter.isEnabled()) return "Bluetooth is turned off";
            if (!hasBluetoothConnectPermission()) return "Bluetooth permission needed";
            BluetoothDevice printer = findPrinter(adapter);
            return printer == null ? "No paired Bluetooth printer found" : "Bluetooth printer ready: " + safeDeviceName(printer);
        }

        @JavascriptInterface
        public String printSlip(String payloadJson) {
            if (!hasBluetoothConnectPermission()) {
                requestBluetoothConnectPermission();
                return "Bluetooth permission requested. Tap print again after allowing permission.";
            }
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null) return "Bluetooth not supported on this device";
                if (!adapter.isEnabled()) return "Bluetooth is turned off";
                BluetoothDevice printer = findPrinter(adapter);
                if (printer == null) return "No paired Bluetooth printer found. Pair printer in Android Bluetooth settings first.";
                byte[] data = buildEscPosSlip(new JSONObject(payloadJson));
                adapter.cancelDiscovery();
                try (BluetoothSocket socket = printer.createRfcommSocketToServiceRecord(SPP_UUID)) {
                    socket.connect();
                    OutputStream out = socket.getOutputStream();
                    out.write(data);
                    out.flush();
                }
                return "Printed to " + safeDeviceName(printer);
            } catch (Exception e) {
                return "Bluetooth print failed: " + e.getMessage();
            }
        }

        @SuppressLint("MissingPermission")
        private BluetoothDevice findPrinter(BluetoothAdapter adapter) {
            Set<BluetoothDevice> devices = adapter.getBondedDevices();
            if (devices == null || devices.isEmpty()) return null;
            BluetoothDevice fallback = null;
            for (BluetoothDevice device : devices) {
                String name = safeDeviceName(device).toLowerCase(Locale.ROOT);
                if (fallback == null) fallback = device;
                if (name.contains("printer")
                    || name.contains("thermal")
                    || name.contains("xprinter")
                    || name.contains("pos")
                    || name.contains("58")
                    || name.contains("80")
                    || name.contains("mpt")
                    || name.contains("pt-")) {
                    return device;
                }
            }
            return fallback;
        }

        @SuppressLint("MissingPermission")
        private String safeDeviceName(BluetoothDevice device) {
            try {
                String name = device.getName();
                return name == null || name.trim().isEmpty() ? device.getAddress() : name;
            } catch (Exception e) {
                return "Bluetooth printer";
            }
        }

        private byte[] buildEscPosSlip(JSONObject payload) throws Exception {
            JSONObject buyer = payload.optJSONObject("buyer");
            JSONObject settings = payload.optJSONObject("settings");
            String storeName = payload.optString("storeName", "SellerFlowLive");
            String sessionDate = payload.optString("sessionDate", "");
            String buyerName = buyer == null ? "" : buyer.optString("name", "");
            String handle = buyer == null ? "" : buyer.optString("handle", "");
            int buyerNum = buyer == null ? 0 : buyer.optInt("num", 0);
            JSONArray orders = buyer == null ? new JSONArray() : buyer.optJSONArray("orders");
            boolean printTotal = settings == null || settings.optBoolean("printTotal", true);
            String currency = payload.optString("currency", "P");
            int total = buyer == null ? 0 : buyer.optInt("totalSpent", 0);

            EscPosBuilder esc = new EscPosBuilder();
            esc.init();
            esc.alignLeft();
            esc.bold(true);
            esc.text("SellerFlowLive");
            if (!sessionDate.isEmpty()) esc.text("Session: " + sessionDate);
            esc.feed();
            esc.text(storeName);
            esc.text("Buyer #" + buyerNum);
            esc.text(buyerName);
            if (!handle.isEmpty()) esc.text("@" + handle);
            esc.feed();
            esc.text("Order here");
            esc.bold(false);
            for (int i = 0; i < orders.length(); i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;
                String time = order.optString("time", "");
                String item = order.optString("item", "");
                if (!time.isEmpty()) esc.text(time);
                if (!item.isEmpty()) {
                    esc.bold(true);
                    esc.text(item);
                    esc.bold(false);
                }
            }
            if (printTotal && total > 0) {
                esc.feed();
                esc.bold(true);
                esc.text("Total: " + currency + total);
                esc.bold(false);
            }
            esc.feed(4);
            esc.cut();
            return esc.bytes();
        }
    }

    private static class EscPosBuilder {
        private final java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        private final Charset charset = Charset.forName("GBK");

        void init() { raw(0x1B, 0x40); }
        void alignLeft() { raw(0x1B, 0x61, 0x00); }
        void bold(boolean on) { raw(0x1B, 0x45, on ? 0x01 : 0x00); }
        void feed() { raw(0x0A); }
        void feed(int lines) { for (int i = 0; i < lines; i++) feed(); }
        void cut() { raw(0x1D, 0x56, 0x42, 0x00); }
        void text(String value) {
            try {
                out.write((value == null ? "" : value).getBytes(charset));
                out.write(0x0A);
            } catch (Exception ignored) {}
        }
        void raw(int... bytes) { for (int b : bytes) out.write(b); }
        byte[] bytes() { return out.toByteArray(); }
    }
}
