// "Send to TikTok" (admin-only preview). TikTok has no DM API, so — like the Pickup Status
// Chase — the seller copies a ready message and opens the buyer's profile, then taps
// Message → Paste → Send in TikTok. Everything here is PURE + message-only: nothing is
// written to orders / live_session_orders / products / Sales. The only thing remembered is
// the seller's last note (localStorage, per seller id).
import { fmt } from "../data";

/** Who sees Send: an admin, or a seller on the "tiktok_send" preview list (sql/126). */
export const tiktokSendAllowed = (isAdmin: boolean, listed: boolean): boolean => isAdmin || listed;

export interface SendLine {
  key: string;
  text: string;
  price: string;   // the editable field ("" = 0)
  added: boolean;  // added in the sheet (+ Dagdag item) — message only
  qty: number;     // the order's quantity (read-only; added lines = 1). The price stays the LINE total.
}

/** The buyer card's lines, in the card's order (NT$0 lines included). */
export function initialSendLines(lines: { item: string; total: number; qty?: number }[]): SendLine[] {
  return lines.map((l, i) => ({ key: `c${i}`, text: l.item, price: String(Number(l.total) || 0), added: false, qty: qtyOf(l.qty) }));
}

/** A whole quantity ≥ 1 (missing / odd values → 1). */
export const qtyOf = (q: unknown): number => {
  const n = Math.floor(Number(q));
  return Number.isFinite(n) && n > 1 ? n : 1;
};
/** " x3" after the item text, only when qty > 1. */
export const qtySuffix = (qty: number): string => (qtyOf(qty) > 1 ? ` x${qtyOf(qty)}` : "");

export const priceOf = (s: string): number => {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Total of the lines going into the message (removed lines are not in `lines`). */
export const sumLines = (lines: SendLine[]): number => lines.reduce((s, l) => s + priceOf(l.price), 0);

/** Total shown in the message: the seller's override when set, else the sum. */
export const messageTotal = (lines: SendLine[], override: string | null): number =>
  override !== null && override.trim() !== "" ? priceOf(override) : sumLines(lines);

export interface MessageLabels { hi: string; order: string; total: string }

/** The message text. Blank-text added lines are left out; numbering has no gaps. */
export function buildSendMessage(o: {
  name: string; date: string; lines: SendLine[]; total: number; cur: string; note: string; labels: MessageLabels;
}): string {
  const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const rows = o.lines.filter((l) => l.text.trim() !== "");
  const out = [
    fill(o.labels.hi, { name: o.name }),
    fill(o.labels.order, { date: o.date }),
    ...rows.map((l, i) => `${i + 1}. ${l.text.trim()}${qtySuffix(l.qty)} — ${o.cur}${fmt(priceOf(l.price))}`),
    fill(o.labels.total, { total: `${o.cur}${fmt(o.total)}` }),
  ];
  const note = o.note.trim();
  if (note) out.push(note);
  return out.join("\n");
}

/** Session date for the message: the Taipei day of the buyer's first order (MM/DD), else the fallback day. */
export function sessionDateLabel(orderNums: number[], fallbackDay: string): string {
  const first = orderNums.filter((n) => Number.isFinite(n) && n > 1e12).sort((a, b) => a - b)[0];
  const day = first
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first))
    : fallbackDay;
  return day && day.length >= 10 ? day.slice(5, 10).replace("-", "/") : day;
}

// ── the seller's last note (the ONLY thing remembered) ──
export const noteKey = (sellerId: string) => `sfl_rd_tt_send_note_${sellerId || "anon"}`;
export function loadSendNote(sellerId: string): string {
  try { return localStorage.getItem(noteKey(sellerId)) || ""; } catch { return ""; }
}
export function saveSendNote(sellerId: string, note: string): void {
  try { localStorage.setItem(noteKey(sellerId), note); } catch { /* best-effort */ }
}
