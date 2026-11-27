// INVOICING → FACEBOOK: the seller's edit of ONE buyer's Messenger receipt (sql/231 fb_receipt_edits) →
// the picture's input. PURE and SHARED: the phone's editor (src/redesign/components/FbSendAllTab.tsx) and
// the server's Send all (server/fbSendAll.js) build the picture's input with these SAME functions, then
// lay it out with the shared layoutReceipt — so what the seller sees in the editor is what the buyer gets
// (only the fonts differ: the phone's own, the server's bundled Noto). Types: receiptEdit.d.ts.
// No imports, no DOM, no Node.

export const EDIT_MAX_LINES = 100;
export const EDIT_ITEM_MAX = 200;
export const EDIT_OPENING_MAX = 300;
export const EDIT_NOTE_MAX = 1000;
export const EDIT_PRICE_MAX = 100000000;

// Emoji (and their joiners / skin tones / flags / keycaps) out of a text for the server-drawn picture: the
// server's bundled Noto fonts have no emoji, so they would show as boxes. Letters of every script are kept.
// Spaces left doubled by a removed emoji are made single, and the ends trimmed. PURE.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
export function noEmoji(s) {
  if (typeof s !== "string" || !s) return s ?? "";
  if (!EMOJI_RE.test(s)) { EMOJI_RE.lastIndex = 0; return s; }
  EMOJI_RE.lastIndex = 0;
  return s.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").split("\n").map((l) => l.trim()).join("\n").trim();
}

const text = (v, max) => (typeof v === "string" ? v : "").slice(0, max);
const money = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, EDIT_PRICE_MAX) : null;
};

// Anything (the editor's state, a database row) → a clean edit that fits sql/231's checks:
// { opening, note, lines: [{ item, price: number | null }], shippingFee: number | null }. PURE.
export function cleanReceiptEdit(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const lines = (Array.isArray(r.lines) ? r.lines : []).slice(0, EDIT_MAX_LINES).map((l) => ({
    item: text(l && l.item, EDIT_ITEM_MAX),
    price: money(l && l.price),
  }));
  return {
    opening: text(r.opening, EDIT_OPENING_MAX),
    note: text(r.note, EDIT_NOTE_MAX),
    lines,
    shippingFee: money(r.shippingFee !== undefined ? r.shippingFee : r.shipping_fee),
  };
}

// The picture's lines of an edit: the item without emoji, trimmed; a line with no item is left out (the
// picture numbers the rest 1..n); a price that is not above 0 = 0 (the total then says "to be confirmed"). PURE.
export function editPictureLines(lines) {
  const out = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const item = noEmoji(String((l && l.item) ?? "")).trim();
    if (!item) continue;
    const p = Number(l && l.price);
    out.push({ item, total: Number.isFinite(p) && p > 0 ? p : 0 });
  }
  return out;
}

// The picture's input with the edit on top of `base` (the input of the same buyer drawn from the orders:
// buyer number + name, currency, QR and the words stay base's). Opening / note without emoji; the shipping
// fee only when above 0 (no key otherwise — the same as the orders' input). PURE.
export function applyReceiptEdit(base, raw) {
  const e = cleanReceiptEdit(raw);
  const { shippingFee: _drop, ...rest } = base || {};
  return {
    ...rest,
    opening: noEmoji(e.opening),
    note: noEmoji(e.note),
    lines: editPictureLines(e.lines),
    ...(e.shippingFee !== null && e.shippingFee > 0 ? { shippingFee: e.shippingFee } : {}),
  };
}
