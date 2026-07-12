// Connection-status truth (B2) — shared, PURE decision core imported by server.js
// AND unit-tested by vitest (server.js has no test harness; same convention as
// server/broadcastTranslate.js).
//
// THE ZOMBIE TRAP THIS FIXES: POST /connect/tiktok used to return success
// ("already_connected") whenever a server-side connection object existed for the
// seller+account key — WITHOUT checking that the underlying TikTok websocket was
// actually receiving events. A zombie (dead/old room after a live restart, or the
// documented fail-open ambiguous-roomInfo case) therefore survived every
// re-Connect tap, and since the app's Disconnect is client-local (no server
// unbind endpoint), a seller had NO self-service escape — only the 10–12 min
// server health timers could break it (the real reason "2× logout/login" seemed
// to fix it: elapsed time). Definition of done #5: disconnect → refresh → connect
// MUST be a working recovery.
//
// DECISION: reuse the existing connection ONLY when it is demonstrably alive —
// an event (chat/member/like/gift/...) was received within CONNECT_REUSE_FRESH_MS.
// Otherwise treat the seller's explicit Connect tap as intent to FORCE a fresh
// TikTok connection (the normal fresh-connect path: lock → clean disconnect →
// startTikTokConnection, with all existing cooldown/rate-limit machinery).
//
// COST BOUND: forcing consumes one EulerStream connect, but only on an explicit
// user tap AND only when the connection has been event-silent ≥ the threshold —
// a genuinely active live emits events far more often than 60s, so double-taps
// on a healthy connection still reuse (no extra quota).

export const CONNECT_REUSE_FRESH_MS = 60 * 1000;

// F1 (audit) — the events that stamp lastEventAt (liveness). The original six
// missed `roomUser` (periodic viewer-count updates — the HIGH-FREQUENCY signal
// present in essentially any live room) plus follow/share, so a quiet-but-alive
// room could read as "event-silent": the 12-min silent_timeout force-reconnected
// healthy quiet rooms, and B2's force-fresh would burn an unnecessary EulerStream
// connect on a Connect tap. A dead-room zombie emits NOTHING, so widening the
// list keeps zombie detection fully intact while making lastEventAt a true
// liveness signal. Names verified against tiktok-live-connector 2.1.1-beta1
// (WebcastEvent enum). `chat` is deliberately separate (stamps lastCommentAt too).
export const LIVENESS_EVENTS = [
  "member", "like", "gift", "social", "emote", "envelope", // original six
  "roomUser", "follow", "share",                            // F1 additions
];

// lastEventAt = existing.lastEventAt (ms epoch; server sets it on EVERY TikTok
// event). Missing/invalid → force (never trust an untracked connection).
export function shouldForceFreshConnect(lastEventAt, nowMs) {
  const last = Number(lastEventAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return nowMs - last >= CONNECT_REUSE_FRESH_MS;
}

// clientfix RC3 — STALE-RECONNECT GUARD. clearTikTokReconnect can only cancel a
// PENDING TIMER; once the timer has fired, the reconnect work sits in the
// MIN_GAP queue as a closure that nothing could cancel. If the seller's own
// Connect tap restored the account in the meantime, that stale closure would
// either (a) fail (not_live / retry) and emit a TERMINAL status +
// live_session_ended that grays a perfectly healthy pill (false-gray: comments
// flowing while gray), or (b) succeed and silently OVERWRITE the healthy
// connection in the map — an orphaned-but-still-relaying old connection (the
// documented G1 double-relay hole, reachable from the scheduler). A queued
// reconnect must therefore be a NO-OP whenever the account already has a live
// connection or a connect is currently in flight (lock held).
export function shouldSkipQueuedReconnect(hasActiveConnection, connectLockHeld) {
  return Boolean(hasActiveConnection || connectLockHeld);
}
