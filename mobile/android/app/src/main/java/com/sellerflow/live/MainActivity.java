package com.sellerflow.live;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.DhcpInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_PRINTER_PERMISSIONS = 8588;
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PREFS = "sellerflow_printer";
    private static final String PREF_SELECTED = "selected_printer";
    private static final int LAN_PORT = 9100;
    private static final int LAN_TIMEOUT_MS = 130;
    private SellerFlowPrinterBridge printerBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SellerFlowPrinterPlugin.class);
        super.onCreate(savedInstanceState);
        printerBridge = new SellerFlowPrinterBridge();
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            webView.clearCache(true);
            webView.clearHistory();
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
            + "var cap=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.SellerFlowPrinter;"
            + "window.SellerFlowPrinter=window.SellerFlowPrinter||{};"
            + "if(cap){"
            + "window.SellerFlowPrinter.setPrinter=function(config){return cap.setPrinter(config||{});};"
            + "window.SellerFlowPrinter.getPrinter=function(){return cap.getPrinter();};"
            + "window.SellerFlowPrinter.testConnection=function(config){return cap.testConnection(config||{});};"
            + "window.SellerFlowPrinter.printSlip=function(payload){return cap.printSlip(payload);};"
            + "window.SellerFlowPrinter.status=function(){return cap.getPrinter();};"
            + "window.SellerFlowPrinter.scanPrinters=function(){return cap.getPrinter();};"
            + "window.SellerFlowPrinter.connectPrinter=function(printer){var p=printer;if(typeof printer==='string'){try{p=JSON.parse(printer);}catch(e){p={host:printer};}}return cap.setPrinter({host:(p&&p.host)||p||'',port:(p&&p.port)||9100});};"
            + "window.SellerFlowPrinter.printerStatus=function(){return cap.getPrinter();};"
            + "window.SellerFlowPrinter.testPrint=function(){return cap.printSlip({type:'sellerflow.printSlip',storeName:'SellerFlowLive',currency:'PHP',sessionDate:new Date().toISOString().slice(0,10),createdAt:new Date().toISOString(),buyer:{num:0,name:'Test Print',handle:'sellerflow',platform:'Android',orders:[{orderNum:1,item:'SellerFlowLive test print',qty:1,price:0,total:0,time:new Date().toLocaleString()}],totalSpent:0,totalOrders:1}});};"
            + "}else{"
            + "window.SellerFlowPrinter.printSlip=function(payload){return window.SellerFlowPrinterAndroid.printSlip(JSON.stringify(payload));};"
            + "window.SellerFlowPrinter.status=function(){return window.SellerFlowPrinterAndroid.status();};"
            + "window.SellerFlowPrinter.scanPrinters=function(){return window.SellerFlowPrinterAndroid.scanPrinters();};"
            + "window.SellerFlowPrinter.connectPrinter=function(printer){return window.SellerFlowPrinterAndroid.connectPrinter(typeof printer==='string'?printer:JSON.stringify(printer));};"
            + "window.SellerFlowPrinter.printerStatus=function(){return window.SellerFlowPrinterAndroid.printerStatus();};"
            + "window.SellerFlowPrinter.testPrint=function(){return window.SellerFlowPrinterAndroid.testPrint();};"
            + "}"
            + "})();";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private boolean hasPermission(String permission) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBluetoothConnectPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || hasPermission(Manifest.permission.BLUETOOTH_CONNECT);
    }

    private boolean hasBluetoothScanPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || hasPermission(Manifest.permission.BLUETOOTH_SCAN);
    }

    private void requestPrinterPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runOnUiThread(() -> requestPermissions(
                new String[]{Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN},
                REQUEST_PRINTER_PERMISSIONS
            ));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, REQUEST_PRINTER_PERMISSIONS));
        }
    }

    private class SellerFlowPrinterBridge {
        @JavascriptInterface
        public String status() {
            return printerStatus();
        }

        @JavascriptInterface
        public String printerStatus() {
            try {
                JSONObject saved = getSavedPrinter();
                JSONObject out = ok();
                out.put("savedPrinter", saved);
                if (saved == null) {
                    out.put("online", false);
                    out.put("message", "No saved printer yet");
                    return out.toString();
                }
                boolean online = isPrinterOnline(saved);
                out.put("online", online);
                out.put("message", online ? "Printer online: " + saved.optString("name", "Printer") : "Saved printer is offline");
                return out.toString();
            } catch (Exception e) {
                return fail("Printer status failed: " + e.getMessage()).toString();
            }
        }

        @JavascriptInterface
        public String scanPrinters() {
            try {
                JSONObject out = ok();
                JSONArray printers = new JSONArray();
                Set<String> ids = new HashSet<>();
                JSONObject saved = getSavedPrinter();
                out.put("savedPrinter", saved);
                if (!hasBluetoothConnectPermission() || !hasBluetoothScanPermission()) {
                    requestPrinterPermissions();
                    out.put("message", "Bluetooth permission requested. Allow it, then tap Scan again.");
                }
                for (JSONObject printer : scanBluetoothPrinters()) addUnique(printers, ids, printer);
                for (JSONObject printer : scanLanPrinters(saved)) addUnique(printers, ids, printer);
                out.put("printers", printers);
                out.put("message", printers.length() == 0
                    ? "No printer found. Make sure printer is on, Bluetooth is paired, or phone is on same WiFi."
                    : "Found " + printers.length() + " printer" + (printers.length() == 1 ? "" : "s"));
                return out.toString();
            } catch (Exception e) {
                return fail("Printer scan failed: " + e.getMessage()).toString();
            }
        }

        @JavascriptInterface
        public String connectPrinter(String printerJson) {
            try {
                JSONObject printer = new JSONObject(printerJson);
                boolean online = isPrinterOnline(printer);
                savePrinter(printer);
                JSONObject out = ok();
                out.put("savedPrinter", printer);
                out.put("online", online);
                out.put("message", (online ? "Connected to " : "Saved ") + printer.optString("name", "Printer"));
                return out.toString();
            } catch (Exception e) {
                return fail("Connect printer failed: " + e.getMessage()).toString();
            }
        }

        @JavascriptInterface
        public String testPrint() {
            try {
                JSONObject printer = choosePrinter(null);
                if (printer == null) return fail("No printer found. Scan and connect a printer first.").toString();
                sendToPrinter(printer, buildTestSlip());
                savePrinter(printer);
                JSONObject out = ok();
                out.put("savedPrinter", printer);
                out.put("online", true);
                out.put("message", "Test printed to " + printer.optString("name", "Printer"));
                return out.toString();
            } catch (Exception e) {
                return fail("Test print failed: " + e.getMessage()).toString();
            }
        }

        @JavascriptInterface
        public String printSlip(String payloadJson) {
            try {
                JSONObject payload = new JSONObject(payloadJson);
                JSONObject settings = payload.optJSONObject("settings");
                JSONObject printer = choosePrinter(settings);
                if (printer == null) return "No printer found. Open Settings > Mobile Printer, then Scan Printers.";
                sendToPrinter(printer, buildEscPosSlip(payload));
                savePrinter(printer);
                return "Printed to " + printer.optString("name", "Printer");
            } catch (Exception e) {
                return "Printer failed: " + e.getMessage();
            }
        }

        private JSONObject choosePrinter(JSONObject settings) throws Exception {
            JSONObject saved = getSavedPrinter();
            if (saved != null && isPrinterOnline(saved)) return saved;
            String preferred = settings == null ? "auto" : settings.optString("printerType", "auto").toLowerCase(Locale.ROOT);
            if (!"lan".equals(preferred)) {
                for (JSONObject bt : scanBluetoothPrinters()) {
                    if (isPrinterOnline(bt)) return bt;
                }
            }
            if (!"bluetooth".equals(preferred)) {
                List<JSONObject> lan = scanLanPrinters(saved);
                if (!lan.isEmpty()) return lan.get(0);
            }
            return saved;
        }

        private void sendToPrinter(JSONObject printer, byte[] data) throws Exception {
            String type = printer.optString("type", "");
            if ("lan".equals(type)) {
                sendToLanPrinter(printer.optString("host"), printer.optInt("port", LAN_PORT), data);
                return;
            }
            if ("bluetooth".equals(type)) {
                sendToBluetoothPrinter(printer.optString("address"), data);
                return;
            }
            throw new Exception("Unsupported printer type");
        }

        @SuppressLint("MissingPermission")
        private List<JSONObject> scanBluetoothPrinters() {
            List<JSONObject> printers = new ArrayList<>();
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled() || !hasBluetoothConnectPermission()) return printers;
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice device : bonded) {
                    printers.add(bluetoothJson(device, 0, true));
                }
            }
            if (hasBluetoothScanPermission()) {
                printers.addAll(discoverNearbyBluetooth(adapter));
            }
            Collections.sort(printers, (a, b) -> Integer.compare(b.optInt("signal", -100), a.optInt("signal", -100)));
            return printers;
        }

        @SuppressLint("MissingPermission")
        private List<JSONObject> discoverNearbyBluetooth(BluetoothAdapter adapter) {
            List<JSONObject> found = Collections.synchronizedList(new ArrayList<>());
            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (!BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) return;
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    short rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                    if (device != null && looksLikePrinter(safeDeviceName(device))) {
                        found.add(bluetoothJson(device, rssi, false));
                    }
                }
            };
            try {
                registerReceiver(receiver, new IntentFilter(BluetoothDevice.ACTION_FOUND));
                adapter.cancelDiscovery();
                adapter.startDiscovery();
                Thread.sleep(4200);
            } catch (Exception ignored) {
            } finally {
                try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
                try { unregisterReceiver(receiver); } catch (Exception ignored) {}
            }
            return found;
        }

        private List<JSONObject> scanLanPrinters(JSONObject saved) {
            List<JSONObject> printers = new ArrayList<>();
            String prefix = localSubnetPrefix();
            if (prefix == null) {
                if (saved != null && "lan".equals(saved.optString("type")) && tcpOpen(saved.optString("host"), saved.optInt("port", LAN_PORT), LAN_TIMEOUT_MS)) {
                    printers.add(saved);
                }
                return printers;
            }
            ExecutorService pool = Executors.newFixedThreadPool(36);
            List<Future<JSONObject>> futures = new ArrayList<>();
            for (int i = 1; i <= 254; i++) {
                final String host = prefix + i;
                futures.add(pool.submit(new Callable<JSONObject>() {
                    @Override
                    public JSONObject call() {
                        if (!tcpOpen(host, LAN_PORT, LAN_TIMEOUT_MS)) return null;
                        return lanJson(host, LAN_PORT);
                    }
                }));
            }
            pool.shutdown();
            try { pool.awaitTermination(2600, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) {}
            for (Future<JSONObject> future : futures) {
                try {
                    JSONObject printer = future.isDone() ? future.get() : null;
                    if (printer != null) printers.add(printer);
                } catch (Exception ignored) {}
            }
            return printers;
        }

        private boolean isPrinterOnline(JSONObject printer) {
            String type = printer.optString("type", "");
            if ("lan".equals(type)) return tcpOpen(printer.optString("host"), printer.optInt("port", LAN_PORT), 250);
            if ("bluetooth".equals(type)) return bluetoothDeviceExists(printer.optString("address"));
            return false;
        }

        @SuppressLint("MissingPermission")
        private boolean bluetoothDeviceExists(String address) {
            if (address == null || address.trim().isEmpty() || !hasBluetoothConnectPermission()) return false;
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) return false;
            Set<BluetoothDevice> devices = adapter.getBondedDevices();
            if (devices == null) return false;
            for (BluetoothDevice device : devices) if (address.equals(device.getAddress())) return true;
            return false;
        }

        @SuppressLint("MissingPermission")
        private void sendToBluetoothPrinter(String address, byte[] data) throws Exception {
            if (!hasBluetoothConnectPermission()) {
                requestPrinterPermissions();
                throw new Exception("Bluetooth permission requested. Tap again after allowing.");
            }
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) throw new Exception("Bluetooth not supported");
            if (!adapter.isEnabled()) throw new Exception("Bluetooth is turned off");
            BluetoothDevice printer = adapter.getRemoteDevice(address);
            adapter.cancelDiscovery();
            try (BluetoothSocket socket = printer.createRfcommSocketToServiceRecord(SPP_UUID)) {
                socket.connect();
                OutputStream out = socket.getOutputStream();
                out.write(data);
                out.flush();
            }
        }

        private void sendToLanPrinter(String host, int port, byte[] data) throws Exception {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), 1800);
                OutputStream out = socket.getOutputStream();
                out.write(data);
                out.flush();
            }
        }

        private boolean tcpOpen(String host, int port, int timeout) {
            if (host == null || host.trim().isEmpty()) return false;
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), timeout);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        private String localSubnetPrefix() {
            try {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi == null) return null;
                DhcpInfo dhcp = wifi.getDhcpInfo();
                if (dhcp == null || dhcp.ipAddress == 0) return null;
                int ip = dhcp.ipAddress;
                return (ip & 0xff) + "." + ((ip >> 8) & 0xff) + "." + ((ip >> 16) & 0xff) + ".";
            } catch (Exception e) {
                return null;
            }
        }

        private JSONObject getSavedPrinter() {
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String raw = prefs.getString(PREF_SELECTED, "");
                return raw == null || raw.isEmpty() ? null : new JSONObject(raw);
            } catch (Exception e) {
                return null;
            }
        }

        private void savePrinter(JSONObject printer) {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_SELECTED, printer.toString()).apply();
        }

        private void addUnique(JSONArray printers, Set<String> ids, JSONObject printer) {
            String id = printer.optString("id", "");
            if (id.isEmpty() || ids.contains(id)) return;
            ids.add(id);
            printers.put(printer);
        }

        @SuppressLint("MissingPermission")
        private JSONObject bluetoothJson(BluetoothDevice device, int rssi, boolean paired) {
            JSONObject printer = new JSONObject();
            try {
                String name = safeDeviceName(device);
                String address = device.getAddress();
                printer.put("id", "bluetooth:" + address);
                printer.put("type", "bluetooth");
                printer.put("name", name);
                printer.put("address", address);
                printer.put("paired", paired);
                printer.put("online", paired);
                printer.put("signal", rssi);
                printer.put("distance", rssi == 0 ? "paired" : (rssi > -55 ? "very near" : rssi > -70 ? "near" : "far"));
                printer.put("hint", paired ? "Paired Bluetooth printer" : "Nearby Bluetooth printer");
            } catch (Exception ignored) {}
            return printer;
        }

        private JSONObject lanJson(String host, int port) {
            JSONObject printer = new JSONObject();
            try {
                printer.put("id", "lan:" + host + ":" + port);
                printer.put("type", "lan");
                printer.put("name", "WiFi/LAN ESC-POS " + host);
                printer.put("host", host);
                printer.put("port", port);
                printer.put("online", true);
                printer.put("signal", 100);
                printer.put("distance", "same WiFi");
                printer.put("hint", "Network thermal printer");
            } catch (Exception ignored) {}
            return printer;
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

        private boolean looksLikePrinter(String name) {
            String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
            return n.contains("printer")
                || n.contains("thermal")
                || n.contains("xprinter")
                || n.contains("pos")
                || n.contains("58")
                || n.contains("80")
                || n.contains("mpt")
                || n.contains("pt-")
                || n.contains("rpp")
                || n.contains("xp-")
                || n.contains("receipt");
        }

        private JSONObject ok() {
            JSONObject out = new JSONObject();
            try { out.put("ok", true); } catch (Exception ignored) {}
            return out;
        }

        private JSONObject fail(String message) {
            JSONObject out = new JSONObject();
            try {
                out.put("ok", false);
                out.put("message", message);
            } catch (Exception ignored) {}
            return out;
        }

        private byte[] buildTestSlip() {
            EscPosBuilder esc = new EscPosBuilder();
            esc.init();
            esc.alignCenter();
            esc.bold(true);
            esc.text("SellerFlowLive");
            esc.text("PRINTER TEST");
            esc.bold(false);
            esc.feed();
            esc.alignLeft();
            esc.text("Bluetooth / LAN auto connect OK");
            esc.text("Time: " + new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new java.util.Date()));
            esc.feed(4);
            esc.cut();
            return esc.bytes();
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
            if (orders == null) orders = new JSONArray();
            boolean printTotal = settings == null || settings.optBoolean("printTotal", true);
            String currency = payload.optString("currency", "");
            int total = buyer == null ? 0 : buyer.optInt("totalSpent", 0);

            EscPosBuilder esc = new EscPosBuilder();
            esc.init();
            esc.alignLeft();
            esc.bold(true);
            esc.text("SellerFlowLive");                                  // normal -- header
            if (!sessionDate.isEmpty()) esc.text("Session: " + sessionDate); // normal -- header info
            esc.feed();
            esc.text(storeName);                                         // normal -- header

            esc.setCharSize(SellerFlowPrinterPlugin.ESC_POS_IMPORTANT_SIZE);  // === IMPORTANT ===
            esc.text("Buyer #" + buyerNum);
            esc.text(buyerName);
            if (!handle.isEmpty()) esc.text("@" + handle);
            esc.setCharSize(0x00);                                       // === END IMPORTANT ===

            esc.feed();
            esc.text("Order here");                                      // normal -- subtitle
            esc.bold(false);
            for (int i = 0; i < orders.length(); i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;
                String time = order.optString("time", "");
                String item = order.optString("item", "");
                if (!time.isEmpty()) esc.text(time);                     // normal -- timestamp
                if (!item.isEmpty()) {
                    esc.setCharSize(SellerFlowPrinterPlugin.ESC_POS_IMPORTANT_SIZE);  // === IMPORTANT ===
                    esc.bold(true);
                    esc.text(item);
                    esc.bold(false);
                    esc.setCharSize(0x00);                               // === END IMPORTANT ===
                }
            }
            if (printTotal && total > 0) {
                esc.feed();
                esc.setCharSize(SellerFlowPrinterPlugin.ESC_POS_IMPORTANT_SIZE);      // === IMPORTANT ===
                esc.bold(true);
                esc.text("Total: " + currency + total);
                esc.bold(false);
                esc.setCharSize(0x00);                                   // === END IMPORTANT ===
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
        void alignCenter() { raw(0x1B, 0x61, 0x01); }
        void bold(boolean on) { raw(0x1B, 0x45, on ? 0x01 : 0x00); }
        // GS ! n -- character size. Use SellerFlowPrinterPlugin.ESC_POS_IMPORTANT_SIZE
        // for prominent fields, 0x00 to return to normal.
        void setCharSize(int size) { raw(0x1D, 0x21, size); }
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
