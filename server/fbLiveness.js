// #2 FB LIVENESS (STOPGAP) - shared, PURE clock-based liveness for the Facebook
// status pill, imported by server.js AND unit-tested by vitest (server.js has no
// harness; same convention as sanitize.js / accountCap.js).
//
// ⚠️ FB IS NON-FUNCTIONAL SERVER-SIDE: there is NO Facebook comment listener,
// streamEnd, or health path anywhere in server.js - the facebookConnections entry
// is a status-only marker and no FB comments flow through the server. So FB
// liveness CANNOT be verified from events (unlike TikTok, which gates on
// lastEventAt). The green pill promises capture the server never performs;
// making FB actually work (or hiding it in the UI) is a SEPARATE product decision.
//
// This STOPGAP only makes the pill honest + stops the Map leak: since liveness is
// unverifiable, treat "connected" as a TIME-BOXED assertion - green for up to
// FB_CONNECTED_TTL_MS after the seller taps Connect, then HONEST GRAY. A re-tap
// refreshes the window. On the gray transition the join snapshot prunes the entry
// (bounds facebookConnections, which was never deleted → grew until a restart).
export const FB_CONNECTED_TTL_MS = 6 * 60 * 60 * 1000; // 6h — longer than a realistic FB live; rarely false-grays

// PURE: is a FB entry still within its time-boxed "connected" window? A missing /
// non-finite startedAt (a pre-stopgap entry, or malformed) → NOT live → pruned.
export function fbConnectedNow(startedAt, nowMs, ttlMs = FB_CONNECTED_TTL_MS) {
  const started = Number(startedAt);
  if (!Number.isFinite(started)) return false;
  return nowMs - started < ttlMs;
}
