// PIN-TO-PRINT Phase 2 (2026-09-27) — pure client core. The server relays a
// pinned comment as a `platform_pin` event (separate lane — NEVER the comment
// relay, see server.js [PIN-RELAY]); when the per-device toggle is ON, the pin
// becomes a 1-Click order: RedesignApp routes buildPinComment() into the SAME
// orders.createOrder path a manual tap uses, inheriting buyer# assignment, the
// 3 DB writes, msgId dedup (createOrder returns null on an already-ordered
// msgId — a pinned comment Auto Mode already ordered is a silent no-op), the
// free-cap soft block, outbox retry, and auto-print (BLE / web browser print /
// the no-printer modal).
import type { Comment as ProdComment } from "../../lib/orderTypes";

export const PIN_PRINT_LS_KEY = "sfl_rd_pin_print"; // per-device, default OFF

export interface PinPayload {
  pinned?: boolean;
  platform?: string;
  username?: string;       // the seller's live account (client-side scoping)
  handle?: string;
  name?: string;
  comment?: string;
  avatar?: string;
  msgId?: string;
  sellerId?: string;
  sessionId?: string;
  sourceUsername?: string;
  time?: string;
  timestamp?: string;
}

// A relayed pin is actionable only when it can be keyed (msgId) and attributed
// (handle) and has text — mirrors the server-side validity check (defense in
// depth: a forged/partial event never becomes an order).
export function isActionablePin(p: PinPayload | null | undefined): boolean {
  if (!p || typeof p !== "object") return false;
  if (String(p.platform || "").toLowerCase() !== "tiktok") return false;
  return Boolean(String(p.msgId || "") && String(p.handle || "") && String(p.comment || "").trim());
}

// The ProdComment handed to createOrder — same shape the live chat lane builds,
// self-contained (a pin of an old comment beyond FEED_RENDER_CAP needs no feed
// row). msgId rides as the extra field the order pipeline already reads.
export function buildPinComment(p: PinPayload): ProdComment & { msgId: string } {
  return {
    handle: String(p.handle || ""),
    name: String(p.name || "") || String(p.handle || ""),
    comment: String(p.comment || ""),
    platform: "TikTok",
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    time: String(p.time || ""),
    avatar: String(p.avatar || ""),
    timestamp: String(p.timestamp || ""),
    sellerId: String(p.sellerId || ""),
    sessionId: String(p.sessionId || ""),
    sourceUsername: String(p.sourceUsername || ""),
    msgId: String(p.msgId || ""),
  };
}

// Unattended-order guard: 1-Click on a SOLD-OUT Auto-Mode code asks
// window.confirm; a pin can't ask, so it SKIPS instead of overselling (the
// seller can still tap the row manually and answer the confirm).
export function shouldSkipPin(soldOutCode: string | null): boolean {
  return soldOutCode != null;
}
