import { describe, it, expect } from "vitest";
import {
  parseCreateMs,
  riskFor,
  buildMinerRiskMap,
  minerRiskFor,
  minerRiskKey,
  RISK_AGE_DAYS,
  type RiskLevel,
} from "../minerRisk";
import type { Comment } from "../data";

const DAY = 86400000;
// Fixed "now" so age math is deterministic.
const NOW = 1_700_000_000_000; // ms
const daysAgoMs = (d: number) => NOW - d * DAY;
const daysAgoSec = (d: number) => Math.round(daysAgoMs(d) / 1000);

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

describe("parseCreateMs — unit handling", () => {
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
    expect(parseCreateMs(0)).toBeNull();
    expect(parseCreateMs(-5)).toBeNull();
    expect(parseCreateMs(NaN)).toBeNull();
    expect(parseCreateMs(1e16)).toBeNull(); // micro/nano — refuse to guess
  });
});

describe("riskFor — badge logic", () => {
  it("🔴 risky: new (<7d) AND zero followers", () => {
    expect(riskFor({ followerCount: 0, accountCreatedAt: daysAgoSec(2) }, NOW)).toBe("risky");
  });
  it("🟡 watch: new only (has followers)", () => {
    expect(riskFor({ followerCount: 42, accountCreatedAt: daysAgoSec(2) }, NOW)).toBe("watch");
  });
  it("🟡 watch: zero followers only (established account)", () => {
    expect(riskFor({ followerCount: 0, accountCreatedAt: daysAgoSec(400) }, NOW)).toBe("watch");
  });
  it("no badge (null): established AND has followers", () => {
    expect(riskFor({ followerCount: 500, accountCreatedAt: daysAgoSec(400) }, NOW)).toBeNull();
  });
  it("boundary: exactly 7d old is NOT new (established side)", () => {
    // age === RISK_AGE_DAYS → not < threshold → not new. With followers → no badge.
    expect(riskFor({ followerCount: 10, accountCreatedAt: daysAgoSec(RISK_AGE_DAYS) }, NOW)).toBeNull();
    // just under 7d → new → watch
    const justUnder = Math.round(daysAgoMs(RISK_AGE_DAYS) / 1000) + 60; // 1 min newer
    expect(riskFor({ followerCount: 10, accountCreatedAt: justUnder }, NOW)).toBe("watch");
  });
  it("⚪ unknown when followerCount missing — and NEVER risky", () => {
    expect(riskFor({ accountCreatedAt: daysAgoSec(1) }, NOW)).toBe("unknown");
    // even brand-new account with no follower data is unknown, not risky
    expect(riskFor({ accountCreatedAt: daysAgoSec(0.01) }, NOW)).not.toBe("risky");
  });
  it("⚪ unknown when createTime missing — and NEVER risky", () => {
    expect(riskFor({ followerCount: 0 }, NOW)).toBe("unknown");
    expect(riskFor({ followerCount: 0 }, NOW)).not.toBe("risky");
  });
  it("⚪ unknown when both missing", () => {
    expect(riskFor({}, NOW)).toBe("unknown");
  });
  it("⚪ unknown when createTime unparseable (0/garbage) — never risky", () => {
    expect(riskFor({ followerCount: 0, accountCreatedAt: 0 }, NOW)).toBe("unknown");
    expect(riskFor({ followerCount: 0, accountCreatedAt: "junk" }, NOW)).toBe("unknown");
  });
  it("treats non-finite / NaN followerCount as missing → unknown", () => {
    expect(riskFor({ followerCount: NaN, accountCreatedAt: daysAgoSec(1) }, NOW)).toBe("unknown");
  });

  // followerCount arrives from the connector as a numeric STRING (protobuf int64
  // → .toString()). The coercion must accept it exactly like a number.
  it("accepts a numeric STRING followerCount (the real wire shape)", () => {
    expect(riskFor({ followerCount: "0", accountCreatedAt: daysAgoSec(2) }, NOW)).toBe("risky");
    expect(riskFor({ followerCount: "59", accountCreatedAt: daysAgoSec(2) }, NOW)).toBe("watch");
    expect(riskFor({ followerCount: "0", accountCreatedAt: daysAgoSec(400) }, NOW)).toBe("watch");
    expect(riskFor({ followerCount: "500", accountCreatedAt: daysAgoSec(400) }, NOW)).toBeNull();
  });
  it("empty-string / non-numeric followerCount → unknown (never risky)", () => {
    expect(riskFor({ followerCount: "", accountCreatedAt: daysAgoSec(1) }, NOW)).toBe("unknown");
    expect(riskFor({ followerCount: "abc", accountCreatedAt: daysAgoSec(1) }, NOW)).toBe("unknown");
    expect(riskFor({ followerCount: "", accountCreatedAt: daysAgoSec(1) }, NOW)).not.toBe("risky");
  });
  it("string createTime + string followerCount together resolve correctly", () => {
    // both as the real wire strings: new account ("<7d") + "0" followers → risky
    expect(riskFor({ followerCount: "0", accountCreatedAt: String(daysAgoSec(3)) }, NOW)).toBe("risky");
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
    const safe = { followerCount: 900, accountCreatedAt: daysAgoSec(500) };
    const comments = [
      mk({ id: "1", handle: "@a" }),                         // no data
      mk({ id: "2", handle: "@a", ...safe }),                // resolves safe
      mk({ id: "3", handle: "@a" }),                         // no data
    ];
    const map = buildMinerRiskMap(comments, NOW);
    expect(map.has("a TikTok")).toBe(false); // safe → no badge
  });

  it("locks risky/watch once resolved (later blank comments don't override)", () => {
    const comments = [
      mk({ id: "1", handle: "@b", followerCount: 0, accountCreatedAt: daysAgoSec(1) }), // risky
      mk({ id: "2", handle: "@b" }),                                                    // blank
    ];
    const map = buildMinerRiskMap(comments, NOW);
    expect(map.get("b TikTok")).toBe("risky");
  });

  it("miner whose comments NEVER carried data → unknown (never risky)", () => {
    const comments = [mk({ id: "1", handle: "@c" }), mk({ id: "2", handle: "@c" })];
    const map = buildMinerRiskMap(comments, NOW);
    expect(map.get("c TikTok")).toBe("unknown");
  });

  it("keeps different miners / platforms distinct", () => {
    const comments = [
      mk({ id: "1", handle: "@x", platform: "TikTok", followerCount: 0, accountCreatedAt: daysAgoSec(1) }),
      mk({ id: "2", handle: "@x", platform: "Facebook" }), // different platform → separate miner
      mk({ id: "3", handle: "@y", followerCount: 5, accountCreatedAt: daysAgoSec(1) }), // watch
    ];
    const map = buildMinerRiskMap(comments, NOW);
    expect(map.get("x TikTok")).toBe("risky");
    expect(map.get("x Facebook")).toBe("unknown");
    expect(map.get("y TikTok")).toBe("watch");
  });

  it("empty feed → empty map", () => {
    expect(buildMinerRiskMap([], NOW).size).toBe(0);
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
