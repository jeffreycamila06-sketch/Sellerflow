// Auto Mode — PURE matching + inventory logic (no DB / socket / React). A seller
// maps a CODE → a catalog product (+ its price); the product's stock is the code's
// inventory. When a live comment is EXACTLY a code, every commenter gets an
// auto-order first-come (socket arrival order), decrementing stock until sold out.
//
// This module is the pure core only — the socket seam (useLiveFeed.onComment), the
// ref-backed concurrency lock, the atomic DB decrement RPC, and order creation live
// in their own adapters. Keeping match/claim pure makes them exhaustively testable.
//
// Q-decisions baked in:
//   Q1 case-insensitive ("D" == "d")
//   Q2 strict exact-match: normalized comment === normalized code, whitespace
//      trimmed, but punctuation is NOT stripped → "D." ("d.") ≠ "D" ("d")
//   Q3 tie-break (arrival order) + Q4 inventory-driven are handled by the caller.

export interface AutoCode {
  code: string;            // the trigger token a buyer types (e.g. "D")
  productLocalId: number;  // links to products.local_id (cross-device + Part-2 auto-delete)
  price: number;           // order price (the product's price; editable in setup)
  productName: string;     // for display / the sold-out toast
}

// Canonical form for comparing a code or a comment: trim surrounding whitespace and
// lowercase. Punctuation is intentionally preserved so "D." never equals "D".
export function normalizeCode(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

// Returns the code whose token EXACTLY equals the comment (after normalize), or null.
// Because the match is exact, a comment maps to at most one code; the first matching
// entry wins if a map somehow contains duplicates. Empty comments never match.
export function matchCode(text: string, codes: AutoCode[]): AutoCode | null {
  const c = normalizeCode(text);
  if (!c) return null;
  for (const entry of codes) {
    if (normalizeCode(entry.code) === c) return entry;
  }
  return null;
}

export interface StockClaim {
  ok: boolean;        // true → this comment may create an auto-order
  nextStock: number;  // stock after the claim (never negative)
  soldOut: boolean;   // true → the code is now (or already was) out of stock
}

// One inventory claim against the current stock. ok only when stock > 0; the claim
// decrements by 1 and reports sold-out when it reaches 0. A non-positive stock is
// already sold out → ok:false. PURE; the caller applies this against a ref-backed
// live count (same-device anti-double-decrement) and the atomic RPC (cross-device).
export function claimStock(stock: number): StockClaim {
  if (stock > 0) {
    const nextStock = stock - 1;
    return { ok: true, nextStock, soldOut: nextStock === 0 };
  }
  return { ok: false, nextStock: 0, soldOut: true };
}

// PURE decision for one incoming comment: match a code, then claim its inventory.
//   • "none"    → not a code (do nothing)
//   • "soldout" → matched a code that's already out of stock (no order; caller toasts)
//   • "order"   → create the auto-order; caller commits nextStock + toasts if soldOut
// Dedup of the same comment, the ref-backed stock mutation, the toast, and order
// creation are the CALLER's job (they're stateful/side-effecting) — this just decides.
export type AutoPlan =
  | { kind: "none" }
  | { kind: "soldout"; code: AutoCode }
  | { kind: "order"; code: AutoCode; nextStock: number; soldOut: boolean };

export function planAutoOrder(text: string, codes: AutoCode[], stockOf: (localId: number) => number): AutoPlan {
  const code = matchCode(text, codes);
  if (!code) return { kind: "none" };
  const claim = claimStock(stockOf(code.productLocalId));
  if (!claim.ok) return { kind: "soldout", code };
  return { kind: "order", code, nextStock: claim.nextStock, soldOut: claim.soldOut };
}
