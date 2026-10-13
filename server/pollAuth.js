// M5 (security audit 2026-09-26) — shared-secret hygiene for the cron-triggered
// /admin/parcel-tracking-poll endpoint. PURE-ish module (only node:crypto), imported
// by server.js AND unit-tested by vitest (server.js has no test harness; same
// convention as server/connectionHealth.js / sanitize.js / accountCap.js).
//
// THE HOLES (audit M5): the secret was accepted in ?token= (query strings land in
// Render/cron/proxy logs), compared with !== (not timing-safe), and wrong guesses
// were never throttled. server.js now reads the X-Poll-Token HEADER only and gates
// through these two helpers.
import { createHash, timingSafeEqual } from "node:crypto";

// Constant-time token comparison. SHA-256 both sides first so the buffers are
// always equal-length (timingSafeEqual throws on length mismatch, and a direct
// length check would leak the secret's length). Empty/missing input never matches.
export function timingSafeTokenEqual(candidate, secret) {
  const c = String(candidate || "");
  const s = String(secret || "");
  if (!c || !s) return false;
  const a = createHash("sha256").update(c).digest();
  const b = createHash("sha256").update(s).digest();
  return timingSafeEqual(a, b);
}

// Global failed-attempt throttle (each route has exactly ONE legitimate caller — the
// cron-job.org job — so one counter per route; no per-IP map to grow). After `max`
// failures inside `windowMs` the route is "locked" for WRONG tokens only: the correct
// token is compared FIRST and always passes (audit Oct 14 — 5 junk requests used to
// lock the real cron out for 15 minutes). Use it through checkPollToken below.
//   blocked(now) → true while locked
//   fail(now)    → record a bad token
//   ok()         → clear (successful auth)
export function makeFailureThrottle({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  let failures = [];
  return {
    blocked(now = Date.now()) {
      failures = failures.filter((t) => now - t < windowMs);
      return failures.length >= max;
    },
    fail(now = Date.now()) {
      failures.push(now);
    },
    ok() {
      failures = [];
    },
  };
}

// The one gate every token-protected route uses (audit Oct 14):
//   1. compare FIRST (constant time): the correct token → "ok" and the counter clears;
//   2. a wrong token while locked → "locked" (respond 429);
//   3. a wrong token otherwise → "bad" (respond 403), counted; the request that starts a
//      lockout logs ONE line (label only — never a token value).
export function checkPollToken(throttle, candidate, secret, { label = "POLL-AUTH", now = Date.now(), log = console.log } = {}) {
  if (timingSafeTokenEqual(candidate, secret)) { throttle.ok(); return "ok"; }
  if (throttle.blocked(now)) return "locked";
  throttle.fail(now);
  if (throttle.blocked(now)) log(`[${label}] locked out wrong tokens after repeated bad attempts (the correct token still passes)`);
  return "bad";
}
