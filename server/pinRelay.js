// PIN-TO-PRINT Phase 2 (2026-09-27) — pure core for the WebcastRoomPinMessage
// relay. Probe-verified (secondserve7tw diag: WebcastRoomPinMessage:28; lheypaldo
// captures: phase=live, nested chatMessage populated). The pin event's nested
// chatMessage is NOT simplified by the legacy wrapper (simplifyObject only
// flattens the TOP-level `common` — the F1 lesson), so the ORIGINAL comment's
// msgId lives at chatMessage.common.msgId and the commenter at chatMessage.user.
// Accessors are dual-shape anyway: if a future library version simplifies the
// nested message too, the top-level spellings win.
//
// pin-vs-expire is DELIBERATELY not distinguished (action/isShowMsg semantics
// unverified — the probe's 800-char cap cut them off): every event carrying a
// chatMessage references the SAME pinned comment, so msgId dedup (the caller's
// per-connection seen-set + the client's createOrder dedup + the DB unique
// index) makes a redundant expire/re-pin event a no-op. An event WITHOUT a
// valid chatMessage returns null and relays nothing.

// Extract the pinned comment from a (legacy-simplified) WebcastRoomPinMessage.
// Returns null unless msgId + non-blank text + handle are ALL present — a pin
// we can't key or can't attribute must never become an order.
export function pinChatOf(obj) {
  const chat = obj && typeof obj === "object" ? obj.chatMessage : null;
  if (!chat || typeof chat !== "object") return null;
  const user = chat.user && typeof chat.user === "object" ? chat.user : {};
  const msgId = String(chat.msgId || chat.common?.msgId || "");
  const comment = String(chat.comment ?? chat.content ?? "");
  const handle = String(chat.uniqueId || user.uniqueId || "");
  if (!msgId || !comment.trim() || !handle) return null;
  const name = String(chat.nickname || user.nickname || "") || handle;
  const avatar = String(
    chat.profilePictureUrl ||
    user.profilePicture?.url?.[0] ||
    user.profilePicture?.urls?.[0] ||
    ""
  );
  return { msgId, comment, handle, name, avatar };
}

// The platform_pin payload. Mirrors the live-chat relay payload shape (so the
// client can construct its Comment object the same way) + pinned:true. The
// caller passes ctx from relay-time state (emailIdOf(sellerId), relaySessionId,
// roomId) and runs the result through sanitizeCommentPayload before emitting.
export function buildPinPayload(chat, ctx) {
  return {
    pinned: true,
    platform: "TikTok",
    handle: chat.handle,
    name: chat.name,
    comment: chat.comment,
    avatar: chat.avatar,
    msgId: chat.msgId,
    sellerId: ctx.sellerId ?? "",
    sessionId: ctx.sessionId ?? "",
    sourceUsername: ctx.sourceUsername ?? "",
    roomId: ctx.roomId ?? "",
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    time: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: new Date().toISOString(),
  };
}

// Per-connection pin dedup — bounded (pins are rare; the cap only guards a
// pathological stream). Returns true when this msgId was already relayed.
export const PIN_SEEN_CAP = 500;
export function pinAlreadySeen(entry, msgId) {
  if (!entry.pinSeenMsgIds) entry.pinSeenMsgIds = new Set();
  if (entry.pinSeenMsgIds.has(msgId)) return true;
  if (entry.pinSeenMsgIds.size < PIN_SEEN_CAP) entry.pinSeenMsgIds.add(msgId);
  return false;
}

// Latency self-report — TikTok's pin-broadcast leg (pin action → our wire).
// pinTime is TikTok's clock on the TOP-level pin event; captures show an epoch
// string, but seconds-vs-ms is unverified → handle both (< 1e12 = seconds).
// null = pinTime missing/garbage (log "?", never NaN math).
export function pinLagMs(obj, nowMs = Date.now()) {
  const raw = Number(obj?.pinTime);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const pinMs = raw < 1e12 ? raw * 1000 : raw;
  return Math.max(0, Math.round(nowMs - pinMs));
}
