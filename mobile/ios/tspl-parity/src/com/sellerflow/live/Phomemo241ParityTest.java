package com.sellerflow.live;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JVM-runnable parity test for the Android Phomemo 241 builder
 * ({@link Phomemo241Builder}). Unlike the Swift XCTest twin
 * (Phomemo241BuilderTests.swift, Mac-only), this compiles + runs with plain
 * javac/java against the org.json stubs + the UNMODIFIED production TsplBuilder +
 * Phomemo241Builder — so CI/any JDK can prove the LAYOUT. It uses a FAKE
 * BandRenderer (no android.graphics), so the actual glyph raster is out of scope
 * (device-verified only); this pins the command stream.
 *
 * THE ANTI-DRIFT PIN (FORK-DRIFT rule): an all-ASCII buyer through
 * forStickerNative241 must equal rotate180(TsplBuilder.forStickerNative) for the
 * 4 AIMO-mirrored sizes; 60x40 is Jeff's bespoke v3 (pinned separately). Any
 * un-mirrored AIMO layout edit turns this red.
 *
 * Run:  mobile/ios/tspl-parity/run-241-parity.sh
 */
public final class Phomemo241ParityTest {

    private static final int EDGE_GUARD = 16;   // P1 MEASURED (reading-left worst 16 + covered with the x floor; see the builder Emit doc)
    private static int failures = 0;

    // ── tiny assert harness ─────────────────────────────────────────────────
    private static void check(boolean cond, String msg) {
        if (cond) { System.out.println("  ok   " + msg); }
        else { System.out.println("  FAIL " + msg); failures++; }
    }
    private static void eq(String a, String b, String msg) {
        if (a.equals(b)) { System.out.println("  ok   " + msg); }
        else {
            System.out.println("  FAIL " + msg);
            System.out.println("        expected: " + b.replace("\r\n", "\\r\\n"));
            System.out.println("        actual:   " + a.replace("\r\n", "\\r\\n"));
            failures++;
        }
    }
    private static void contains(String haystack, String needle, String msg) {
        check(haystack.contains(needle), msg + "  [missing: " + needle + "]");
    }

