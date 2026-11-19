// "Free" orders (Choose price before print → the Free button).
// ONE rule, used everywhere: an order is free when its price is 0 AND its item text is exactly
// "FREE". No database marker — the item text is what prints on the sticker, what is saved with
// the order and what comes back on a reload / Reprint.
//
// A normal 1-Click / pin with no price keeps the buyer's comment as its item, so it is NOT free
// (the one exception: a comment that is exactly the word "FREE" — its sticker prints FREE too).
// The word on the sticker is always English, in every app language.
export const FREE_ITEM = "FREE";

export function isFreeOrder(o: { price?: unknown; item?: unknown } | null | undefined): boolean {
  if (!o) return false;
  const price = typeof o.price === "number" ? o.price : Number(o.price);
  return price === 0 && o.item === FREE_ITEM;
}

// A list of order lines → true only when there is at least one line and EVERY line is free.
export function allFree(lines: ReadonlyArray<{ price?: unknown; item?: unknown }>): boolean {
  return lines.length > 0 && lines.every(isFreeOrder);
}
