// "Free" orders (Choose price before print → the Free button).
// ONE rule, used everywhere: an order is free when its price is 0 AND its item text is exactly
// "FREE". No database marker — the item text is what prints on the sticker, what is saved with
// the order and what comes back on a reload / Reprint.
//
// A normal 1-Click / pin with no price keeps the buyer's comment as its item, so it is NOT free
// (the one exception: a comment that is exactly the word "FREE" — its sticker prints FREE too).
// The word on the sticker is always English, in every app language.
export const FREE_ITEM = "FREE";

// The price must be a REAL number 0: a number, or a number written as text (the database can give
// "0" / "0.00"). null, undefined, "" and anything that is not a number are NOT free (Number("") and
// Number(null) are 0 in JavaScript — they must not count).
export function isFreeOrder(o: { price?: unknown; item?: unknown } | null | undefined): boolean {
  if (!o || o.item !== FREE_ITEM) return false;
  const p = o.price;
  const price = typeof p === "number" ? p : typeof p === "string" && p.trim() !== "" ? Number(p) : NaN;
  return Number.isFinite(price) && price === 0;
}

// A list of order lines → true only when there is at least one line and EVERY line is free.
export function allFree(lines: ReadonlyArray<{ price?: unknown; item?: unknown }>): boolean {
  return lines.length > 0 && lines.every(isFreeOrder);
}
