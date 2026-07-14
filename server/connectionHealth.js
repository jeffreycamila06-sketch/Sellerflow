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

// ── B4 PHASE 1 (log-only) — REUSE is-LIVE verification, pure decision core ──
// The B2 reuse branch never checks whether the account is STILL LIVE — an
// entry whose room died <60s ago (streamEnd is structurally unreliable) reuses
// and asserts connected:true → the B4 zombie green (Jeff's check-#3 repro).
// Phase 1 measures before enforcing: the reuse branch fires a FIRE-AND-FORGET
// verification (zero added latency, zero behavior change) and logs the verdict
// distribution; the Phase-2 flip (await + teardown + 409) ships only after the
// logs confirm no false-not_live on genuinely-live accounts.
//
// ⚠️ R3 (audit catch, load-bearing): the verification must run on a THROWAWAY
// listener-less WebcastPushConnection — NEVER on the live connection instance.
// fetchIsLive()'s fallback tiers call handleError() on every intermediate
// failure (the HTML tier fails routinely), and handleError EMITS the `error`
// event when a listener exists — server.js's error listener responds with
// handleTikTokDisconnected, i.e. verifying on the live instance would tear
// down a healthy connection on a mere tier hiccup. On a listener-less
// instance handleError is a structural no-op (client.js: returns when
// listenerCount(ERROR) < 1).

export const REUSE_VERIFY_TIMEOUT_MS = 4 * 1000;

// Pure verdict from a settled fetchIsLive outcome. CONSERVATIVE by design
// (Phase-1 fail-open philosophy — never risk false-blocking a live seller):
//   • value === false  → "not_live"  (TikTok's own ended-signal — high confidence)
//   • value === true   → "live"
//   • error / timeout / any non-boolean → "ambiguous" (Phase 2 will FAIL-OPEN)
export function reuseVerdict(outcome) {
  if (!outcome || outcome.error !== undefined) return "ambiguous";
  if (outcome.value === false) return "not_live";
  if (outcome.value === true) return "live";
  return "ambiguous";
}

// R1 (audit) — SINGLE-FLIGHT per key: one verification per account at a time;
// concurrent Connect taps (double-tap, two devices on the same account) ride
// the SAME pending promise instead of spawning duplicate fetches. The entry
// is removed when the flight settles, so the next tap after that re-verifies.
export function singleFlight(inFlightMap, key, factory) {
  const pending = inFlightMap.get(key);
  if (pending) return pending;
  let started;
  try {
    started = Promise.resolve(factory()); // synchronous start — riders arriving in the same tick share it
  } catch (err) {
    started = Promise.reject(err);        // a synchronously-throwing factory still yields a normal rejection
  }
  const flight = started.finally(() => { inFlightMap.delete(key); });
  inFlightMap.set(key, flight);
  return flight;
}

// ── Viewer-count relay throttle (platform_viewers, FLive parity) ─────────────
// TikTok pushes roomUser (WebcastRoomUserSeqMessage → viewerCount) roughly
// every 1–10s. The relay is DISPLAY DATA ONLY and must stay cheap:
//   • MIN floor: never more than one emit per VIEWER_RELAY_MIN_MS per account
//     (a busy room churning ±1 every second stays bounded);
//   • change-gated: a static count emits nothing…
//   • …except the VIEWER_REFRESH_MS heartbeat: the client NULLS its count at
//     connect initiation (account-switch zero-frame rule), so without a
//     periodic unchanged re-emit a late joiner / reuse tap on a QUIET room
//     would wait indefinitely for the chip to reappear. ≤2 msgs/min worst.
// The caller keeps (prevCount, lastRelayAt) ON the tiktokConnections entry —
// a replaced/killed connection drops its throttle state with the entry, so a
// fresh connection's FIRST count always relays (prev undefined ≠ count).
export const VIEWER_RELAY_MIN_MS = 3 * 1000;
export const VIEWER_REFRESH_MS = 30 * 1000;

export function shouldRelayViewers(prevCount, lastRelayAt, nextCount, nowMs) {
  if (!Number.isFinite(nextCount) || nextCount < 0) return false;
  const last = Number(lastRelayAt) || 0;
  if (nowMs - last < VIEWER_RELAY_MIN_MS) return false;
  return nextCount !== prevCount || nowMs - last >= VIEWER_REFRESH_MS;
}

// ── Rate-limit cooldown (#4) — honor Euler's own reset window ────────────────
// When EulerStream returns HTTP 429, the tiktok-live-connector throws a
// SignatureRateLimitError that already parses the response headers into:
//   • retryAfter (ms)  = Retry-After: <delay-seconds> * 1000   (RFC 6585/9110)
//   • resetTime  (ms)  = X-RateLimit-Reset: <epoch-seconds> * 1000
// The old code ignored both and benched the account for a FIXED 24h — far
// longer than Euler's real (daily) reset, with no self-service clear, so a
// single spurious 429 could lock a paying seller out of going live for a full
// day. Correct behavior (RFC 9110 §10.2.3): honor the server's own reset
// signal; only fall back to a SANE default when no header is present.
export const RATE_LIMIT_DEFAULT_MS = 30 * 60 * 1000;    // no header → 30 min (was 24h)
export const RATE_LIMIT_MIN_MS = 60 * 1000;             // 1 min floor (never thrash)
export const RATE_LIMIT_MAX_MS = 24 * 60 * 60 * 1000;   // 24h ceiling (never WORSE than before)

const clampCooldown = (ms) => Math.min(RATE_LIMIT_MAX_MS, Math.max(RATE_LIMIT_MIN_MS, ms));

// PURE: resolve how long to bench an account after a 429. Prefer the absolute
// reset time, then Retry-After, then the default. Defensive on a wrapped error
// that lost the fields (→ default). Clamped so a pathological header can't over-
// or under-bench.
export function resolveRateLimitCooldownMs(error, nowMs) {
  const reset = Number(error && error.resetTime);
  if (Number.isFinite(reset) && reset > nowMs) return clampCooldown(reset - nowMs);
  const retry = Number(error && error.retryAfter);
  if (Number.isFinite(retry) && retry > 0) return clampCooldown(retry);
  return RATE_LIMIT_DEFAULT_MS;
}
