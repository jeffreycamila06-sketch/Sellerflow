// FACEBOOK LIVE — Phase 1 (F-P1). Pure mapper: a raw Graph API live-video comment →
// the EXACT internal comment payload emitCommentScoped expects. Mirrors
// server/shopeeComment.js / server/initialComments.js. Unit-tested. Nothing calls
// this yet (P2 wires the FB live-comment fetch → fbToPayload → emitCommentScoped).
//
// Graph comment shape (the /{live-video-id}/comments edge): { id, from:{name,id},
// message, created_time }. ⚠️ `from` is FREQUENTLY ABSENT — reading a commenter's
// name/id needs elevated Page permissions many pages don't grant, so Graph omits
// `from` entirely. The mapper therefore DEGRADES to a safe anonymous handle/name and
// NEVER throws (defensive on all input, exactly like the Shopee mapper).
//
// ⚠️ NO SANITIZE HERE (by design): control-byte stripping happens ONCE at the
// emitCommentScoped choke-point via server/sanitize.js (covers live + initial + reuse
// relays in one place). Doubling it here would be redundant. Do not add sanitize here.
//
// ⚠️ GRAPH VERSION: the avatar picture URL is built from the SINGLE GRAPH_VERSION pin
// in server/fbConfig.js — never an unversioned graph.facebook.com URL.
import { GRAPH_VERSION } from "./fbConfig.js";

// Graph `created_time` is an ISO-8601 string (e.g. "2026-09-16T12:00:00+0000"); be
// tolerant of a numeric epoch too. Returns ms, or null when unparseable (caller falls
// back to now).
export function parseFbTimeMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /[-T:]/.test(v)) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
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

// raw = one comment object from the Graph /{live-video-id}/comments edge.
// ctx = { sellerId, sessionId, pageId, liveVideoId, pageUsername, nowMs? }.
// Output = the SAME shape as the TikTok/Shopee relay with platform:"Facebook", PLUS
// the additive pageId + liveVideoId keys (receipt plumbing — they pass through
// emitCommentScoped untouched). msgId = comment.id (stable per-comment). roomId =
// live_video_id. sourceUsername = the page identity used for select_account scoping
// (P2/P3). time/timestamp come from created_time when parseable, else now.
export function fbToPayload(raw, ctx = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const { sellerId, sessionId, pageId, liveVideoId, pageUsername, nowMs = Date.now() } = ctx;

  // `from` may be a nested object, or absent (permission-dependent). Defensive on
  // both the nested and any flattened top-level shape.
  const from = r.from && typeof r.from === "object" ? r.from : {};
  const fromName = firstStr(from.name, r.from_name);
  const fromId = firstStr(from.id, r.from_id);

  const handle = firstStr(fromName, fromId, "unknown"); // display name → id → anon
  const name = firstStr(fromName, "Unknown");
  const comment = firstStr(r.message, r.text, r.comment);
  const commentId = firstStr(r.id, r.comment_id, r.msg_id);
  // Avatar: an expanded from.picture.data.url if present, else the versioned Graph
  // picture endpoint for the commenter id, else "" (no id / anonymous).
  const avatar = firstStr(from?.picture?.data?.url, r.avatar)
    || (fromId ? `https://graph.facebook.com/${GRAPH_VERSION}/${fromId}/picture` : "");

  // Prefer the comment's real create time; when absent, derive a STABLE ms from a
  // numeric comment id BEFORE falling back to nowMs (a stable timestamp keeps the
  // client's commentKey identical across a reconnect re-emit). FB ids are usually
  // NON-temporal composites ("{video}_{comment}"), so parseFbTimeMs(commentId) will
  // typically be null → nowMs; re-emit safety still holds via initial:true + msgId.
  const atMs = parseFbTimeMs(r.created_time ?? r.create_time ?? r.timestamp)
    ?? parseFbTimeMs(commentId)
    ?? nowMs;
  const at = new Date(atMs);

  return {
    handle,
    name,
    comment,
    avatar,
    platform: "Facebook",
    sellerId,
    sessionId,
    sourceUsername: firstStr(pageUsername, ctx.pageName), // page vanity/name for scoping
    roomId: String(liveVideoId ?? ""), // FB "room" = the live video
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    msgId: String(commentId), // comment.id — stable → client dedup + Ordered✓ (sql/18)
    time: at.toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: at.toISOString(),
    // ── additive receipt-plumbing keys (pass through emitCommentScoped untouched) ──
    pageId: pageId == null ? null : String(pageId),
    liveVideoId: liveVideoId == null ? null : String(liveVideoId),
  };
}
