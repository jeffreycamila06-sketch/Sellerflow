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

// Global failed-attempt throttle (this endpoint has exactly ONE legitimate caller
// — the cron-job.org job — so a global lockout is the right scope; no per-IP map
// to grow). After `max` failures inside `windowMs`, EVERY attempt is refused until
// the window ends. A successful auth clears the counter.
//   blocked(now) → true while locked out (caller responds 429 without comparing)
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
