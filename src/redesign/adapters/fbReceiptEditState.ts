// INVOICING → FACEBOOK receipt editor — PURE helpers (no database, no React): the editor's fields ↔ the saved
// edit (sql/231 fb_receipt_edits) ↔ the picture's input. The picture input goes through the SAME shared
// functions the server's Send all uses (src/lib/receiptEdit.js), so the editor's live picture and the picture
// the buyer gets are drawn from the same input (only the fonts differ: the phone's own, the server's Noto).
// Tested against the server in fbSendAllEdit.server.test.ts.
import { applyReceiptEdit, cleanReceiptEdit, noEmoji, type ReceiptEdit } from "../../lib/receiptEdit.js";
import type { ReceiptInput } from "../../lib/receiptLayout.js";
import type { BuyerReceipt } from "./useReadData";

/** The editor's fields — the same shape the Orders receipt sheet keeps (prices as typed). */
export interface EditorLine { id: number; item: string; price: string }
export interface EditorState { opening: string; note: string; lines: EditorLine[]; shipping: string }
export interface PictureLabels { total: string; toBeConfirmed: string; more: string; shipping: string; howToPay: string; scanToPay: string }

const priceOf = (s: string): number | null => (String(s ?? "").trim() === "" ? null : Number(s));

/** The editor's fields → the edit as it is saved (a price box left empty = null). */
export function stateToEdit(s: EditorState): ReceiptEdit {
  return cleanReceiptEdit({
    opening: s.opening, note: s.note, shippingFee: priceOf(s.shipping),
    lines: s.lines.map((l) => ({ item: l.item, price: priceOf(l.price) })),
  });
}
/** A saved edit (a database row or a clean edit) → the editor's fields. */
export function editToState(raw: unknown): EditorState {
  const e = cleanReceiptEdit(raw);
  return {
    opening: e.opening, note: e.note,
    shipping: e.shippingFee === null ? "" : String(e.shippingFee),
    lines: e.lines.map((l, i) => ({ id: i, item: l.item, price: l.price === null ? "" : String(l.price) })),
  };
}
/** What the server sends when there is no edit: the saved format's opening + note, the buyer's order lines that
 *  are not cancelled (each line's total, as the Orders sheet starts), the Invoicing shipping fee. */
export function originalState(receipt: BuyerReceipt, cancelled: readonly boolean[], format: { opening: string; note: string }, fee: string): EditorState {
  return {
    opening: format.opening, note: format.note, shipping: String(fee ?? ""),
    lines: receipt.lines.flatMap((l, i) => (cancelled[i] ? [] : [{ id: i, item: l.item, price: String(l.total) }])),
  };
}
/** Same receipt? (the saved edit vs the original: "Edited" only when they differ) */
export function sameEdit(a: EditorState, b: EditorState): boolean {
  return JSON.stringify(stateToEdit(a)) === JSON.stringify(stateToEdit(b));
}
/** The picture's input of the editor's fields — the server builds its input with the same applyReceiptEdit on
 *  the same buyer number / name / QR / words / currency. */
export function fbPictureInput(state: EditorState, ctx: { receipt: BuyerReceipt; qrImage: string | null; cur: string; labels: PictureLabels }): ReceiptInput {
  const base: ReceiptInput = {
    opening: "", note: "", lines: [],
    qrImage: typeof ctx.qrImage === "string" && ctx.qrImage.startsWith("data:image/") ? ctx.qrImage : null,
    currency: ctx.cur, buyerNum: ctx.receipt.num,
    buyerName: noEmoji(ctx.receipt.name) || noEmoji(ctx.receipt.handle),
    labels: ctx.labels,
  };
  return applyReceiptEdit(base, stateToEdit(state));
}
/** The lines that show on the picture (numbered 1..n) — the editor numbers its rows with this. */
export function shownLineIds(state: EditorState): Set<number> {
  return new Set(state.lines.filter((l) => noEmoji(l.item).trim() !== "").map((l) => l.id));
}
