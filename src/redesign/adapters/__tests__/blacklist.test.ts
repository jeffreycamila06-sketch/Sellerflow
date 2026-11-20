// BLACKLIST — the rules (pure): the strict QR reader, the exact-match key, the live-row lookup, the
// list grouping / search, who sees it (never Taiwan), the "NEW" badge, the chip words.
import { describe, it, expect, beforeEach } from "vitest";
import {
  BL_SEEN_KEY, blacklistChipText, blacklistCountsText, blacklistForComment, blacklistHandleFromQr, blacklistInputProblem, blacklistKey,
  blacklistLabel, blacklistMap, blacklistSeen, blacklistVisible, displayBuyer, filterBlacklist, formatBlacklistDay, groupBlacklist,
  markBlacklistSeen, parseBlRows, type BlRow,
} from "../blacklist";
import { handleFromQrPayload } from "../../../lib/tiktokHandle";
import { buildT } from "../../i18n";

const row = (id: string, platform: "tiktok" | "facebook", label: string, reason: "returned" | "not_checked_out", day: string, at: string): BlRow =>
  ({ id, platform, label, reason, day, createdAt: at });

describe("the strict QR reader (blacklist only)", () => {
  it("a TikTok profile link — what the sticker prints — gives the username", () => {
    for (const s of [
      "https://tiktok.com/@maria_shop", "http://tiktok.com/@maria_shop", "tiktok.com/@maria_shop", "https://www.tiktok.com/@maria_shop",
      "https://m.tiktok.com/@maria_shop", "HTTPS://TIKTOK.COM/@maria_shop", "  https://tiktok.com/@maria_shop  ", "https://tiktok.com/@maria_shop/",
      "https://www.tiktok.com/@maria_shop?lang=en", "https://www.tiktok.com/@maria_shop#top",
    ]) expect(blacklistHandleFromQr(s), s).toBe("maria_shop");
    expect(blacklistHandleFromQr("https://tiktok.com/@jhun.belle_23")).toBe("jhun.belle_23");
  });
  it("a text that starts with @ gives the username", () => {
    expect(blacklistHandleFromQr("@maria_shop")).toBe("maria_shop");
    expect(blacklistHandleFromQr("  @Maria.Shop ")).toBe("Maria.Shop");
  });
  it("anything else = no buyer (where Parcel Scan's reader would accept some of them)", () => {
    const noBuyer = [
      "maria_shop", "ABC123", "hello", "12345", "", "   ", "@", "@ maria", "@maria shop", "@maria/shop", "@maria!",
      "https://example.com/@maria", "https://tiktok.com/maria", "https://vm.tiktok.com/ZMabc123/", "https://www.tiktok.com/@maria/video/7300000000",
      "https://tiktok.com.evil.io/@maria", "https://www.facebook.com/maria", "tiktok.com/@", "Buyer #12 maria", "https://tiktok.com/@" + "a".repeat(31),
    ];
    for (const s of noBuyer) expect(blacklistHandleFromQr(s), JSON.stringify(s)).toBeNull();
    // Parcel Scan's reader is unchanged and still accepts a plain word — the stricter rule is the blacklist's own.
    expect(handleFromQrPayload("ABC123")).toBe("ABC123");
    expect(handleFromQrPayload("maria_shop")).toBe("maria_shop");
  });
});

