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

// TikTok's common.createTime is an epoch string — seconds (10-digit) or
// milliseconds (13-digit) depending on message vintage. Returns ms, or null
// when unparseable (caller falls back to "now").
export function parseCreateTimeMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e12) return Math.round(n * 1000); // seconds → ms
  if (n < 1e15) return Math.round(n);        // already ms
  return null;                               // micro/nano or garbage — refuse to guess
}

// Dedup the collected initial batch by TikTok's stable per-message id
// (common.msgId); entries without a msgId fall back to a content key so a
// double-buffered message still collapses. Preserves arrival order.
export function dedupInitialChats(chats) {
  const seen = new Set();
  const out = [];
  for (const data of Array.isArray(chats) ? chats : []) {
    if (!data || typeof data !== "object") continue;
    const comment = String(data.comment || "").trim();
    if (!comment) continue; // non-chat / empty — nothing to display
    const msgId = String(data?.common?.msgId || "").trim();
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
  const atMs = parseCreateTimeMs(data?.common?.createTime) ?? nowMs;
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
    msgId: String(data?.common?.msgId || ""),          // stable id for client-side dedup
    time: at.toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: at.toISOString(),
  };
}

// Full batch: dedup then map. Order preserved (oldest→newest, as TikTok buffered
// them); the client sorts for display.
export function buildInitialCommentPayloads(chats, ctx) {
  return dedupInitialChats(chats).map((data) => initialCommentPayload(data, ctx));
}
