package com.sellerflow.live;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Golden-fixture generator. Compiles against the UNMODIFIED production
 * mobile/android/.../TsplBuilder.java and calls its package-private
 * forStickerNative() to produce the authoritative Android TSPL byte stream for
 * a set of canonical payloads. For each fixture it writes:
 *
 *   payloads/<name>.json  — the exact input (ASCII-safe \\uXXXX), consumed by
 *                           the Swift XCTest and the web (vitest) parity tests
 *   golden/<name>.bin     — the raw Android TSPL bytes (source of truth)
 *   golden/<name>.hex     — same bytes as lowercase hex (human-diffable)
 *   manifest.json         — fixture list + label dimensions
 *
 * The Swift buildTsplSticker and the TS reference builder are both asserted
 * byte-for-byte against golden/<name>.bin. Run via run.sh.
 */
public final class GoldenGen {
    private static final int W = 100;
    private static final int H = 60;

    private static final class Fixture {
        final String name;
        final JSONObject payload;
        final int w;
        final int h;
        Fixture(String name, JSONObject payload) { this(name, payload, W, H); }
        Fixture(String name, JSONObject payload, int w, int h) {
            this.name = name; this.payload = payload; this.w = w; this.h = h;
        }
    }

    public static void main(String[] args) throws IOException {
        if (args.length < 1) {
            System.err.println("usage: GoldenGen <outDir>");
            System.exit(2);
        }
        File outDir = new File(args[0]);
        File payloadsDir = new File(outDir, "payloads");
        File goldenDir = new File(outDir, "golden");
        payloadsDir.mkdirs();
        goldenDir.mkdirs();

        List<Fixture> fixtures = buildFixtures();
        StringBuilder manifest = new StringBuilder();
        // Per-fixture label dimensions: PHASE 1 covers two sizes in the 60mm
        // height tier (100x60 + 80x60), so each fixture carries its own w/h.
        manifest.append("{\n  \"fixtures\": [\n");

        for (int i = 0; i < fixtures.size(); i++) {
            Fixture f = fixtures.get(i);
            byte[] bytes = TsplBuilder.forStickerNative(f.payload, f.w, f.h);

            write(new File(payloadsDir, f.name + ".json"), f.payload.toString());
            Files.write(new File(goldenDir, f.name + ".bin").toPath(), bytes);
            write(new File(goldenDir, f.name + ".hex"), toHex(bytes));

            manifest.append("    {\"name\": \"").append(f.name)
                    .append("\", \"labelWidthMm\": ").append(f.w)
                    .append(", \"labelHeightMm\": ").append(f.h).append("}");
            manifest.append(i < fixtures.size() - 1 ? ",\n" : "\n");
            System.out.println(f.name + " (" + f.w + "x" + f.h + "): " + bytes.length + " bytes");
        }
        manifest.append("  ]\n}\n");
        write(new File(outDir, "manifest.json"), manifest.toString());
        System.out.println("Wrote " + fixtures.size() + " fixtures to " + outDir);
    }

