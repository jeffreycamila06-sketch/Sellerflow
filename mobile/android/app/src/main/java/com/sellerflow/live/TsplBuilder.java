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
        // CJK buyer-name enlargement: Chinese/kanji names render via TSS24.BF2,
        // which is 24 dots tall at 1x vs the ASCII name font "4" at 32 — so a CJK
        // name looks smaller than an English one. nameCjk{X,Y}Mul scale ONLY the
        // CJK name (English stays 1x1); nameCjkGap is the y advance under the
        // taller name. The rest of the layout below the name shifts down by
        // (nameCjkGap - nameGap) only when the name is CJK (see forStickerNative),
        // so English fixtures stay byte-identical.
        final int nameCjkXMul, nameCjkYMul, nameCjkGap;
        SizeConfig(int wDots, int rightEdge, int storeGap, int buyerNumYMul, int buyerNumGap,
                   int nameGap, int usernameGap, int sepGap, int sepWidth, int orderEntryGuard,
                   int orderLoopGuard, boolean showTotal, int totalY, int totalAmountX,
                   int nameCjkXMul, int nameCjkYMul, int nameCjkGap) {
            this.wDots=wDots; this.rightEdge=rightEdge; this.storeGap=storeGap;
            this.buyerNumYMul=buyerNumYMul; this.buyerNumGap=buyerNumGap; this.nameGap=nameGap;
            this.usernameGap=usernameGap; this.sepGap=sepGap; this.sepWidth=sepWidth;
            this.orderEntryGuard=orderEntryGuard; this.orderLoopGuard=orderLoopGuard;
            this.showTotal=showTotal; this.totalY=totalY; this.totalAmountX=totalAmountX;
            this.nameCjkXMul=nameCjkXMul; this.nameCjkYMul=nameCjkYMul; this.nameCjkGap=nameCjkGap;
        }
    }
    private static final java.util.Map<String, SizeConfig> LAYOUTS = java.util.Map.of(
        // 480-dot height tier (60mm): full 2x2 buyer#, 2 order rows, Total kept.
        // CJK name 2x2 (48 tall); nameCjkGap 58 -> extra 0 on 100x60 (gap already 58).
        "100x60", new SizeConfig(800, 784, 55, 2, 110, 58, 58, 10, 520, 390, 400, true, 445, 410, 2, 2, 58),
        "80x60",  new SizeConfig(640, 624, 35, 2, 95, 40, 35, 10, 360, 350, 360, true, 395, 250, 2, 2, 58),
        // 400-dot height tier (50mm): Total moves up, ~1 order row fits.
        "80x50",  new SizeConfig(640, 624, 35, 2, 95, 40, 35, 10, 360, 270, 280, true, 315, 250, 2, 2, 58),
        "70x50",  new SizeConfig(560, 544, 35, 2, 95, 40, 35, 10, 280, 270, 280, true, 315, 170, 2, 2, 58),
        // 320-dot height tier (40mm): compact — buyer# 2x1, tighter gaps, NO Total
        // (swapped for @username); order row uses the freed bottom space.
        "60x40",  new SizeConfig(480, 464, 30, 1, 46, 34, 30,  6, 200, 240, 264, false,  0,   0, 2, 2, 58)
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

        // ── Per-element size scaling (mirrors tsplReference.ts / Swift) ─────────
        // Each element has an integer LEVEL 1-8 = the seller's size adjuster. The
        // level multiplies the element's BASE TSPL multiplier (clamped to the
        // TSPL 8x ceiling). Level 1 => base => byte-identical to the goldens. The
        // already-2x-wide elements (buyer#, price code, total amount) scale
        // HEIGHT only so they never overrun the right edge. F2/F3/F4 are the 1x
        // font heights (dots) used only to reflow the layout down so a grown
        // element never overlaps the next — at level 1 every delta is 0.
        final int F2 = 24, F3 = 24, F4 = 32;
        int lvlStore    = lvl(settings, "printStoreScale");
        int lvlBuyerNum = lvl(settings, "printBuyerNumberScale");
        int lvlName     = lvl(settings, "printBuyerNameScale");
        int lvlUser     = lvl(settings, "printUsernameScale");
        int lvlOrder    = lvl(settings, "printOrderScale");
        int lvlComment  = lvl(settings, "printCommentScale");
        int lvlTotal    = lvl(settings, "printTotalScale");

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

        // Buyer name — language-agnostic resolution (works for ANY buyer):
        //   1. pure-emoji name -> handle / "Buyer #N" (unchanged fallback).
        //   2. transliterate Latin diacritics so accented Latin (Vietnamese,
        //      Filipino, European, romanized) becomes ASCII -> big font "4".
        //   3. classify the result: ASCII | CJK ideograph | UNSUPPORTED.
        //   4. UNSUPPORTED (no AIMO font: Arabic/Korean/Thai/...) -> romanized
        //      @handle if ASCII, else omit the name line. The Buyer #N header +
        //      order code still identify the buyer, so nothing prints as '?'.
        String nameSource = cleanBuyerName;
        if (!buyerName.isEmpty() && cleanBuyerName.isEmpty()) {
            nameSource = !cleanBuyerHandle.isEmpty() ? cleanBuyerHandle : "Buyer #" + buyerNum;
        }
        String nameOut = transliterateLatin(nameSource);
        int nameTier = classifyScript(nameOut);
        if (nameTier == SCRIPT_UNSUPPORTED) {
            String handleOut = transliterateLatin(cleanBuyerHandle);
            if (!handleOut.isEmpty() && classifyScript(handleOut) == SCRIPT_ASCII) {
                nameOut = handleOut;
                nameTier = SCRIPT_ASCII;
            } else {
                nameOut = "";
            }
        }

        // `extra` accumulates the cumulative downward shift from BOTH the CJK-
        // name enlargement (legacy) and per-element size scaling, so the guards
        // + the bottom-anchored Total track everything above them. At all levels
        // = 1 it stays 0 (or the legacy CJK delta), keeping fixtures identical.
        int extra = 0;
        int y = 60;
        if (printStoreName && !cleanStoreName.isEmpty()) {
            int m = cmul(lvlStore);
            writeTextSmart(out, 16, y, "3", safe(truncate(cleanStoreName, 36)), m, m, m, m, c.rightEdge);
            int d = (m - 1) * F3;
            y += c.storeGap + d;
            extra += d;
        }

        // Buyer # is the dominant element — the whole point of the sticker.
        // Height multiplier per size (2x2 on tall labels, 2x1 on 60x40).
        // Height-priority scaling: width stays 2x, height = buyerNumYMul * level.
        //
        // BUYER 4-DIGIT FIT (2026-07-22, Jeff): the line is TWO fixed-position
        // TEXT commands — "Buyer" at x=16 and the BARE number (no "#") at
        // x=280 = 16 + 5 chars x 48 dots + a 24-dot gap (~3mm, half the old
        // space+"#" visual gap). Font "4" at 2x width = 48 dots/char, so 4
        // digits end at 280 + 4x48 = 472 <= 480 (the 60x40 wDots) — buyer
        // #1002 fits COMPLETELY on the smallest label (old single-command
        // "Buyer #<n>" clipped the 3rd digit there). Same font/width-pin/ym/y
        // on both commands, y-advance identical — nothing else moves. Keep the
        // three builders (Java/Swift/TS reference) byte-identical.
        if (printBuyerNumber) {
            int ym = cmul(c.buyerNumYMul * lvlBuyerNum);
            writeAscii(out, "TEXT 16," + y + ",\"4\",0,2," + ym + ",\"Buyer\"");
            writeAscii(out, "TEXT 280," + y + ",\"4\",0,2," + ym + ",\"" + buyerNum + "\"");
            int d = (ym - c.buyerNumYMul) * F4;
            y += c.buyerNumGap + d;
            extra += d;
        }

        // Buyer name — scaled on both axes (left-aligned, has width budget).
        // When the name is CJK it renders taller (base 2x = 48 vs ASCII 32), so
        // the whole layout BELOW it shifts down by `extra`. ASCII names at level
        // 1 -> extra 0, keeping every English fixture byte-identical.
        if (!nameOut.isEmpty()) {
            boolean cjkName = nameTier == SCRIPT_CJK;
            int asciiX = cmul(lvlName), asciiY = cmul(lvlName);
            int cjkX = cmul(c.nameCjkXMul * lvlName), cjkY = cmul(c.nameCjkYMul * lvlName);
            writeTextSmart(out, 16, y, "4", safe(truncate(nameOut, 30)), asciiX, asciiY, cjkX, cjkY, c.rightEdge);
            int usedY = cjkName ? cjkY : asciiY;
            int refBaseY = cjkName ? c.nameCjkYMul : 1;
            int d = (usedY - refBaseY) * F4;
            y += (cjkName ? c.nameCjkGap : c.nameGap) + d;
            extra += (cjkName ? (c.nameCjkGap - c.nameGap) : 0) + d;
        }

        // @username — kept on every size, incl. 60x40 (it replaced the Total
        // line there; buyer identity is essential on a shipping sticker).
        if (printBuyerUsername && !cleanBuyerHandle.isEmpty()) {
            int m = cmul(lvlUser);
            writeTextSmart(out, 16, y, "3", "@" + safe(truncate(cleanBuyerHandle, 30)), m, m, m, m, c.rightEdge);
            int d = (m - 1) * F3;
            y += c.usernameGap + d;
            extra += d;
        }

        // Thin separator before the order lines so they read as a sub-section.
        if (printOrderItems && orders != null && orders.length() > 0 && y < c.orderEntryGuard + extra) {
            writeAscii(out, "BAR 16," + y + "," + c.sepWidth + ",2");
            y += c.sepGap;
            // Cap at 2 orders so the layout doesn't run off the bottom of a
            // 60mm label. The full order history is still on the web slip and
            // any reprint UI; the sticker is a buyer-identifier, not a ledger.
            int maxOrders = 2;
            for (int i = 0; i < Math.min(orders.length(), maxOrders) && y < c.orderLoopGuard + extra; i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;
                String time = order.optString("time", "");
                String item = order.optString("item", "");
                String cleanItem = stripEmoji(item);
                int tm = cmul(lvlOrder);
                int pm = cmul(lvlComment); // price code: height-priority (width stays 2x)
                if (!time.isEmpty()) {
                    // Time column: x=16..~160 (font 2, ~12 dots/char). The
                    // frontend formats this as "HH:MM" (5 chars = ~60 dots)
                    // in the device's local timezone; truncate is a safety
                    // net for unexpected formats.
                    writeAscii(out, "TEXT 16," + y + ",\"2\",0," + tm + "," + tm + ",\"" + safe(truncate(time, 10)) + "\"");
                }
                if (!cleanItem.isEmpty()) {
                    // Item column: the "item" is the buyer's short price code
                    // (e.g. 150/250/600), rendered at the SAME base as the grand
                    // Total amount — font "4", 2x width, 1x height. truncate(12)
                    // is a width guard so a longer-than-expected code clips
                    // instead of overrunning rightEdge.
                    // PRICE-NEXT-TO-TIME (owner req): x = time_x(16) + time width
                    // + TWO spaces, all in the TIME's font "2" (12-dot cell) at
                    // the time's scale tm, so the gap reads ~2 spaces at 1x/2x/3x
                    // and tracks the actual time length (never overlaps the time).
                    // ONLY x changes. No time on this row -> keep the legacy x=180.
                    int priceX = time.isEmpty() ? 180 : 16 + (truncate(time, 10).length() + 2) * 12 * tm;
                    writeTextSmart(out, priceX, y, "4", safe(truncate(cleanItem, 12)), 2, pm, 2, pm, c.rightEdge);
                }
                int d = Math.max((tm - 1) * F2, (pm - 1) * F4);
                y += 38 + d;
                extra += d;
            }
        }

        // Footer total, anchored to the bottom of the label (no divider line).
        // The order rows stay clear of it via the guards. Dropped on 60x40
        // (config showTotal=false): that tier swaps the Total line for the
        // @username row — the price still prints as the order item above.
        if (printTotal && totalSpent > 0 && c.showTotal) {
            int totalY = c.totalY + extra;
            int lm = cmul(lvlTotal);
            writeAscii(out, "TEXT 16," + totalY + ",\"3\",0," + lm + "," + lm + ",\"Total:\"");
            int am = cmul(lvlTotal); // amount: height-priority (width stays 2x)
            String totalStr = safe(currency) + money(totalSpent);
            writeAscii(out, "TEXT " + c.totalAmountX + "," + totalY + ",\"4\",0,2," + am + ",\"" + safe(truncate(totalStr, 18)) + "\"");
        }

        writeAscii(out, "PRINT 1");
        return out.toByteArray();
    }

    private static String truncate(String s, int maxLen) {
        if (s == null) return "";
        return s.length() > maxLen ? s.substring(0, maxLen) : s;
    }

    // Per-element size LEVEL read from settings (1-8, default 1 = base size).
    private static int lvl(JSONObject settings, String key) {
        int v = settings == null ? 1 : settings.optInt(key, 1);
        return Math.max(1, Math.min(8, v));
    }

    // Clamp a computed TSPL multiplier to the firmware's 1-8 range.
    private static int cmul(int m) {
        return Math.max(1, Math.min(8, m));
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
     * Production content-line writer.
     *
     * ASCII content (incl. romanized Latin): emits a numbered-font TEXT command —
     * byte-identical to the legacy inline writeAscii calls for unaccented English.
     *
     * Chinese content: emits TSS24.BF2 + GBK bytes — the only combination the
     * AIMO D520BT rendered in the hardware diagnostic (probe "D"). TSS24.BF2 is a
     * 24-dot font; the content is re-truncated to fit the printable width from
     * its x origin. If GBK is unavailable it falls back to the ASCII path (never
     * a crash). Unsupported scripts are dropped upstream, so '?' never prints.
     */
    // Content-line writer with separate ASCII (xMul,yMul) and CJK (cjkXMul,
    // cjkYMul) multipliers so a CJK field can be enlarged WITHOUT touching the
    // ASCII (English) size. Before deciding the path, content is normalized:
    // Latin diacritics are romanized to ASCII, then any codepoint the AIMO has
    // no font for (non-ASCII, non-CJK-ideograph) is dropped — so nothing ever
    // prints as '?'. rightEdge = wDots-16 so the CJK width clamp tracks the
    // actual label width (784 on 100mm, 624 on 80mm).
    private static void writeTextSmart(ByteArrayOutputStream out, int x, int y, String asciiFont, String content, int xMul, int yMul, int cjkXMul, int cjkYMul, int rightEdge) {
        content = stripUnrenderable(transliterateLatin(content));
        if (content.isEmpty()) return;
        if (!hasNonAscii(content)) {
            writeAscii(out, "TEXT " + x + "," + y + ",\"" + asciiFont + "\",0," + xMul + "," + yMul + ",\"" + content + "\"");
            return;
        }
        try {
            // Conservative width clamp: treat every char as full-width 24 dots
            // times the horizontal multiplier so mixed ASCII+CJK strings can
            // never overrun the right edge of the label.
            int maxChars = Math.max(1, (rightEdge - x) / (24 * cjkXMul));
            String fitted = truncate(content, maxChars);
            String prefix = "TEXT " + x + "," + y + ",\"TSS24.BF2\",0," + cjkXMul + "," + cjkYMul + ",\"";
            writeBytes(out, prefix.getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, fitted.getBytes("GBK"));
            writeBytes(out, "\"".getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, CRLF);
        } catch (java.io.UnsupportedEncodingException e) {
            writeAscii(out, "TEXT " + x + "," + y + ",\"" + asciiFont + "\",0," + xMul + "," + yMul + ",\"" + content + "\"");
        }
    }

    // ── Script handling (language-agnostic; mirrored in Swift + TS reference) ──
    // The AIMO D520BT can only render ASCII (bitmap fonts) and Chinese (TSS24.BF2
    // + GBK). Everything else is handled in software: Latin diacritics are
    // romanized to ASCII; truly unsupported scripts (Arabic/Korean/Thai/...) are
    // dropped or fall back to the @handle / Buyer # so nothing prints as '?'.
    static final int SCRIPT_ASCII = 1, SCRIPT_CJK = 2, SCRIPT_UNSUPPORTED = 3;

    // Latin letters that NFD does NOT decompose to base+combining-mark. (The
    // Android Gradle build and the golden harness both compile with UTF-8, so
    // the literal letters here are safe — same as the Chinese fixtures.)
    private static String atomicLatin(char ch) {
        switch (ch) {
            case 'đ': return "d";  case 'Đ': return "D";  // d-stroke
            case 'ł': return "l";  case 'Ł': return "L";  // l-stroke
            case 'ø': return "o";  case 'Ø': return "O";  // o-slash
            case 'æ': return "ae"; case 'Æ': return "AE"; // ae
            case 'œ': return "oe"; case 'Œ': return "OE"; // oe
            case 'ß': return "ss";                             // sharp s
            case 'þ': return "th"; case 'Þ': return "Th"; // thorn
            case 'ð': return "d";  case 'Ð': return "D";  // eth
            case 'ı': return "i";                              // dotless i
            default: return null;
        }
    }

    /**
     * Romanize Latin-script text: NFD-decompose, drop combining diacritics
     * (U+0300-U+036F), and map the handful of atomic Latin letters NFD leaves
     * alone. e.g. "Tran"/"Phuong"/"Dang" from their accented forms. CJK
     * ideographs (no NFD decomposition) and plain ASCII pass through unchanged,
     * so existing goldens are byte-identical.
     */
    static String transliterateLatin(String s) {
        if (s == null || s.isEmpty()) return "";
        String d = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD);
        StringBuilder sb = new StringBuilder(d.length());
        for (int i = 0; i < d.length(); i++) {
            char ch = d.charAt(i);
            if (ch >= 0x0300 && ch <= 0x036F) continue; // combining mark
            String mapped = atomicLatin(ch);
            if (mapped != null) sb.append(mapped);
            else sb.append(ch);
        }
        return sb.toString();
    }

    private static boolean isCjkIdeograph(int cp) {
        return (cp >= 0x4E00 && cp <= 0x9FFF)   // CJK Unified Ideographs
            || (cp >= 0x3400 && cp <= 0x4DBF)   // Extension A
            || (cp >= 0xF900 && cp <= 0xFAFF);  // Compatibility Ideographs
    }

    /**
     * Classify already-transliterated text: ASCII (printable on the big numbered
     * fonts), CJK ideograph (printable via TSS24.BF2 + GBK), or UNSUPPORTED (any
     * non-ASCII, non-CJK codepoint — no AIMO font, would print as '?').
     */
    static int classifyScript(String s) {
        boolean hasCjk = false;
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            if (cp <= 127) continue;
            if (isCjkIdeograph(cp)) { hasCjk = true; continue; }
            return SCRIPT_UNSUPPORTED;
        }
        return hasCjk ? SCRIPT_CJK : SCRIPT_ASCII;
    }

    /** Keep only what the printer can render: ASCII + CJK ideographs. */
    private static String stripUnrenderable(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            int w = Character.charCount(cp);
            if (cp <= 127 || isCjkIdeograph(cp)) sb.appendCodePoint(cp);
            i += w;
        }
        return sb.toString();
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