    // ── fakes ────────────────────────────────────────────────────────────────
    private static int r241(double v) { return (int) (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5)); }

    /** Deterministic fake band: widthBytes 4, height = round(24 x yMul). */
    private static Phomemo241Builder.BandRenderer fakeBand() {
        return (text, xMul, yMul, maxW) -> {
            int h = Math.max(1, r241(24 * yMul));
            byte[] bytes = new byte[4 * h];
            java.util.Arrays.fill(bytes, (byte) 0xAA);
            return new Phomemo241Builder.Band(4, h, bytes);
        };
    }
    private static Phomemo241Builder.BandRenderer nullBand() {
        return (text, xMul, yMul, maxW) -> null;
    }

    // ── payload builders ──────────────────────────────────────────────────────
    private static JSONObject asciiPayload() {
        JSONObject buyer = new JSONObject();
        buyer.put("num", 12).put("name", "Maria Santos").put("handle", "maria_shops").put("totalSpent", 700.0);
        JSONArray orders = new JSONArray();
        orders.put(new JSONObject().put("item", "250").put("time", "20:15"));
        orders.put(new JSONObject().put("item", "Blue jeans M").put("time", "20:18"));
        buyer.put("orders", orders);
        return new JSONObject().put("buyer", buyer).put("storeName", "My Shop").put("currency", "NT$").put("sessionDate", "07/17/2026");
    }

    // ── rotate180: deterministic 180-about-centre rewrite of the AIMO stream ───
    // (fixture content has no quoted commas). W/H = label dots. Same transform shape
    // as the Swift twin's rotate180, but with the ANDROID measured EDGE_GUARD (16);
    // the iOS builder/tests still carry the old blanket 48 (iOS untouched — its P1
    // measurement pass is a future task).
    private static String rotate180(String aimo, int W, int H) {
        String[] lines = aimo.split("\r\n", -1);
        List<String> out = new ArrayList<>();
        for (String line : lines) {
            if (line.equals("DIRECTION 1")) { out.add("DIRECTION 0"); continue; }
            if (line.startsWith("TEXT ")) {
                String[] f = line.substring(5).split(",");
                if (f.length >= 7) {
                    int x = Integer.parseInt(f[0]);
                    int y = Integer.parseInt(f[1]);
                    StringBuilder content = new StringBuilder();
                    for (int i = 6; i < f.length; i++) { if (i > 6) content.append(","); content.append(f[i]); }
                    out.add("TEXT " + (W - x - EDGE_GUARD) + "," + (H - y) + "," + f[2] + ",180," + f[4] + "," + f[5] + "," + content);
                    continue;
                }
            }
            if (line.startsWith("BAR ")) {
                String[] f = line.substring(4).split(",");
                if (f.length == 4) {
                    int x = Integer.parseInt(f[0]);
                    int y = Integer.parseInt(f[1]);
                    int w = Integer.parseInt(f[2]);
                    int h = Integer.parseInt(f[3]);
                    out.add("BAR " + Math.max(0, W - x - w - EDGE_GUARD) + "," + (H - y - h) + "," + w + "," + h);
                    continue;
                }
            }
            out.add(line);
        }
        return String.join("\r\n", out);
    }

    private static String utf8(byte[] b) { return new String(b, java.nio.charset.StandardCharsets.UTF_8); }

    // The 4 big sizes are now a DOCUMENTED FORK-DRIFT divergence from AIMO (Jeff,
    // 2026-07-18): each is "one row, no separator bar, no Total". So the fork equals
    // rotate180(AIMO) with exactly those elements removed. We still compare against
    // the (filtered) AIMO stream rather than hand-written bespoke pins, so every
    // SHARED line — header, date, top bar, store, buyer#, name, @user, and the first
    // order row — KEEPS full AIMO drift protection; only the declared removals below
    // are dropped. 60x40 stays a fully bespoke pin (testBespoke6040).
    private static String stripForkRemovals(String rot180Aimo) {
        // Removals vs AIMO for the fixed ASCII fixture: the height-2 separator BAR
        // (the top bar is height 3), the 2nd order row (20:18 / Blue jeans M), and the
        // Total label + amount (Total: / NT$700). Absent lines are a no-op, so this is
        // robust across sizes whose order/total guard prints fewer lines.
        List<String> out = new ArrayList<>();
        for (String line : rot180Aimo.split("\r\n", -1)) {
            if (line.startsWith("BAR ") && line.endsWith(",2")) continue;   // separator bar
            if (line.contains("\"20:18\"")) continue;                        // 2nd order time
            if (line.contains("\"Blue jeans M\"")) continue;                 // 2nd order price
            if (line.contains("\"Total:\"")) continue;                       // total label
            if (line.contains("\"NT$700\"")) continue;                       // total amount
            // P3: the three sorting PRIMARIES are BOLD BANDS in the fork (the TSPL
            // ROM has no bold), so their AIMO TEXT lines are documented removals too.
            if (line.contains("\"Buyer #12\"")) continue;
            if (line.contains("\"Maria Santos\"")) continue;
            if (line.contains("\"@maria_shops\"")) continue;
            // P3.6: the PRICE is an always-band too (the AIMO's font-4 x2 marquee
            // needs a band on this firmware — TEXT multipliers are dead), so its
            // AIMO TEXT line is a documented removal as well.
            if (line.contains("\"250\"")) continue;
            out.add(line);
        }
        return String.join("\r\n", out);
    }

    // Drop every BAR line — the top bar is now a documented printable-width divergence
    // (M5), so the TEXT stream is compared bar-free and the bar is pinned separately.
    private static String stripBars(String s) {
        List<String> out = new ArrayList<>();
        for (String line : s.split("\r\n", -1)) if (!line.startsWith("BAR ")) out.add(line);
        return String.join("\r\n", out);
    }

    // ── tests ──────────────────────────────────────────────────────────────────

    private static void testAsciiFullParityEverySize() {
        System.out.println("testAsciiBigSizesEqualFilteredAimo (one row, no sep bar, no Total, printable-width top bar)");
        // {w, h, rightEdge}. The M5 top bar spans physical [16 .. W-64] = emitBar(16,48,
        // rightEdge-64,3) -> "BAR 16,(H-51),(rightEdge-64),3".
        int[][] sizes = {{100, 60, 784}, {80, 60, 624}, {80, 50, 624}, {70, 50, 544}};
        for (int[] s : sizes) {
            int W = s[0] * 8, H = s[1] * 8, rE = s[2];
            JSONObject payload = asciiPayload();
            byte[] aimo = TsplBuilder.forStickerNative(payload, s[0], s[1]);
            String fork = utf8(Phomemo241Builder.forStickerNative241(payload, s[0], s[1], nullBand()));
            String exp = stripForkRemovals(rotate180(utf8(aimo), W, H));
            // TEXT parity (every shared line keeps AIMO drift protection); bars compared apart.
            eq(stripBars(fork), stripBars(exp),
               "fork TEXT == rotate180(AIMO) minus {sep bar, 2nd row, Total} at " + s[0] + "x" + s[1]);
            contains(fork, "BAR 48," + (H - 51) + "," + (rE - 64) + ",3",
               "printable-width top bar at " + s[0] + "x" + s[1] + " (reading [32.." + (rE - 32) + "])");
            check(fork.split("BAR ", -1).length - 1 == 1, "exactly one (top) bar at " + s[0] + "x" + s[1]);
            String forkBands = utf8(Phomemo241Builder.forStickerNative241(payload, s[0], s[1], fakeBand()));
            check(forkBands.split("BITMAP ", -1).length - 1 == 4,
                  "the 3 bold primaries + the price marquee emit as bands at " + s[0] + "x" + s[1]);
        }
    }

    private static void testBespoke6040() {
        System.out.println("testBespoke6040LayoutMatchesJeffSpec");
        JSONObject buyer = new JSONObject();
        buyer.put("num", 12).put("name", "Maria Santos").put("handle", "maria_shops").put("totalSpent", 700.0);
        JSONArray orders = new JSONArray();
        orders.put(new JSONObject().put("item", "250").put("time", "20:15"));
        buyer.put("orders", orders);
        JSONObject payload = new JSONObject().put("buyer", buyer).put("storeName", "My Shop").put("currency", "NT$").put("sessionDate", "07/17/2026");
        // Jeff's 60x40 v3 VERTICAL arrangement (y-flow unchanged), with M2 SAFETY:
        // every left-column x floored to MIN_X_6040=24 (was 8/10/14/18/22) — so the
        // lifted rows (header/buyer#/name/@user/time) share ax = W-24-48 = 408. The
        // fixture name is ASCII "Maria Santos", so @user/time/price pin the ASCII
        // column; the CJK column sits a bit lower (taller name band). store(64)/
        // date(260)/price(92) already cleared MIN_X and are unmoved. v3: the PRICE
        // shares the TIME's row (offset 0). All fixture content FITS → raw TEXT (M1
        // width guard is a no-op here; the long-content case is a separate test).
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 60, 40, fakeBand()));
        contains(s, "TEXT 440,306,\"3\",180,1,1,\"SellerFlowLive\"", "header authoring (24,14)");
        contains(s, "TEXT 204,300,\"2\",180,1,1,\"07/17/2026\"", "date authoring (260,20)");
        contains(s, "BAR 64,271,376,3", "top bar authoring (24,46,376,3) -> physical span");
        contains(s, "TEXT 400,256,\"3\",180,1,1,\"My Shop\"", "shop authoring (64,64)");
        contains(s, "BITMAP 408,180,4,48,0,", "buyer# authoring (24,92) — P3.5 AIMO-proportion band (48-dot cell)");
        contains(s, "BITMAP 408,126,4,42,0,", "name authoring (24,152) — P3.5 bold band, 42-dot cell");
        contains(s, "BITMAP 408,100,4,24,0,", "@username authoring (24,196 ASCII col) — bold band, 24-dot cell (unchanged size)");
        contains(s, "TEXT 440,74,\"2\",180,1,1,\"20:15\"", "time authoring (24,246 ASCII col) = row anchor");
        contains(s, "BITMAP 340,42,4,32,0,", "price authoring (92,246 ASCII col) — P3.6 AIMO-marquee band (32-dot cell), SAME row as time");
        int bars = s.split("BAR ", -1).length - 1;
        check(bars == 1, "order separator bar REMOVED on 60x40 -> only the top bar remains (got " + bars + ")");
    }

    // STRENGTHENED GUARD (the pins alone missed the right-edge overflow): every
    // rot-180 TEXT element fits the label iff its rendered width <= its anchor x
    // (reading-right = W - anchor + width <= W). This catches the class of bug the
    // exact-string pins could not — a pin can be "correct" (matches the emit) while
    // the emit itself overflows. Uses conservative TSPL 203dpi cell widths.
    private static int charW(String font) {
        switch (font) { case "2": return 12; case "3": return 16; case "4": return 24; default: return 24; }
    }
    private static boolean textFits(String line) {
        // TEXT ax,ay,"font",180,xmul,ymul,"content"
        String body = line.substring(5);
        int ax = Integer.parseInt(body.substring(0, body.indexOf(',')));
        int q1 = body.indexOf('"'), q2 = body.indexOf('"', q1 + 1);
        String font = body.substring(q1 + 1, q2);
        // xmul is the field right after the font's closing quote: ...,"f",180,XMUL,ymul,"content"
        String afterFont = body.substring(q2 + 1);            // ,180,XMUL,ymul,"content"
        String[] mf = afterFont.split(",");                    // ["", "180", "XMUL", "ymul", "\"content\""...]
        int xmul = Integer.parseInt(mf[2]);
        // content = between the LAST two double-quotes (robust; the line ends "...content\"")
        int e2 = body.lastIndexOf('"');
        int e1 = body.lastIndexOf('"', e2 - 1);
        String content = body.substring(e1 + 1, e2);
        int width = content.length() * charW(font) * xmul;
        boolean ok = width <= ax;
        if (!ok) System.out.println("        overflow: '" + content + "' width=" + width + " > anchor=" + ax);
        return ok;
    }
    private static void testNoRightEdgeOverflow60x40() {
        System.out.println("testNoRightEdgeOverflow60x40 (width <= anchor for every TEXT element)");
        // self-check the guard is not vacuous: the OLD (pre-fix) buyer# / date overflow.
        check(!textFits("TEXT 392,226,\"4\",180,2,1,\"Buyer #88\""), "guard flags the OLD 2x buyer# (432 > 392)");
        check(!textFits("TEXT 102,300,\"2\",180,1,1,\"07/17/2026\""), "guard flags the OLD far-right date (120 > 102)");
        // the FIXED verification output must have every TEXT element fit.
        JSONObject buyer = new JSONObject();
        buyer.put("num", 888).put("name", "陳小美").put("handle", "sellerflow").put("totalSpent", 1200);   // worst 3-digit #
        JSONArray orders = new JSONArray();
        orders.put(new JSONObject().put("item", "紅色洋裝 x2").put("time", "20:15"));
        buyer.put("orders", orders);
        JSONObject payload = new JSONObject().put("buyer", buyer).put("storeName", "SellerFlowLive")
            .put("currency", "NT$").put("sessionDate", "07/17/2026").put("labelWidthMm", 60).put("labelHeightMm", 40);
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 60, 40, nullBand()));
        boolean allFit = true;
        for (String line : s.split("\r\n")) {
            if (line.startsWith("TEXT ")) allFit &= textFits(line);
        }
        check(allFit, "every 60x40 TEXT element fits (width <= anchor), incl. worst-case Buyer #888");
    }

    // P2 — the FITTING LADDER replaces the M1 compress-to-fit: wide ASCII steps DOWN
    // the sharp ROM fonts (4x1 -> 3x1 -> 2x1 — NO x2 multiplier rungs, the firmware
    // ignores multipliers on rot-180 TEXT; larger-than-4 = raster band territory) and
    // only truncates with ASCII "..." at font 2. NEVER a compressed band from the
    // TEXT path, and short content stays byte-identical designed TEXT.
    private static JSONObject p2Payload(String store, String name, String handle, String item) {
        JSONObject buyer = new JSONObject();
        buyer.put("num", 888).put("name", name).put("handle", handle).put("totalSpent", 0);
        JSONArray orders = new JSONArray();
        orders.put(new JSONObject().put("item", item).put("time", "20:15"));
        buyer.put("orders", orders);
        return new JSONObject().put("buyer", buyer).put("storeName", store).put("currency", "NT$").put("sessionDate", "07/17/2026");
    }
    private static void testP2FittingLadder() {
        System.out.println("testP2FittingLadder (sharp step-down 4->3->2, '...' last resort, zero bands from ASCII)");
        // guard sanity: the raw designed emit for a 13ch x2 price WOULD overflow.
        check(!textFits("TEXT 372,90,\"4\",180,2,1,\"Blue jeans Me\""), "control: raw 13ch @2x price WOULD overflow (624 > 372)");
        // 60x40 budgets (rightEdge 464 - x - EDGE_GUARD 16): price(x=92)=356,
        // name/user/time(x=24)=424, store(x=64)=384.
        // — PRICE (P3.6): ALWAYS a regular-weight band at the AIMO marquee target
        //   (48-dot chars x 32-dot cell); its fitting lives in the renderer measure
        //   ladder (device side). Short-content TEXT invariants now cover the
        //   remaining regular TEXT elements (store/header/date/time) below.
        String s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("My Shop", "Maria Santos", "maria_shops", "250"), 60, 40, fakeBand()));
        contains(s, "BITMAP 340,42,4,32,0,", "short price = the full 48-target band at its row (nothing stepped)");
        // — name (P3: a BOLD primary = always a band) — the ladder no longer applies;
        //   the renderer step-down fits it. The FULL 20ch content must reach the
        //   renderer with bold=true (pinned in testP3BoldRouting + the whole-string test).
        // — store 36ch (upstream truncate(36)): 36x16>384, 36x12=432>384 -> ladder
        //   exhausted -> "..." at font 2: maxChars=384/12=32 -> 29 kept + "...":
        s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "Ann", "a", "250"), 60, 40, nullBand()));
        contains(s, "TEXT 400,256,\"2\",180,1,1,\"ABCDEFGHIJKLMNOPQRSTUVWXYZ012...\"", "36ch store: font-2 still over -> truncate 29 + ASCII '...'");
        // — @username (P3 BOLD primary) — band path; covered by testP3BoldRouting.
        // — NEVER a band from the ASCII TEXT path (nullBand: a band request would
        //   vanish; every long element above still printed as TEXT), and every
        //   emitted TEXT fits (width <= anchor) on every size:
        JSONObject longAll = p2Payload("My Very Long Shop Name Here", "Very Long Buyer Display Name", "verylongusername_tiktok9999", "Blue jeans Medium");
        for (int[] wh : new int[][]{{100, 60}, {80, 60}, {80, 50}, {70, 50}, {60, 40}}) {
            String o = utf8(Phomemo241Builder.forStickerNative241(longAll, wh[0], wh[1], nullBand()));
            boolean allFit = true;
            for (String line : o.split("\r\n")) if (line.startsWith("TEXT ")) allFit &= textFits(line);
            check(allFit, "every TEXT fits after the ladder at " + wh[0] + "x" + wh[1]);
            check(!o.contains("BITMAP"), "no band from ASCII overflow at " + wh[0] + "x" + wh[1] + " (ladder, not compression)");
        }
    }

    // P2 — mixed CJK+ASCII goes to the renderer WHOLE (measureText-based fitting
    // lives in Phomemo241Raster now): the old ~24xMul cell model pre-truncated
    // "陳小美 Anna x2" to 8 chars before the renderer ever saw it.
    private static void testP2MixedStringReachesRendererWhole() {
        System.out.println("testP2MixedStringReachesRendererWhole");
        final List<String> texts = new ArrayList<>();
        Phomemo241Builder.BandRenderer cap = (text, xMul, yMul, maxW) -> {
            texts.add(text);
            byte[] b = new byte[4 * 48];
            java.util.Arrays.fill(b, (byte) 0xAA);
            return new Phomemo241Builder.Band(4, 48, b);
        };
        String mixed = "陳小美 Anna x2";   // 陳小美 Anna x2 — 11 chars
        JSONObject payload = p2Payload("S", mixed, "s", "250");
        JSONObject off = new JSONObject().put("printStoreName", false).put("printBuyerNumber", false)
            .put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false);
        payload.put("settings", off);
        Phomemo241Builder.forStickerNative241(payload, 60, 40, cap);
        check(texts.size() == 1 && texts.get(0).equals(mixed),
              "the FULL mixed string reaches the renderer (was cell-truncated to 8 chars) — got " + texts);
    }

    // ── P2.5 vertical fitting ────────────────────────────────────────────────
    private static JSONObject p25Payload(double sStore, double sBuyerNum, double sName, double sUser, double sComment) {
        JSONObject buyer = new JSONObject().put("num", 12).put("name", "陳小美").put("handle", "maria_shops").put("totalSpent", 700.0);
        JSONArray o = new JSONArray();
        o.put(new JSONObject().put("item", "250").put("time", "20:15"));
        buyer.put("orders", o);
        JSONObject sr = new JSONObject()
            .put("printStoreScale", sStore).put("printBuyerNumberScale", sBuyerNum).put("printBuyerNameScale", sName)
            .put("printUsernameScale", sUser).put("printCommentScale", sComment);
        return new JSONObject().put("buyer", buyer).put("scalesRaw", sr).put("storeName", "My Shop").put("currency", "NT$").put("sessionDate", "07/17/2026");
    }

    // Property: for every size × scale combination — every band stays fully inside
    // the label, no two bands overlap vertically (the old M6 by=0 clamp collision),
    // and NOTHING is dropped (buyer#, name band, and the price row all present).
    private static void testP25VerticalFitProperty() {
        System.out.println("testP25VerticalFitProperty (all sizes x scale combos: in-bounds, disjoint, nothing lost)");
        double[][] combos = {
            {1.0, 1.0, 1.0, 1.0, 1.0}, {1.5, 1.5, 1.5, 1.5, 1.5}, {3.0, 3.0, 3.0, 3.0, 3.0},
            {1.0, 1.0, 3.0, 1.0, 1.0},   // one element huge (persona A)
            {2.0, 1.3, 2.7, 1.5, 3.0},   // mixed
            {8.0, 8.0, 8.0, 8.0, 8.0},   // integer-ceiling extreme
        };
        for (int[] wh : new int[][]{{100, 60}, {80, 60}, {80, 50}, {70, 50}, {60, 40}}) {
            int H = wh[1] * 8;
            for (double[] cb : combos) {
                final List<String> bandTexts = new ArrayList<>();
                Phomemo241Builder.BandRenderer cap = (text, xMul, yMul, maxW) -> {
                    bandTexts.add(text);
                    int h = Math.max(1, r241(24 * yMul));
                    byte[] b = new byte[4 * h];
                    java.util.Arrays.fill(b, (byte) 0xAA);
                    return new Phomemo241Builder.Band(4, h, b);
                };
                List<String> dropped = new ArrayList<>();
                String s = utf8(Phomemo241Builder.forStickerNative241(p25Payload(cb[0], cb[1], cb[2], cb[3], cb[4]), wh[0], wh[1], cap, dropped));
                String tag = wh[0] + "x" + wh[1] + " scales=" + java.util.Arrays.toString(cb);
                // (a) every band fully inside the label
                List<int[]> spans = new ArrayList<>();
                boolean inBounds = true;
                for (String line : s.split("\r\n")) {
                    if (!line.startsWith("BITMAP ")) continue;
                    String[] f = line.substring(7).split(",");
                    int by = Integer.parseInt(f[1]), h = Integer.parseInt(f[3]);
                    if (by < 0 || by + h > H) inBounds = false;
                    spans.add(new int[]{by, by + h});
                }
                check(inBounds, "every band inside the label at " + tag);
                // (b) no two bands overlap vertically (M6 collision class)
                boolean disjoint = true;
                for (int i = 0; i < spans.size(); i++)
                    for (int j = i + 1; j < spans.size(); j++)
                        if (spans.get(i)[0] < spans.get(j)[1] && spans.get(j)[0] < spans.get(i)[1]) disjoint = false;
                check(disjoint, "no vertical band overlap at " + tag);
                // (c) nothing lost: buyer#, the name band, and the price row all present
                boolean buyerPresent = s.contains("Buyer #12") || bandTexts.stream().anyMatch(t -> t.contains("Buyer #12"));
                boolean namePresent = bandTexts.stream().anyMatch(t -> t.contains("陳"));
                boolean pricePresent = s.contains("\"250\"") || bandTexts.stream().anyMatch(t -> t.contains("250"));
                check(buyerPresent && namePresent && pricePresent && dropped.isEmpty(),
                      "nothing dropped at " + tag + " (buyer=" + buyerPresent + " name=" + namePresent + " price=" + pricePresent + " dropped=" + dropped + ")");
            }
        }
    }

    // Priority proof (persona B, 60x40): "everything big" steps SECONDARIES down
    // first and protects the parcel-sorting primaries — the buyer# keeps an enlarged
    // band (h=36 = 24x1.5) while store/user/price return to sharp 1.0 TEXT; the name
    // band lands at its base size. Same converged layout for all-1.5 and all-3.0.
    private static void testP25PriorityProtectsPrimaries() {
        System.out.println("testP25PriorityProtectsPrimaries (60x40 persona B)");
        for (double all : new double[]{1.5, 3.0}) {
            String s = utf8(Phomemo241Builder.forStickerNative241(p25Payload(all, all, all, all, all), 60, 40, fakeBand(), new ArrayList<>()));
            String tag = "all-" + all;
            contains(s, "BITMAP 408,156,4,72,0,", tag + ": buyer# keeps its ENLARGED band (48x1.5=72) — most protected");
            contains(s, "BITMAP 408,96,4,48,0,", tag + ": name band floored to base (48), directly below, no overlap");
            contains(s, "TEXT 400,256,\"3\",180,1,1,\"My Shop\"", tag + ": store stepped to sharp 1.0 TEXT");
            contains(s, "BITMAP 408,64,4,24,0,", tag + ": @username floored to its base bold band (24)");
            contains(s, "BITMAP 340,6,4,32,0,", tag + ": price floored to its 32-cell marquee band, row at reading y=282 (fits: 282+38<=320)");
        }
    }

    // When everything FITS as requested the planner must not touch a single byte:
    // explicit all-1.0 scalesRaw == no scalesRaw at all (both fit, byte-equal). The
    // scale-1.0 exact-string suites (bespoke + AIMO parity) are the deeper pin.
    private static void testP25ByteIdenticalWhenFits() {
        System.out.println("testP25ByteIdenticalWhenFits");
        byte[] with = Phomemo241Builder.forStickerNative241(p25Payload(1.0, 1.0, 1.0, 1.0, 1.0), 60, 40, fakeBand(), new ArrayList<>());
        // Same buyer/store/date but NO scalesRaw at all (the org.json stub has no
        // remove(), so build it directly) — both fit, both must be byte-equal.
        JSONObject buyer = new JSONObject().put("num", 12).put("name", "陳小美").put("handle", "maria_shops").put("totalSpent", 700.0);
        JSONArray o = new JSONArray();
        o.put(new JSONObject().put("item", "250").put("time", "20:15"));
        buyer.put("orders", o);
        JSONObject noScales = new JSONObject().put("buyer", buyer).put("storeName", "My Shop").put("currency", "NT$").put("sessionDate", "07/17/2026");
        byte[] without = Phomemo241Builder.forStickerNative241(noScales, 60, 40, fakeBand(), new ArrayList<>());
        check(java.util.Arrays.equals(with, without), "all-1.0 output is byte-identical (planner untouched when it fits)");
    }

    // The drop path NEVER fires silently: on an impossibly short label (unknown
    // 60x20 falls back to the 100x60 gap table with H=160) rows are dropped lowest-
    // priority-first and each is RECORDED; buyer# + name are never dropped.
    private static void testP25DropSignal() {
        System.out.println("testP25DropSignal (extreme fallback: recorded, primaries kept)");
        final List<String> bandTexts = new ArrayList<>();
        Phomemo241Builder.BandRenderer cap = (text, xMul, yMul, maxW) -> {
            bandTexts.add(text);
            byte[] b = new byte[4 * 48];
            java.util.Arrays.fill(b, (byte) 0xAA);
            return new Phomemo241Builder.Band(4, 48, b);
        };
        List<String> dropped = new ArrayList<>();
        String s = utf8(Phomemo241Builder.forStickerNative241(p25Payload(1.0, 1.0, 1.0, 1.0, 1.0), 60, 20, cap, dropped));
        check(dropped.contains("store") && dropped.contains("@username") && dropped.contains("order-row"),
              "every dropped row is RECORDED (got " + dropped + ")");
        check(!s.contains("\"My Shop\"") && !s.contains("@maria_shops") && !s.contains("\"250\""), "dropped rows are not emitted");
        boolean buyerKept = s.contains("Buyer #12") || bandTexts.stream().anyMatch(t -> t.contains("Buyer #12"));
        boolean nameKept = bandTexts.stream().anyMatch(t -> t.contains("陳"));
        check(buyerKept && nameKept, "buyer# + name are NEVER dropped (buyer=" + buyerKept + " name=" + nameKept + ")");
    }

    // ── P3 bold/weight hierarchy ─────────────────────────────────────────────
    // The three sorting PRIMARIES (Buyer#, name, @username) are BOLD by default =
    // ALWAYS raster bands with bold=true (the TSPL ROM has no bold), even short
    // ASCII at scale 1.0. SECONDARIES (store/date/time/price) keep the pre-P3
    // behavior exactly: short content = raw TEXT, the P2 ladder on overflow.
    private static void testP3BoldRouting() {
        System.out.println("testP3BoldRouting (primaries = bold bands, secondaries byte-unchanged)");
        final List<String> boldTexts = new ArrayList<>();
        final List<String> regularTexts = new ArrayList<>();
        // Anonymous class (not a lambda) so the 5-arg bold-aware overload is visible.
        Phomemo241Builder.BandRenderer cap = new Phomemo241Builder.BandRenderer() {
            @Override public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxW) {
                return render(text, xMul, yMul, maxW, false);
            }
            @Override public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxW, boolean bold) {
                (bold ? boldTexts : regularTexts).add(text);
                int h = Math.max(1, r241(24 * yMul));
                byte[] b = new byte[4 * h]; java.util.Arrays.fill(b, (byte) 0xAA);
                return new Phomemo241Builder.Band(4, h, b);
            }
        };
        String s = utf8(Phomemo241Builder.forStickerNative241(asciiPayload(), 60, 40, cap));
        check(boldTexts.size() == 3
              && boldTexts.stream().anyMatch(t -> t.equals("Buyer #12"))
              && boldTexts.stream().anyMatch(t -> t.equals("Maria Santos"))
              && boldTexts.stream().anyMatch(t -> t.equals("@maria_shops")),
              "exactly the 3 primaries render as BOLD bands even short at 1.0 (got " + boldTexts + ")");
        check(regularTexts.equals(java.util.List.of("250")), "exactly ONE regular-weight band at all-1.0 — the price marquee (store/date/time stay TEXT; got " + regularTexts + ")");
        contains(s, "TEXT 400,256,\"3\",180,1,1,\"My Shop\"", "store stays raw TEXT (regular invariant)");
        contains(s, "TEXT 440,74,\"2\",180,1,1,\"20:15\"", "time stays raw TEXT");
        contains(s, "BITMAP 340,", "price emits as its regular-weight marquee band");
        check(!s.contains("\"Buyer #12\"") && !s.contains("\"Maria Santos\"") && !s.contains("\"@maria_shops\""),
              "no primary ever appears as raw TEXT");
        // Bold band sizing: the band must never be SMALLER than the ROM text it
        // replaces — buyer#/name (font 4) = 32-dot cell, @username (font 3) = 24.
        final List<Integer> heights = new ArrayList<>();
        Phomemo241Builder.BandRenderer hcap = new Phomemo241Builder.BandRenderer() {
            @Override public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxW) {
                return render(text, xMul, yMul, maxW, false);
            }
            @Override public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxW, boolean bold) {
                int h = Math.max(1, r241(24 * yMul)); heights.add(h);
                byte[] b = new byte[4 * h]; java.util.Arrays.fill(b, (byte) 0xAA);
                return new Phomemo241Builder.Band(4, h, b);
            }
        };
        Phomemo241Builder.forStickerNative241(asciiPayload(), 60, 40, hcap);
        check(heights.equals(java.util.List.of(48, 42, 24, 32)),
              "P3.6 design cells: buyer# 48, name 42, @user 24, price 32 — the AIMO-match hierarchy (got " + heights + ")");
        // The vertical planner accounts for the bold heights: 60x40 CJK all-1.5 fits
        // with the buyer# ENLARGED (pinned in testP25PriorityProtectsPrimaries).
    }

    // P4 — per-field WEIGHT routing (additive `weightsRaw`, the scalesRaw
    // delivery pattern). Back-compat is the hard requirement: a payload WITHOUT
    // weightsRaw (every saved seller, AIMO, App.tsx, old binaries) must be
    // byte-identical to the explicit P3-hierarchy defaults; toggles then
    // re-route each field between its PROMINENT band and the plain rendering.
    private static void testP4WeightRouting() throws Exception {
        System.out.println("testP4WeightRouting (weightsRaw: back-compat bytes + per-field toggles)");
        // BACK-COMPAT: absent weightsRaw == explicit defaults, byte-for-byte, on
        // the bespoke 60x40 AND an AIMO-mirrored big size.
        for (int[] size : new int[][]{{60, 40}, {100, 60}}) {
            String without = utf8(Phomemo241Builder.forStickerNative241(asciiPayload(), size[0], size[1], fakeBand()));
            JSONObject explicit = asciiPayload();
            explicit.put("weightsRaw", new JSONObject()
                    .put("store", false).put("buyerNum", true).put("name", true)
                    .put("username", true).put("comment", false));
            String withS = utf8(Phomemo241Builder.forStickerNative241(explicit, size[0], size[1], fakeBand()));
            check(without.equals(withS),
                  "explicit default weights == absent weightsRaw (" + size[0] + "x" + size[1] + ")");
        }
        // ALL-NORMAL primaries: the 3 primaries fall back to plain rotation-180
        // TEXT (the plain rendering) — zero bold bands; the price marquee stays
        // its regular band; the planner mirror follows the normal advances.
        final List<String> boldTexts = new ArrayList<>();
        final List<String> regularTexts = new ArrayList<>();
        Phomemo241Builder.BandRenderer cap = new Phomemo241Builder.BandRenderer() {
            @Override public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxW) {
                return render(text, xMul, yMul, maxW, false);
            }
            @Override public Phomemo241Builder.Band render(String text, double xMul, double yMul, int maxW, boolean bold) {
                (bold ? boldTexts : regularTexts).add(text);
                int h = Math.max(1, r241(24 * yMul));
                byte[] b = new byte[4 * h]; java.util.Arrays.fill(b, (byte) 0xAA);
                return new Phomemo241Builder.Band(4, h, b);
            }
        };
        JSONObject normal = asciiPayload();
        normal.put("weightsRaw", new JSONObject()
                .put("buyerNum", false).put("name", false).put("username", false));
        java.util.List<String> dropped = new ArrayList<>();
        String s = utf8(Phomemo241Builder.forStickerNative241(normal, 60, 40, cap, dropped));
        check(boldTexts.isEmpty(), "all-normal -> ZERO bold bands (got " + boldTexts + ")");
        check(regularTexts.equals(java.util.List.of("250")),
              "price marquee stays the one regular band (got " + regularTexts + ")");
        check(s.contains("1,1,\"Buyer #12\"") && s.contains("1,1,\"Maria Santos\"") && s.contains("1,1,\"@maria_shops\""),
              "normal primaries render as plain rotation-180 TEXT at 1.0");
        check(dropped.isEmpty(), "normal weights fit without drops");
        // STORE + PRICE PROMINENT: the flag routes them to bold bands too.
        boldTexts.clear(); regularTexts.clear();
        JSONObject prominent = asciiPayload();
        prominent.put("weightsRaw", new JSONObject().put("store", true).put("comment", true));
        Phomemo241Builder.forStickerNative241(prominent, 60, 40, cap);
        check(boldTexts.containsAll(java.util.List.of("My Shop", "250", "Buyer #12", "Maria Santos", "@maria_shops"))
              && regularTexts.isEmpty(),
              "store:true + comment:true -> both join the bold-band route (got bold=" + boldTexts + " reg=" + regularTexts + ")");
    }

    // P5 pairing fix — SOURCE CONTRACT on SellerFlowPrinterPlugin.java (Android
    // Bluetooth code can't compile on this JVM gate; the tap-to-bond fixes are
    // pinned textually, run-241-parity.sh passes -Dsfl.plugin.src). The pinned
    // invariants close the "tap -> silence" bug:
    //  1. LE-only discovery sightings are DROPPED (createBond on a dual-mode
    //     printer's BLE identity = Just-Works LE pairing = no dialog, silent
    //     30s timeout — the root silence mechanism).
    //  2. cancelDiscovery is WAITED OUT (isDiscovering poll) before createBond.
    //  3. The bond end states are DISTINCT + actionable (timeout-with-
    //     notification-hint vs cancelled/rejected) — never a mute failure.
    //  4. createBond()==false still resolves with a visible message.
    private static void testP5BondSourceContract() throws Exception {
        System.out.println("testP5BondSourceContract (tap-to-pair: LE filter + settle + loud end states)");
        String path = System.getProperty("sfl.plugin.src", "");
        if (path.isEmpty()) { System.out.println("  (skipped: -Dsfl.plugin.src not set)"); return; }
        String src = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(path)),
                java.nio.charset.StandardCharsets.UTF_8);
        check(src.contains("discoverBluetoothPrinters skip LE-only"),
              "discovery drops LE-only sightings (the silent no-dialog bond trap)");
        check(src.contains("DEVICE_TYPE_LE"), "the LE guard keys off BluetoothDevice.DEVICE_TYPE_LE");
        int bondIdx = src.indexOf("public void bondBluetoothDevice");
        check(bondIdx > 0, "bondBluetoothDevice exists");
        String bond = src.substring(bondIdx);
        check(bond.contains("isDiscovering()") && bond.indexOf("isDiscovering()") < bond.indexOf("device.createBond()"),
              "discovery is settled (isDiscovering poll) BEFORE the createBond call");
        check(bond.contains("No pairing window appeared") && bond.contains("cancelled or rejected"),
              "timeout vs cancelled end states are distinct + actionable");
        check(bond.contains("Couldn't start pairing"),
              "createBond()==false resolves with a visible message");
        check(bond.contains("BLE identity"),
              "a stale LE entry tapped from an old list gets an explicit explanation");
    }

    // P3.7 completion — ONE-WEIGHT VERDICT (Jeff's font sampler, 2026-07-18):
    // the enlarged-ASCII style is ROW 2's mechanism (ROM-emulation: regular
    // face + pixel stretch) at ROW C's weight (threshold 160, stroke 0 — the
    // approved CJK tuning), so the WHOLE sticker carries one consistent stroke
    // weight and the hierarchy comes from SIZE, not boldness. This supersedes
    // the P3 per-script split (the retired ASCII 1.5/128 bold face must never
    // return); CJK's own tuning is numerically unchanged.
    private static void testP37UnifiedBandWeight() {
        System.out.println("testP37UnifiedBandWeight (Row-2 mechanism at Row-C weight — one stroke weight)");
        check(Phomemo241Builder.ROM_BAND_THRESHOLD == 160,
              "ROM_BAND_THRESHOLD is the approved Row-C 160");
        check(Phomemo241Builder.boldStrokeFor("Buyer #88") == 0f && Phomemo241Builder.boldThresholdFor("Buyer #88") == 160,
              "ASCII: zero stroke + threshold 160 (the P3 bold 1.5/128 is retired)");
        check(Phomemo241Builder.boldStrokeFor("陳小美") == 0f && Phomemo241Builder.boldThresholdFor("陳小美") == 160,
              "CJK: the approved tuning unchanged (stroke 0, threshold 160)");
        check(Phomemo241Builder.boldStrokeFor("陳小美 Anna") == 0f && Phomemo241Builder.boldThresholdFor("陳小美 Anna") == 160,
              "MIXED: the same one weight");
        check(Phomemo241Builder.boldStrokeFor("สวัสดี") == 0f && Phomemo241Builder.boldThresholdFor("สวัสดี") == 160,
              "any non-ASCII script (Thai): the same one weight");
    }

    // P3.7 completion — SOURCE CONTRACT on Phomemo241Raster.java. The raster
    // imports android.graphics, so this JVM gate cannot compile or execute it;
    // the production wiring of the chosen style is pinned TEXTUALLY instead
    // (run-241-parity.sh passes -Dsfl.raster.src; skipped gracefully without it).
    private static void testP37RasterSourceContract() throws Exception {
        System.out.println("testP37RasterSourceContract (ROM-emulation wiring in the raster source)");
        String path = System.getProperty("sfl.raster.src", "");
        if (path.isEmpty()) { System.out.println("  (skipped: -Dsfl.raster.src not set)"); return; }
        String src = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(path)),
                java.nio.charset.StandardCharsets.UTF_8);
        check(!src.contains("Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)"),
              "the ASCII bold monospace face is retired (regular ROM face only)");
        check(src.contains("Phomemo241Builder.ROM_BAND_THRESHOLD"),
              "non-CJK bands pack at the one approved weight (ROM_BAND_THRESHOLD)");
        check(src.contains("Phomemo241Builder.stretchGrayNearest"),
              "the ASCII enlarge mechanism is the ROM nearest-neighbor pixel stretch");
        check(src.contains("Typeface.DEFAULT_BOLD"),
              "the approved CJK tuning (bold typeface) is untouched");
        check(src.contains("if (!containsCjk(text))"),
              "the one-weight routing is script-based at the render() entry");
    }

    // P3.7 — the ROM-emulation core: pure HORIZONTAL nearest-neighbor stretch
    // (exactly the AIMO firmware's TEXT x-multiplier — every source column is
    // duplicated), so a thin regular-weight stroke WIDENS geometrically instead of
    // the glyph fattening. The raster feeds regular-weight pixels through this.
    private static void testP37StretchGrayH() {
        System.out.println("testP37StretchGrayH (ROM x-multiplier column duplication, pure)");
        // 2x2 gray [a,b / c,d] x2 -> each column duplicated: [a,a,b,b / c,c,d,d]
        byte[] src = {10, 20, 30, 40};
        byte[] out2 = Phomemo241Builder.stretchGrayH(src, 2, 2, 2);
        check(java.util.Arrays.equals(out2, new byte[]{10, 10, 20, 20, 30, 30, 40, 40}),
              "x2 duplicates every column in place (got " + java.util.Arrays.toString(out2) + ")");
        // a 1-column black stroke in a 3-wide row becomes a 2-column stroke at x2 —
        // the 'thin stroke widens geometrically' property (never fattens vertically).
        byte[] stroke = {(byte) 255, 0, (byte) 255};
        byte[] s2 = Phomemo241Builder.stretchGrayH(stroke, 3, 1, 2);
        check(java.util.Arrays.equals(s2, new byte[]{(byte) 255, (byte) 255, 0, 0, (byte) 255, (byte) 255}),
              "a 1-dot stroke doubles to exactly 2 dots (columns 2-3)");
        // factor 1 = identity; invalid inputs -> null.
        check(Phomemo241Builder.stretchGrayH(src, 2, 2, 1) == src, "factor 1 is the identity (same array)");
        check(Phomemo241Builder.stretchGrayH(null, 2, 2, 2) == null, "null gray -> null");
        check(Phomemo241Builder.stretchGrayH(src, 2, 2, 0) == null, "factor 0 -> null");
        check(Phomemo241Builder.stretchGrayH(new byte[]{1, 2}, 2, 2, 2) == null, "short buffer -> null");
        // x3 for completeness (non-2 factors used by future stretches).
        byte[] out3 = Phomemo241Builder.stretchGrayH(new byte[]{5, 6}, 2, 1, 3);
        check(java.util.Arrays.equals(out3, new byte[]{5, 5, 5, 6, 6, 6}), "x3 triples every column");

        // P3.7 completion — stretchGrayNearest, the FRACTIONAL generalization the
        // PRODUCTION enlarged-ASCII path uses (exact target dims; srcCol =
        // col*srcW/outW): integer ratios stay pure duplication, fractional ratios
        // (e.g. the buyer#'s ~1.71) distribute the extra columns evenly.
        byte[] frac = Phomemo241Builder.stretchGrayNearest(new byte[]{10, 20, 30}, 3, 1, 5, 1);
        check(java.util.Arrays.equals(frac, new byte[]{10, 10, 20, 20, 30}),
              "fractional 3->5 maps cols 0,0,1,1,2 (got " + java.util.Arrays.toString(frac) + ")");
        byte[] rows = Phomemo241Builder.stretchGrayNearest(new byte[]{1, 2}, 1, 2, 1, 4);
        check(java.util.Arrays.equals(rows, new byte[]{1, 1, 2, 2}),
              "vertical 2->4 duplicates rows (the ROM y-multiplier)");
        byte[] both = Phomemo241Builder.stretchGrayNearest(src, 2, 2, 4, 2);
        check(java.util.Arrays.equals(both, out2),
              "integer-target nearest == stretchGrayH x2 (delegation is byte-equal)");
        check(Phomemo241Builder.stretchGrayNearest(src, 2, 2, 2, 2) == src,
              "target == source is the identity (same array)");
        check(Phomemo241Builder.stretchGrayNearest(src, 2, 2, 1, 2) == null,
              "shrink target -> null (enlarge-only, the P2 no-squish rule)");
        check(Phomemo241Builder.stretchGrayNearest(null, 2, 2, 4, 2) == null, "null gray -> null");
    }

    // P1 — the ruler test page measures the PHYSICAL edges, so it must bypass
    // EDGE_GUARD entirely: a guarded emit would shift every tick by the very margin
    // the ruler exists to replace. Pins: frame on the exact boundary, tick distances
    // 0..32 from BOTH physical edges, labels inboard, and the no-guard proof.
    private static void testRulerTestPage() {
        System.out.println("testRulerTestPage (P1 ruler — raw physical edges, no EDGE_GUARD)");
        String s = utf8(Phomemo241Builder.rulerTestPage(60, 40));   // W=480 H=320
        contains(s, "DIRECTION 0", "ruler runs DIRECTION 0 like production");
        check(!s.contains("BITMAP"), "ruler is BAR+TEXT only (no renderer dependency)");
        // Frame on the exact label boundary (0-dot reference on all 4 edges).
        contains(s, "BAR 0,318,480,2", "frame: boundary bar (physical top)");
        contains(s, "BAR 0,0,480,2", "frame: boundary bar (physical bottom)");
        contains(s, "BAR 478,0,2,320", "frame: boundary bar (physical right/W edge)");
        contains(s, "BAR 0,0,2,320", "frame: boundary bar (physical left/0 edge)");
        // NO-GUARD PROOF: the d=0 side tick sits AT the physical W edge (478) — a
        // guarded emit would have shifted it inboard by EDGE_GUARD. Same for d=32 -> 446.
        contains(s, "BAR 478,260,2,20", "d=0 tick at the raw physical edge (no guard shift)");
        contains(s, "BAR 446,44,2,20", "d=32 tick exactly 32 dots in from the W edge");
        contains(s, "BAR 32,44,2,20", "d=32 tick exactly 32 dots in from the 0 edge");
        // Labels are TEXT, inboard (>=40 dots from the edge they annotate).
        contains(s, "TEXT 440,64,\"2\",180,1,1,\"32\"", "left-column label inboard at physical 440");
        contains(s, "TEXT 64,64,\"2\",180,1,1,\"32\"", "right-column label inboard at physical 64");
        // Top/bottom combs (step 8) + center info + terminator.
        contains(s, "BAR 180,302,120,2", "top comb d=16 long tick");
        contains(s, "BAR 180,16,120,2", "bottom comb d=16 long tick");
        contains(s, "\"RULER 60x40\"", "center size label");
        contains(s, "\"PRINT #__ (1-3)\"", "print-number blank for the 3-print protocol");
        check(s.endsWith("PRINT 1\r\n"), "ruler terminates normally");
        // Size-parametric: the 100x60 ruler uses its own W/H.
        String big = utf8(Phomemo241Builder.rulerTestPage(100, 60));
        contains(big, "SIZE 100 mm, 60 mm", "ruler follows the seller's label size");
        contains(big, "BAR 798,0,2,480", "100x60 frame bar at ITS physical W edge (798)");
    }

    private static void test6040CapsToOneOrderRow() {
        System.out.println("test6040CapsToOneOrderRow");
        JSONObject buyer = new JSONObject();
        buyer.put("num", 5).put("name", "Ann").put("handle", "a").put("totalSpent", 0);
        JSONArray orders = new JSONArray();
        orders.put(new JSONObject().put("item", "250").put("time", "20:15"));
        orders.put(new JSONObject().put("item", "999").put("time", "20:18"));
        buyer.put("orders", orders);
        JSONObject payload = new JSONObject().put("buyer", buyer).put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
        final List<String> texts = new ArrayList<>();
        Phomemo241Builder.BandRenderer cap = (t, x, yy, m) -> { texts.add(t); return null; };
        Phomemo241Builder.forStickerNative241(payload, 60, 40, cap);
        check(texts.stream().anyMatch(t -> t.equals("250")), "the first (only) order row prints (price band)");
        check(texts.stream().noneMatch(t -> t.contains("999")), "60x40 caps at ONE row (2nd order becomes its own sticker in the plugin)");
    }

    private static void testDirection0Rotated180() {
        System.out.println("testDirection0Rotated180");
        String s = utf8(Phomemo241Builder.forStickerNative241(asciiPayload(), 100, 60, nullBand()));
        contains(s, "DIRECTION 0", "241 fork runs DIRECTION 0 (DIR1 rasterizer broken)");
        check(!s.contains("DIRECTION 1"), "DIRECTION 1 must never be emitted");
        contains(s, "TEXT 768,470,\"3\",180,1,1,\"SellerFlowLive\"", "header rot-180 at mapped anchor (800-16-16,480-10)");
        check(!s.matches("(?s).*TEXT \\d+,\\d+,\"[^\"]*\",0,.*"), "no element may stay rotation 0");
    }

    private static void testBandHeightScaleCoupled() {
        System.out.println("testBandHeightScaleCoupled (F1)");
        final List<Integer> heights = new ArrayList<>();
        Phomemo241Builder.BandRenderer capture = (text, xMul, yMul, maxW) -> {
            int h = Math.max(1, r241(24 * yMul));
            heights.add(h);
            byte[] b = new byte[4 * h];
            java.util.Arrays.fill(b, (byte) 0xAA);
            return new Phomemo241Builder.Band(4, h, b);
        };
        // CJK name, everything else off. level 1 -> cjkYMul = nameCjkYMul(2) x 1 = 2 -> 48.
        JSONObject buyer = new JSONObject().put("num", 88).put("name", "陳小美").put("handle", "s").put("orders", new JSONArray());
        for (int[] pair : new int[][]{{1, 48}, {3, 144}, {8, 192}}) {
            heights.clear();
            JSONObject settings = new JSONObject()
                .put("printStoreName", false).put("printBuyerNumber", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false)
                .put("printBuyerNameScale", pair[0]);
            JSONObject payload = new JSONObject().put("buyer", buyer).put("settings", settings).put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
            Phomemo241Builder.forStickerNative241(payload, 100, 60, capture);
            check(heights.size() == 1 && heights.get(0) == pair[1], "name-scale " + pair[0] + " -> band height " + pair[1] + " (got " + heights + ")");
        }
    }

    private static void testDecimalScaleFromScalesRaw() {
        System.out.println("testDecimalScaleFromScalesRaw (BUG 3)");
        JSONObject buyer = new JSONObject().put("num", 88).put("name", "").put("handle", "s").put("totalSpent", 0).put("orders", new JSONArray());
        double[][] cases = {{1.3, 62}, {0.7, 34}, {1.1, 53}, {2.4, 115}};
        for (double[] cse : cases) {
            final List<Integer> heights = new ArrayList<>();
            Phomemo241Builder.BandRenderer cap = (text, xMul, yMul, maxW) -> {
                int h = Math.max(1, r241(24 * yMul));
                heights.add(h);
                byte[] b = new byte[4 * h];
                java.util.Arrays.fill(b, (byte) 0xAA);
                return new Phomemo241Builder.Band(4, h, b);
            };
            // integer setting says 1 (rounded); scalesRaw carries the real decimal.
            JSONObject settings = new JSONObject()
                .put("printStoreName", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false)
                .put("printBuyerNumberScale", 1);
            JSONObject scalesRaw = new JSONObject().put("printBuyerNumberScale", cse[0]);
            JSONObject payload = new JSONObject().put("buyer", buyer).put("settings", settings).put("scalesRaw", scalesRaw)
                .put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
            Phomemo241Builder.forStickerNative241(payload, 60, 40, cap);
            check(heights.size() == 1 && heights.get(0) == (int) cse[1], "scale " + cse[0] + " -> P3.5 buyer# band height r241(48 x scale) = " + (int) cse[1] + " (got " + heights + ")");
        }
    }

    // P3.6 note: the 1.0-stays-TEXT invariant now covers STORE/header/date/time
    // (bold primaries + the price marquee are always bands) — this pins the STORE.
    private static void testExactlyOnePointZeroStaysText() {
        System.out.println("testExactlyOnePointZeroStaysText (store — the remaining regular scalable)");
        JSONObject buyer = new JSONObject().put("num", 88).put("name", "").put("handle", "s").put("totalSpent", 0).put("orders", new JSONArray());
        JSONObject off = new JSONObject().put("printBuyerNumber", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false);
        final int[] bands = {0};
        Phomemo241Builder.BandRenderer count = (t, x, yy, m) -> { bands[0]++; return null; };
        JSONObject p10 = new JSONObject().put("buyer", buyer).put("settings", off).put("scalesRaw", new JSONObject().put("printStoreScale", 1.0))
            .put("storeName", "My Shop").put("currency", "NT$").put("sessionDate", "");
        String s10 = utf8(Phomemo241Builder.forStickerNative241(p10, 60, 40, count));
        check(bands[0] == 0, "REGULAR store at scale exactly 1.0 -> TEXT, never a band");
        contains(s10, "\"My Shop\"", "scale 1.0 -> the store is a plain TEXT");
        // 0.9 (just under 1) -> band (TEXT cannot shrink; a rounded gate would miss this).
        final int[] b09 = {0};
        Phomemo241Builder.BandRenderer r09 = (t, x, yy, m) -> { b09[0]++; byte[] by = new byte[88]; java.util.Arrays.fill(by, (byte) 0xAA); return new Phomemo241Builder.Band(4, 22, by); };
        JSONObject p09 = new JSONObject().put("buyer", buyer).put("settings", off).put("scalesRaw", new JSONObject().put("printStoreScale", 0.9))
            .put("storeName", "My Shop").put("currency", "NT$").put("sessionDate", "");
        Phomemo241Builder.forStickerNative241(p09, 60, 40, r09);
        check(b09[0] == 1, "REGULAR store at 0.9 -> band (must SHRINK below 1)");
    }

    private static void testOrderTimeFixed() {
        System.out.println("testOrderTimeFixedRegardlessOfCommentScale (BUG 1/2)");
        JSONArray orders = new JSONArray();
        orders.put(new JSONObject().put("item", "250").put("time", "7:07"));
        JSONObject buyer = new JSONObject().put("num", 7).put("name", "").put("handle", "s").put("totalSpent", 0).put("orders", orders);
        JSONObject on = new JSONObject().put("printStoreName", false).put("printBuyerNumber", false).put("printBuyerUsername", false)
            .put("printOrderItems", true).put("printTotal", false).put("printOrderScale", 8).put("printCommentScale", 8);
        JSONObject payload = new JSONObject().put("buyer", buyer).put("settings", on).put("scalesRaw", new JSONObject().put("printCommentScale", 3.0))
            .put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 60, 40, fakeBand()));
        contains(s, "\"2\",180,1,1,\"7:07\"", "time stays FIXED font-2 1x1 even when comment/order scale is enlarged");
        contains(s, "BITMAP", "the enlarged PRICE still becomes a band (only the time is pinned)");
    }

    private static void testThaiRendersAsBand() {
        System.out.println("testThaiNameRendersAsBand (F3/D3/D4)");
        JSONObject buyer = new JSONObject().put("num", 5).put("name", "สวัสดี").put("handle", "thaiseller").put("orders", new JSONArray());
        final List<String> texts = new ArrayList<>();
        Phomemo241Builder.BandRenderer cap = (text, xMul, yMul, maxW) -> {
            texts.add(text);
            int h = Math.max(1, r241(24 * yMul));
            byte[] b = new byte[4 * h];
            java.util.Arrays.fill(b, (byte) 0xAA);
            return new Phomemo241Builder.Band(4, h, b);
        };
        JSONObject settings = new JSONObject().put("printStoreName", false).put("printBuyerNumber", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false);
        JSONObject payload = new JSONObject().put("buyer", buyer).put("settings", settings).put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 100, 60, cap));
        check(texts.size() == 1, "Thai name reaches the band renderer (no downgrade-to-handle, D3) (got " + texts.size() + ")");
        check(texts.size() == 1 && texts.get(0).contains("ส"), "band text keeps Thai glyphs (no stripUnrenderable, D4)");
        contains(s, "BITMAP 736,", "band BITMAP at 180-mapped name x (800-16-32-16)");
        check(!s.contains("@thaiseller"), "the name line must not silently become the handle");
    }

    private static void testOverTallBandClampsY() {
        System.out.println("testOverTallBandClampsPhysicalYNeverNegative");
        JSONObject buyer = new JSONObject().put("num", 1).put("name", "陳小美").put("handle", "s").put("orders", new JSONArray());
        // A band TALLER than the space below its authoring y (60x40, name-only at
        // startY 64): H - y - height = 320 - 64 - 400 = -144, which WITHOUT the clamp
        // would be a malformed negative-y BITMAP that drops content. Clamp -> 0.
        Phomemo241Builder.BandRenderer cap = (t, x, y, m) -> { byte[] b = new byte[4 * 400]; java.util.Arrays.fill(b, (byte) 0xAA); return new Phomemo241Builder.Band(4, 400, b); };
        JSONObject off = new JSONObject().put("printStoreName", false).put("printBuyerNumber", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false);
        JSONObject payload = new JSONObject().put("buyer", buyer).put("settings", off).put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 60, 40, cap));
        check(!s.matches("(?s).*BITMAP \\d+,-\\d+,.*"), "no band may have a negative physical y");
        contains(s, "BITMAP 408,0,4,400,0,", "over-tall band clamps y to 0 (name x=24 -> bx 408; y 320-64-400=-144 -> 0)");
    }

    private static void testFailedRenderEmitsNothing() {
        System.out.println("testFailedRenderEmitsNothingNeverMalformed");
        JSONObject buyer = new JSONObject().put("num", 88).put("name", "陳小美").put("handle", "s").put("orders", new JSONArray());
        JSONObject payload = new JSONObject().put("buyer", buyer).put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 100, 60, nullBand()));
        check(!s.contains("BITMAP"), "a failed band render emits NOTHING (0-width BITMAP would be malformed)");
        check(s.endsWith("PRINT 1\r\n"), "the label still terminates normally");
    }

    // ── pure packBits ──────────────────────────────────────────────────────────
    private static void testPackBits() {
        System.out.println("packBits (pure)");
        Phomemo241Builder.Band b1 = Phomemo241Builder.packBits(new byte[]{0, 0, 0, 0, (byte) 255, (byte) 255, (byte) 255, (byte) 255}, 8, 1, 128, false);
        check(b1 != null && b1.bytes.length == 1 && (b1.bytes[0] & 0xFF) == 0x0F, "polarity: 0=black clears bit, white keeps 1 (0b0000_1111)");
        byte[] allBlack = new byte[10];
        Phomemo241Builder.Band b2 = Phomemo241Builder.packBits(allBlack, 10, 1, 128, false);
        check(b2 != null && b2.widthBytes == 2 && (b2.bytes[0] & 0xFF) == 0x00 && (b2.bytes[1] & 0xFF) == 0x3F, "pad bits beyond true width stay white (0x00,0b0011_1111)");
        Phomemo241Builder.Band b3 = Phomemo241Builder.packBits(new byte[]{127, (byte) 128}, 2, 1, 128, false);
        check(b3 != null && (b3.bytes[0] & 0xFF) == 0x7F, "threshold: <128 black, >=128 white");
        // flip180 2x2: black at top-left -> bottom-right
        byte[] gray = {0, (byte) 255, (byte) 255, (byte) 255};
        Phomemo241Builder.Band n = Phomemo241Builder.packBits(gray, 2, 2, 128, false);
        check(n != null && (n.bytes[0] & 0xFF) == 0x7F && (n.bytes[1] & 0xFF) == 0xFF, "no flip: row0=0b0111_1111 row1=all white");
        Phomemo241Builder.Band fl = Phomemo241Builder.packBits(gray, 2, 2, 128, true);
        check(fl != null && (fl.bytes[0] & 0xFF) == 0xFF && (fl.bytes[1] & 0xFF) == 0xBF, "flip180 rotates both axes: row0 white, row1=0b1011_1111");
        check(Phomemo241Builder.packBits(new byte[0], 0, 1, 128, false) == null, "invalid width -> null");
        check(Phomemo241Builder.packBits(new byte[]{0, 0}, 2, 2, 128, false) == null, "short pixel buffer -> null");
        check(Phomemo241Builder.maxChars(16, 784, 2) == (784 - 16) / 48, "maxChars mirrors AIMO formula");
        check(Phomemo241Builder.maxChars(780, 784, 2) == 1, "maxChars floor of 1");
    }

    private static void testProfileRouting() {
        System.out.println("isPhomemo241 routing");
        check(Phomemo241Builder.isPhomemo241("PM-241Z-BT-1234"), "PM-241 prefix -> 241");
        check(Phomemo241Builder.isPhomemo241("pm-241z-bt"), "case-insensitive");
        check(!Phomemo241Builder.isPhomemo241("D520BT-Z"), "AIMO -> not 241");
        check(!Phomemo241Builder.isPhomemo241(""), "empty -> not 241");
        check(!Phomemo241Builder.isPhomemo241(null), "null -> not 241");
        check(!Phomemo241Builder.isPhomemo241("PM-220"), "PM-220 (different printer) -> not 241");
    }

    public static void main(String[] args) throws Exception {
        testAsciiFullParityEverySize();
        testBespoke6040();
        testNoRightEdgeOverflow60x40();
        testP2FittingLadder();
        testP2MixedStringReachesRendererWhole();
        testP25VerticalFitProperty();
        testP25PriorityProtectsPrimaries();
        testP25ByteIdenticalWhenFits();
        testP25DropSignal();
        testP3BoldRouting();
        testP4WeightRouting();
        testP5BondSourceContract();
        testP37UnifiedBandWeight();
        testP37RasterSourceContract();
        testP37StretchGrayH();
        testRulerTestPage();
        test6040CapsToOneOrderRow();
        testDirection0Rotated180();
        testBandHeightScaleCoupled();
        testDecimalScaleFromScalesRaw();
        testExactlyOnePointZeroStaysText();
        testOrderTimeFixed();
        testThaiRendersAsBand();
        testOverTallBandClampsY();
        testFailedRenderEmitsNothing();
        testPackBits();
        testProfileRouting();
        System.out.println();
        if (failures == 0) { System.out.println("ALL PASS"); }
        else { System.out.println(failures + " FAILURE(S)"); System.exit(1); }
    }
}