    private static List<Fixture> buildFixtures() {
        List<Fixture> list = new ArrayList<>();

        // 1. ASCII, all settings on, two orders, whole-number total.
        list.add(new Fixture("ascii_full", payload(
            "My Shop", "June 18, 2026", "NT$",
            buyer(7, "Maria Santos", "maria_s", 250.0,
                order("14:02", "Red Dress"),
                order("14:05", "Blue Bag")),
            settings(true, true, true, true, true))));

        // 2. Chinese store/name/item — exercises TSS24.BF2 + GBK per field.
        //    小店 = "Xiao Dian"; 陳小美 = "Chen Xiao Mei";
        //    紅色洋裝 = "red dress" (Traditional).
        list.add(new Fixture("chinese", payload(
            "小店", "2026-06-18", "NT$",
            buyer(12, "陳小美", "meimei", 1280.5,
                order("09:30", "紅色洋裝")),
            settings(true, true, true, true, true))));

        // 3. Emoji stripping: PH flag + fire dropped, store bag emoji dropped,
        //    empty session date, no orders, fractional-but-whole total.
        list.add(new Fixture("emoji_strip", payload(
            "Shop 🛍️", "", "$",
            buyer(3, "Maria 🇵🇭🔥", "maria_ph", 99.0),
            settings(true, true, true, true, true))));

        // 4. Pure-emoji name strips to empty -> falls back to handle.
        list.add(new Fixture("pure_emoji_fallback", payload(
            "", "2026-06-18", "$",
            buyer(5, "🔥😀", "firegirl", 0.0),
            settings(true, true, true, true, true))));

        // 5. Every print-setting OFF: only the fixed scaffold + dividers remain.
        list.add(new Fixture("settings_off", payload(
            "Big Store", "2026-06-18", "NT$",
            buyer(9, "John Doe", "johnd", 500.0, order("10:00", "Item A")),
            settings(false, false, false, false, false))));

        // 6. Over-length fields exercise every truncate() bound + 2-order cap.
        list.add(new Fixture("long_truncation", payload(
            "A store name that is definitely longer than thirty six characters total",
            "A very long session date string over twenty two", "NT$",
            buyer(123, "A very long buyer name that exceeds thirty characters limit",
                "averylonghandlethatexceedsthirtycharacterslimit", 12345.67,
                order("14:02:30 PM", "A super long product item name that goes beyond thirty chars"),
                order("14:09", "Second order item also fairly long for the column")),
            settings(true, true, true, true, true))));

        // 7. Embedded double-quotes -> safe() rewrites them to single quotes.
        list.add(new Fixture("quote_escape", payload(
            "Joe's \"Shop\"", "2026-06-18", "NT$",
            buyer(1, "O\"Brien", "quote", 10.0),
            settings(true, true, true, true, true))));

        // 8. Minimal payload: empty buyer, no settings object (defaults true).
        JSONObject minimal = new JSONObject();
        minimal.put("buyer", new JSONObject());
        list.add(new Fixture("minimal", minimal));

        // 9. PHASE 1 second size — 80x60 (width-scaled, same 60mm height tier).
        //    ASCII, all settings on; validates the width-parametric layout
        //    (full-width rules, right-anchored session/total, separator).
        list.add(new Fixture("ascii_full_80x60", payload(
            "My Shop", "June 18, 2026", "NT$",
            buyer(7, "Maria Santos", "maria_s", 250.0,
                order("14:02", "Red Dress"),
                order("14:05", "Blue Bag")),
            settings(true, true, true, true, true)), 80, 60));

        // 10. 80x60 with Chinese fields — exercises the width-scaled CJK clamp
        //     (rightEdge = 80*8-16 = 624 instead of 784).
        list.add(new Fixture("chinese_80x60", payload(
            "小店", "2026-06-18", "NT$",
            buyer(12, "陳小美", "meimei", 1280.5,
                order("09:30", "紅色洋裝")),
            settings(true, true, true, true, true)), 80, 60));

        // ── PHASE 2: 400-dot (50mm) height tier — footer reflows to the bottom.
        // 11. 80x50 ASCII (width 640, height 400). Validates the bottom-anchored
        //     footer + order-row cap on the shorter label.
        list.add(new Fixture("ascii_full_80x50", payload(
            "My Shop", "June 18, 2026", "NT$",
            buyer(7, "Maria Santos", "maria_s", 250.0,
                order("14:02", "150"),
                order("14:05", "250")),
            settings(true, true, true, true, true)), 80, 50));

        // 12. 70x50 ASCII (width 560, height 400) — narrowest Phase-2 width.
        list.add(new Fixture("ascii_full_70x50", payload(
            "My Shop", "June 18, 2026", "NT$",
            buyer(7, "Maria Santos", "maria_s", 250.0,
                order("14:02", "150"),
                order("14:05", "250")),
            settings(true, true, true, true, true)), 70, 50));

        // 13. 70x50 Chinese — CJK clamp (rightEdge=544) at the new height tier.
        list.add(new Fixture("chinese_70x50", payload(
            "小店", "2026-06-18", "NT$",
            buyer(12, "陳小美", "meimei", 1280.5,
                order("09:30", "紅色洋裝")),
            settings(true, true, true, true, true)), 70, 50));

        // 14. 70x50 all settings OFF — checks the footer position with an empty
        //     body (only the fixed scaffold + bottom-anchored divider remain).
        list.add(new Fixture("settings_off_70x50", payload(
            "Big Store", "2026-06-18", "NT$",
            buyer(9, "John Doe", "johnd", 500.0, order("10:00", "300")),
            settings(false, false, false, false, false)), 70, 50));

        // ── PHASE 3: 320-dot (40mm) tier — compact body (buyer# 2x1, tighter
        // gaps, @username dropped). Width 480 dots.
        // 15. 60x40 ASCII, all settings on. Validates the compact layout fits.
        list.add(new Fixture("ascii_full_60x40", payload(
            "My Shop", "June 18, 2026", "NT$",
            buyer(7, "Maria Santos", "maria_s", 250.0,
                order("14:02", "150")),
            settings(true, true, true, true, true)), 60, 40));

        // 16. 60x40 Chinese — CJK clamp (rightEdge = 60*8-16 = 464) + compact.
        list.add(new Fixture("chinese_60x40", payload(
            "小店", "2026-06-18", "NT$",
            buyer(12, "陳小美", "meimei", 1280.5,
                order("09:30", "紅色洋裝")),
            settings(true, true, true, true, true)), 60, 40));

        // 17. 60x40 all settings OFF — footer position with an empty compact body.
        list.add(new Fixture("settings_off_60x40", payload(
            "Big Store", "2026-06-18", "NT$",
            buyer(9, "John Doe", "johnd", 500.0, order("10:00", "300")),
            settings(false, false, false, false, false)), 60, 40));

        // ── LANGUAGE COVERAGE: any-language buyer-name handling (run.sh compiles
        // this with -encoding UTF-8, so non-ASCII literals are fine — same as the
        // Chinese fixtures above). Transliteration romanizes Latin+diacritics to
        // the big ASCII font; Arabic (no printer font) falls back to the @handle.
        // 18. Vietnamese name "Trần Trà My" -> "Tran Tra My": diacritics stripped
        //     -> rendered on ASCII font "4", not the small CJK path.
        list.add(new Fixture("vietnamese", payload(
            "Shop", "2026-06-22", "NT$",
            buyer(8, "Trần Trà My", "tra_my", 250.0,
                order("14:02", "150")),
            settings(true, true, true, true, true))));

        // 19. Same Vietnamese name on the compact 60x40 — proves romanization
        //     works on every size, not just 100x60.
        list.add(new Fixture("vietnamese_60x40", payload(
            "Shop", "2026-06-22", "NT$",
            buyer(8, "Trần Trà My", "tra_my", 250.0,
                order("14:02", "150")),
            settings(true, true, true, true, true)), 60, 40));

        // 20. "Đặng Phương" -> "Dang Phuong" exercises the atomic-letter map:
        //     Đ (D-stroke) is NOT decomposed by NFD, so it needs the explicit map.
        list.add(new Fixture("vietnamese_dong", payload(
            "Shop", "2026-06-22", "NT$",
            buyer(8, "Đặng Phương", "dang_p", 250.0,
                order("14:02", "150")),
            settings(true, true, true, true, true))));

        // 21. Arabic name (no AIMO font) + ASCII handle -> name falls back to the
        //     romanized @handle "ahmad_q"; nothing prints as '?' (Tier 3 fallback).
        list.add(new Fixture("arabic_fallback", payload(
            "Shop", "2026-06-22", "NT$",
            buyer(9, "محمد العربي", "ahmad_q", 100.0,
                order("14:02", "150")),
            settings(true, true, true, true, true))));

        return list;
    }