describe("exact match only", () => {
  it("TikTok: trimmed, ONE @ off, any case; Facebook: trimmed, any case", () => {
    expect(blacklistKey("tiktok", " @Maria_Shop ")).toBe("maria_shop");
    expect(blacklistKey("tiktok", "maria_shop")).toBe("maria_shop");
    expect(blacklistLabel("tiktok", "@Maria_Shop")).toBe("Maria_Shop");
    expect(blacklistKey("facebook", "  Ana Reyes ")).toBe("ana reyes");
    expect(blacklistKey("facebook", "Ana  Reyes")).toBe("ana  reyes"); // two spaces stay two spaces
    expect(blacklistLabel("facebook", "@Ana")).toBe("@Ana"); // a Facebook name keeps its @
    expect(displayBuyer("tiktok", "maria_shop")).toBe("@maria_shop");
    expect(displayBuyer("facebook", "Ana Reyes")).toBe("Ana Reyes");
  });
  it("the Add button: empty / a TikTok name with a space / too long", () => {
    expect(blacklistInputProblem("tiktok", "  @ ")).toBe("empty");
    expect(blacklistInputProblem("tiktok", "maria shop")).toBe("space");
    expect(blacklistInputProblem("facebook", "Ana Reyes")).toBeNull();
    expect(blacklistInputProblem("facebook", "x".repeat(101))).toBe("long");
    expect(blacklistInputProblem("tiktok", "@maria_shop")).toBeNull();
  });
  const map = blacklistMap(groupBlacklist([
    row("1", "tiktok", "Maria_Shop", "returned", "2026-11-18", "2026-11-18T10:00:00Z"),
    row("2", "facebook", "Ana Reyes", "not_checked_out", "2026-11-16", "2026-11-16T10:00:00Z"),
    row("3", "facebook", "maria_shop", "returned", "2026-11-10", "2026-11-10T10:00:00Z"),
  ]));
  it("a TikTok comment matches by its @username, any case, never by part of it", () => {
    expect(blacklistForComment(map, { platform: "TikTok", name: "Maria", handle: "@maria_shop" })?.label).toBe("Maria_Shop");
    expect(blacklistForComment(map, { platform: "tiktok", name: "x", handle: "@MARIA_SHOP" })?.label).toBe("Maria_Shop");
    expect(blacklistForComment(map, { platform: "TikTok", name: "Maria", handle: "@maria_shop2" })).toBeNull();
    expect(blacklistForComment(map, { platform: "TikTok", name: "Maria", handle: "@maria_sho" })).toBeNull();
    // the TikTok NICKNAME is never used
    expect(blacklistForComment(map, { platform: "TikTok", name: "maria_shop", handle: "@someone" })).toBeNull();
  });
  it("a Facebook comment matches by the commenter's name (trimmed, any case), never an id", () => {
    expect(blacklistForComment(map, { platform: "Facebook", name: " ana reyes ", handle: "100009988" })?.label).toBe("Ana Reyes");
    expect(blacklistForComment(map, { platform: "Facebook", name: "Ana Reye", handle: "Ana Reye" })).toBeNull();
    expect(blacklistForComment(map, { platform: "Facebook", name: "Ana  Reyes", handle: "x" })).toBeNull();
    expect(blacklistForComment(map, { platform: "Facebook", name: "Unknown", handle: "maria_shop" })).toBeNull();
  });
  it("TikTok and Facebook are separate; Instagram / Shopee never match", () => {
    expect(blacklistForComment(map, { platform: "Facebook", name: "maria_shop", handle: "1" })?.platform).toBe("facebook");
    expect(blacklistForComment(map, { platform: "Instagram", name: "maria_shop", handle: "@maria_shop" })).toBeNull();
    expect(blacklistForComment(map, { platform: "Shopee", name: "Ana Reyes", handle: "maria_shop" })).toBeNull();
    expect(blacklistForComment(undefined, { platform: "TikTok", name: "x", handle: "@maria_shop" })).toBeNull();
    expect(blacklistForComment(new Map(), { platform: "TikTok", name: "x", handle: "@maria_shop" })).toBeNull();
  });
});

