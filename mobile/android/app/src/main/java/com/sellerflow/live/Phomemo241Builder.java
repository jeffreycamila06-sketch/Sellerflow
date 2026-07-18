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
 *  - Margins are MEASURED, not guessed (P1 ruler, 3-print drift-envelope
 *    protocol, Jeff's PM-241, 2026-07-18): reading-LEFT edge worst 16 dots
 *    (drifting), reading-RIGHT worst 8 (stable). Guards = worst + 8 buffer:
 *    reading-left is covered by the authoring-x floor + EDGE_GUARD (see the
 *    Emit class), reading-right by the per-size rightEdge inset (16 dots).
 *
 * The FORK-DRIFT rule (mirrored from the iOS FORK-OF header + CLAUDE.md):
 * as of Jeff's 2026-07-18 revisions EVERY size is a documented divergence from
 * AIMO — all sizes are "one row, no separator bar, no Total", and the three
 * sorting PRIMARIES (Buyer#, name, @username) are ENLARGED raster bands (P3.7:
 * ROM-emulation regular weight — prominence comes from SIZE; the 241 ignores
 * TEXT multipliers on rotation-180, so bands are the only way to enlarge).
 * The 4 big sizes still SHARE their remaining TEXT block with AIMO
 * (header/date/store + the single order row are byte-equal to rotate180(AIMO));
 * the removals are {sep bar, 2nd row, Total, the 3 bold primaries}. 60x40 is
 * Jeff's fully bespoke layout (fork-local x + gaps). ANY AIMO layout edit to a
 * SHARED line must be mirrored here OR consciously declined in writing. The
 * parity is pinned by the JVM test {@code Phomemo241ParityTest}: big-size TEXT ==
 * rotate180(AIMO) minus the documented removals + the 3 bold bands pinned
 * present; 60x40 is pinned by its own bespoke spec — a drift turns it red.
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

    // ── P3 per-script BOLD TUNING → P3.7 ONE-WEIGHT VERDICT (Jeff's samplers) ──
    // P3's bold sampler picked per-script weights (ASCII stroke 1.5/thr 128, CJK
    // 0/160). P3.7's FONT STYLE sampler then RETIRED the ASCII bold face: Jeff's
    // rematch verdict was that the bold+stroke ASCII bands look "buntis" next to
    // the AIMO's thin x2-stretched ROM font, and the pick was ROW 2's MECHANISM
    // (ROM-emulation: REGULAR weight drawn sharp, then nearest-neighbor pixel
    // stretch — see stretchGrayNearest) at ROW C's WEIGHT (the approved CJK
    // tuning: stroke 0, threshold 160 — the higher threshold packs the AA edge
    // fuller, giving the Row-C stroke thickness with no bold face). The whole
    // sticker now carries ONE consistent stroke weight — every enlarged/stretched
    // ASCII band AND the CJK bands pack at 160 with zero stroke widening — and
    // the hierarchy comes from SIZE, not boldness. CJK rendering itself is
    // untouched (approved: bold typeface + 160 when flagged, default face + 128
    // otherwise). Pure (JVM-pinned); Phomemo241Raster consumes these.
    static final int ROM_BAND_THRESHOLD = 160;
    static float boldStrokeFor(String text) { return 0f; }
    static int boldThresholdFor(String text) { return ROM_BAND_THRESHOLD; }

    // ── P3.5 AIMO-PROPORTION primary design (Jeff's side-by-side verdict,
    // 2026-07-18: the AIMO still won on SIZE — its buyer# is a true 2x-wide font 4;
    // the P3 241 buyer# was bold but 1x). New DESIGNED sizes (seller scales in the
    // pattern multiply ON TOP of these; the ladder + vertical planner still apply):
    //  - Buyer# band = BUYER_BOLD_X x BUYER_BOLD_Y = (8/3, 2.0) on EVERY size:
    //    48-dot cell, ~37-dot-wide mono chars (2x the P3 width, 1.5x its height —
    //    the AIMO-dominance proportion; mono glyphs are narrower than the ROM's,
    //    so ~37 is the 2x-directive result, one constant to widen further).
    //    Big sizes already drew 48-tall (baseY=2); they now gain the wider X too.
    //  - ASCII name band: 60x40 = NAME_BOLD_6040 (1.75 -> 42-dot cell, ~1.3x the
    //    P3 4/3); BIG sizes keep NAME_BOLD_BIG = 4/3 (32) — their nameGap (40) can
    //    not hold 42 without moving AIMO-parity rows, and their hierarchy is
    //    already dominant (buyer 48 > name 32 > user 24).
    //  - @username unchanged (24-dot cell) — Jeff: tama na.
    // The 60x40 reflow/planner RESERVES the new heights (buyer# d = 48s-32, ASCII
    // name d = 42(s-1)) so the defaults fit with zero stepping — see finalYFor.
    // P3.6 EXACT AIMO DIMENSION MATCH (dimensions export, 2026-07-18). The AIMO
    // 60x40 chars: buyer#/price = font 4 x2 = 48x32 dots; @user = font 3 = 16x24.
    // The Android mono glyph advance at the 24-dot cell is ~14 dots (estimate —
    // the renderer MEASURES the real width, so these are targets and the fit is
    // guaranteed by measure + step-down):
    static final double MONO_CHAR_W = 14.0;
    static final double AIMO_CHAR48_X = 48.0 / MONO_CHAR_W;   // ~3.43 -> 48-dot chars
    static final double PRICE_BAND_Y = 4.0 / 3.0;             // 32-dot cell (font-4 height)
    static final double USER_BOLD_X = 16.0 / MONO_CHAR_W;     // ~1.14 -> 16-dot chars
    static final double BUYER_BOLD_X = AIMO_CHAR48_X;         // was 8/3 (P3.5) -> full AIMO width
    static final double BUYER_BOLD_Y = 2.0;
    static final double NAME_BOLD_6040 = 1.75;
    static final double NAME_BOLD_BIG = 4.0 / 3.0;

    // ── Injectable glyph rasterizer ─────────────────────────────────────────
    // The ONLY android.graphics dependency of the 241 path lives behind this
    // interface. render() returns the packed 1-bit band (already 180-rotated
    // via packBits flip180) or null on a failed/empty render (caller emits
    // nothing). Muls are DECIMAL — the raster sizes in PIXELS (24 x yMul) so it
    // honors every 0.1 seller step, unlike rotation-180 TEXT the 241 won't scale.
    interface BandRenderer {
        Band render(String text, double xMul, double yMul, int maxWidthDots);
        // P3: bold-aware variant. Default delegates to the 4-arg form so every
        // existing fake/lambda keeps compiling; the production Phomemo241Raster
        // overrides it. P3.7: for ASCII the flag no longer changes the face/weight
        // (every non-CJK band renders ROM-emulation regular at ROM_BAND_THRESHOLD;
        // hierarchy = SIZE) — it still ROUTES the element to a band, and for CJK
        // it still selects the approved bold typeface + 160 tuning.
        default Band render(String text, double xMul, double yMul, int maxWidthDots, boolean bold) {
            return render(text, xMul, yMul, maxWidthDots);
        }
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
    // showTotal is FALSE for EVERY size now (Jeff, 2026-07-18: no Total on any 241
    // sticker). totalY/totalAmountX are retained (harmless data) so a future decision
    // to restore Total is a one-flag change. The AIMO SizeConfig is a SEPARATE table
    // (golden-locked) — it still shows Total; this is the fork-local divergence.
    private static final java.util.Map<String, Size> LAYOUTS = java.util.Map.of(
        "100x60", new Size(800, 784, 55, 2, 110, 58, 58, 10, 520, 390, 400, false, 445, 410, 2, 2, 58),
        "80x60",  new Size(640, 624, 35, 2, 95, 40, 35, 10, 360, 350, 360, false, 395, 250, 2, 2, 58),
        "80x50",  new Size(640, 624, 35, 2, 95, 40, 35, 10, 360, 270, 280, false, 315, 250, 2, 2, 58),
        "70x50",  new Size(560, 544, 35, 2, 95, 40, 35, 10, 280, 270, 280, false, 315, 170, 2, 2, 58),
        "60x40",  new Size(480, 464, 30, 1, 46, 34, 30, 6, 200, 240, 264, false, 0, 0, 2, 2, 56)
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

    // ── P1 RULER TEST PAGE (margin/dead-zone measurement diagnostic) ─────────
    // Prints tick marks measured from every edge so Jeff can READ the unit's real
    // printable window instead of us guessing it (the 3-print drift-envelope
    // protocol: print, reload the roll, print again, mid-roll print — the WORST
    // surviving tick per edge across the 3 prints = that edge's dead-zone
    // envelope; margin offset = envelope + 8-dot buffer).
    //
    // ⚠️ DELIBERATELY BYPASSES EDGE_GUARD + the production Emit primitives: the
    // ruler must measure the PHYSICAL edges, and routing it through the guard
    // would shift every tick by the very margin we're trying to replace. These
    // helpers apply ONLY the DIR0+180 coordinate flip (so the ejected label reads
    // upright, same as production) with ZERO guard: an authoring/READING-space
    // coordinate maps bar (ax,ay,w,h) -> BAR (W-ax-w),(H-ay-h) and text (ax,ay)
    // -> TEXT (W-ax),(H-ay),180. Reading-left tick distances therefore measure
    // the physical edge that clips the layout's LEFT column — the number Jeff
    // reads is DIRECTLY the safe authoring-x margin for that edge, no mapping.
    private static void rulerBar(ByteArrayOutputStream out, int W, int H, int ax, int ay, int w, int h) {
        writeBytes(out, ("BAR " + (W - ax - w) + "," + (H - ay - h) + "," + w + "," + h).getBytes(StandardCharsets.US_ASCII));
        writeBytes(out, CRLF);
    }
    private static void rulerText(ByteArrayOutputStream out, int W, int H, int ax, int ay, String font, String content) {
        writeBytes(out, ("TEXT " + (W - ax) + "," + (H - ay) + ",\"" + font + "\",180,1,1,\"" + content + "\"").getBytes(StandardCharsets.US_ASCII));
        writeBytes(out, CRLF);
    }

    /**
     * P1 ruler pattern at the seller's current label size. Reading-space layout:
     *  - FRAME on the exact label boundary (the 0-dot reference all around).
     *  - LEFT + RIGHT edges: 9 vertical ticks each at 0,4,8,...,32 dots from the
     *    edge, VERTICALLY STAGGERED (own y band per tick, so each also samples a
     *    different point along the feed) with its dot-number label printed well
     *    inboard (left labels at x=40; right labels ending 40 dots from the edge).
     *  - TOP + BOTTOM edges: horizontal ticks at 0,8,16,24,32 (8-dot step — a
     *    4-dot step leaves 2-dot gaps between 2-dot bars, uncountable on paper;
     *    feed-direction drift is governed by GAP calibration and is coarser).
     *  - CENTER: size + "RULER" + a print-number blank Jeff pen-fills (1-3).
     * BAR-only at the edges (no font dependency where clipping happens); TEXT only
     * appears >=40 dots inboard. Pure bytes — no renderer, no settings, no buyer.
     */
    static byte[] rulerTestPage(int labelWidthMm, int labelHeightMm) {
        final int W = labelWidthMm * 8, H = labelHeightMm * 8;
        ByteArrayOutputStream out = new ByteArrayOutputStream(1024);
        for (String cmd : new String[]{
                "SIZE " + labelWidthMm + " mm, " + labelHeightMm + " mm",
                "GAP 2 mm, 0", "DIRECTION 0", "REFERENCE 0,0", "DENSITY 8", "CLS"}) {
            writeBytes(out, cmd.getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, CRLF);
        }
        // FRAME on the exact boundary (doubles as the 0-dot mark on all 4 edges).
        rulerBar(out, W, H, 0, 0, W, 2);
        rulerBar(out, W, H, 0, H - 2, W, 2);
        rulerBar(out, W, H, 0, 0, 2, H);
        rulerBar(out, W, H, W - 2, 0, 2, H);
        // LEFT + RIGHT vertical ticks: 9 each at d = 0..32 step 4, staggered bands.
        final int bandTop = 40, tickLen = 20;
        final int pitch = (H - 100) / 8;   // 9 bands between the top/bottom combs
        for (int i = 0; i <= 8; i++) {
            int d = i * 4;
            int yB = bandTop + i * pitch;
            rulerBar(out, W, H, d, yB, 2, tickLen);                    // left tick
            rulerText(out, W, H, 40, yB, "2", String.valueOf(d));       // left label (inboard)
            rulerBar(out, W, H, W - 2 - d, yB, 2, tickLen);            // right tick
            rulerText(out, W, H, W - 64, yB, "2", String.valueOf(d));   // right label (ends 40 in)
        }
        // TOP + BOTTOM horizontal ticks: d = 0..32 step 8, alternating lengths.
        for (int i = 0; i <= 4; i++) {
            int d = i * 8;
            int len = (i % 2 == 0) ? 120 : 70;
            rulerBar(out, W, H, W / 2 - len / 2, d, len, 2);            // top
            rulerBar(out, W, H, W / 2 - len / 2, H - 2 - d, len, 2);    // bottom
        }
        // CENTER info block.
        rulerText(out, W, H, W / 2 - 90, H / 2 - 40, "3", "RULER " + labelWidthMm + "x" + labelHeightMm);
        rulerText(out, W, H, W / 2 - 90, H / 2 - 12, "2", "PRINT #__ (1-3)");
        rulerText(out, W, H, W / 2 - 90, H / 2 + 12, "2", "SIDE TICKS 0-32 STEP 4");
        writeBytes(out, "PRINT 1".getBytes(StandardCharsets.US_ASCII));
        writeBytes(out, CRLF);
        return out.toByteArray();
    }

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
        return forStickerNative241(payload, labelWidthMm, labelHeightMm, renderer, new java.util.ArrayList<>());
    }

    /**
     * P2.5 overload: {@code droppedOut} receives the labels of any rows the vertical
     * planner had to DROP (extreme case only — after every scale is at its floor the
     * layout still doesn't fit). Empty in every realistic configuration (the 1.0
     * layouts fit every size by design). The plugin logs it; a P4 preview warning
     * will surface it to the seller.
     */
    static byte[] forStickerNative241(JSONObject payload, int labelWidthMm, int labelHeightMm, BandRenderer renderer, java.util.List<String> droppedOut) {
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

        // ── P4 per-field WEIGHT routing (additive `weightsRaw` payload object,
        // same delivery pattern as scalesRaw: absent on AIMO/App.tsx/legacy/old-
        // binary payloads → the P3 hierarchy DEFAULTS below → byte-identical
        // output; AIMO ignores the field entirely). true = the PROMINENT designed
        // rendering (enlarged band; CJK bold face); false = the plain rendering
        // (TEXT at base size / regular-scaled band). Post-P3.7 the flag never
        // changes the stroke weight of ASCII — prominence is SIZE.
        JSONObject weightsRaw = payload.optJSONObject("weightsRaw");
        boolean wStore = wgt(weightsRaw, "store", false);
        boolean wBuyer = wgt(weightsRaw, "buyerNum", true);
        boolean wName  = wgt(weightsRaw, "name", true);
        boolean wUser  = wgt(weightsRaw, "username", true);
        boolean wPrice = wgt(weightsRaw, "comment", false);

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

        // 60x40 = Jeff's fully bespoke layout. A CONSCIOUS divergence from AIMO (the
        // FORK-DRIFT rule permits a documented decline) — x + gaps are FORK-LOCAL here.
        // The shared per-size table (AIMO reads the SAME numbers) is UNTOUCHED; the big
        // sizes reuse its top-block x/gaps (so those lines stay AIMO-parity) and only
        // drop the bar/2nd row/Total below (every `is6040 ? ... : <lit>` off 60x40
        // resolves to the big-size literal).
        boolean is6040 = (labelWidthMm == 60 && labelHeightMm == 40);
        // 60x40 = Jeff's v3 vertical arrangement (the y-flow / gaps below are his design,
        // UNCHANGED): shop 64 -> buyer# 92 (storeGap 28) -> name 136 (buyerNumGap 44) ->
        // @user 192 (nameCjkGap 56) -> time 242 (usernameGap 50) -> price 242 (offset 0,
        // same line as the time).
        // LEFT_GUARD_MEASURED = 24 — P1 MEASURED (3-print drift-envelope protocol on
        // Jeff's PM-241, 2026-07-18): reading-left worst 16 dots (16/16/12, drifting)
        // + 8 buffer. Every 60x40 left-column x is floored here; the big sizes author
        // at x=16 and clear the same envelope via EDGE_GUARD (16+16 = 32 >= 24 — see
        // Emit), so their AIMO-parity x's stay untouched. The measurement is a
        // property of the MACHINE, not the size — both mechanisms enforce it.
        final int LEFT_GUARD_MEASURED = 24;
        int storeGap    = is6040 ? 28 : c.storeGap;
        int buyerNumGap = is6040 ? 44 : c.buyerNumGap;
        int nameGap     = is6040 ? 44 : c.nameGap;
        int usernameGap = is6040 ? 50 : c.usernameGap;
        int headerX = is6040 ? LEFT_GUARD_MEASURED : 16;
        int headerY = is6040 ? 14  : 10;
        // RIGHT-EDGE FIT (60x40): the DIR0+180 emit places a rot-180 element's
        // reading-right at (W - anchor + width). Jeff's revision keeps the date at
        // x=260 (clears LEFT_GUARD_MEASURED, fits its ~120-dot width).
        int dateX   = is6040 ? 260 : 290;
        int dateY   = is6040 ? 20  : 18;
        int storeX  = is6040 ? 64  : 16;
        int buyerX  = is6040 ? LEFT_GUARD_MEASURED : 16;
        int nameX   = is6040 ? LEFT_GUARD_MEASURED : 16;
        int userX   = is6040 ? LEFT_GUARD_MEASURED : 16;
        int timeX   = is6040 ? LEFT_GUARD_MEASURED : 16;
        int priceX  = is6040 ? 92  : 180;
        int startY  = is6040 ? 64  : 60;

        e.emitText(headerX, headerY, "3", 1, 1, "SellerFlowLive", c.rightEdge);
        if (!sessionDate.isEmpty()) {
            e.emitText(dateX, dateY, "2", 1, 1, safe(truncate(sessionDate, 12)), c.rightEdge);
        }
        // TOP bar — PRINTABLE-WIDTH on every size (M5). The old big-size bar spanned the
        // full label width (x=0, w=wDots) so its right end ran into the 241's DIRECTION-0
        // right non-printable dead-zone and clipped. A printable-width bar physically
        // spans [W-rightEdge .. W-64] = the same band-content bounds, clearing both
        // dead-zones. 60x40 keeps Jeff's bespoke bar (x=24 per LEFT_GUARD_MEASURED).
        if (is6040) {
            e.emitBar(LEFT_GUARD_MEASURED, 46, 376, 3);
        } else {
            e.emitBar(16, 48, c.rightEdge - 64, 3);
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

        // ── P2.5 VERTICAL FITTING (priority-based) ──────────────────────────────
        // The P2 ladder fits WIDTH; this fits HEIGHT. Before emitting, mirror the
        // exact y-flow math with the requested scales; if the final y runs past the
        // label, step scales DOWN in reverse priority (0.5 rungs, floor 1.0) until it
        // fits: tier 1 = store + price-code (secondaries; date/time are fixed-size),
        // tier 2 = @username, tier 3 (most protected, stepped LAST, buyer# after
        // name) = name + Buyer# — the parcel-sorting primaries keep their size
        // longest and stay the largest thing on the label. Only if EVERY floor is
        // reached and it still doesn't fit (unreachable on real sizes — the 1.0
        // layout fits by design) are rows dropped, lowest priority first, each
        // recorded in droppedOut (never silently). When everything fits as
        // requested — including every all-1.0 case — nothing is touched and the
        // output is byte-identical (pinned by the scale-1.0 exact-string tests).
        // This planner REPLACES the old orderEntryGuard/orderLoopGuard y-checks
        // (which silently skipped the order row) and the by=0 band clamp collisions:
        // fit guarantees final-y <= H, and every row's advance >= its element height,
        // so nothing crosses the bottom edge and no two rows overlap.
        boolean hasStore = printStoreName && !cleanStoreName.isEmpty();
        boolean hasName = !nameOut.isEmpty();
        double[] fitS = {sStore, sComment, sUser, sName, sBuyerNum};
        boolean[] fitRows = {hasStore, printBuyerUsername && !cleanBuyerHandle.isEmpty(), printOrderItems && orders != null && orders.length() > 0};
        fitVertical(fitS, fitRows, printBuyerNumber, hasName, bandName, wBuyer, wName, startY, storeGap, buyerNumGap, nameGap, usernameGap, c, is6040, labelHeightMm * 8, droppedOut);
        sStore = fitS[0]; sComment = fitS[1]; sUser = fitS[2]; sName = fitS[3]; sBuyerNum = fitS[4];
        hasStore = fitRows[0];
        boolean hasUser = fitRows[1];
        boolean hasOrder = fitRows[2];

        int extra = 0;
        int y = startY;
        if (hasStore) {
            e.emitSym(storeX, y, "3", sStore, safe(truncate(cleanStoreName, 36)), c.rightEdge, wStore, 1.0, 1.0);   // P4: weight-routable (bold store band = same 24-dot cell -> zero flow change)
            int d = r241((clampF(sStore) - 1) * F3);
            y += storeGap + d;
            extra += d;
        }

        if (printBuyerNumber) {
            double effY = clampF(c.buyerNumYMul * sBuyerNum);   // height mul (width stays baseX)
            // RIGHT-EDGE FIT (60x40): "Buyer #88" at font4 2x width is 432 dots, but its
            // anchor is only 392 (width>anchor -> reading-right overflow -> the last digit
            // clipped: "Buyer #88"->"Buyer #8"). A 2x-width buyer# CANNOT fit on the 480-dot
            // 60x40 with first-letter clearance (would need anchor>=432 but anchor<=~400).
            // So drop to 1x width on 60x40 (216 dots for "Buyer #88", 240 for "Buyer #888")
            // -> fits every real buyer number. Other sizes keep 2x (AIMO parity). Height is
            // unchanged (buyerNumYMul), so no vertical reflow. (Prominence trade-off: the
            // buyer# is now 1x wide; a bolder 2x-tall variant would need the y-gaps re-tuned
            // + a device check — deferred.)
            int buyerNumBaseX = is6040 ? 1 : 2;
            e.emitHeightScaled(buyerX, y, "4", buyerNumBaseX, c.buyerNumYMul, sBuyerNum, "Buyer #" + buyerNum, c.rightEdge, wBuyer);   // primary band (P3.7 ROM weight; P4: weight-routable)
            // P3.5 60x40: reserve the 48-dot buyer# cell (d = 48s - 32; the v3 gap of
            // 44 was designed around the 32-dot cell). Big sizes keep the AIMO-parity
            // advance (their gap already holds 48s comfortably).
            // P4: the 48-dot design cell is reserved only when the buyer# IS the
            // prominent band; a plain buyer# advances by the AIMO-parity formula.
            int d = (is6040 && wBuyer) ? r241(clampF(sBuyerNum) * 24 * BUYER_BOLD_Y - F4)
                                       : r241((effY - c.buyerNumYMul) * F4);
            y += buyerNumGap + d;
            extra += d;
        }

        if (hasName) {
            if (bandName) {
                // CJK / UNSUPPORTED name → band on both axes (base nameCjk*Mul), scaled.
                e.emitBand(nameX, y, safe(truncate(nameOut, 30)), c.nameCjkXMul * sName, c.nameCjkYMul * sName, c.rightEdge, wName);   // primary band (CJK approved tuning; P4: weight-routable face)
                double effY = clampF(c.nameCjkYMul * sName);
                int d = r241((effY - c.nameCjkYMul) * F4);
                y += c.nameCjkGap + d;
                extra += (c.nameCjkGap - nameGap) + d;
            } else {
                e.emitSym(nameX, y, "4", sName, safe(truncate(nameOut, 30)), c.rightEdge, wName, is6040 ? NAME_BOLD_6040 : NAME_BOLD_BIG, is6040 ? NAME_BOLD_6040 : NAME_BOLD_BIG);   // primary band (P3.7 ROM weight; P4: weight-routable)
                // P3.5 60x40: the ASCII-name band is 42s tall -> grow by 42/step so
                // the advance (44 + d) always covers it. Big sizes keep the 32 cell.
                int d = (is6040 && wName) ? r241((clampF(sName) - 1) * 24 * NAME_BOLD_6040)
                                          : r241((clampF(sName) - 1) * F4);
                y += nameGap + d;
                extra += d;
            }
        }

        if (hasUser) {
            e.emitSym(userX, y, "3", sUser, "@" + safe(truncate(cleanBuyerHandle, 30)), c.rightEdge, wUser, USER_BOLD_X, 1.0);   // primary band, AIMO 16x24 chars (P4: weight-routable)
            int d = r241((clampF(sUser) - 1) * F3);
            y += usernameGap + d;
            extra += d;
        }

        // ALL SIZES = one row, no separator bar (Jeff, 2026-07-18; order-per-sticker
        // splits a multi-order buyer in the plugin). The big sizes KEEP the sepGap
        // advance so the single order row stays at its prior position. P2.5: the old
        // y < orderEntryGuard/orderLoopGuard checks are GONE — they silently dropped
        // the row; the vertical planner above now guarantees the fit (or records an
        // explicit drop in droppedOut), so hasOrder is the single authority.
        if (hasOrder) {
            if (!is6040) {
                y += c.sepGap;
            }
            int maxOrders = 1;
            int i = 0;
            while (i < Math.min(orders.length(), maxOrders)) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) { i++; continue; }
                String time = order.optString("time", "");
                String item = order.optString("item", "");
                String cleanItem = stripEmoji(item);
                // TIME — FIXED at base size (BUG 1/2). Plain TEXT font "2" 1x1.
                if (!time.isEmpty()) {
                    e.emitText(timeX, y, "2", 1, 1, safe(truncate(time, 10)), c.rightEdge);
                }
                // PRICE CODE — P3.6: ALWAYS a REGULAR-weight band at the AIMO
                // "enlarged marquee" target (48-dot chars x 32-dot cell). The AIMO
                // prints this via font-4 x2 (multiplier WORKS on DIR1); the 241
                // firmware ignores TEXT multipliers, so the band is the only way to
                // match — ROM-emulation regular weight (P3.7: same as every band), height honors the
                // comment decimal. Long items step down via the renderer measure
                // ladder before truncating; short codes ("150") get full 48-dot
                // dominance. v3 (Jeff): the price shares the time's row (offset 0);
                // priceX keeps it in its own column (no overlap).
                if (!cleanItem.isEmpty()) {
                    String priceOut = TsplBuilder.transliterateLatin(safe(truncate(cleanItem, 12)));
                    if (!priceOut.isEmpty()) {
                        e.emitBand(priceX, y, priceOut, AIMO_CHAR48_X, PRICE_BAND_Y * clampF(sComment), c.rightEdge, wPrice);   // P4: weight-routable (CJK item face; ASCII unchanged)
                    }
                }
                int d = Math.max(0, r241((clampF(sComment) - 1) * F4));
                y += 38 + d;
                i++;
            }
        }

        if (printTotal && totalSpent > 0 && c.showTotal) {
            int totalY = c.totalY + extra;
            e.emitSym(16, totalY, "3", sTotal, "Total:", c.rightEdge, false, 0, 0);
            String totalStr = safe(currency) + money(totalSpent);
            e.emitHeightScaled(c.totalAmountX, totalY, "4", 2, 1, sTotal, safe(truncate(totalStr, 18)), W - 16, false);
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

    // P4: per-field weight read from the additive `weightsRaw` payload object.
    // Absent object / absent key -> the P3 hierarchy default (byte-identical).
    private static boolean wgt(JSONObject weightsRaw, String key, boolean def) {
        return weightsRaw == null ? def : weightsRaw.optBoolean(key, def);
    }

    // Per-element size LEVEL read from settings (1-8, default 1 = base size).
    private static int lvl(JSONObject settings, String key) {
        int v = settings == null ? 1 : settings.optInt(key, 1);
        return Math.max(1, Math.min(8, v == 0 ? 1 : v));
    }

    // ── P2.5 vertical planner (pure, JVM-tested) ───────────────────────────
    // finalYFor mirrors the emit body's y-flow EXACTLY (same gaps, same r241/clampF
    // reflow deltas, same conditions) — any drift between this mirror and the emit
    // math re-opens the silent-drop/overlap hole, so the property tests exercise
    // both together. s = {store, comment/price, user, name, buyerNum};
    // rows = {store, user, order} (the droppable rows).
    private static int finalYFor(double[] s, boolean[] rows, boolean hasBuyerNum, boolean hasName, boolean bandName,
            boolean wBuyer, boolean wName,
            int startY, int storeGap, int buyerNumGap, int nameGap, int usernameGap, Size c, boolean is6040) {
        final int F3 = 24, F4 = 32;
        int y = startY;
        if (rows[0]) y += storeGap + r241((clampF(s[0]) - 1) * F3);
        if (hasBuyerNum) {
            // P3.5/P4: the 60x40 buyer# reserves its 48-dot design cell only when
            // PROMINENT (d = 48s - 32); plain buyer# / big sizes keep the
            // AIMO-parity advance — EXACT mirror of the emit body.
            double effY = clampF(c.buyerNumYMul * s[4]);
            y += buyerNumGap + ((is6040 && wBuyer) ? r241(clampF(s[4]) * 24 * BUYER_BOLD_Y - F4)
                                                   : r241((effY - c.buyerNumYMul) * F4));
        }
        if (hasName) {
            if (bandName) y += c.nameCjkGap + r241((clampF(c.nameCjkYMul * s[3]) - c.nameCjkYMul) * F4);
            else y += nameGap + ((is6040 && wName) ? r241((clampF(s[3]) - 1) * 24 * NAME_BOLD_6040)
                                                   : r241((clampF(s[3]) - 1) * F4));
        }
        if (rows[1]) y += usernameGap + r241((clampF(s[2]) - 1) * F3);
        if (rows[2]) {
            if (!is6040) y += c.sepGap;
            y += 38 + Math.max(0, r241((clampF(s[1]) - 1) * F4));
        }
        return y;
    }

    // Priority-based step-down: reduce scales in 0.5 rungs (floor = min(1.0,
    // requested) — sub-1.0 requests only shrink, never raised) until finalYFor fits
    // within H. Tier order (first shrunk → last): {store, price} → {@username} →
    // {name, buyerNum} (buyer# stepped after name = the single most protected
    // element). Every row's advance >= its element height (checked per size/row in
    // the fork math), so fit ⟹ nothing crosses the bottom edge and no rows overlap.
    // If every floor is reached and it STILL doesn't fit (unreachable on real sizes),
    // drop rows lowest-priority-first — store, @username, order-row — recording each
    // in droppedOut; buyer#/name/header/date are never dropped.
    private static void fitVertical(double[] s, boolean[] rows, boolean hasBuyerNum, boolean hasName, boolean bandName,
            boolean wBuyer, boolean wName,
            int startY, int storeGap, int buyerNumGap, int nameGap, int usernameGap, Size c, boolean is6040, int H,
            java.util.List<String> droppedOut) {
        if (finalYFor(s, rows, hasBuyerNum, hasName, bandName, wBuyer, wName, startY, storeGap, buyerNumGap, nameGap, usernameGap, c, is6040) <= H) return;
        double[] floor = new double[s.length];
        for (int i = 0; i < s.length; i++) floor[i] = Math.min(1.0, s[i]);
        int[][] tiers = {{0, 1}, {2}, {3, 4}};
        boolean stepped = true;
        while (stepped) {
            stepped = false;
            for (int[] tier : tiers) {
                boolean tierHas = false;
                for (int idx : tier) if (s[idx] > floor[idx] + 1e-9) tierHas = true;
                if (!tierHas) continue;
                for (int idx : tier) {
                    if (s[idx] > floor[idx] + 1e-9) {
                        s[idx] = Math.max(floor[idx], s[idx] - 0.5);
                        if (finalYFor(s, rows, hasBuyerNum, hasName, bandName, wBuyer, wName, startY, storeGap, buyerNumGap, nameGap, usernameGap, c, is6040) <= H) return;
                    }
                }
                stepped = true;
                break;   // stay on the earliest non-exhausted tier next round
            }
        }
        // Extreme fallback: floors everywhere and still over — drop rows, recorded.
        String[] labels = {"store", "@username", "order-row"};
        for (int i = 0; i < rows.length; i++) {
            if (finalYFor(s, rows, hasBuyerNum, hasName, bandName, wBuyer, wName, startY, storeGap, buyerNumGap, nameGap, usernameGap, c, is6040) <= H) return;
            if (rows[i]) { rows[i] = false; droppedOut.add(labels[i]); }
        }
    }

    // ── DIRECTION 0 + in-layout 180 rotation emit primitives (D1) ──────────
    // A rot-0 element authored at (x,y) becomes a rot-180 element anchored at
    // (W-x, H-y); a BAR re-anchors to (W-x-w, H-y-h); a band pre-rotates its
    // pixels (flip180, done in the renderer) and re-anchors its box. W/H = label
    // in dots (203 DPI = 8 dot/mm).
    // EDGE_GUARD = 16 — P1 MEASURED (was a blanket 48). It shifts the whole layout
    // toward reading-right, padding the READING-LEFT edge (physical W side — the
    // drifting edge that clipped first letters). With it every edge clears its
    // measured envelope on Jeff's PM-241 (3-print protocol, 2026-07-18):
    //   reading-left  = authoring-x floor + EDGE_GUARD = 24+16 = 40 (60x40) /
    //                   16+16 = 32 (big sizes)  >= 24 needed (worst 16 + 8)
    //   reading-right = W - rightEdge = 16 = exactly needed (worst 8 + 8)
    // The +32-dot reclaim vs the blanket 48 widens every line's usable width.
    private static final class Emit {
        static final int EDGE_GUARD = 16;
        final ByteArrayOutputStream out = new ByteArrayOutputStream(1024);
        final int W, H;
        final BandRenderer renderer;
        Emit(int W, int H, BandRenderer renderer) { this.W = W; this.H = H; this.renderer = renderer; }

        void writeAscii(String s) {
            writeBytes(out, s.getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, CRLF);
        }

        // 1x TSPL font dot-width (per char), used by the fit check + the P2 ladder.
        // Same width model as the JVM overflow test (font 2=12, 3=16, 4=24 dots).
        static int fontDots(String font) {
            switch (font) { case "2": return 12; case "3": return 16; case "4": return 24; default: return 24; }
        }

        // P2 FITTING LADDER (sharp ROM fonts only, largest→smallest, all at 1x —
        // the 241 firmware ignores font multipliers on rotation-180 TEXT, so ×2
        // rungs don't exist on this hardware; anything larger than font 4 is a
        // raster band, not a TEXT rung).
        private static final String[] FONT_LADDER = {"4", "3", "2"};

        // P2 STEP-DOWN (replaces the M1 compress-to-fit): wide ASCII content is
        // never squeezed into a thin compressed band — it STEPS DOWN the ladder of
        // sharp ROM fonts until it fits at full stroke weight, and only at the
        // smallest font is it truncated (ASCII "..." — the TSPL ROM has no Unicode
        // ellipsis). Content that fits its DESIGNED font is emitted byte-identical
        // (the short-content invariant; the width check keeps the JVM overflow
        // model: nominal chars × fontDots × xMul, conservative on this firmware).
        void emitText(int x, int y, String font, int xMul, int yMul, String content, int rightEdge) {
            int budget = Math.max(8, rightEdge - x - EDGE_GUARD);
            if (content.length() * fontDots(font) * xMul <= budget) {
                writeAscii("TEXT " + (W - x - EDGE_GUARD) + "," + (H - y) + ",\"" + font + "\",180," + xMul + "," + yMul + ",\"" + content + "\"");
                return;
            }
            // Ladder start: the designed font itself at 1x (a ×2-designed element
            // that fits at 1x steps here first — same physical size, honest bytes),
            // unless it was already 1x (then that width just failed above).
            int start = FONT_LADDER.length - 1;
            for (int i = 0; i < FONT_LADDER.length; i++) if (FONT_LADDER[i].equals(font)) { start = i; break; }
            if (xMul == 1 && yMul == 1) start++;
            for (int i = start; i < FONT_LADDER.length; i++) {
                if (content.length() * fontDots(FONT_LADDER[i]) <= budget) {
                    writeAscii("TEXT " + (W - x - EDGE_GUARD) + "," + (H - y) + ",\"" + FONT_LADDER[i] + "\",180,1,1,\"" + content + "\"");
                    return;
                }
            }
            // Last resort: truncate with "..." at the smallest sharp font (2 = 12/char).
            int maxChars = Math.max(1, budget / fontDots("2"));
            String cut = maxChars <= 4 ? truncate(content, maxChars) : truncate(content, maxChars - 3) + "...";
            writeAscii("TEXT " + (W - x - EDGE_GUARD) + "," + (H - y) + ",\"2\",180,1,1,\"" + cut + "\"");
        }

        void emitBar(int x, int y, int w, int h) {
            writeAscii("BAR " + Math.max(0, W - x - w - EDGE_GUARD) + "," + (H - y - h) + "," + w + "," + h);
        }

        // Emit `content` as a pre-rotated raster band, box re-anchored under the
        // 180 map: top-left → (W-x-boxW-EDGE_GUARD, H-y-h). Empty/blank or a failed
        // render → emit NOTHING (a 0-width BITMAP is malformed).
        void emitBand(int x, int y, String content, double xMulRaw, double yMulRaw, int rightEdge, boolean bold) {
            if (content.isEmpty()) return;
            double xMul = clampF(xMulRaw), yMul = clampF(yMulRaw);
            // Usable width RESERVES the EDGE_GUARD on the far side too, so the placed
            // box bx = W-x-bandW-EDGE_GUARD never hits the max(0,..) clamp that would
            // slice the leading letter. The band reads [x+EDGE_GUARD, <=rightEdge].
            int avail = Math.max(8, rightEdge - x - EDGE_GUARD);
            // P2: the content is passed WHOLE — fitting now lives in the renderer,
            // measureText-based on the ACTUAL string (correct for mixed CJK+ASCII like
            // "陳小美 Anna x2", where the old ~24×xMul cell model over/under-counted).
            // The renderer steps the point size down proportionally (100%→85%→70%,
            // sharp shrink, never a horizontal squish) and only then truncates.
            Band band = renderer.render(content, xMul, yMul, avail, bold);
            if (band == null || band.height <= 0 || band.widthBytes <= 0 || band.bytes.length == 0) return;
            int bx = Math.max(0, W - x - band.widthBytes * 8 - EDGE_GUARD);
            // VERTICAL margin protection: a scaled band grown + pushed down by reflow
            // could drive H-y-height NEGATIVE (top row off the physical top edge =
            // reading bottom), losing content silently. Clamp to 0 so the band stays
            // fully on the label (top-aligned worst case). Horizontal is bounded by
            // `avail`: a band's physical span is [W-rightEdge .. W-x-EDGE_GUARD], i.e.
            // left >= W-rightEdge (16 dots = measured reading-right guard) and right =
            // W-x-EDGE_GUARD (reading-left margin >= x-floor+16 = the measured 24+
            // envelope); the M1 width guard routes any over-wide TEXT here too, so
            // NOTHING escapes to the raw-TEXT clip path.
            int by = Math.max(0, H - y - band.height);
            writeBytes(out, ("BITMAP " + bx + "," + by + "," + band.widthBytes + "," + band.height + ",0,").getBytes(StandardCharsets.US_ASCII));
            writeBytes(out, band.bytes);
            writeBytes(out, CRLF);
        }

        // 1x TSPL font cell HEIGHT (dots), used to size a bold band so it never
        // prints SMALLER than the ROM text it replaces (font 2=20, 3=24, 4=32).
        static int fontCellH(String font) {
            switch (font) { case "2": return 20; case "3": return 24; case "4": return 32; default: return 32; }
        }

        // SYMMETRIC scalable element (store / ASCII name / @username): scale BOTH
        // axes by the decimal. Non-primary: scale EXACTLY 1.0 (ASCII) → the
        // verified TEXT command (byte-identical); CJK or scale!=1 → a (scale, scale)
        // band. bold=true (name/@username — the sorting PRIMARIES): ALWAYS a
        // proportional band at the designed cell (never smaller than the TEXT it
        // replaces). P3.7: "bold" is a ROUTING/prominence flag — the ASCII band
        // itself renders ROM-emulation REGULAR weight (hierarchy = SIZE).
        void emitSym(int x, int y, String font, double scale, String rawContent, int rightEdge, boolean bold, double boldMulX, double boldMulY) {
            String content = TsplBuilder.transliterateLatin(rawContent);
            if (content.isEmpty()) return;   // same emptiness rule as writeTextSmart (parity)
            if (bold) {
                // P3.5/P3.6: the designed bold cell comes from the CALL SITE, per
                // axis (x scale) — e.g. the @username is widened to the AIMO 16-dot
                // char (X only) while keeping its 24-dot height.
                emitBand(x, y, content, boldMulX * scale, boldMulY * scale, rightEdge, true);
                return;
            }
            boolean isCjk = hasNonAscii(content);
            if (!isCjk && scale == 1.0) { emitText(x, y, font, 1, 1, content, rightEdge); return; }
            emitBand(x, y, content, scale, scale, rightEdge, false);
        }

        // HEIGHT-PRIORITY scalable element (Buyer# / price code). Non-primary:
        // scale EXACTLY 1.0 (ASCII) → TEXT at (baseX, baseY) [byte-identical]; else
        // band width = baseX, height = baseY x scale. bold=true (Buyer# — the top
        // sorting primary): ALWAYS a proportional band at the designed AIMO-match
        // cell — >= the printed height of the font-4 TEXT it replaces. P3.7: the
        // band renders ROM-emulation REGULAR weight (prominence = SIZE).
        void emitHeightScaled(int x, int y, String font, int baseX, int baseY, double scale, String rawContent, int rightEdge, boolean bold) {
            String content = TsplBuilder.transliterateLatin(rawContent);
            if (content.isEmpty()) return;
            if (bold) {
                // P3.6 AIMO-match buyer#: (48/14 wide, 2.0 tall) x scale on every
                // size — 48-dot chars (the AIMO font-4 x2 width) x 48-dot cell. On
                // 60x40 a 9-char "Buyer #NN" is ~432 dots vs the 424 measured avail,
                // so the renderer's 0.95 rung trims it to ~46-dot chars (96% AIMO) —
                // the accepted trade-off; big sizes fit the full 48.
                emitBand(x, y, content, BUYER_BOLD_X * scale, Math.max(baseY, BUYER_BOLD_Y) * scale, rightEdge, true);
                return;
            }
            boolean isCjk = hasNonAscii(content);
            if (!isCjk && scale == 1.0) { emitText(x, y, font, baseX, baseY, content, rightEdge); return; }
            emitBand(x, y, content, (double) baseX, (double) baseY * scale, rightEdge, false);
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
    /**
     * P3.7 ROM-emulation core — HORIZONTAL nearest-neighbor pixel stretch, exactly
     * what the AIMO firmware does for a TEXT x-multiplier: every source column is
     * duplicated {@code factor} times, so a REGULAR-weight glyph's thin strokes
     * WIDEN geometrically instead of the whole letter fattening (the "payat na
     * lumalapad" AIMO look vs the bold+stroke "buntis" band). Pure + JVM-pinned;
     * Phomemo241Raster feeds its regular-weight gray pixels through this before
     * packBits. factor 1 = identity; invalid input → null.
     */
    static byte[] stretchGrayH(byte[] gray, int width, int height, int factor) {
        if (gray == null || width <= 0 || height <= 0 || factor < 1 || gray.length < width * height) return null;
        // Integer column duplication == the nearest-neighbor map at outW = w*factor
        // (srcCol = col*w/(w*f) = col/f floored), so the general core is the single
        // implementation — the original x2 pins hold byte-for-byte via delegation.
        return stretchGrayNearest(gray, width, height, width * factor, height);
    }

    /**
     * P3.7 completion — the FRACTIONAL generalization of {@link #stretchGrayH},
     * used by the PRODUCTION enlarged-ASCII path: nearest-neighbor stretch of a
     * grayscale buffer to an EXACT target (outW x outH), enlarge-only on both
     * axes. srcCol = col*srcW/outW (and the same for rows) — for an integer
     * ratio this IS column/row duplication (the AIMO firmware multiplier); for a
     * fractional target (e.g. the buyer#'s 48/14-wide x 2.0-tall cell → ratio
     * ~1.71) the duplication is distributed evenly, which is what a firmware
     * with fractional multipliers would do. Pure + JVM-pinned. Identity when the
     * target equals the source; shrink targets / invalid input → null.
     */
    static byte[] stretchGrayNearest(byte[] gray, int width, int height, int outW, int outH) {
        if (gray == null || width <= 0 || height <= 0 || outW < width || outH < height
                || gray.length < width * height) return null;
        if (outW == width && outH == height) return gray;
        byte[] out = new byte[outW * outH];
        for (int row = 0; row < outH; row++) {
            int srcBase = (row * height / outH) * width;
            int dstBase = row * outW;
            for (int col = 0; col < outW; col++) {
                out[dstBase + col] = gray[srcBase + col * width / outW];
            }
        }
        return out;
    }

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
