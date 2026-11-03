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
 * `cents=true`: the FIRST "." is the decimal point (later dots dropped: "12.5.0" → "12.50"); with no
 * dot, the LAST "," is the decimal point only when 1–2 digits follow it ("2,90" → "2.90", "2," stays
 * pending), any other comma is a thousands separator ("1,200" → "1200", "1,234.50" → "1234.50");
 * a lone separator with exactly 3 digits after it is a thousands group ("1.200" → "1200"); the
 * fraction is capped at 2 digits ("2.9051" → "2.90"); "-" and letters never pass.
 */
export function priceInput(s: string, cents = true): string {
  if (!cents) return String(s).replace(/[^0-9]/g, "");
  const v = String(s).replace(/[^0-9.,]/g, "");
  const seps = (v.match(/[.,]/g) || []).length;
  let int: string, frac: string;
  const dot = v.indexOf(".");
  if (dot >= 0) { int = v.slice(0, dot); frac = v.slice(dot + 1); }
  else {
    const m = /^(.*),(\d{0,2})$/.exec(v);
    if (!m) return v.replace(/,/g, "");
    int = m[1]; frac = m[2];
  }
  int = int.replace(/[.,]/g, ""); frac = frac.replace(/[.,]/g, "");
  if (seps === 1 && frac.length === 3) return int + frac;
  return `${int}.${frac.slice(0, 2)}`;
}
