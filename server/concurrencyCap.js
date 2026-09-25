// PER-SELLER CONCURRENCY CAP (kick-oldest) — the paid differentiator enforced
// server-side: a seller may have at most maxAccountsForPlan(plan) CONCURRENT TikTok
// LIVE connections (Basic 1 / Plus 2 / Pro 3 / Master 5). PURE + unit-tested; the
// impure map iteration + teardown live in server.js (same convention as
// connectionHealth.js / accountCap.js / sanitize.js — server.js has no vitest harness).
//
// ⚠️ SCOPE: this ONLY governs going LIVE (connectTikTok's NEW-key branch). It counts
// entries from `tiktokConnections` (TikTok live connections) ONLY — Facebook markers
// (facebookConnections) and Shopee (its own runtime) are NOT counted here. Parcel Scan
// / encode never opens a live connection, so it is never counted and never blocked.
//
// ⚠️ NEVER FALSE-BLOCK: unknown plan → NO cap (a DB-read hiccup must not cap a paying
// seller); admin → NO cap; and only FRESH connections (an event within
// CONNECT_REUSE_FRESH_MS) count, so a crashed device self-clears from the count in ≤60s
// (its server connection stops emitting events → goes stale → excluded → no lockout).
import { CONNECT_REUSE_FRESH_MS } from "./connectionHealth.js";
import { maxAccountsForPlan } from "./accountCap.js";

// A connection counts toward concurrency only while it is demonstrably alive: an event
// (chat/roomUser/like/… — LIVENESS_EVENTS) within the reuse-freshness window. Mirrors
// shouldForceFreshConnect's definition so "counts" == "would be reused as alive".
export function isFreshEntry(lastEventAt, nowMs) {
  const last = Number(lastEventAt) || 0;
  return last > 0 && (nowMs - last) < CONNECT_REUSE_FRESH_MS;
}

// The concurrency cap for this seller. null = NO cap:
//   • admin  → unlimited (owner tests multiple accounts) — mirrors accountCapVerdict.
//   • unknown/empty plan → fail-open (checkPlanActive fail-opened on a DB error and
//     attached no plan → H2: capped at 1 (Basic-level), not unlimited — see below.
export function concurrencyCap(plan, role) {
  if (String(role == null ? "" : role).trim().toLowerCase() === "admin") return null;
  const p = String(plan == null ? "" : plan).trim().toLowerCase();
  // H2 (security audit 2026-09-26) — an unknown/empty plan is capped at the MOST
  // RESTRICTIVE tier (maxAccountsForPlan("") = 1), never unlimited. Since the plan
  // check now hard-denies missing profiles, an empty plan here can only mean the
  // genuine-DB-error fail-open upstream: a paying seller in an outage still gets
  // ONE live (Basic-level) instead of a lockout — and nothing ever gets unlimited.
  return maxAccountsForPlan(p);
}

// The seller's FRESH TikTok live keys, excluding `excludeKey` (the account being
// connected — never counted or kicked against itself). Sorted OLDEST-first by
// startedAt (tie-break by key for determinism) so kick-oldest is well-defined.
// entries: [{ key, sellerId, startedAt, lastEventAt }] (from tiktokConnections).
export function freshLiveKeysForSeller(entries, sellerId, nowMs, excludeKey) {
  const sid = String(sellerId || "");
  return (entries || [])
    .filter((e) => e && String(e.sellerId || "") === sid && e.key !== excludeKey && isFreshEntry(e.lastEventAt, nowMs))
    .sort((a, b) => ((Number(a.startedAt) || 0) - (Number(b.startedAt) || 0)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Decide for a NEW-key live connect.
//   realFresh     = the seller's fresh live keys (kickable), oldest-first (above).
//   reservedCount = OTHER in-flight new connects for this seller (TOCTOU guard; NOT
//                   kickable — they hold no teardownable connection yet).
//   max           = concurrencyCap(...) (null → always allow).
// Returns:
//   { action: "allow", keys: [] }         — under cap, just connect.
//   { action: "kick",  keys: [oldest…] }  — at/over cap: tear these down, then connect
//                                            the new one → net concurrency == max.
//   { action: "block", keys: [] }         — cap would be exceeded but the only things
//                                            occupying slots are sibling RESERVATIONS
//                                            (a pure parallel race) → reject this one.
export function capDecision({ realFresh = [], reservedCount = 0, max } = {}) {
  if (max === null || max === undefined) return { action: "allow", keys: [] };
  const removeN = (realFresh.length + reservedCount) - (max - 1); // make room so the new one fits at exactly `max`
  if (removeN <= 0) return { action: "allow", keys: [] };
  // Defensive oldest-first sort (kick-oldest ends a real live → never trust caller order).
  const sorted = realFresh.slice().sort((a, b) => ((Number(a.startedAt) || 0) - (Number(b.startedAt) || 0)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const keys = sorted.slice(0, removeN).map((e) => e.key);
  if (keys.length < removeN) return { action: "block", keys: [] }; // only reservations left to displace → race
  return { action: "kick", keys };
}
