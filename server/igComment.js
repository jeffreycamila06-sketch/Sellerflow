// INSTAGRAM LIVE — phase 1. One Graph IG comment → the SAME comment payload shape the
// Facebook / TikTok relays send (server/fbComment.js), so the client pipeline needs no new
// shape. Pure + unit-tested.
//
// Graph IG comment (GET /{live-media}/comments?fields=id,text,timestamp,username,from{id,username}):
//   { id, text, timestamp: "2026-10-08T09:00:00+0000", username, from: { id, username } }
// The buyer key is the Instagram USERNAME (handle and name) + platform "Instagram" — the exact
// casing is a contract (useLiveFeed / select_account / printing compare it). msgId = the
// comment id (stable across a re-emit → dedup + "Ordered" checks). Instagram comments carry
// no picture → avatar "" (the initials circle shows).
export const IG_PLATFORM = "Instagram";
export const IG_UNKNOWN = "unknown";

const str = (v) => (v == null ? "" : String(v).trim());

export function igTimeMs(v) {
  if (v == null || v === "") return null;
  const ms = Date.parse(String(v).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")); // "+0000" → "+00:00"
  return Number.isFinite(ms) ? ms : null;
}

// ctx: { sellerId, sessionId, igUserId, igUsername, liveMediaId, nowMs }
export function igToPayload(raw, ctx = {}) {
  const r = raw || {};
  const from = r.from || {};
  const username = str(from.username) || str(r.username);
  const commenterId = str(from.id);
  const atMs = igTimeMs(r.timestamp) ?? ctx.nowMs ?? Date.now();
  const at = new Date(atMs);
  return {
    handle: username || commenterId || IG_UNKNOWN,
    name: username || "Unknown",
    comment: str(r.text),
    avatar: "",
    platform: IG_PLATFORM,
    sellerId: ctx.sellerId,
    sessionId: ctx.sessionId,
    sourceUsername: str(ctx.igUsername) || str(ctx.igUserId), // the select_account scoping key
    roomId: str(ctx.liveMediaId),
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    msgId: str(r.id),
    time: at.toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: at.toISOString(),
    igUserId: str(ctx.igUserId) || null,
    liveMediaId: str(ctx.liveMediaId) || null,
    commenterId,
  };
}
