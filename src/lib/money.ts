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

/** Currencies with no cents: their price inputs stay digits-only (origin/main behaviour). */
export const NO_CENTS = new Set(["NT$", "₫", "Rp", "¥", "₩"]);
export const hasCents = (cur: string): boolean => !NO_CENTS.has(cur);

/**
 * A typed price. `cents=false` (NT$ …) = origin/main's rule verbatim: digits only ("1,200" → "1200").
 * `cents=true` = plain decimals: "," becomes ".", the FIRST "." is the decimal point, later dots are
 * dropped ("12.5.0" → "12.50"), at most 2 digits after it ("2.905" → "2.90"); no thousands parsing
 * ("1,200" → "1.20"); "-" and letters never pass.
 */
export function priceInput(s: string, cents = true): string {
  if (!cents) return String(s).replace(/[^0-9]/g, "");
  const v = String(s).replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot < 0) return v;
  return `${v.slice(0, dot)}.${v.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}
