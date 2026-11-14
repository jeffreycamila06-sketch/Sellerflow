// MESSENGER RECEIPT PICTURE (phone). One PNG per buyer: opening → "#N buyer name" → numbered
// lines (price right-aligned) → total → note → the seller's own payment QR. Facebook allows ONE
// message per live comment, so everything the buyer needs is in one picture.
//
// The layout is the SHARED pure layoutReceipt (src/lib/receiptLayout.js — the server's
// automatic receipt uses the same one); renderReceiptPng() draws it on a browser canvas with
// the device's system fonts (Chinese / Cyrillic / Thai from the phone's own fonts).
// Independent of the sticker/print code on purpose.
import { layoutReceipt, RECEIPT_PAD, RECEIPT_RULE_COLOR, type Measure, type ReceiptInput } from "../../lib/receiptLayout.js";
export { RECEIPT_WIDTH, RECEIPT_PAD, QR_MAX_WIDTH, FONT_STACK, formatAmount, receiptTotalText, wrapText, layoutReceipt } from "../../lib/receiptLayout.js";
export type { ReceiptLine, ReceiptInput, Measure, DrawOp, ReceiptLayout } from "../../lib/receiptLayout.js";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("qr_load_failed"));
    img.src = src;
  });
}

// Rounded rectangle path (arcTo — works on every canvas, no roundRect needed).
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Draws the layout on a canvas → PNG Blob. Rejects when the platform has no 2D canvas.
export async function renderReceiptPng(input: ReceiptInput): Promise<Blob> {
  let qr: HTMLImageElement | null = null;
  if (input.qrImage) { try { qr = await loadImage(input.qrImage); } catch { qr = null; } }
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("no_canvas");
  const measure: Measure = (t, font) => { probe.font = font; return probe.measureText(t).width; };
  const layout = layoutReceipt(input, measure, qr ? { w: qr.naturalWidth, h: qr.naturalHeight } : null);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.textBaseline = "alphabetic";
  const spacing = "letterSpacing" in ctx; // canvas letter-spacing where the platform has it
  for (const op of layout.ops) {
    if (op.kind === "text") {
      ctx.font = op.font; ctx.fillStyle = op.color; ctx.textAlign = op.align;
      if (spacing) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${op.letterSpacing || 0}px`;
      ctx.fillText(op.text, op.x, op.y - 8);
    } else if (op.kind === "rule") {
      const x0 = op.x0 ?? RECEIPT_PAD, x1 = op.x1 ?? layout.width - RECEIPT_PAD;
      ctx.fillStyle = RECEIPT_RULE_COLOR; ctx.fillRect(x0, op.y, x1 - x0, op.thick ?? 2);
    } else if (op.kind === "box") {
      roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r);
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = 2; ctx.stroke(); }
    } else if (op.kind === "image" && qr) {
      ctx.drawImage(qr, op.x, op.y, op.w, op.h);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png_failed"))), "image/png"));
}
