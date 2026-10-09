// SERVER-SIDE MESSENGER RECEIPT PICTURE (automatic receipt after a Facebook live, B1).
// Same layout as the phone (the shared pure layoutReceipt in src/lib/receiptLayout.js); drawn
// with @napi-rs/canvas and the bundled Noto fonts in server/fonts (Latin/Cyrillic/Vietnamese
// = Noto Sans, Traditional + Simplified Chinese = Noto Sans TC / SC, Thai = Noto Sans Thai;
// SIL Open Font License, server/fonts/OFL.txt). The native canvas is loaded LAZILY on the
// first draw: if it cannot load, drawReceiptPng throws "canvas_unavailable" and nothing else
// in the server is affected.
//
// Input = the buyer's RAW order rows (live_session_orders) — edits made in the manual receipt
// sheet are not used. Name + lines mirror rebuildSessionFromRows / buyerReceipt exactly.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { layoutReceipt, RECEIPT_PAD, RECEIPT_RULE_COLOR } from "../src/lib/receiptLayout.js";
import { RECEIPT_MAX_IMAGE_BYTES } from "./fbReceipt.js";

export const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");
export const SERVER_FONTS = [
  ["NotoSans.ttf", "Noto Sans"],
  ["NotoSansTC.ttf", "Noto Sans TC"],
  ["NotoSansSC.ttf", "Noto Sans SC"],
  ["NotoSansThai.ttf", "Noto Sans Thai"],
];
export const SERVER_FONT_STACK = '"Noto Sans", "Noto Sans TC", "Noto Sans SC", "Noto Sans Thai", sans-serif';

// The picture words, per app language — the same text as the app's rd_rc_pic_total /
// rd_rc_pic_tbc / rd_rc_pic_more (a test pins them). Unknown language → English.
export const RECEIPT_LABELS = {
  en: { total: "Total", toBeConfirmed: "to be confirmed", more: "…and {n} more" },
  fil: { total: "Kabuuan", toBeConfirmed: "kukumpirmahin pa", more: "…at {n} pa" },
  zh: { total: "合计", toBeConfirmed: "待确认", more: "…还有 {n} 项" },
  "zh-TW": { total: "合計", toBeConfirmed: "待確認", more: "…還有 {n} 項" },
  vi: { total: "Tổng cộng", toBeConfirmed: "sẽ xác nhận sau", more: "…và {n} món nữa" },
  th: { total: "รวม", toBeConfirmed: "รอยืนยัน", more: "…และอีก {n} รายการ" },
  id: { total: "Total", toBeConfirmed: "akan dikonfirmasi", more: "…dan {n} lagi" },
  bg: { total: "Общо", toBeConfirmed: "предстои потвърждение", more: "…и още {n}" },
};

// rows: ONE buyer's live_session_orders rows (any order) → the shared ReceiptInput. PURE.
// settings: { opening, note, qrImage, currency, lang }.
export function receiptInputFromRows(rows, settings = {}) {
  const sorted = [...(rows || [])].sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || Number(a.id || 0) - Number(b.id || 0));
  let name = "", handle = "";
  const lines = [];
  for (const r of sorted) {
    const price = Number(r.price) || 0;
    const qty = Math.max(1, Math.floor(Number(r.qty) || 1));
    if (!lines.length) { handle = String(r.handle || ""); name = String(r.customer_name || r.handle || ""); }
    else if (r.customer_name && name === handle) name = String(r.customer_name);
    const item = String(r.product ?? "").trim();
    // Same rule as the phone's ReceiptSheet: blank items are left out; no positive price → 0.
    if (item) lines.push({ item, total: price * qty > 0 ? price * qty : 0 });
  }
  const first = sorted[0] || {};
  return {
    opening: String(settings.opening || ""),
    note: String(settings.note || ""),
    qrImage: typeof settings.qrImage === "string" && settings.qrImage.startsWith("data:image/") ? settings.qrImage : null,
    currency: String(settings.currency || "NT$"),
    buyerNum: Number(first.buyer_number) || 0,
    buyerName: name || handle,
    lines,
    labels: RECEIPT_LABELS[settings.lang] || RECEIPT_LABELS.en,
  };
}

export const QR_MAX_BYTES = 2 * 1024 * 1024; // decoded size of the QR data URL
export const QR_MAX_SIDE = 1000;             // px, width or height
// data:image/...;base64,XXXX → decoded byte count (no decode).
export function qrDataBytes(dataUrl) {
  const s = String(dataUrl || "");
  const comma = s.indexOf(",");
  const b64 = comma >= 0 ? s.slice(comma + 1) : s;
  return Math.floor((b64.replace(/=+$/, "").length * 3) / 4);
}

let canvasMod = null;
async function loadCanvas() {
  if (canvasMod) return canvasMod;
  let mod;
  try { mod = await import("@napi-rs/canvas"); } catch { throw new Error("canvas_unavailable"); }
  for (const [file, family] of SERVER_FONTS) {
    try { mod.GlobalFonts.registerFromPath(join(FONTS_DIR, file), family); } catch { /* a missing font only costs its script */ }
  }
  canvasMod = mod;
  return mod;
}

// The layout the server draws (exported for the phone/server parity test).
export function serverLayout(input, measure, qrSize) {
  return layoutReceipt(input, measure, qrSize, SERVER_FONT_STACK);
}

// rows + settings → PNG Buffer. Throws canvas_unavailable / png_too_big (over the same 4 MB the
// manual send accepts; a 20-line receipt with a QR is about 200 KB).
export async function drawReceiptPng(rows, settings = {}) {
  const { createCanvas, loadImage } = await loadCanvas();
  const input = receiptInputFromRows(rows, settings);
  let qr = null;
  if (input.qrImage) {
    // Build 8: the seller's QR is refused (the receipt is not drawn) above 2 MB or 1,000 px a side.
    if (qrDataBytes(input.qrImage) > QR_MAX_BYTES) throw new Error("qr_too_big");
    try { qr = await loadImage(input.qrImage); } catch { qr = null; }
    if (qr && (qr.width > QR_MAX_SIDE || qr.height > QR_MAX_SIDE)) throw new Error("qr_too_big");
  }
  const probe = createCanvas(1, 1).getContext("2d");
  const measure = (t, font) => { probe.font = font; return probe.measureText(t).width; };
  const layout = serverLayout(input, measure, qr ? { w: qr.width, h: qr.height } : null);
  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.textBaseline = "alphabetic";
  for (const op of layout.ops) {
    if (op.kind === "text") {
      ctx.font = op.font; ctx.fillStyle = op.color; ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y - 8);
    } else if (op.kind === "rule") {
      ctx.fillStyle = RECEIPT_RULE_COLOR; ctx.fillRect(RECEIPT_PAD, op.y, layout.width - RECEIPT_PAD * 2, 2);
    } else if (qr) {
      ctx.drawImage(qr, op.x, op.y, op.w, op.h);
    }
  }
  const png = canvas.toBuffer("image/png");
  if (png.length > RECEIPT_MAX_IMAGE_BYTES) throw new Error("png_too_big");
  return png;
}
