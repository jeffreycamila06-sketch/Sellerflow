// MESSENGER RECEIPT PICTURE (step 1 — preview only, nothing is sent). One PNG per buyer:
// opening → "#N buyer name" → numbered lines (price right-aligned) → total → note → the
// seller's own payment QR. Facebook allows ONE message per live comment, so everything the
// buyer needs is in one picture.
//
// layoutReceipt() is PURE (text measurement is injected) so the layout rules are unit-
// tested without a canvas; renderReceiptPng() draws that layout on a canvas. Text uses the
// device's system fonts so Chinese / Cyrillic / Thai render from the phone's own fonts.
// Independent of the sticker/print code on purpose.

export interface ReceiptLine { item: string; total: number }
export interface ReceiptInput {
  opening: string;
  buyerName: string;
  buyerNum: number;
  lines: ReceiptLine[];
  currency: string;
  note: string;
  qrImage?: string | null;              // data URL of the seller's own QR picture
  labels: { total: string; toBeConfirmed: string };
}

export const RECEIPT_WIDTH = 720;
export const RECEIPT_PAD = 36;
export const QR_MAX_WIDTH = 420;
export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", "Helvetica Neue", Arial, sans-serif';

const F = {
  opening: `500 26px ${FONT_STACK}`,
  header: `700 30px ${FONT_STACK}`,
  num: `500 22px ${FONT_STACK}`,
  item: `400 24px ${FONT_STACK}`,
  price: `600 24px ${FONT_STACK}`,
  totalLabel: `700 28px ${FONT_STACK}`,
  totalAmount: `700 30px ${FONT_STACK}`,
  note: `400 22px ${FONT_STACK}`,
};
const LH = { opening: 34, header: 40, item: 32, total: 40, note: 30 };
const NUM_COL = 44;   // "12." column
const GAP = 16;       // between item text and price
const INK = "#16151f", MUTED = "#6b6a7a", RULE = "#e2e1ea";

export type Measure = (text: string, font: string) => number;
export type DrawOp =
  | { kind: "text"; text: string; x: number; y: number; font: string; align: "left" | "right" | "center"; color: string }
  | { kind: "rule"; y: number }
  | { kind: "image"; x: number; y: number; w: number; h: number };
export interface ReceiptLayout { width: number; height: number; ops: DrawOp[]; totalText: string; allPriced: boolean }

export const formatAmount = (currency: string, n: number): string =>
  `${currency}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Total rule: the sum only when there is at least one line and EVERY line has total > 0;
// otherwise the "to be confirmed" label stands in for the amount.
export function receiptTotalText(lines: ReceiptLine[], currency: string, toBeConfirmed: string): { text: string; allPriced: boolean } {
  const allPriced = lines.length > 0 && lines.every((l) => Number(l.total) > 0);
  if (!allPriced) return { text: toBeConfirmed, allPriced };
  const sum = lines.reduce((s, l) => s + Number(l.total), 0);
  return { text: formatAmount(currency, sum), allPriced };
}

// Greedy wrap that never clips: break at the last space when there is one, otherwise
// mid-word (CJK has no spaces). Explicit newlines start a new line; empty lines are kept.
export function wrapText(text: string, maxWidth: number, font: string, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of String(text ?? "").split(/\r?\n/)) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    for (const ch of Array.from(para)) {
      const next = line + ch;
      if (line === "" || measure(next, font) <= maxWidth) { line = next; continue; }
      const sp = line.lastIndexOf(" ");
      if (sp > 0) {
        out.push(line.slice(0, sp));
        line = line.slice(sp + 1) + ch;
      } else {
        out.push(line);
        line = ch;
      }
    }
    out.push(line);
  }
  return out;
}

export function layoutReceipt(input: ReceiptInput, measure: Measure, qrSize?: { w: number; h: number } | null): ReceiptLayout {
  const W = RECEIPT_WIDTH, P = RECEIPT_PAD, CW = W - P * 2;
  const ops: DrawOp[] = [];
  let y = P;
  const text = (t: string, x: number, font: string, align: "left" | "right" | "center" = "left", color = INK) =>
    ops.push({ kind: "text", text: t, x, y, font, align, color });

  if (input.opening.trim()) {
    for (const l of wrapText(input.opening.trim(), CW, F.opening, measure)) { y += LH.opening; text(l, P, F.opening); }
    y += 18;
  }
  const header = `#${input.buyerNum} ${input.buyerName}`.trim();
  for (const l of wrapText(header, CW, F.header, measure)) { y += LH.header; text(l, P, F.header); }
  y += 16; ops.push({ kind: "rule", y }); y += 8;

  input.lines.forEach((ln, i) => {
    const priced = Number(ln.total) > 0;
    const price = priced ? formatAmount(input.currency, Number(ln.total)) : "";
    const priceW = priced ? measure(price, F.price) : 0;
    const itemW = CW - NUM_COL - (priced ? priceW + GAP : 0);
    const wrapped = wrapText(ln.item || "", Math.max(itemW, 40), F.item, measure);
    wrapped.forEach((l, j) => {
      y += LH.item;
      if (j === 0) {
        text(`${i + 1}.`, P, F.num, "left", MUTED);
        if (priced) text(price, P + CW, F.price, "right");
      }
      text(l, P + NUM_COL, F.item);
    });
    y += 6;
  });

  y += 6; ops.push({ kind: "rule", y }); y += 6;
  const { text: totalText, allPriced } = receiptTotalText(input.lines, input.currency, input.labels.toBeConfirmed);
  const labelW = measure(input.labels.total, F.totalLabel);
  const amountFont = allPriced ? F.totalAmount : F.totalLabel;
  const amountLines = wrapText(totalText, Math.max(CW - labelW - GAP, 80), amountFont, measure);
  amountLines.forEach((l, j) => {
    y += LH.total;
    if (j === 0) text(input.labels.total, P, F.totalLabel);
    text(l, P + CW, amountFont, "right", allPriced ? INK : MUTED);
  });

  if (input.note.trim()) {
    y += 22;
    for (const l of wrapText(input.note.trim(), CW, F.note, measure)) { y += LH.note; text(l, P, F.note); }
  }
  if (qrSize && qrSize.w > 0 && qrSize.h > 0) {
    const w = Math.min(QR_MAX_WIDTH, CW, qrSize.w);
    const h = Math.round((qrSize.h * w) / qrSize.w);
    y += 24;
    ops.push({ kind: "image", x: Math.round((W - w) / 2), y, w, h });
    y += h;
  }
  return { width: W, height: Math.ceil(y + P), ops, totalText, allPriced };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("qr_load_failed"));
    img.src = src;
  });
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
  for (const op of layout.ops) {
    if (op.kind === "text") {
      ctx.font = op.font; ctx.fillStyle = op.color; ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y - 8);
    } else if (op.kind === "rule") {
      ctx.fillStyle = RULE; ctx.fillRect(RECEIPT_PAD, op.y, layout.width - RECEIPT_PAD * 2, 2);
    } else if (qr) {
      ctx.drawImage(qr, op.x, op.y, op.w, op.h);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png_failed"))), "image/png"));
}