    // ── payload builders ────────────────────────────────────────────────────

    private static JSONObject payload(String storeName, String sessionDate, String currency,
                                      JSONObject buyer, JSONObject settings) {
        JSONObject p = new JSONObject();
        p.put("storeName", storeName);
        p.put("sessionDate", sessionDate);
        p.put("currency", currency);
        p.put("buyer", buyer);
        p.put("settings", settings);
        return p;
    }

    private static JSONObject buyer(int num, String name, String handle, double totalSpent,
                                    JSONObject... orders) {
        JSONObject b = new JSONObject();
        b.put("num", num);
        b.put("name", name);
        b.put("handle", handle);
        b.put("totalSpent", totalSpent);
        JSONArray arr = new JSONArray();
        for (JSONObject o : orders) arr.put(o);
        b.put("orders", arr);
        return b;
    }

    private static JSONObject order(String time, String item) {
        JSONObject o = new JSONObject();
        o.put("time", time);
        o.put("item", item);
        return o;
    }

    private static JSONObject settings(boolean store, boolean number, boolean username,
                                       boolean orderItems, boolean total) {
        JSONObject s = new JSONObject();
        s.put("printStoreName", store);
        s.put("printBuyerNumber", number);
        s.put("printBuyerUsername", username);
        s.put("printOrderItems", orderItems);
        s.put("printTotal", total);
        return s;
    }

    // ── io ──────────────────────────────────────────────────────────────────

    private static void write(File f, String s) throws IOException {
        try (FileWriter w = new FileWriter(f)) { w.write(s); }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b & 0xFF));
        return sb.toString();
    }
}
