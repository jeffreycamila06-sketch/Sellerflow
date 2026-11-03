// Money helpers shared by every price input and price display (pure).
//
// Whole amounts render exactly as before ("350", "1,200" — NT$ has no cents), so
// nothing changes for Taiwan sellers. Only a non-whole amount (RM 2.90, ₱ 12.50)
// gets its cents, always 2 places ("2.90", never "2.9" or "3").

/** Display: whole → "1,200" (as before); cents → "2.90". */
export const fmtMoney = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Plain text (no thousands separator) for item/sticker/CSV strings: 350 → "350", 2.9 → "2.90". */
export const moneyText = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Currencies with no cents: their price inputs take whole numbers only. (CNY ¥ HAS cents.) */
export const NO_CENTS = new Set(["NT$", "₫", "Rp", "₩"]);
export const hasCents = (cur: string): boolean => !NO_CENTS.has(cur);

/**
 * A typed price, by currency. Every non-digit is ignored.
 * - no-cent currency (NT$ …): everything from the first "." is cut ("350.50" → "350", "1,200" → "1200").
 * - every other currency: "." is the decimal point — the FIRST "." wins, later dots are dropped
 *   ("12.5.0" → "12.50"), at most 2 digits after it ("2.905" → "2.90"); "," is removed ("1,200.50" → "1200.50").
 */
export function priceInput(s: string, cur = ""): string {
  const v = String(s).replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot < 0) return v;
  if (!hasCents(cur)) return v.slice(0, dot);
  return `${v.slice(0, dot)}.${v.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}