describe("the list", () => {
  const rows = [
    row("a1", "tiktok", "maria_shop", "returned", "2026-11-18", "2026-11-18T09:00:00Z"),
    row("a2", "tiktok", "Maria_Shop", "returned", "2026-11-02", "2026-11-02T09:00:00Z"),
    row("a3", "tiktok", "MARIA_SHOP", "not_checked_out", "2026-10-30", "2026-10-30T09:00:00Z"),
    row("b1", "facebook", "Ana Reyes", "not_checked_out", "2026-11-16", "2026-11-16T09:00:00Z"),
    row("c1", "tiktok", "jhun.belle", "returned", "2026-11-12", "2026-11-12T09:00:00Z"),
  ];
  it("one row per buyer, counts per reason, newest buyer first, newest spelling shown", () => {
    const g = groupBlacklist(rows);
    expect(g.map((e) => `${e.platform}:${e.label}:${e.returned}/${e.notCheckedOut}:${e.lastDay}`)).toEqual([
      "tiktok:maria_shop:2/1:2026-11-18", "facebook:Ana Reyes:0/1:2026-11-16", "tiktok:jhun.belle:1/0:2026-11-12",
    ]);
    expect(g[0].rows.map((r) => r.id)).toEqual(["a1", "a2", "a3"]);
  });
  it("search: part of the name, with or without @, any case", () => {
    const g = groupBlacklist(rows);
    expect(filterBlacklist(g, "MARIA").map((e) => e.label)).toEqual(["maria_shop"]);
    expect(filterBlacklist(g, "@jhun").map((e) => e.label)).toEqual(["jhun.belle"]);
    expect(filterBlacklist(g, "zzz")).toEqual([]);
    expect(filterBlacklist(g, "  ")).toHaveLength(3);
  });
  it("database rows: bad shapes are dropped", () => {
    expect(parseBlRows([
      { id: "1", platform: "tiktok", buyer_label: "x", reason: "returned", added_day: "2026-11-18", created_at: "t" },
      { id: "2", platform: "instagram", buyer_label: "x", reason: "returned" }, { id: "3", platform: "tiktok", buyer_label: " ", reason: "returned" },
      { id: 4, platform: "tiktok", buyer_label: "x", reason: "returned" }, { id: "5", platform: "tiktok", buyer_label: "x", reason: "scam" }, null,
    ]).map((r) => r.id)).toEqual(["1"]);
    expect(parseBlRows("nope")).toEqual([]);
  });
  it("chip words: Return first, a reason with 0 left out (English + Filipino)", () => {
    expect(blacklistChipText({ returned: 2, notCheckedOut: 1 }, buildT("en"))).toBe("2× Return · 1× Not checked out");
    expect(blacklistChipText({ returned: 0, notCheckedOut: 3 }, buildT("en"))).toBe("3× Not checked out");
    expect(blacklistChipText({ returned: 1, notCheckedOut: 0 }, buildT("fil"))).toBe("1× Nag-return");
    expect(blacklistCountsText({ returned: 0, notCheckedOut: 0 }, { cnt: () => "x", ret: "r", notOut: "n" })).toBe("");
  });
  it("days are shown as saved (no time zone moves them)", () => {
    expect(formatBlacklistDay("2026-11-18", "en")).toBe("Nov 18");
    expect(formatBlacklistDay("2026-11-18", "en", true)).toBe("Nov 18, 2026");
    expect(formatBlacklistDay("bad", "en")).toBe("—");
  });
});

describe("who sees Blacklist", () => {
  const base = { switchOn: false, isAdmin: false, hasKey: false, adminUnion: false };
  it("Taiwan never — switch on, a tester key, even an admin viewing as Taiwan", () => {
    expect(blacklistVisible({ ...base, country: "TW", switchOn: true })).toBe(false);
    expect(blacklistVisible({ ...base, country: "TW", hasKey: true })).toBe(false);
    expect(blacklistVisible({ ...base, country: "TW", isAdmin: true, switchOn: true, hasKey: true })).toBe(false);
    expect(blacklistVisible({ ...base, country: "tw", switchOn: true })).toBe(false);
  });
  it("switch OFF, not an admin, not a tester → nobody, any country", () => {
    for (const c of ["PH", "AU", "CA", "MY", "US", "BG", null, ""]) expect(blacklistVisible({ ...base, country: c })).toBe(false);
  });
  it("switch ON → every seller outside Taiwan (all plans: no plan input at all)", () => {
    for (const c of ["PH", "AU", "CA", "MY", "US", "BG", "KR"]) expect(blacklistVisible({ ...base, country: c, switchOn: true })).toBe(true);
  });
  it("before the switch: an admin or a tester login outside Taiwan", () => {
    expect(blacklistVisible({ ...base, country: "PH", hasKey: true })).toBe(true);
    expect(blacklistVisible({ ...base, country: "PH", isAdmin: true })).toBe(true);
    expect(blacklistVisible({ ...base, country: "TW", isAdmin: true, adminUnion: true })).toBe(true); // admin "all markets" view
  });
});

describe("the NEW badge", () => {
  beforeEach(() => localStorage.clear());
  it("until the seller opens Blacklist once on this phone", () => {
    expect(blacklistSeen()).toBe(false);
    markBlacklistSeen();
    expect(blacklistSeen()).toBe(true);
    expect(localStorage.getItem(BL_SEEN_KEY)).toBe("1");
  });
});
