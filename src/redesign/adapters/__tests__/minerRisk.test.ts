import { describe, it, expect } from "vitest";
import {
  parseCreateMs,
  riskFor,
  buildMinerRiskMap,
  minerRiskFor,
  minerRiskKey,
  RISK_WATCH_MAX,
  type RiskLevel,
} from "../minerRisk";
import type { Comment } from "../data";

// Minimal Comment factory — only the risk-relevant fields matter here.
const mk = (over: Partial<Comment>): Comment =>
  ({
    id: over.id ?? "c1",
    name: over.name ?? "Buyer",
    handle: over.handle ?? "@buyer",
    text: over.text ?? "mine",
    platform: over.platform ?? "TikTok",
    ...over,
  }) as Comment;

// parseCreateMs is RESERVED (createTime is "0" in production today) but kept in the
// pipeline for a future age re-add — its unit behavior is still pinned.
describe("parseCreateMs — unit handling (reserved)", () => {
  it("treats 10-digit epoch as SECONDS → ms", () => {
    expect(parseCreateMs(1_700_000_000)).toBe(1_700_000_000_000);
  });
  it("treats 13-digit epoch as already MS", () => {
    expect(parseCreateMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
  it("accepts numeric strings", () => {
    expect(parseCreateMs("1700000000")).toBe(1_700_000_000_000);
    expect(parseCreateMs("1700000000000")).toBe(1_700_000_000_000);
  });
  it("returns null for missing / empty / garbage / non-positive / out-of-range", () => {
    expect(parseCreateMs(undefined)).toBeNull();
    expect(parseCreateMs(null)).toBeNull();
    expect(parseCreateMs("")).toBeNull();
    expect(parseCreateMs("abc")).toBeNull();
    expect(parseCreateMs(0)).toBeNull();      // the production value → null (age unknown)
    expect(parseCreateMs("0")).toBeNull();    // string "0" (connector's absent default)
    expect(parseCreateMs(-5)).toBeNull();
    expect(parseCreateMs(NaN)).toBeNull();
    expect(parseCreateMs(1e16)).toBeNull();   // micro/nano — refuse to guess
  });
});

// FOLLOWER-ONLY logic (createTime always "0"/absent → age can't gate):
//   0 → risky · 1..RISK_WATCH_MAX → watch · >RISK_WATCH_MAX → no badge ·
//   missing/non-numeric → unknown (NEVER risky).
describe("riskFor — follower-only thresholds", () => {
  it("🔴 risky: exactly 0 followers", () => {
    expect(riskFor({ followerCount: 0 })).toBe("risky");
  });
  it("🟡 watch: 1 follower (low boundary)", () => {
    expect(riskFor({ followerCount: 1 })).toBe("watch");
  });
  it(`🟡 watch: ${RISK_WATCH_MAX} followers (high boundary, inclusive)`, () => {
    expect(riskFor({ followerCount: RISK_WATCH_MAX })).toBe("watch");
  });
  it(`no badge: ${RISK_WATCH_MAX + 1} followers (just over → established)`, () => {
    expect(riskFor({ followerCount: RISK_WATCH_MAX + 1 })).toBeNull();
  });
  it("no badge: large follower counts (real live values)", () => {
    for (const n of [23, 58, 266, 845, 1555]) expect(riskFor({ followerCount: n })).toBeNull();
  });
  it("⚪ unknown: followerCount missing/undefined — NEVER risky (missing ≠ 0)", () => {
    expect(riskFor({})).toBe("unknown");
    expect(riskFor({ followerCount: undefined })).toBe("unknown");
    expect(riskFor({})).not.toBe("risky");
  });
  it("⚪ unknown: empty-string / non-numeric followerCount → unknown (never risky)", () => {
    expect(riskFor({ followerCount: "" })).toBe("unknown");
    expect(riskFor({ followerCount: "abc" })).toBe("unknown");
    expect(riskFor({ followerCount: NaN })).toBe("unknown");
    expect(riskFor({ followerCount: "" })).not.toBe("risky");
  });

  // The real wire shape: followerCount is a numeric STRING; createTime is "0".
  it("accepts numeric-STRING followerCount (the real wire shape)", () => {
    expect(riskFor({ followerCount: "0" })).toBe("risky");
    expect(riskFor({ followerCount: "1" })).toBe("watch");
    expect(riskFor({ followerCount: "20" })).toBe("watch");
    expect(riskFor({ followerCount: "21" })).toBeNull();
    expect(riskFor({ followerCount: "845" })).toBeNull();
  });
  it("createTime = 0 does NOT block a verdict (the whole point of this change)", () => {
    // Production shape: real follower string + createTime "0". Age is ignored;
    // 0 followers still fires 🔴 (previously forced ⚪ by the null createTime).
    expect(riskFor({ followerCount: "0", accountCreatedAt: "0" })).toBe("risky");
    expect(riskFor({ followerCount: "5", accountCreatedAt: 0 })).toBe("watch");
    expect(riskFor({ followerCount: "845", accountCreatedAt: "0" })).toBeNull();
  });
});

describe("minerRiskKey", () => {
  it("strips leading @ and trims; defaults platform to TikTok", () => {
    expect(minerRiskKey("@maria", "TikTok")).toBe("maria TikTok");
    expect(minerRiskKey("maria", undefined)).toBe("maria TikTok");
    expect(minerRiskKey("@@maria ", "Facebook")).toBe("maria Facebook");
  });
});

describe("buildMinerRiskMap — per-miner aggregation", () => {
  it("resolves a miner from the FIRST data-carrying comment; safe miner omitted", () => {
    const comments = [
      mk({ id: "1", handle: "@a" }),                       // no data
      mk({ id: "2", handle: "@a", followerCount: "900" }), // resolves safe (>20)
      mk({ id: "3", handle: "@a" }),                       // no data
    ];
    const map = buildMinerRiskMap(comments);
    expect(map.has("a TikTok")).toBe(false); // safe → no badge
  });

  it("locks risky/watch once resolved (later blank comments don't override)", () => {
    const comments = [
      mk({ id: "1", handle: "@b", followerCount: "0" }), // risky
      mk({ id: "2", handle: "@b" }),                     // blank
    ];
    const map = buildMinerRiskMap(comments);
    expect(map.get("b TikTok")).toBe("risky");
  });

  it("miner whose comments NEVER carried data → unknown (never risky)", () => {
    const comments = [mk({ id: "1", handle: "@c" }), mk({ id: "2", handle: "@c" })];
    const map = buildMinerRiskMap(comments);
    expect(map.get("c TikTok")).toBe("unknown");
  });

  it("keeps different miners / platforms distinct", () => {
    const comments = [
      mk({ id: "1", handle: "@x", platform: "TikTok", followerCount: "0" }),
      mk({ id: "2", handle: "@x", platform: "Facebook" }),   // different platform → separate miner
      mk({ id: "3", handle: "@y", followerCount: "5" }),     // watch
    ];
    const map = buildMinerRiskMap(comments);
    expect(map.get("x TikTok")).toBe("risky");
    expect(map.get("x Facebook")).toBe("unknown");
    expect(map.get("y TikTok")).toBe("watch");
  });

  it("empty feed → empty map", () => {
    expect(buildMinerRiskMap([]).size).toBe(0);
  });
});

describe("minerRiskFor — row lookup", () => {
  it("looks up by display handle (@-tolerant) + platform", () => {
    const map = new Map<string, RiskLevel>([["maria TikTok", "watch"]]);
    expect(minerRiskFor(map, "@maria", "TikTok")).toBe("watch");
    expect(minerRiskFor(map, "maria", "TikTok")).toBe("watch");
  });
  it("returns null for unknown miner or undefined map", () => {
    const map = new Map<string, RiskLevel>([["maria TikTok", "watch"]]);
    expect(minerRiskFor(map, "@bob", "TikTok")).toBeNull();
    expect(minerRiskFor(undefined, "@maria", "TikTok")).toBeNull();
  });
});
