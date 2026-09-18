// Real-time MINER RISK badge — flags suspicious commenters/miners while the seller
// is live, so she can avoid mining bogus / joy-joy accounts. Uses ONLY signals
// already on the TikTok comment event (followerCount + account createTime, relayed
// off-data by the server — NO profile fetch, which carries ban risk). Pure +
// display-only: computes a badge level per miner; the feed rows / order path are
// untouched.
//
// ⚠️ MISSING DATA IS COMMON: TikTok's followInfo/userDetails are CONDITIONAL on the
// event, so followerCount/createTime are often absent. Missing data → "unknown"
// (⚪) — NEVER "risky". A real buyer who simply had no followInfo on their comment
// must never be flagged red.
import type { Comment } from "../data";

export type RiskLevel = "risky" | "watch" | "unknown";

export const RISK_AGE_DAYS = 7;               // account younger than this = "new"
const MS_PER_DAY = 86400000;

// TikTok account createTime is an epoch string — seconds (10-digit) or, rarely,
// milliseconds (13-digit). Returns ms, or null when missing/unparseable (→ unknown).
export function parseCreateMs(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e12) return Math.round(n * 1000); // seconds → ms
  if (n < 1e15) return Math.round(n);        // already ms
  return null;                               // micro/nano / garbage — refuse to guess
}

// Per-miner badge from a single comment's signals. null = NO badge (established
// account WITH followers — keep the feed clean). unknown = we couldn't verify.
//   🔴 risky : age < 7d AND followerCount === 0
//   🟡 watch : EXACTLY ONE of {age < 7d, followerCount === 0}
//   ⚪ unknown: followerCount or createTime missing/undefined
export function riskFor(
  signals: { followerCount?: number | string; accountCreatedAt?: string | number },
  nowMs: number,
): RiskLevel | null {
  // followerCount arrives from the TikTok connector as a numeric STRING ("0",
  // "59"…) — the protobuf int64 decoder emits `.toString()` (tiktok-schema
  // User_FollowInfo). Coerce: finite + non-empty + non-null → the number, else
  // null (→ unknown, never risky). accountCreatedAt is likewise a numeric string
  // and is handled by parseCreateMs (Number(v)).
  const rawFc = signals.followerCount;
  const nFc = rawFc == null || rawFc === "" ? NaN : Number(rawFc);
  const fc = Number.isFinite(nFc) ? nFc : null;
  const createMs = parseCreateMs(signals.accountCreatedAt);
  if (fc === null || createMs === null) return "unknown"; // missing data — NEVER risky
  const isNew = (nowMs - createMs) / MS_PER_DAY < RISK_AGE_DAYS;
  const noFollowers = fc === 0;
  if (isNew && noFollowers) return "risky";
  if (isNew || noFollowers) return "watch";
  return null;                                            // established + followers → no badge
}

// Identity key = handle+platform, mirroring the basket-count/session-rebuild key
// (handle raw, no @). One miner shows the SAME badge on every row of theirs.
export const minerRiskKey = (handle: string, platform: string | undefined): string =>
  `${String(handle || "").replace(/^@+/, "").trim()} ${platform || "TikTok"}`;

// Build a per-miner risk map over the visible comments. Aggregates by miner:
// the FIRST comment that carries real data (followInfo present) resolves the miner
// — account values are stable, so later comments can't disagree. A miner whose
// data resolves to "safe" (established + followers) is OMITTED (no badge). A miner
// whose comments NEVER carried the data → "unknown". Pure; O(n) once per feed
// change (caller memoizes), O(1) lookup per row.
export function buildMinerRiskMap(comments: Comment[], nowMs: number): Map<string, RiskLevel> {
  const resolved = new Map<string, RiskLevel | null>(); // null = resolved-safe (no badge)
  const seen = new Set<string>();
  for (const c of comments) {
    const key = minerRiskKey(c.handle, c.platform);
    seen.add(key);
    if (resolved.has(key)) continue;                      // already resolved from real data
    const r = riskFor(c, nowMs);
    if (r !== "unknown") resolved.set(key, r);            // got real data → lock (risky/watch/null-safe)
    // r === "unknown" → leave unresolved; a later comment may carry followInfo
  }
  const out = new Map<string, RiskLevel>();
  for (const key of seen) {
    if (resolved.has(key)) {
      const r = resolved.get(key);
      if (r) out.set(key, r);                             // risky / watch (null-safe omitted → clean feed)
    } else {
      out.set(key, "unknown");                            // never carried the data
    }
  }
  return out;
}

// Row lookup — display handle ("@maria") → the miner's badge level, or null (no badge).
export function minerRiskFor(map: Map<string, RiskLevel> | undefined, displayHandle: string, platform: string | undefined): RiskLevel | null {
  if (!map) return null;
  return map.get(minerRiskKey(displayHandle, platform)) ?? null;
}
