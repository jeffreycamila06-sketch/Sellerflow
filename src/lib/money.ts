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

/** Cent currencies whose keypad comma IS the decimal point ("2,90" → 2.90). Everywhere else "," is a thousands separator. */
export const COMMA_DECIMAL = new Set(["€"]);

/**
 * A typed price, by currency. `prev` is the field's current value: any "-" (typed or pasted) is
 * IGNORED — the field keeps `prev` ("-3" is never turned into 3).
 * - no-cent currency (NT$ …): commas stripped, everything from the first "." cut ("350.50" → "350", "1,200" → "1200").
 * - € : "," is the decimal point ("2,90" → "2.90").
 * - every other cent currency (₱, RM, $, ¥ …): commas are thousands separators and are removed
 *   ("1,200" → "1200", "1,200.50" → "1200.50"); "." is the decimal point.
 * Cents: the FIRST "." wins, later dots are dropped ("12.5.0" → "12.50"), at most 2 digits after it ("2.905" → "2.90").
 */
export function priceInput(s: string, cur = "", prev = ""): string {
  const raw = String(s);
  if (raw.includes("-")) return prev;
  if (!hasCents(cur)) {
    const v = raw.replace(/,/g, "").replace(/[^0-9.]/g, "");
    const dot = v.indexOf(".");
    return dot < 0 ? v : v.slice(0, dot);
  }
  const v = raw.replace(/,/g, COMMA_DECIMAL.has(cur) ? "." : "").replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot < 0) return v;
  return `${v.slice(0, dot)}.${v.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

/** The LIVE price box only: for no-cent currencies this is origin/main's rule verbatim (digits only, "350.50" → "35050"). */
export const livePriceInput = (s: string, cur: string, prev = ""): string => (hasCents(cur) ? priceInput(s, cur, prev) : String(s).replace(/[^0-9]/g, ""));
