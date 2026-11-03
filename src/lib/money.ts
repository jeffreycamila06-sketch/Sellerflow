// Money helpers shared by every price input and price display (pure).
//
// Whole amounts render exactly as before ("350", "1,200" — NT$ has no cents), so
// nothing changes for Taiwan sellers. Only a non-whole amount (RM 2.90, ₱ 12.50)
// gets its cents, always 2 places ("2.90", never "2.9" or "3").

/** Display: whole → "1,200" (as before); cents → "2.90". */
export const fmtMoney = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Plain text (no thousands separator) for item/sticker strings: 350 → "350", 2.9 → "2.90". */
export const moneyText = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** A typed price: "," → "." (comma keypads), digits and ONE dot ("2,90" → "2.90", "12.5.0" → "12.50"). */
export const priceInput = (s: string): string => {
  const clean = String(s).replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const dot = clean.indexOf(".");
  return dot < 0 ? clean : clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, "");
};
