package com.sellerflow.live;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * TSPL (TSC Printer Language) command stream builder for AIMO-class label
 * printers like the AIMO D520BT. The AIMO firmware accepts TEXT and BAR
 * primitives but silently ignores BITMAP, so this builder uses TEXT + BAR
 * only (no raster/BITMAP path). Two production entry points:
 *
 *   - forStickerNative(payload, w, h): the 1-click sticker. Lays out the
 *     same slip data the WiFi/LAN ESC-POS print uses (store name, buyer #,
 *     buyer name, @handle, up to 2 order lines, total) as positioned TEXT
 *     blocks and BAR dividers.
 *   - textTestPage(storeName, w, h): minimal text-only diagnostic that
 *     confirms the printer + Bluetooth pipeline before any structured
 *     content is involved.
 *
 * Encoding: TSPL commands are ASCII, line-terminated with \r\n; the full
 * byte[] is written to the BluetoothSocket OutputStream in one go via
 * Classic Bluetooth SPP (UUID 00001101-0000-1000-8000-00805F9B34FB).
 */
class TsplBuilder {

    private static final byte[] CRLF = new byte[]{'\r', '\n'};

    /**
     * Minimal text-only test page. Used by testStickerPrint() to verify the
     * printer + Bluetooth pipeline before any structured content is involved.
     *
     * CJK DIAGNOSTIC (temporary, additive): lines A-D probe whether the AIMO
     * firmware can render Chinese at all. Each line has an ASCII label so the
     * photo of the printout tells us exactly which approach (if any) works:
     *   A: internal Traditional-Chinese font TST24.BF2 + Big5 bytes
     *   B: numbered font "3" + Big5 bytes (some clones map CJK here)
     *   D: internal Simplified font TSS24.BF2 + GBK bytes
     *   C: CODEPAGE UTF-8 + TST24.BF2 + UTF-8 bytes (last, so a sticky
     *      codepage can't corrupt the earlier lines; reset to 437 after)
     * The first four ASCII lines are the known-good control — they must
     * always print. Production forStickerNative is untouched by all of this.
     */
    static byte[] textTestPage(String storeName, int labelWidthMm, int labelHeightMm) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(512);
        writeAscii(out, "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm");
        writeAscii(out, "GAP 2 mm, 0");
        writeAscii(out, "DIRECTION 1");
        writeAscii(out, "REFERENCE 0,0");
        writeAscii(out, "DENSITY 8");
        writeAscii(out, "CLS");
        writeAscii(out, "TEXT 20,20,\"4\",0,1,1,\"SellerFlowLive\"");
        writeAscii(out, "TEXT 20,80,\"3\",0,1,1,\"Bluetooth printer OK\"");
        writeAscii(out, "TEXT 20,140,\"3\",0,1,1,\"" + safe(storeName) + "\"");
        writeAscii(out, "TEXT 20,200,\"2\",0,1,1,\"" + nowStamp() + "\"");

        // -- CJK probes: test name "CHEN XIAO MEI" (Traditional Chinese),
        // written as unicode escapes so this .java source stays ASCII-safe
        // under any javac file-encoding setting.
        String cjk = "\u9673\u5C0F\u7F8E";
        // A: TST24.BF2 + Big5
        writeAscii(out, "TEXT 20,250,\"2\",0,1,1,\"A:\"");
        writeEncodedTextLine(out, "TEXT 70,244,\"TST24.BF2\",0,1,1,\"", cjk, "Big5");
        // B: numbered font 3 + Big5
        writeAscii(out, "TEXT 20,300,\"2\",0,1,1,\"B:\"");
        writeEncodedTextLine(out, "TEXT 70,294,\"3\",0,1,1,\"", cjk, "Big5");
        // D: TSS24.BF2 + GBK (Simplified probe)
        writeAscii(out, "TEXT 20,350,\"2\",0,1,1,\"D:\"");
        writeEncodedTextLine(out, "TEXT 70,344,\"TSS24.BF2\",0,1,1,\"", cjk, "GBK");
        // C: CODEPAGE UTF-8 route — LAST so it can't affect A/B/D, then reset.
        writeAscii(out, "CODEPAGE UTF-8");
        writeAscii(out, "TEXT 20,400,\"2\",0,1,1,\"C:\"");
        writeEncodedTextLine(out, "TEXT 70,394,\"TST24.BF2\",0,1,1,\"", cjk, "UTF-8");
        // Reset to the TSPL default codepage so nothing sticky leaks into
        // later production prints (which never set CODEPAGE themselves).
        writeAscii(out, "CODEPAGE 437");

