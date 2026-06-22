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

    // ── Per-size layout config (ISOLATION) ──────────────────────────────────
    // Each sticker size is a self-contained entry: editing one row cannot affect
    // another (no shared geometry formula for any tunable value). forStickerNative
    // just executes the config. Values are the resolved equivalents of the old
    // parametric formulas, so every golden stays byte-identical. Mirrors the TS
    // reference (tsplReference.ts STICKER_LAYOUTS) and Swift — keep all in sync.
    //   rightEdge=wDots-16 (CJK clamp)   *Gap=y advance after that field
    //   buyerNumYMul=2x2 vs 2x1 height   orderEntry/LoopGuard=order-row y caps
    //   sepWidth=separator bar width     totalAmountX=right-aligned total amount
    private static final class SizeConfig {
        final int wDots, rightEdge, storeGap, buyerNumYMul, buyerNumGap, nameGap,
                  usernameGap, sepGap, sepWidth, orderEntryGuard, orderLoopGuard, totalY, totalAmountX;
        final boolean showTotal;
        SizeConfig(int wDots, int rightEdge, int storeGap, int buyerNumYMul, int buyerNumGap,
                   int nameGap, int usernameGap, int sepGap, int sepWidth, int orderEntryGuard,
                   int orderLoopGuard, boolean showTotal, int totalY, int totalAmountX) {
            this.wDots=wDots; this.rightEdge=rightEdge; this.storeGap=storeGap;
            this.buyerNumYMul=buyerNumYMul; this.buyerNumGap=buyerNumGap; this.nameGap=nameGap;
            this.usernameGap=usernameGap; this.sepGap=sepGap; this.sepWidth=sepWidth;
            this.orderEntryGuard=orderEntryGuard; this.orderLoopGuard=orderLoopGuard;
            this.showTotal=showTotal; this.totalY=totalY; this.totalAmountX=totalAmountX;
        }
    }
    private static final java.util.Map<String, SizeConfig> LAYOUTS = java.util.Map.of(
        // 480-dot height tier (60mm): full 2x2 buyer#, 2 order rows, Total kept.
        "100x60", new SizeConfig(800, 784, 35, 2, 95, 40, 35, 10, 520, 350, 360, true, 395, 410),
        "80x60",  new SizeConfig(640, 624, 35, 2, 95, 40, 35, 10, 360, 350, 360, true, 395, 250),
        // 400-dot height tier (50mm): Total moves up, ~1 order row fits.
        "80x50",  new SizeConfig(640, 624, 35, 2, 95, 40, 35, 10, 360, 270, 280, true, 315, 250),
        "70x50",  new SizeConfig(560, 544, 35, 2, 95, 40, 35, 10, 280, 270, 280, true, 315, 170),
        // 320-dot height tier (40mm): compact — buyer# 2x1, tighter gaps, NO Total
        // (swapped for @username); order row uses the freed bottom space.
        "60x40",  new SizeConfig(480, 464, 30, 1, 46, 34, 30,  6, 200, 240, 264, false,  0,   0)
    );
    private static SizeConfig stickerConfig(int wMm, int hMm) {
        SizeConfig c = LAYOUTS.get(wMm + "x" + hMm);
        return c != null ? c : LAYOUTS.get("100x60");
    }

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
     *
     * CJK: content fields (store name, buyer name, handle, order item) go
     * through writeTextSmart — pure-ASCII content takes the legacy
     * byte-identical path; content with any non-ASCII char is emitted as
     * TSS24.BF2 + GBK bytes, the only combination the AIMO firmware rendered
     * in the hardware diagnostic (probe "D" on the test page).
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

        // ISOLATION: all per-size geometry comes from this size's config entry —
        // no shared formula, so editing one size can't affect another.
        SizeConfig c = stickerConfig(labelWidthMm, labelHeightMm);

        // Header row: brand at left (font 3 so it can't reach the date), the
        // compact MM/DD/YYYY date grouped right after it at a fixed x=290 (the
        // font-3 brand is ~240 dots wide on every label width). No "Session:"
        // prefix — it overflowed into the brand on every size.
        writeAscii(out, "TEXT 16,10,\"3\",0,1,1,\"SellerFlowLive\"");
        if (!sessionDate.isEmpty()) {
            writeAscii(out, "TEXT 290,18,\"2\",0,1,1,\"" + safe(truncate(sessionDate, 12)) + "\"");
        }
        writeAscii(out, "BAR 0,48," + c.wDots + ",3");

        // Strip unrenderable codepoints (emoji/flags/pictographs/ZWJ/VS) per
        // field BEFORE the encoding decision — otherwise GBK turns them into
        // '?'. Pure-emoji buyer name then falls back to handle or "Buyer #N"
        // so the dominant identification row is never blank.
        String cleanStoreName = stripEmoji(storeName);
        String cleanBuyerName = stripEmoji(buyerName);
        String cleanBuyerHandle = stripEmoji(buyerHandle);
        String buyerNameToPrint = cleanBuyerName;
        if (!buyerName.isEmpty() && cleanBuyerName.isEmpty()) {
            buyerNameToPrint = !cleanBuyerHandle.isEmpty()
                ? cleanBuyerHandle
                : "Buyer #" + buyerNum;
        }

        int y = 60;
        if (printStoreName && !cleanStoreName.isEmpty()) {
            writeTextSmart(out, 16, y, "3", safe(truncate(cleanStoreName, 36)), 1, 1, c.rightEdge);
            y += c.storeGap;
        }

        // Buyer # is the dominant element — the whole point of the sticker.
        // Height multiplier per size (2x2 on tall labels, 2x1 on 60x40).
        if (printBuyerNumber) {
            writeAscii(out, "TEXT 16," + y + ",\"4\",0,2," + c.buyerNumYMul + ",\"Buyer #" + buyerNum + "\"");
            y += c.buyerNumGap;
        }

        if (!buyerNameToPrint.isEmpty()) {
            writeTextSmart(out, 16, y, "4", safe(truncate(buyerNameToPrint, 30)), 1, 1, c.rightEdge);
            y += c.nameGap;
        }

        // @username — kept on every size, incl. 60x40 (it replaced the Total
        // line there; buyer identity is essential on a shipping sticker).
        if (printBuyerUsername && !cleanBuyerHandle.isEmpty()) {
            writeTextSmart(out, 16, y, "3", "@" + safe(truncate(cleanBuyerHandle, 30)), 1, 1, c.rightEdge);
            y += c.usernameGap;
        }

        // Thin separator before the order lines so they read as a sub-section.
        if (printOrderItems && orders != null && orders.length() > 0 && y < c.orderEntryGuard) {
            writeAscii(out, "BAR 16," + y + "," + c.sepWidth + ",2");
            y += c.sepGap;
            // Cap at 2 orders so the layout doesn't run off the bottom of a
            // 60mm label. The full order history is still on the web slip and
            // any reprint UI; the sticker is a buyer-identifier, not a ledger.
            int maxOrders = 2;
            for (int i = 0; i < Math.min(orders.length(), maxOrders) && y < c.orderLoopGuard; i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;
                String time = order.optString("time", "");
                String item = order.optString("item", "");
                String cleanItem = stripEmoji(item);
                if (!time.isEmpty()) {
                    // Time column: x=16..~160 (font 2, ~12 dots/char). The
                    // frontend formats this as "HH:MM" (5 chars = ~60 dots)
                    // in the device's local timezone; truncate is a safety
                    // net for unexpected formats.
                    writeAscii(out, "TEXT 16," + y + ",\"2\",0,1,1,\"" + safe(truncate(time, 10)) + "\"");
                }
                if (!cleanItem.isEmpty()) {
                    // Item column: x=180..rightEdge. The "item" is the buyer's
                    // short price code (e.g. 150/250/600), rendered at the SAME
                    // size as the grand Total amount — font "4", 2x width, 1x
                    // height. truncate(12) is a width guard so a longer-than-
                    // expected code clips instead of overrunning rightEdge.
                    writeTextSmart(out, 180, y, "4", safe(truncate(cleanItem, 12)), 2, 1, c.rightEdge);
                }
                y += 38;
            }
        }

        // Footer total, anchored to the bottom of the label (no divider line).
        // The order rows stay clear of it via the guards. Dropped on 60x40
        // (config showTotal=false): that tier swaps the Total line for the
        // @username row — the price still prints as the order item above.
        if (printTotal && totalSpent > 0 && c.showTotal) {
            writeAscii(out, "TEXT 16," + c.totalY + ",\"3\",0,1,1,\"Total:\"");
            String totalStr = safe(currency) + money(totalSpent);
            writeAscii(out, "TEXT " + c.totalAmountX + "," + c.totalY + ",\"4\",0,2,1,\"" + safe(truncate(totalStr, 18)) + "\"");
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

    private static boolean hasNonAscii(String s) {
        if (s == null) return false;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) > 127) return true;
        }
        return false;
    }

    /**
     * True for codepoints the AIMO firmware can't render and we therefore
     * drop instead of letting GBK substitute them as '?'. Covers the Unicode
     * emoji blocks (U+1F000+ pictographs/emoticons/flags, U+2600-27BF misc
     * symbols + dingbats), ZWJ (U+200D) that glues emoji sequences,
     * variation selectors (U+FE00-FE0F) that style preceding chars as emoji,
     * and the combining enclosing keycap (U+20E3). CJK ideographs (U+4E00+)
     * and Latin/punctuation/digits pass through untouched.
     */
    private static boolean isStrippable(int cp) {
        return cp >= 0x1F000
            || (cp >= 0x2600 && cp <= 0x27BF)
            || (cp >= 0xFE00 && cp <= 0xFE0F)
            || cp == 0x200D
            || cp == 0x20E3;
    }

    /**
     * Removes emoji / pictographs / flag sequences from a display field so
     * GBK encoding doesn't substitute them as '?'. Walks codepoints (not
     * chars) so surrogate-pair emoji are dropped whole. Trailing/leading
     * whitespace left behind after stripping (e.g. "Maria [flag] ") is
     * trimmed so the caller's empty-check sees a truly empty string and can
     * apply its fallback. ASCII-only and pure-CJK strings come through
     * unchanged.
     */
    private static String stripEmoji(String s) {
        if (s == null || s.isEmpty()) return "";
        StringBuilder sb = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            int cp = s.codePointAt(i);
            int width = Character.charCount(cp);
            if (!isStrippable(cp)) {
                sb.appendCodePoint(cp);
            }
            i += width;
        }
        return sb.toString().trim();
    }

    /**
     * Production content-line writer (rotation 0, multipliers 1,1 — all
     * converted call sites use exactly these).
     *
     * ASCII content: emits the EXACT same command string the legacy inline
     * writeAscii calls produced — byte-identical, zero risk to the English
     * printing the production sellers rely on.
     *
     * Non-ASCII (Chinese) content: emits TSS24.BF2 + GBK bytes — the only
     * combination the AIMO D520BT rendered in the hardware diagnostic
     * (probe "D"). TSS24.BF2 is a 24-dot font and CJK glyphs are full-width
     * (~24 dots/char vs ~16 for ASCII font "3"), so the content is
     * re-truncated to fit the printable width from its x origin; the 24-dot
     * height fits the existing 35/38/40-dot row spacing without overlap.
     * If GBK is somehow unavailable, falls back to the legacy ASCII path
     * (CJK prints as '?' — same as pre-fix behaviour, never a crash).
     */
    // Content-line writer with explicit TSPL multipliers (xMul, yMul) and a
    // width-dependent rightEdge for the CJK clamp. Multipliers apply to BOTH the
    // ASCII and TSS24.BF2 (CJK) paths so an enlarged field renders the same for
    // English and Chinese. rightEdge = wDots-16 so the CJK width clamp tracks the
    // actual label width (784 on 100mm, 624 on 80mm) instead of a hardcoded edge.
    private static void writeTextSmart(ByteArrayOutputStream out, int x, int y, String asciiFont, String content, int xMul, int yMul, int rightEdge) {
        if (!hasNonAscii(content)) {
            writeAscii(out, "TEXT " + x + "," + y + ",\"" + asciiFont + "\",0," + xMul + "," + yMul + ",\"" + content + "\"");
            return;
        }
        try {
            // Conservative width clamp: treat every char as full-width 24 dots
            // times the horizontal multiplier so mixed ASCII+CJK strings can
            // never overrun the right edge of the label.
            int maxChars = Math.max(1, (rightEdge - x) / (24 * xMul));
            String fitted = truncate(content, maxChars);
            String prefix = "TEXT " + x + "," + y + ",\"TSS24.BF2\",0," + xMul + "," + yMul + ",\"";
            writeBytes(out, prefix.getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, fitted.getBytes("GBK"));
            writeBytes(out, "\"".getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, CRLF);
        } catch (java.io.UnsupportedEncodingException e) {
            writeAscii(out, "TEXT " + x + "," + y + ",\"" + asciiFont + "\",0," + xMul + "," + yMul + ",\"" + content + "\"");
        }
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
