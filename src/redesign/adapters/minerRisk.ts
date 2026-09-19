// Real-time MINER RISK badge — flags suspicious commenters/miners while the seller
// is live, so she can avoid mining bogus / joy-joy accounts. Uses ONLY signals
// already on the TikTok comment event (relayed off-data by the server — NO profile
// fetch, which carries ban risk). Pure + display-only: computes a badge level per
// miner; the feed rows / order path are untouched.
//
// ⚠️ FOLLOWER-ONLY (2026-09): a production [RISK-DBG] capture proved TikTok sends a
// reliable followInfo.followerCount on every comment (as a numeric STRING), but
// userDetails.createTime is ALWAYS "0"/absent — so ACCOUNT AGE can never be known
// and cannot gate the badge. The verdict is therefore driven by follower count
// alone. createTime is still PARSED + relayed + on the data model (parseCreateMs
// below) as a RESERVED bonus signal — if TikTok ever starts sending a real value,
// age can be re-added here without touching the pipeline.
//
// ⚠️ MISSING DATA: followInfo is still CONDITIONAL per event. A comment with NO
// followerCount → "unknown" (⚪), NEVER "risky". Missing is NOT zero — a real buyer
// whose comment simply carried no followInfo must never be flagged red.
import type { Comment } from "../data";

export type RiskLevel = "risky" | "watch" | "unknown";

// Follower thresholds (createTime/age is absent, see header):
//   🔴 risky : followerCount === 0        (bogus/joy-joy accounts have zero)
//   🟡 watch : 1 .. RISK_WATCH_MAX        (low follower count — take care)
//   no badge : > RISK_WATCH_MAX           (established — keep the feed clean)
export const RISK_WATCH_MAX = 20;

// TikTok account createTime is an epoch string — seconds (10-digit) or, rarely,
// milliseconds (13-digit). Returns ms, or null when missing/unparseable. RESERVED:
// createTime is "0" in production today (→ null), so this feeds no live logic — it
// is kept for the pipeline + a future age re-add (see header).
export function parseCreateMs(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e12) return Math.round(n * 1000); // seconds → ms
  if (n < 1e15) return Math.round(n);        // already ms
  return null;                               // micro/nano / garbage — refuse to guess
}

// Per-miner badge from a single comment's signals — FOLLOWER-ONLY. null = NO badge
// (established account — keep the feed clean). unknown = followerCount absent.
//   🔴 risky : followerCount === 0
//   🟡 watch : 1 .. RISK_WATCH_MAX (inclusive)
//   ⚪ unknown: followerCount missing/undefined/non-numeric — NEVER risky (≠ 0)
// No clock/age param today (createTime is absent). If age ever returns, re-add a
// nowMs arg + parseCreateMs(signals.accountCreatedAt) to refine the >20 case.
export function riskFor(
  signals: { followerCount?: number | string; accountCreatedAt?: string | number },
): RiskLevel | null {
  // followerCount arrives from the TikTok connector as a numeric STRING ("0",
  // "845"…) — the protobuf int64 decoder emits `.toString()` (tiktok-schema
  // User_FollowInfo). Coerce: finite + non-empty + non-null → the number, else
  // null (→ unknown, NEVER risky — missing is not zero).
  const rawFc = signals.followerCount;
  const nFc = rawFc == null || rawFc === "" ? NaN : Number(rawFc);
  const fc = Number.isFinite(nFc) ? nFc : null;
  if (fc === null) return "unknown";          // followInfo/followerCount absent
  if (fc <= 0) return "risky";                // 0 followers = bogus/joy-joy
  if (fc <= RISK_WATCH_MAX) return "watch";   // 1..20 = low, take care
  return null;                                // > 20 = established → no badge
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
export function buildMinerRiskMap(comments: Comment[]): Map<string, RiskLevel> {
  const resolved = new Map<string, RiskLevel | null>(); // null = resolved-safe (no badge)
  const seen = new Set<string>();
  for (const c of comments) {
    const key = minerRiskKey(c.handle, c.platform);
    seen.add(key);
    if (resolved.has(key)) continue;                      // already resolved from real data
    const r = riskFor(c);
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
