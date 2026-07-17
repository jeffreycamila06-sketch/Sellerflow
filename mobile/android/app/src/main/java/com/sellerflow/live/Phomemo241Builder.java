package com.sellerflow.live;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phomemo PM-241 (PM-241Z-BT) TSPL builder — a VERBATIM FORK of
 * {@link TsplBuilder#forStickerNative} ported directly from the shipped iOS
 * reference {@code SellerFlowPrinterPlugin.buildTsplSticker241} (merged to
 * production main {@code 05e3eec}, hardware-verified on a real PM-241Z + 60x40).
 *
 * WHY A FORK (the 241 firmware quirks — every design choice below traces here):
 *  - The 241 has NO usable CJK font ROM, so Chinese/kanji/Thai/any non-ASCII
 *    name is drawn as a raster BITMAP band (see {@link BandRenderer} /
 *    Phomemo241Raster) instead of the AIMO's internal TSS24.BF2 + GBK.
 *  - The 241's DIRECTION 1 rasterizer is BROKEN (garbled font on 100x60 AND
 *    60x40, hardware-confirmed); only DIRECTION 0 renders clean. To still eject
 *    HEADER-first + upright, every element is authored top-left then rotated
 *    180 IN-LAYOUT at DIRECTION 0 (D1): a rot-0 element at (x,y) becomes a
 *    rot-180 element anchored at (W-x, H-y); a BAR re-anchors to (W-x-w, H-y-h);
 *    a band pre-rotates its pixels 180 (flip180) and re-anchors its box.
 *  - The 241 IGNORES the TSPL font x/y-multiplier on rotation-180 TEXT, so a
 *    SCALED element must be sized in PIXELS (a band). At scale EXACTLY 1.0 an
 *    ASCII element stays the verified rotation-180 TEXT (byte-identical default).
 *  - The 60x40 printable window starts ~authoring x=32 (hardware: x=16 sliced,
 *    x=36 whole), so EDGE_GUARD pulls the whole (right-heavy under the flip)
 *    layout left by 48 to clear the right non-printable edge.
 *
 * The FORK-DRIFT rule (mirrored from the iOS FORK-OF header + CLAUDE.md):
 * this fork tracks {@link TsplBuilder#forStickerNative} for the 4 AIMO-mirrored
 * sizes (an all-ASCII buyer is byte-equal to rotate180(AIMO)); 60x40 is Jeff's
 * bespoke v3 layout (a CONSCIOUS decline, fork-local x + gaps). ANY AIMO layout
 * edit must be mirrored here OR consciously declined in writing. The parity is
 * pinned by the JVM test {@code Phomemo241ParityTest} (rotate180(AIMO) for the 4
 * sizes + the v3 spec for 60x40) — a drift turns it red.
 *
 * PURITY: this class imports NO android.graphics — the glyph rasterizer is
 * injected as a {@link BandRenderer} (production = Phomemo241Raster with
 * Bitmap/Canvas/Noto CJK; tests = a deterministic fake), so the whole layout is
 * JVM-testable. TsplBuilder is NOT touched — its package-private
 * {@link TsplBuilder#transliterateLatin} is reused; the small private helpers
 * (safe/truncate/money/hasNonAscii/stripEmoji) are duplicated here because they
 * are private there.
 *
 * The 241 fork is deliberately NOT part of the cross-language golden set
 * (Java/Swift/tsplReference.ts): its CJK output is a device-font raster, which
 * differs iOS (PingFang) vs Android (Noto CJK) — visually equivalent, not
 * byte-identical. The goldens cover the AIMO TEXT+BAR stream only.
 */
final class Phomemo241Builder {

    private Phomemo241Builder() {}

    private static final byte[] CRLF = new byte[]{'\r', '\n'};

    // Device-name routing: a saved BT printer whose name starts "PM-241" is the
    // Phomemo (case-insensitive). Mirrors the iOS BleStickerLogic.resolveProfile
    // — "PM-241" only, never a broader "PM-2" that could grab a different printer
    // that already works via the AIMO path. Anything else (incl. AIMO D520BT,
    // empty, null) is NOT a 241, so the golden-locked AIMO path is the default.
    private static final String PHOMEMO_NAME_PREFIX = "PM-241";
    static boolean isPhomemo241(String savedName) {
        return savedName != null
            && savedName.toUpperCase(java.util.Locale.ROOT).startsWith(PHOMEMO_NAME_PREFIX);
    }

    // ── Injectable glyph rasterizer ─────────────────────────────────────────
    // The ONLY android.graphics dependency of the 241 path lives behind this
    // interface. render() returns the packed 1-bit band (already 180-rotated
    // via packBits flip180) or null on a failed/empty render (caller emits
    // nothing). Muls are DECIMAL — the raster sizes in PIXELS (24 x yMul) so it
    // honors every 0.1 seller step, unlike rotation-180 TEXT the 241 won't scale.
    interface BandRenderer {
        Band render(String text, double xMul, double yMul, int maxWidthDots);
    }

    /** A packed TSPL BITMAP band: widthBytes x height, mode-0 bytes (bit 0 = black). */
    static final class Band {
        final int widthBytes, height;
        final byte[] bytes;
        Band(int widthBytes, int height, byte[] bytes) {
            this.widthBytes = widthBytes; this.height = height; this.bytes = bytes;
        }
    }

    // ── Fork-local per-size layout (the AIMO SizeConfig table, duplicated) ──
    // TsplBuilder.SizeConfig + LAYOUTS are PRIVATE (golden-locked, ZERO-touch),
    // so the values are duplicated here. These are the SAME numbers — keeping the
    // 4 AIMO-mirrored sizes byte-parity — with 60x40 overridden fork-locally in
    // the builder body (Jeff's bespoke v3). Fields used by the 241 fork only.
    private static final class Size {
        final int wDots, rightEdge, storeGap, buyerNumYMul, buyerNumGap, nameGap,
                  usernameGap, sepGap, sepWidth, orderEntryGuard, orderLoopGuard, totalY, totalAmountX;
        final boolean showTotal;
        final int nameCjkXMul, nameCjkYMul, nameCjkGap;
        Size(int wDots, int rightEdge, int storeGap, int buyerNumYMul, int buyerNumGap,
             int nameGap, int usernameGap, int sepGap, int sepWidth, int orderEntryGuard,
             int orderLoopGuard, boolean showTotal, int totalY, int totalAmountX,
             int nameCjkXMul, int nameCjkYMul, int nameCjkGap) {
            this.wDots = wDots; this.rightEdge = rightEdge; this.storeGap = storeGap;
            this.buyerNumYMul = buyerNumYMul; this.buyerNumGap = buyerNumGap; this.nameGap = nameGap;
            this.usernameGap = usernameGap; this.sepGap = sepGap; this.sepWidth = sepWidth;
            this.orderEntryGuard = orderEntryGuard; this.orderLoopGuard = orderLoopGuard;
            this.showTotal = showTotal; this.totalY = totalY; this.totalAmountX = totalAmountX;
            this.nameCjkXMul = nameCjkXMul; this.nameCjkYMul = nameCjkYMul; this.nameCjkGap = nameCjkGap;
        }
    }
    private static final java.util.Map<String, Size> LAYOUTS = java.util.Map.of(
        "100x60", new Size(800, 784, 55, 2, 110, 58, 58, 10, 520, 390, 400, true, 445, 410, 2, 2, 58),
        "80x60",  new Size(640, 624, 35, 2, 95, 40, 35, 10, 360, 350, 360, true, 395, 250, 2, 2, 58),
        "80x50",  new Size(640, 624, 35, 2, 95, 40, 35, 10, 360, 270, 280, true, 315, 250, 2, 2, 58),
        "70x50",  new Size(560, 544, 35, 2, 95, 40, 35, 10, 280, 270, 280, true, 315, 170, 2, 2, 58),
        "60x40",  new Size(480, 464, 30, 1, 46, 34, 30, 6, 200, 240, 264, false, 0, 0, 2, 2, 58)
    );
    private static Size sizeFor(int wMm, int hMm) {
        Size c = LAYOUTS.get(wMm + "x" + hMm);
        return c != null ? c : LAYOUTS.get("100x60");
    }

    // Round half AWAY FROM ZERO — matches Swift Double.rounded()
    // (.toNearestOrAwayFromZero), used for every layout delta + the cell budget.
    private static int r241(double v) {
        return (int) (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));
    }

    // Clamp a raster multiplier to the usable range. Ceiling 8 mirrors AIMO's
    // TSPL 8x font ceiling (INTEGER scales stay height-parity with the goldens);
    // floor 0.5 lets sub-1 decimals genuinely SHRINK on the band path.
    private static double clampF(double v) { return Math.min(8.0, Math.max(0.5, v)); }

    /**
     * Build a Phomemo 241 sticker from the SAME payload the AIMO
     * {@link TsplBuilder#forStickerNative} consumes (buyer + settings + storeName
     * + currency + sessionDate + label size), plus an optional {@code scalesRaw}
     * map (241-only decimal size adjusters). The renderer draws non-ASCII / scaled
     * elements as raster bands.
     *
     * @param payload  full print payload (buyer/settings/storeName/currency/
     *                 sessionDate/scalesRaw as top-level keys)
     * @param renderer glyph rasterizer (production Phomemo241Raster; tests a fake)
     */
    static byte[] forStickerNative241(JSONObject payload, int labelWidthMm, int labelHeightMm, BandRenderer renderer) {
        if (payload == null) payload = new JSONObject();
        JSONObject buyer = payload.optJSONObject("buyer");
        if (buyer == null) buyer = new JSONObject();
        JSONObject settings = payload.optJSONObject("settings");
        JSONObject scalesRaw = payload.optJSONObject("scalesRaw");

        String storeName = payload.optString("storeName", "");
        String sessionDate = payload.optString("sessionDate", "");
        String currency = payload.optString("currency", "");
        int buyerNum = buyer.optInt("num", buyer.optInt("bNum", 0));
        String buyerName = buyer.optString("name", "");
        String buyerHandle = buyer.optString("handle", "");
        double totalSpent = buyer.optDouble("totalSpent", 0);
        JSONArray orders = buyer.optJSONArray("orders");

        boolean printStoreName     = settings == null || settings.optBoolean("printStoreName", true);
        boolean printBuyerNumber   = settings == null || settings.optBoolean("printBuyerNumber", true);
        boolean printBuyerUsername = settings == null || settings.optBoolean("printBuyerUsername", true);
        boolean printOrderItems    = settings == null || settings.optBoolean("printOrderItems", true);
        boolean printTotal         = settings == null || settings.optBoolean("printTotal", true);

        // F3/F4 = the 1x TSPL font heights (dots) used only to reflow the layout
        // down so a grown element never overlaps the next. No F2: the order-line
        // time is FIXED at base size (BUG 1/2), so it never shifts the layout.
        final int F3 = 24, F4 = 32;

        // DECIMAL seller scales (BUG 3): sclD reads the exact 0.1 step from
        // scalesRaw, falling back to the rounded integer level when absent (so
        // AIMO/legacy/native-test payloads stay byte-identical). No order/time
        // scale — the 241 order-line TIME is FIXED at base size (see the loop).
        double sStore   = sclD(scalesRaw, settings, "printStoreScale");
        double sBuyerNum= sclD(scalesRaw, settings, "printBuyerNumberScale");
        double sName    = sclD(scalesRaw, settings, "printBuyerNameScale");
        double sUser    = sclD(scalesRaw, settings, "printUsernameScale");
        double sComment = sclD(scalesRaw, settings, "printCommentScale");
        double sTotal   = sclD(scalesRaw, settings, "printTotalScale");

        final int W = labelWidthMm * 8;
        final int H = labelHeightMm * 8;
        Emit e = new Emit(W, H, renderer);

        e.writeAscii("SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm");
        e.writeAscii("GAP 2 mm, 0");
        e.writeAscii("DIRECTION 0");   // 241 DIR1 rasterizer is broken; rotate in-layout (D1)
        e.writeAscii("REFERENCE 0,0");
        e.writeAscii("DENSITY 8");
        e.writeAscii("CLS");

        Size c = sizeFor(labelWidthMm, labelHeightMm);

        // 60x40 = Jeff's bespoke layout (final spec v3). A CONSCIOUS divergence from
        // AIMO (the FORK-DRIFT rule permits a documented decline) — x + gaps are
        // FORK-LOCAL here; the shared per-size table (AIMO reads the SAME numbers)
        // is UNTOUCHED and the other 4 sizes stay byte-identical (every
        // `is6040 ? ... : <lit>` resolves to the current literal off 60x40).
        boolean is6040 = (labelWidthMm == 60 && labelHeightMm == 40);
        int storeGap    = is6040 ? 30 : c.storeGap;
        int buyerNumGap = is6040 ? 42 : c.buyerNumGap;
        int nameGap     = is6040 ? 44 : c.nameGap;
        int usernameGap = is6040 ? 50 : c.usernameGap;
        int headerX = is6040 ? 40  : 16;
        int headerY = is6040 ? 12  : 10;
        int dateX   = is6040 ? 330 : 290;
        int dateY   = is6040 ? 20  : 18;
        int storeX  = is6040 ? 64  : 16;
        int buyerX  = is6040 ? 40  : 16;
        int nameX   = is6040 ? 46  : 16;
        int userX   = is6040 ? 48  : 16;
        int timeX   = is6040 ? 58  : 16;
        int priceX  = is6040 ? 200 : 180;
        int startY  = is6040 ? 64  : 60;

        e.emitText(headerX, headerY, "3", 1, 1, "SellerFlowLive");
        if (!sessionDate.isEmpty()) {
            e.emitText(dateX, dateY, "2", 1, 1, safe(truncate(sessionDate, 12)));
        }
        // TOP separator bar. 60x40: printable-width span (the old x=0 w=480 bar ran
        // off the 241's DIRECTION-0 right non-printable edge).
        if (is6040) {
            e.emitBar(40, 48, 376, 3);
        } else {
            e.emitBar(0, 48, c.wDots, 3);
        }

        String cleanStoreName = stripEmoji(storeName);
        String cleanBuyerName = stripEmoji(buyerName);
        String cleanBuyerHandle = stripEmoji(buyerHandle);

        // D3: name resolution WITHOUT the UNSUPPORTED downgrade — the band renders
        // any script. Emoji-only names still fall back (stripEmoji, v1).
        String nameSource = cleanBuyerName;
        if (!buyerName.isEmpty() && cleanBuyerName.isEmpty()) {
            nameSource = !cleanBuyerHandle.isEmpty() ? cleanBuyerHandle : "Buyer #" + buyerNum;
        }
        String nameOut = TsplBuilder.transliterateLatin(nameSource);
        boolean bandName = hasNonAscii(nameOut);   // D3: replaces nameTier==CJK for the gap math

        int extra = 0;
        int y = startY;
        if (printStoreName && !cleanStoreName.isEmpty()) {
            e.emitSym(storeX, y, "3", sStore, safe(truncate(cleanStoreName, 36)), c.rightEdge);
            int d = r241((clampF(sStore) - 1) * F3);
            y += storeGap + d;
            extra += d;
        }

        if (printBuyerNumber) {
            double effY = clampF(c.buyerNumYMul * sBuyerNum);   // height mul (width stays 2x)
            e.emitHeightScaled(buyerX, y, "4", 2, c.buyerNumYMul, sBuyerNum, "Buyer #" + buyerNum, c.rightEdge);
            int d = r241((effY - c.buyerNumYMul) * F4);
            y += buyerNumGap + d;
            extra += d;
        }

        if (!nameOut.isEmpty()) {
            if (bandName) {
                // CJK / UNSUPPORTED name → band on both axes (base nameCjk*Mul), scaled.
                e.emitBand(nameX, y, safe(truncate(nameOut, 30)), c.nameCjkXMul * sName, c.nameCjkYMul * sName, c.rightEdge);
                double effY = clampF(c.nameCjkYMul * sName);
                int d = r241((effY - c.nameCjkYMul) * F4);
                y += c.nameCjkGap + d;
                extra += (c.nameCjkGap - nameGap) + d;
            } else {
                e.emitSym(nameX, y, "4", sName, safe(truncate(nameOut, 30)), c.rightEdge);
                int d = r241((clampF(sName) - 1) * F4);
                y += nameGap + d;
                extra += d;
            }
        }

        if (printBuyerUsername && !cleanBuyerHandle.isEmpty()) {
            e.emitSym(userX, y, "3", sUser, "@" + safe(truncate(cleanBuyerHandle, 30)), c.rightEdge);
            int d = r241((clampF(sUser) - 1) * F3);
            y += usernameGap + d;
            extra += d;
        }

        if (printOrderItems && orders != null && orders.length() > 0 && y < c.orderEntryGuard + extra) {
            // 60x40 (Jeff): the order separator BAR is REMOVED and only ONE order row
            // prints (order-per-sticker — a multi-order buyer splits into N stickers in
            // the plugin). Other sizes keep the bar + sepGap advance + 2 rows.
            if (!is6040) {
                e.emitBar(16, y, c.sepWidth, 2);
                y += c.sepGap;
            }
            int maxOrders = is6040 ? 1 : 2;
            int i = 0;
            while (i < Math.min(orders.length(), maxOrders) && y < c.orderLoopGuard + extra) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) { i++; continue; }
                String time = order.optString("time", "");
                String item = order.optString("item", "");
                String cleanItem = stripEmoji(item);
                // TIME — FIXED at base size (BUG 1/2). Plain TEXT font "2" 1x1.
                if (!time.isEmpty()) {
                    e.emitText(timeX, y, "2", 1, 1, safe(truncate(time, 10)));
                }
                // PRICE CODE — height-priority (base 2x width, 1x height); height honors
                // the comment decimal (BUG 3). ASCII scale 1.0 → TEXT (byte-identical).
                if (!cleanItem.isEmpty()) {
                    e.emitHeightScaled(priceX, is6040 ? y + 12 : y, "4", 2, 1, sComment, safe(truncate(cleanItem, 12)), c.rightEdge);
                }
                int d = Math.max(0, r241((clampF(sComment) - 1) * F4));
                y += 38 + d;
                i++;
            }
        }

        if (printTotal && totalSpent > 0 && c.showTotal) {
            int totalY = c.totalY + extra;
            e.emitSym(16, totalY, "3", sTotal, "Total:", c.rightEdge);
            String totalStr = safe(currency) + money(totalSpent);
            e.emitHeightScaled(c.totalAmountX, totalY, "4", 2, 1, sTotal, safe(truncate(totalStr, 18)), W - 16);
        }

        e.writeAscii("PRINT 1");
        return e.out.toByteArray();
    }

    // Decimal scale for `key`: read the exact seller adjuster from scalesRaw (BUG
    // 3), else the rounded integer level (Double). 0 → 1 (never a zero element).
    private static double sclD(JSONObject scalesRaw, JSONObject settings, String key) {
        if (scalesRaw != null) {
            double d = scalesRaw.optDouble(key, Double.NaN);
            if (!Double.isNaN(d)) return clampF(d == 0 ? 1 : d);
        }
        return (double) lvl(settings, key);
    }

    // Per-element size LEVEL read from settings (1-8, default 1 = base size).
    private static int lvl(JSONObject settings, String key) {
        int v = settings == null ? 1 : settings.optInt(key, 1);
        return Math.max(1, Math.min(8, v == 0 ? 1 : v));
    }

    // ── DIRECTION 0 + in-layout 180 rotation emit primitives (D1) ──────────
    // A rot-0 element authored at (x,y) becomes a rot-180 element anchored at
    // (W-x, H-y); a BAR re-anchors to (W-x-w, H-y-h); a band pre-rotates its
    // pixels (flip180, done in the renderer) and re-anchors its box. W/H = label
    // in dots (203 DPI = 8 dot/mm). EDGE_GUARD pulls the (right-heavy under the
    // flip) layout LEFT so the 241's narrower DIRECTION-0 right printable edge
    // never clips the leading letter (48: the 32-dot pull still half-clipped the
    // first letter of the x=16 lines at 60x40).
    private static final class Emit {
        static final int EDGE_GUARD = 48;
        final ByteArrayOutputStream out = new ByteArrayOutputStream(1024);
        final int W, H;
        final BandRenderer renderer;
        Emit(int W, int H, BandRenderer renderer) { this.W = W; this.H = H; this.renderer = renderer; }

        void writeAscii(String s) {
            writeBytes(out, s.getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, CRLF);
        }

        void emitText(int x, int y, String font, int xMul, int yMul, String content) {
            writeAscii("TEXT " + (W - x - EDGE_GUARD) + "," + (H - y) + ",\"" + font + "\",180," + xMul + "," + yMul + ",\"" + content + "\"");
        }

        void emitBar(int x, int y, int w, int h) {
            writeAscii("BAR " + Math.max(0, W - x - w - EDGE_GUARD) + "," + (H - y - h) + "," + w + "," + h);
        }

        // Emit `content` as a pre-rotated raster band, box re-anchored under the
        // 180 map: top-left → (W-x-boxW-EDGE_GUARD, H-y-h). Empty/blank or a failed
        // render → emit NOTHING (a 0-width BITMAP is malformed).
        void emitBand(int x, int y, String content, double xMulRaw, double yMulRaw, int rightEdge) {
            if (content.isEmpty()) return;
            double xMul = clampF(xMulRaw), yMul = clampF(yMulRaw);
            // Usable width RESERVES the EDGE_GUARD on the far side too, so the placed
            // box bx = W-x-bandW-EDGE_GUARD never hits the max(0,..) clamp that would
            // slice the leading letter. The band reads [x+EDGE_GUARD, <=rightEdge].
            int avail = Math.max(8, rightEdge - x - EDGE_GUARD);
            // CJK is drawn at natural width + clipped, so truncate to the cells that
            // fit (~24 x xMul dots each) from the ACTUAL decimal (NOT rounded up). ASCII
            // is compressed to `avail` by the renderer, so pass it WHOLE (a long name
            // shrinks to fit, never right-clips).
            String fitted;
            if (hasNonAscii(content)) {
                int cell = Math.max(1, r241(24 * xMul));
                fitted = truncate(content, Math.max(1, avail / cell));
            } else {
                fitted = content;
            }
            Band band = renderer.render(fitted, xMul, yMul, avail);
            if (band == null || band.height <= 0 || band.widthBytes <= 0 || band.bytes.length == 0) return;
            int bx = Math.max(0, W - x - band.widthBytes * 8 - EDGE_GUARD);
            // VERTICAL margin protection: a scaled band grown + pushed down by reflow
            // could drive H-y-height NEGATIVE (top row off the physical top edge =
            // reading bottom), losing content silently. Clamp to 0 so the band stays
            // fully on the label (top-aligned worst case). Horizontal is bounded by
            // `avail` + every element's x >= 32, keeping the physical span in [16, 392].
            int by = Math.max(0, H - y - band.height);
            writeBytes(out, ("BITMAP " + bx + "," + by + "," + band.widthBytes + "," + band.height + ",0,").getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, band.bytes);
            writeBytes(out, CRLF);
        }

        // SYMMETRIC scalable element (store / ASCII name / @username): scale BOTH
        // axes by the decimal. scale EXACTLY 1.0 (ASCII) → the verified TEXT command
        // (byte-identical default). CJK or scale!=1 → a (scale, scale) band.
        void emitSym(int x, int y, String font, double scale, String rawContent, int rightEdge) {
            String content = TsplBuilder.transliterateLatin(rawContent);
            if (content.isEmpty()) return;   // same emptiness rule as writeTextSmart (parity)
            boolean isCjk = hasNonAscii(content);
            if (!isCjk && scale == 1.0) { emitText(x, y, font, 1, 1, content); return; }
            emitBand(x, y, content, scale, scale, rightEdge);
        }

        // HEIGHT-PRIORITY scalable element (Buyer# / price code): width mul FIXED
        // (baseX), height scales with the level. scale EXACTLY 1.0 (ASCII) → TEXT at
        // (baseX, baseY) [byte-identical]. CJK or scale!=1 → band width = baseX,
        // height = baseY x scale.
        void emitHeightScaled(int x, int y, String font, int baseX, int baseY, double scale, String rawContent, int rightEdge) {
            String content = TsplBuilder.transliterateLatin(rawContent);
            if (content.isEmpty()) return;
            boolean isCjk = hasNonAscii(content);
            if (!isCjk && scale == 1.0) { emitText(x, y, font, baseX, baseY, content); return; }
            emitBand(x, y, content, (double) baseX, (double) baseY * scale, rightEdge);
        }
    }

    // ── Pure 1-bit packing (mirrors Swift Phomemo241Raster.packBits) ────────
    /**
     * Pack row-major 8-bit grayscale (0=black..255=white) into TSPL BITMAP
     * mode-0 bytes. Bit 0 = BLACK dot (hardware-proven by the Phase-0 P3 probe:
     * 0x00 printed black, 0xFF background). Width pads UP to a whole byte with pad
     * bits = 1 (white). Invalid dimensions / short pixel buffer → null.
     * {@code flip180} rotates 180 (reverses both row and column) so a band reads
     * upright once the whole DIRECTION-0 label is rotated — TRUE for every 241 band.
     */
    static Band packBits(byte[] gray, int width, int height, int threshold, boolean flip180) {
        if (width <= 0 || height <= 0 || gray == null || gray.length < width * height) return null;
        int widthBytes = (width + 7) / 8;
        byte[] out = new byte[widthBytes * height];
        Arrays.fill(out, (byte) 0xFF);
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                int srcRow = flip180 ? (height - 1 - row) : row;
                int srcCol = flip180 ? (width - 1 - col) : col;
                if ((gray[srcRow * width + srcCol] & 0xFF) < threshold) {
                    out[row * widthBytes + (col >> 3)] &= (byte) ~(0x80 >> (col & 7));
                }
            }
        }
        return new Band(widthBytes, height, out);
    }

    /**
     * AIMO-mirror character budget for a band from its x origin (full-width cells
     * of 24 x cjkXMul dots) — same formula as writeTextSmart's CJK clamp.
     */
    static int maxChars(int x, int rightEdge, int cjkXMul) {
        return Math.max(1, (rightEdge - x) / (24 * Math.max(1, cjkXMul)));
    }

    // ── Small helpers duplicated from TsplBuilder (private there) ───────────

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
        return s.replace("\"", "'");   // TSPL TEXT delimiter is " — escape internal quotes
    }

    private static boolean hasNonAscii(String s) {
        if (s == null) return false;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) > 127) return true;
        }
        return false;
    }

    // Emoji/pictographs/flags/ZWJ/variation-selectors/keycap — same set as
    // TsplBuilder.isStrippable, walked by codepoint then trimmed.
    private static boolean isStrippable(int cp) {
        return cp >= 0x1F000
            || (cp >= 0x2600 && cp <= 0x27BF)
            || (cp >= 0xFE00 && cp <= 0xFE0F)
            || cp == 0x200D
            || cp == 0x20E3;
    }

    private static String stripEmoji(String s) {
        if (s == null || s.isEmpty()) return "";
        StringBuilder sb = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            int cp = s.codePointAt(i);
            int width = Character.charCount(cp);
            if (!isStrippable(cp)) sb.appendCodePoint(cp);
            i += width;
        }
        return sb.toString().trim();
    }

    private static void writeBytes(ByteArrayOutputStream out, byte[] data) {
        out.write(data, 0, data.length);
    }
}
