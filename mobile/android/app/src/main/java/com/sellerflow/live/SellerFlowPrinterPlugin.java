package com.sellerflow.live;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.Charset;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "SellerFlowPrinter")
public class SellerFlowPrinterPlugin extends Plugin {
    private static final String TAG = "SellerFlowPrinter";
    private static final String PREFS = "sellerflow_printer";
    private static final String PREF_HOST = "lan_host";
    private static final String PREF_PORT = "lan_port";
    private static final int DEFAULT_PORT = 9100;
    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final Charset PRINTER_CHARSET = Charset.forName("GBK");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void setPrinter(PluginCall call) {
        String host = cleanHost(call.getString("host", ""));
        int port = call.getInt("port", DEFAULT_PORT);
        Log.i(TAG, "setPrinter host=" + host + " port=" + port);
        if (host.isEmpty()) {
            call.reject("Printer IP address is required", "HOST_REQUIRED");
            return;
        }
        if (port <= 0 || port > 65535) {
            call.reject("Printer port must be between 1 and 65535", "PORT_INVALID");
            return;
        }
        prefs().edit().putString(PREF_HOST, host).putInt(PREF_PORT, port).apply();
        JSObject ret = printerConfig(host, port);
        ret.put("ok", true);
        ret.put("message", "Saved WiFi printer " + host + ":" + port);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPrinter(PluginCall call) {
        String host = getSavedHost();
        int port = getSavedPort();
        Log.i(TAG, "getPrinter host=" + host + " port=" + port);
        JSObject ret = printerConfig(host, port);
        ret.put("ok", !host.isEmpty());
        ret.put("message", host.isEmpty() ? "No WiFi printer saved" : "Saved WiFi printer " + host + ":" + port);
        call.resolve(ret);
    }

    @PluginMethod
    public void testConnection(PluginCall call) {
        String host = cleanHost(call.getString("host", getSavedHost()));
        int port = call.getInt("port", getSavedPort());
        Log.i(TAG, "testConnection host=" + host + " port=" + port);
        if (host.isEmpty()) {
            call.reject("Printer IP address is required", "HOST_REQUIRED");
            return;
        }
        if (port <= 0 || port > 65535) {
            call.reject("Printer port must be between 1 and 65535", "PORT_INVALID");
            return;
        }
        executor.execute(() -> {
            try {
                openAndClose(host, port);
                JSObject ret = printerConfig(host, port);
                ret.put("ok", true);
                ret.put("online", true);
                ret.put("message", "Printer reachable at " + host + ":" + port);
                Log.i(TAG, "testConnection success host=" + host + " port=" + port);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "testConnection failed host=" + host + " port=" + port, e);
                call.reject("Printer unreachable at " + host + ":" + port + " - " + e.getMessage(), "CONNECTION_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void printSlip(PluginCall call) {
        String host = getSavedHost();
        int port = getSavedPort();
        Log.i(TAG, "printSlip start host=" + host + " port=" + port);
        if (host.isEmpty()) {
            call.reject("No WiFi printer saved. Enter printer IP and tap Test Connection first.", "PRINTER_NOT_SET");
            return;
        }
        final JSObject payload = call.getData();
        executor.execute(() -> {
            try {
                byte[] data = buildEscPosSlip(new JSONObject(payload.toString()));
                writeTcp(host, port, data);
                JSObject ret = printerConfig(host, port);
                ret.put("ok", true);
                ret.put("online", true);
                ret.put("bytes", data.length);
                ret.put("message", "Printed to WiFi printer " + host + ":" + port);
                Log.i(TAG, "printSlip success host=" + host + " port=" + port + " bytes=" + data.length);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "printSlip failed host=" + host + " port=" + port, e);
                call.reject("Print failed at " + host + ":" + port + " - " + e.getMessage(), "PRINT_FAILED", e);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        executor.shutdownNow();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String getSavedHost() {
        return cleanHost(prefs().getString(PREF_HOST, ""));
    }

    private int getSavedPort() {
        return prefs().getInt(PREF_PORT, DEFAULT_PORT);
    }

    private String cleanHost(String host) {
        return host == null ? "" : host.trim();
    }

    private JSObject printerConfig(String host, int port) {
        JSObject ret = new JSObject();
        ret.put("host", host);
        ret.put("port", port);
        ret.put("savedPrinter", savedPrinter(host, port));
        return ret;
    }

    private JSObject savedPrinter(String host, int port) {
        JSObject printer = new JSObject();
        if (host == null || host.isEmpty()) return printer;
        printer.put("id", "lan:" + host + ":" + port);
        printer.put("type", "lan");
        printer.put("name", "WiFi/LAN ESC-POS " + host);
        printer.put("host", host);
        printer.put("port", port);
        printer.put("online", true);
        printer.put("hint", "Raw TCP port " + port);
        return printer;
    }

    private void openAndClose(String host, int port) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        }
    }

    private void writeTcp(String host, int port, byte[] data) throws Exception {
        Log.i(TAG, "writeTcp connecting host=" + host + " port=" + port + " bytes=" + data.length);
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setSoTimeout(CONNECT_TIMEOUT_MS);
            OutputStream output = socket.getOutputStream();
            output.write(data);
            output.flush();
        }
        Log.i(TAG, "writeTcp complete host=" + host + " port=" + port);
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
