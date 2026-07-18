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
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 60, 40, nullBand()));
        contains(s, "TEXT 440,306,\"3\",180,1,1,\"SellerFlowLive\"", "header authoring (24,14)");
        contains(s, "TEXT 204,300,\"2\",180,1,1,\"07/17/2026\"", "date authoring (260,20)");
        contains(s, "BAR 64,271,376,3", "top bar authoring (24,46,376,3) -> physical span");
        contains(s, "TEXT 400,256,\"3\",180,1,1,\"My Shop\"", "shop authoring (64,64)");
        contains(s, "TEXT 440,228,\"4\",180,1,1,\"Buyer #12\"", "buyer# authoring (24,92) 1x1 (1x width)");
        contains(s, "TEXT 440,184,\"4\",180,1,1,\"Maria Santos\"", "name authoring (24,136)");
        contains(s, "TEXT 440,140,\"3\",180,1,1,\"@maria_shops\"", "@username authoring (24,180 ASCII col)");
        contains(s, "TEXT 440,90,\"2\",180,1,1,\"20:15\"", "time authoring (24,230 ASCII col) = row anchor");
        contains(s, "TEXT 372,90,\"4\",180,2,1,\"250\"", "price authoring (92,230 ASCII col) = SAME row as time (offset 0)");
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
        // — SHORT content = byte-identical designed TEXT (the invariant):
        String s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("My Shop", "Maria Santos", "maria_shops", "250"), 60, 40, nullBand()));
        contains(s, "TEXT 372,90,\"4\",180,2,1,\"250\"", "short price stays the DESIGNED \"4\"x2 TEXT (byte-identical invariant)");
        // — price 10ch: 10x48=480 > 356 -> rung 4x1 (240 fits) — same physical size
        //   (firmware ignores the x2 anyway), honest bytes:
        s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("My Shop", "Ann", "a", "ABCDEFGHIJ"), 60, 40, nullBand()));
        contains(s, "TEXT 372,90,\"4\",180,1,1,\"ABCDEFGHIJ\"", "10ch price steps to font 4 @1x (full content, sharp)");
        // — name 20ch: 20x24=480 > 424 -> font 3 (320 fits):
        s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("My Shop", "ABCDEFGHIJKLMNOPQRST", "a", "250"), 60, 40, nullBand()));
        contains(s, "TEXT 440,184,\"3\",180,1,1,\"ABCDEFGHIJKLMNOPQRST\"", "20ch name steps to font 3 (full content)");
        // — name 28ch: 28x24>424, 28x16=448>424 -> font 2 (336 fits):
        s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("My Shop", "ABCDEFGHIJKLMNOPQRSTUVWXYZAB", "a", "250"), 60, 40, nullBand()));
        contains(s, "TEXT 440,184,\"2\",180,1,1,\"ABCDEFGHIJKLMNOPQRSTUVWXYZAB\"", "28ch name steps to font 2 (full content)");
        // — store 36ch (upstream truncate(36)): 36x16>384, 36x12=432>384 -> ladder
        //   exhausted -> "..." at font 2: maxChars=384/12=32 -> 29 kept + "...":
        s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "Ann", "a", "250"), 60, 40, nullBand()));
        contains(s, "TEXT 400,256,\"2\",180,1,1,\"ABCDEFGHIJKLMNOPQRSTUVWXYZ012...\"", "36ch store: font-2 still over -> truncate 29 + ASCII '...'");
        // — @username 28ch handle (content 29ch): 29x16=464>424 -> font 2 (348):
        s = utf8(Phomemo241Builder.forStickerNative241(p2Payload("My Shop", "Ann", "verylongusername_tiktok_9999", "250"), 60, 40, nullBand()));
        contains(s, "TEXT 440,140,\"2\",180,1,1,\"@verylongusername_tiktok_9999\"", "28ch handle steps to font 2 (full content)");
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
        String s = utf8(Phomemo241Builder.forStickerNative241(payload, 60, 40, nullBand()));
        contains(s, "\"250\"", "the first (only) order row prints");
        check(!s.contains("\"999\""), "60x40 caps at ONE row (2nd order becomes its own sticker in the plugin)");
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
                .put("printStoreName", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false)
                .put("printBuyerNameScale", pair[0]);
            JSONObject payload = new JSONObject().put("buyer", buyer).put("settings", settings).put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
            Phomemo241Builder.forStickerNative241(payload, 100, 60, capture);
            check(heights.size() == 1 && heights.get(0) == pair[1], "name-scale " + pair[0] + " -> band height " + pair[1] + " (got " + heights + ")");
        }
    }

    private static void testDecimalScaleFromScalesRaw() {
        System.out.println("testDecimalScaleFromScalesRaw (BUG 3)");
        JSONObject buyer = new JSONObject().put("num", 88).put("name", "").put("handle", "s").put("totalSpent", 0).put("orders", new JSONArray());
        double[][] cases = {{1.3, 31}, {0.7, 17}, {1.1, 26}, {2.4, 58}};
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
            check(heights.size() == 1 && heights.get(0) == (int) cse[1], "scale " + cse[0] + " -> band height " + (int) cse[1] + " (got " + heights + ")");
        }
    }

    private static void testExactlyOnePointZeroStaysText() {
        System.out.println("testExactlyOnePointZeroStaysText");
        JSONObject buyer = new JSONObject().put("num", 88).put("name", "").put("handle", "s").put("totalSpent", 0).put("orders", new JSONArray());
        JSONObject off = new JSONObject().put("printStoreName", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false);
        final int[] bands = {0};
        Phomemo241Builder.BandRenderer count = (t, x, yy, m) -> { bands[0]++; return null; };
        JSONObject p10 = new JSONObject().put("buyer", buyer).put("settings", off).put("scalesRaw", new JSONObject().put("printBuyerNumberScale", 1.0))
            .put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
        String s10 = utf8(Phomemo241Builder.forStickerNative241(p10, 60, 40, count));
        check(bands[0] == 0, "scale exactly 1.0 -> TEXT, never a band");
        contains(s10, "\"Buyer #88\"", "scale 1.0 -> Buyer# is a plain TEXT");
        // 0.9 (just under 1) -> band (TEXT cannot shrink; a rounded gate would miss this).
        final int[] b09 = {0};
        Phomemo241Builder.BandRenderer r09 = (t, x, yy, m) -> { b09[0]++; byte[] by = new byte[88]; java.util.Arrays.fill(by, (byte) 0xAA); return new Phomemo241Builder.Band(4, 22, by); };
        JSONObject p09 = new JSONObject().put("buyer", buyer).put("settings", off).put("scalesRaw", new JSONObject().put("printBuyerNumberScale", 0.9))
            .put("storeName", "S").put("currency", "NT$").put("sessionDate", "");
        Phomemo241Builder.forStickerNative241(p09, 60, 40, r09);
        check(b09[0] == 1, "scale 0.9 -> band (must SHRINK below 1)");
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
        JSONObject settings = new JSONObject().put("printStoreName", false).put("printBuyerUsername", false).put("printOrderItems", false).put("printTotal", false);
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

    public static void main(String[] args) {
        testAsciiFullParityEverySize();
        testBespoke6040();
        testNoRightEdgeOverflow60x40();
        testP2FittingLadder();
        testP2MixedStringReachesRendererWhole();
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
