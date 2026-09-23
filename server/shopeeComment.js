// SHOPEE LIVE — Phase 1. Pure mapper: a raw Shopee livestream comment → the EXACT
// internal comment payload emitCommentScoped expects (server.js:388). Mirrors
// server/initialComments.js. Unit-tested. Nothing calls this yet (P2 wires the
// poller → shopeeToPayload → emitCommentScoped).
//
// ⚠️ RAW FIELD NAMES ARE UNVERIFIED until we have a Partner ID + a live TW shop:
// get_latest_comment_list's item shape (username / nickname / comment / comment_id
// / avatar / create_time) is an educated guess. So the mapper is DEFENSIVE on
// INPUT (multiple fallbacks per field) and the tests pin the OUTPUT shape, not the
// input names — when the real shape is known, only the fallback lists change.
//
// ⚠️ NO SANITIZE HERE (by design): control-byte stripping happens ONCE at the
// emitCommentScoped choke-point via server/sanitize.js (covers live + initial +
// reuse relays in one place). Doubling it here would be redundant; P2 sends this
// payload straight into emitCommentScoped, which sanitizes. Do not add sanitize
// here.

// Shopee timestamps are typically unix SECONDS; be tolerant of ms too. Returns ms,
// or null when unparseable (caller falls back to now).
export function parseShopeeTimeMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e12) return Math.round(n * 1000); // seconds → ms
  if (n < 1e15) return Math.round(n);        // already ms
  return null;                               // micro/nano / garbage — refuse to guess
}

const firstStr = (...vals) => {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
};

// 🔴 KNOWN BUG — MUST FIX BEFORE SHOPEE GOES LIVE (same bug fixed for Facebook, see
// server/fbLive.js startPoller + adapters/fb.ts fbConnect): the `sessionId` stamped on this
// payload (and on Shopee's platform_status in server.js) is the SHOPEE LIVE-SESSION id, but
// the client (useLiveFeed: `if (c.sessionId && c.sessionId !== sessionId) return;`) expects
// the CONNECTING BROWSER's session id — so EVERY Shopee comment + status is silently
// dropped client-side (no comments, pill never green). Fix = send browserSessionId() in the
// /shopee/connect body, carry it on the poller entry, and stamp THAT here + on status; keep
// the Shopee session id in its own field. Do NOT stamp "" instead: that drops the
// per-device scoping (duplicate auto-orders on multi-device sellers).
// raw = one comment object from get_latest_comment_list.
// ctx = { sellerId, sessionId, shopUsername, nowMs? }.
// Output = the SAME shape as the TikTok live-chat relay (server.js:1208) with
// platform:"Shopee". time/timestamp come from the comment's own create time when
// parseable, else now. sourceUsername = the shop identity used for select_account
// scoping (P2/P3); roomId = String(sessionId).
export function shopeeToPayload(raw, ctx = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const { sellerId, sessionId, shopUsername, nowMs = Date.now() } = ctx;

  const username = firstStr(r.username, r.user_name, r.buyer_username);
  const nickname = firstStr(r.nickname, r.nick_name, r.user_nickname);
  const handle = firstStr(username, nickname, r.user_id, "unknown");
  const name = firstStr(nickname, username, "Unknown");
  const comment = firstStr(r.comment, r.content, r.message);
  const avatar = firstStr(r.avatar, r.avatar_url, r.profile_image, r.user_avatar);
  const commentId = firstStr(r.comment_id, r.id, r.msg_id);

  // F1 (re-emit dedup stability): prefer the comment's real create time. When it is
  // ABSENT, derive a STABLE ms from the comment_id (Shopee ids are commonly epoch-
  // based) BEFORE falling back to nowMs — a stable timestamp keeps the client's
  // commentKey identical across a reconnect re-emit, so the same comment collapses
  // instead of looking new. nowMs is the last resort (id also non-temporal); in that
  // case re-emit safety still holds via the initial:true flag + msgId (initialKey).
  const atMs = parseShopeeTimeMs(r.create_time ?? r.ctime ?? r.timestamp ?? r.comment_time)
    ?? parseShopeeTimeMs(commentId)
    ?? nowMs;
  const at = new Date(atMs);

  return {
    handle,
    name,
    comment,
    avatar,
    platform: "Shopee",
    sellerId,
    sessionId,
    sourceUsername: shopUsername,
    roomId: String(sessionId ?? ""),
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    msgId: String(commentId), // stable per-comment id → client dedup + Ordered✓ (sql/18)
    time: at.toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: at.toISOString(),
  };
}