        writeAscii(out, "PRINT 1");
        return out.toByteArray();
    }

    /**
     * DIAGNOSTIC-ONLY encoder. Writes a TEXT command whose prefix/suffix are
     * ASCII but whose content bytes use the given charset (Big5/GBK/UTF-8),
     * because the production writeAscii would turn every CJK char into '?'.
     * If the charset is unavailable on this device, falls back to writeAscii
     * (the line will print as '?' — still a valid diagnostic result).
     */
    private static void writeEncodedTextLine(ByteArrayOutputStream out, String asciiPrefix, String content, String charsetName) {
        try {
            writeBytes(out, asciiPrefix.getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, content.getBytes(charsetName));
            writeBytes(out, "\"".getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, CRLF);
        } catch (java.io.UnsupportedEncodingException e) {
            writeAscii(out, asciiPrefix + content + "\"");
        }
    }

    /**
     * Build a sticker using TSPL TEXT + BAR primitives ONLY. Mirrors the
     * web/LAN slip content for the AIMO D520BT 100x60mm sticker stock at
     * 203 DPI (800x480 dots).
     *
     * Coordinate budget:
     *   - x=16 left margin / x=784 right margin
     *   - Order lines: time column x=16..160, item/price column x=180..784.
     *     Time is expected pre-formatted as "HH:MM" (5 chars at font 2 =
     *     ~60 dots) so the columns never collide; the truncation lengths
     *     act as a safety net for unexpected formats.
     */
    static byte[] forStickerNative(JSONObject payload, int labelWidthMm, int labelHeightMm) {
        if (payload == null) payload = new JSONObject();
        JSONObject buyer = payload.optJSONObject("buyer");
        if (buyer == null) buyer = new JSONObject();
        JSONObject settings = payload.optJSONObject("settings");

        String storeName = payload.optString("storeName", "");
        String sessionDate = payload.optString("sessionDate", "");
        String currency = payload.optString("currency", "");
        int buyerNum = buyer.optInt("num", buyer.optInt("bNum", 0));
        String buyerName = buyer.optString("name", "");
        String buyerHandle = buyer.optString("handle", "");
        double totalSpent = buyer.optDouble("totalSpent", 0);
        JSONArray orders = buyer.optJSONArray("orders");

        boolean printStoreName    = settings == null || settings.optBoolean("printStoreName", true);
        boolean printBuyerNumber  = settings == null || settings.optBoolean("printBuyerNumber", true);
        boolean printBuyerUsername= settings == null || settings.optBoolean("printBuyerUsername", true);
        boolean printOrderItems   = settings == null || settings.optBoolean("printOrderItems", true);
        boolean printTotal        = settings == null || settings.optBoolean("printTotal", true);

        ByteArrayOutputStream out = new ByteArrayOutputStream(1024);
        writeAscii(out, "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm");
        writeAscii(out, "GAP 2 mm, 0");
        writeAscii(out, "DIRECTION 1");
        writeAscii(out, "REFERENCE 0,0");
        writeAscii(out, "DENSITY 8");
        writeAscii(out, "CLS");

        // Header row: brand at left, session date at right.
        writeAscii(out, "TEXT 16,10,\"4\",0,1,1,\"SellerFlowLive\"");
        if (!sessionDate.isEmpty()) {
            writeAscii(out, "TEXT 460,18,\"2\",0,1,1,\"Session: " + safe(truncate(sessionDate, 22)) + "\"");
        }
        writeAscii(out, "BAR 0,48,800,3");

        int y = 60;
        if (printStoreName && !storeName.isEmpty()) {
            writeAscii(out, "TEXT 16," + y + ",\"3\",0,1,1,\"" + safe(truncate(storeName, 36)) + "\"");
            y += 35;
        }

        // Buyer # is the dominant element — the whole point of the sticker.
        if (printBuyerNumber) {
            writeAscii(out, "TEXT 16," + y + ",\"4\",0,2,2,\"Buyer #" + buyerNum + "\"");
            y += 95;
        }

        if (!buyerName.isEmpty()) {
            writeAscii(out, "TEXT 16," + y + ",\"4\",0,1,1,\"" + safe(truncate(buyerName, 30)) + "\"");
            y += 40;
        }

        if (printBuyerUsername && !buyerHandle.isEmpty()) {
            writeAscii(out, "TEXT 16," + y + ",\"3\",0,1,1,\"@" + safe(truncate(buyerHandle, 30)) + "\"");
            y += 35;
        }

        // Thin separator before the order lines so they read as a sub-section.
        if (printOrderItems && orders != null && orders.length() > 0 && y < 350) {
            writeAscii(out, "BAR 16," + y + ",520,2");
            y += 10;
            // Cap at 2 orders so the layout doesn't run off the bottom of a
            // 60mm label. The full order history is still on the web slip and
            // any reprint UI; the sticker is a buyer-identifier, not a ledger.
            int maxOrders = 2;
            for (int i = 0; i < Math.min(orders.length(), maxOrders) && y < 360; i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;
                String time = order.optString("time", "");
                String item = order.optString("item", "");
                if (!time.isEmpty()) {
                    // Time column: x=16..~160 (font 2, ~12 dots/char). The
                    // frontend formats this as "HH:MM" (5 chars = ~60 dots)
                    // in the device's local timezone; truncate is a safety
                    // net for unexpected formats.
                    writeAscii(out, "TEXT 16," + y + ",\"2\",0,1,1,\"" + safe(truncate(time, 10)) + "\"");
                }
                if (!item.isEmpty()) {
                    // Item column: x=180..~780. Pushed out from x=130 so
                    // even a full "HH:MM:SS PM" time can't bleed into it.
                    writeAscii(out, "TEXT 180," + y + ",\"3\",0,1,1,\"" + safe(truncate(item, 30)) + "\"");
                }
                y += 38;
            }
        }

        // Footer divider + total. Anchored to the bottom of the label so
        // variable-length content above doesn't shift it.
        writeAscii(out, "BAR 0,380,800,3");
        if (printTotal && totalSpent > 0) {
            writeAscii(out, "TEXT 16,395,\"3\",0,1,1,\"Total:\"");
            String totalStr = safe(currency) + money(totalSpent);
            writeAscii(out, "TEXT 410,395,\"4\",0,2,1,\"" + safe(truncate(totalStr, 18)) + "\"");
        }

        writeAscii(out, "PRINT 1");
        return out.toByteArray();
    }

    private static String truncate(String s, int maxLen) {
        if (s == null) return "";
        return s.length() > maxLen ? s.substring(0, maxLen) : s;
    }

    private static String money(double v) {
        if (Math.rint(v) == v) return String.valueOf((long) v);
        return String.format(java.util.Locale.US, "%.2f", v);
    }

    private static String safe(String s) {
        if (s == null) return "";
        // TSPL TEXT uses " as the value delimiter; escape any internal quotes.
        return s.replace("\"", "'");
    }

    private static String nowStamp() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
            .format(new java.util.Date());
    }

    private static void writeAscii(ByteArrayOutputStream out, String s) {
        writeBytes(out, s.getBytes(StandardCharsets.US_ASCII));
        writeBytes(out, CRLF);
    }

    private static void writeBytes(ByteArrayOutputStream out, byte[] data) {
        out.write(data, 0, data.length);
    }
}
