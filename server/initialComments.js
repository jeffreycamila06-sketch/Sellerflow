// APPROACH A — FLive-parity initial comments (display-only history).
// Pure core for the server's initial-batch relay, extracted so vitest can cover
// it (server.js has no test harness — the connectionHealth.js pattern).
//
// Where the data comes from: with processInitialData:true, tiktok-live-connector
// decodes the signed-websocket fetch's buffered messages ("messages of the last
// minutes" — TikTok's recent room buffer) INSIDE connect(), BEFORE the promise
// resolves. server.js attaches a temporary collector before connect() and feeds
// the collected chats through these helpers AFTER a successful connect.
//
// ⚠️ DUPLICATE-ORDER SAFETY: every payload built here carries `initial: true`.
// The client (useLiveFeed) routes flagged comments into a DISPLAY-ONLY array
// BEFORE the Auto-Mode seam and pushComment — they can never create orders.
// The flag is the contract; do not remove it.

// TikTok's createTime is an epoch string — seconds (10-digit) or
// milliseconds (13-digit) depending on message vintage. Returns ms, or null
// when unparseable (caller falls back to "now").
export function parseCreateTimeMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e12) return Math.round(n * 1000); // seconds → ms
  if (n < 1e15) return Math.round(n);        // already ms
  return null;                               // micro/nano or garbage — refuse to guess
}

// ⚠️ FIELD SHAPE (audit F1 — verified against the shipped library, not the raw
// protocol): server.js instantiates the LEGACY WebcastPushConnection, whose
// simplifyObject FLATTENS the protobuf `common` block into the top level and
// DELETES `common` (data-converter.js:19-24, with msgId/createTime stringified
// at :161-164). So in production the chat event carries data.msgId /
// data.createTime — data.common never exists. The common.* fallbacks below
// only serve a future migration to the non-legacy TikTokLiveConnection (raw
// CommonMessageData shape); both shapes are unit-tested.
export const msgIdOf = (data) => String(data?.msgId ?? data?.common?.msgId ?? "").trim();
export const createTimeOf = (data) => data?.createTime ?? data?.common?.createTime;

// Dedup the collected initial batch by TikTok's stable per-message id
// (msgId — top-level in the legacy shape, see msgIdOf); entries without a
// msgId fall back to a content key so a double-buffered message still
// collapses. Preserves arrival order.
export function dedupInitialChats(chats) {
  const seen = new Set();
  const out = [];
  for (const data of Array.isArray(chats) ? chats : []) {
    if (!data || typeof data !== "object") continue;
    const comment = String(data.comment || "").trim();
    if (!comment) continue; // non-chat / empty — nothing to display
    const msgId = msgIdOf(data);
    const key = msgId ? `m:${msgId}` : `c:${data.uniqueId || ""}|${comment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(data);
  }
  return out;
}

// Build the relay payload for ONE initial chat — the SAME shape as the live
// chat relay in server.js plus the safety flag + stable id. time/timestamp
// derive from the message's own createTime when parseable (the comment really
// happened minutes ago), else `nowMs`.
export function initialCommentPayload(data, { sellerId, sessionId, sourceUsername, roomId, nowMs }) {
  const atMs = parseCreateTimeMs(createTimeOf(data)) ?? nowMs;
  const at = new Date(atMs);
  return {
    handle: data.uniqueId || "unknown",
    name: data.nickname || data.uniqueId || "Unknown",
    comment: data.comment || "",
    avatar: data.profilePictureUrl || "",
    platform: "TikTok",
    sellerId,
    sessionId,
    sourceUsername,
    roomId: roomId || "",
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    initial: true,                                     // ⚠️ the display-only contract
    msgId: msgIdOf(data),                              // stable id for client-side dedup
    time: at.toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: at.toISOString(),
  };
}

// Full batch: dedup then map. Order preserved (oldest→newest, as TikTok buffered
// them); the client sorts for display.
export function buildInitialCommentPayloads(chats, ctx) {
  return dedupInitialChats(chats).map((data) => initialCommentPayload(data, ctx));
}

// ── recent-comments ring (clientfix RC2) ─────────────────────────────────────
// The B2 REUSE branch never runs startTikTokConnection, so a refresh mid-live
// (the PRIMARY FLive-parity case: healthy connection reused) had NO initial
// batch at all. Each connection entry keeps a small ring of the last relayed
// comments (seeded with the connect-time buffer, appended by the live chat
// relay); on reuse the ring is re-emitted flagged initial:true — the same
// display-only lane, so the cancelled-F4 duplicate-order concern does not
// apply (flagged comments can never reach the order path, test-pinned
// client-side; the client's empty-feed guard also drops the re-emit whenever
// the feed already shows those comments live).
export const RECENT_RING_CAP = 20;

export function pushRecent(ring, payload, cap = RECENT_RING_CAP) {
  ring.push(payload);
  if (ring.length > cap) ring.splice(0, ring.length - cap);
  return ring;
}

// M1 (clientfix audit) — the reuse re-emit payload. Ring entries carry the
// sessionId of the session that CREATED the connection; the client drops
// comments whose sessionId differs from its own, so a two-device seller's
// second device would silently lose the whole block. Re-emits therefore carry
// the REQUESTING session's id (from the reuse POST), falling back to the
// stored one only when the requester sent none.
export const reuseReEmitPayload = (p, requesterSessionId) =>
  ({ ...p, initial: true, sessionId: requesterSessionId || p.sessionId });
