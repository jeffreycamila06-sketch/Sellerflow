// Per-seller concurrency cap (kick-oldest) — PURE behavioral tests against the REAL
// server module. Every scenario from the spec: Basic 2nd live kicks the 1st, the
// single-device A→B switch works, admin unlimited, unknown-plan no-cap, TOCTOU parallel
// connects capped, Pro allows 3 / kicks on the 4th, crashed device self-clears (fresh gate).
import { describe, it, expect } from "vitest";
import { concurrencyCap, freshLiveKeysForSeller, capDecision, isFreshEntry } from "../../../../server/concurrencyCap.js";
import { CONNECT_REUSE_FRESH_MS } from "../../../../server/connectionHealth.js";

const NOW = 1_000_000_000_000;
const entry = (key: string, sellerId: string, startedAt: number, ageMs = 0) => ({ key, sellerId, startedAt, lastEventAt: NOW - ageMs });

describe("concurrencyCap — the per-plan ceiling (null = no cap)", () => {
  it("admin → null (unlimited), regardless of plan", () => {
    expect(concurrencyCap("basic", "admin")).toBeNull();
    expect(concurrencyCap("master", "Admin")).toBeNull();
  });
  it("unknown / empty plan → null (fail-open — never false-block a paid seller on a DB hiccup)", () => {
    for (const p of ["", null, undefined, "   "]) expect(concurrencyCap(p as unknown as string, "seller")).toBeNull();
  });
  it("known plans → their cap (case-insensitive)", () => {
    expect(concurrencyCap("basic", "seller")).toBe(1);
    expect(concurrencyCap("plus", "seller")).toBe(2);
    expect(concurrencyCap("pro", "seller")).toBe(3);
    expect(concurrencyCap("MASTER", "seller")).toBe(5);
    expect(concurrencyCap("weird", "seller")).toBe(1); // unknown-but-present → maxAccountsForPlan default 1
  });
});

describe("isFreshEntry — crashed device self-clears in ≤60s", () => {
  it("event within the reuse window = fresh; older = stale; never-evented = stale", () => {
    expect(isFreshEntry(NOW - 1000, NOW)).toBe(true);
    expect(isFreshEntry(NOW - (CONNECT_REUSE_FRESH_MS + 1), NOW)).toBe(false);
    expect(isFreshEntry(0, NOW)).toBe(false);
  });
});

describe("freshLiveKeysForSeller — scope + exclusions + oldest-first", () => {
  const entries = [
    entry("s1:TikTok:a", "s1", 100),               // fresh
    entry("s1:TikTok:b", "s1", 50),                // fresh, OLDER
    entry("s1:TikTok:stale", "s1", 10, CONNECT_REUSE_FRESH_MS + 5000), // stale → excluded
    entry("s2:TikTok:x", "s2", 20),                // other seller → excluded
  ];
  it("returns only THIS seller's FRESH keys, excluding the incoming key, oldest-first", () => {
    const out = freshLiveKeysForSeller(entries, "s1", NOW, "s1:TikTok:incoming");
    expect(out.map((e) => e.key)).toEqual(["s1:TikTok:b", "s1:TikTok:a"]); // b(50) before a(100)
  });
  it("excludes the incoming key itself (a force-fresh/reconnect never counts against itself)", () => {
    const out = freshLiveKeysForSeller(entries, "s1", NOW, "s1:TikTok:a");
    expect(out.map((e) => e.key)).toEqual(["s1:TikTok:b"]);
  });
});

describe("capDecision — allow / kick-oldest / block", () => {
  const k = (key: string, startedAt: number) => ({ key, startedAt });
  it("BASIC (max 1): 0 others → allow; 1 other → KICK the oldest (2nd live kicks the 1st / single-device A→B switch)", () => {
    expect(capDecision({ realFresh: [], reservedCount: 0, max: 1 })).toEqual({ action: "allow", keys: [] });
    expect(capDecision({ realFresh: [k("A", 100)], reservedCount: 0, max: 1 })).toEqual({ action: "kick", keys: ["A"] });
  });
  it("PRO (max 3): allows the 3rd (2 others) → kicks oldest on the 4th (3 others)", () => {
    expect(capDecision({ realFresh: [k("A", 1), k("B", 2)], max: 3 })).toEqual({ action: "allow", keys: [] });
    expect(capDecision({ realFresh: [k("A", 3), k("B", 1), k("C", 2)], max: 3 })).toEqual({ action: "kick", keys: ["B"] }); // oldest=B(1)
  });
  it("max=null (admin / unknown plan) → always allow, never kicks", () => {
    expect(capDecision({ realFresh: [k("A", 1), k("B", 2), k("C", 3)], max: null })).toEqual({ action: "allow", keys: [] });
  });
  it("TOCTOU: only a sibling RESERVATION occupies the slot (no real conn to kick) → BLOCK", () => {
    expect(capDecision({ realFresh: [], reservedCount: 1, max: 1 })).toEqual({ action: "block", keys: [] });
  });
  it("over-cap (a race left more than max) → kicks enough oldest to land at exactly max", () => {
    // Pro max 3, 4 fresh reals → remove 4-(3-1)=2 oldest.
    expect(capDecision({ realFresh: [k("A", 4), k("B", 1), k("C", 2), k("D", 3)], max: 3 }))
      .toEqual({ action: "kick", keys: ["B", "C"] }); // oldest two: B(1), C(2)
  });
});
