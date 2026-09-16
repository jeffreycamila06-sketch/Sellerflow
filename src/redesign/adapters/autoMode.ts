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

// Rule 2 — the ONLY quantity format: "<code><space><digits>" (e.g. "A1 2", "a1 2").
// qty must be 1..99. NO "x2" / "*2" / "2 A1". Parsed ONLY when the whole comment is
// NOT already an exact code (exact wins → qty 1), so a code that literally contains
// a trailing " <n>" (a seller may set any string) still matches exactly first.
export const MAX_AUTO_QTY = 99;
const QTY_RE = /^(.+)\s+(\d{1,2})$/; // {1,2} digits ⇒ 0..99; "A1 100" (3 digits) never matches → nomatch

export type AutoParse =
  | { code: AutoCode; qty: number }
  | { kind: "nomatch" };

// Match a comment to a code + quantity under Jeff's strict rules:
//   1. Exact match on the WHOLE comment → { code, qty: 1 } (unchanged behavior).
//   2. Else, if the comment is "<head> <1-2 digits>" AND head exactly matches a
//      code AND the number is 1..99 → { code, qty }. ("A1 0" → qty 0 → nomatch;
//      "A1 100" → 3 digits → the regex never matches → nomatch.)
//   3. Otherwise → nomatch.
// "A12" (no space) only ever matches a code literally named "A12" — it never
// becomes "A1" qty 2, because the qty branch REQUIRES whitespace before the digits.
export function parseAutoComment(text: string, codes: AutoCode[]): AutoParse {
  const exact = matchCode(text, codes);
  if (exact) return { code: exact, qty: 1 };
  const m = QTY_RE.exec(String(text ?? "").trim());
  if (m) {
    const head = matchCode(m[1], codes);
    const qty = Number(m[2]);
    if (head && Number.isInteger(qty) && qty >= 1 && qty <= MAX_AUTO_QTY) return { code: head, qty };
  }
  return { kind: "nomatch" };
}

export interface StockClaim {
  ok: boolean;        // true → this comment may create an auto-order for the full qty
  nextStock: number;  // stock after the claim (never negative)
  soldOut: boolean;   // true → the code is now (or already was) out of stock
}

// One inventory claim of `qty` units against the current stock. ok only when the
// WHOLE quantity fits (stock >= qty, qty within 1..99) — NO partial fill (Jeff).
// A short/zero stock → ok:false. PURE; the caller applies this against a ref-backed
// live count (same-device anti-double-decrement) and the atomic RPC (cross-device).
export function claimStock(stock: number, qty: number = 1): StockClaim {
  const q = Math.floor(qty);
  if (stock > 0 && q >= 1 && q <= MAX_AUTO_QTY && stock >= q) {
    const nextStock = stock - q;
    return { ok: true, nextStock, soldOut: nextStock === 0 };
  }
  return { ok: false, nextStock: 0, soldOut: stock <= 0 };
}

// PURE decision for one incoming comment: parse a code (+qty), then claim inventory.
//   • "none"    → not a code (do nothing)
//   • "soldout" → matched a code that's already at 0 (no order; caller badges/banners)
//   • "short"   → matched, stock > 0 but < requested qty → REJECT whole order (no partial)
//   • "order"   → create the auto-order for `qty`; caller commits nextStock + soldOut
// Rule 1 (one order per session/handle/code) is a STATEFUL dedup the caller checks
// BEFORE calling this (it owns the session set + the DB backstop). The same-comment
// dedup, the ref-backed stock mutation, and order creation are also the caller's job.
export type AutoPlan =
  | { kind: "none" }
  | { kind: "soldout"; code: AutoCode }
  | { kind: "short"; code: AutoCode; qty: number; available: number }
  | { kind: "order"; code: AutoCode; qty: number; nextStock: number; soldOut: boolean };

export function planAutoOrder(text: string, codes: AutoCode[], stockOf: (localId: number) => number): AutoPlan {
  const parsed = parseAutoComment(text, codes);
  if ("kind" in parsed) return { kind: "none" };
  const { code, qty } = parsed;
  const stock = stockOf(code.productLocalId);
  if (stock <= 0) return { kind: "soldout", code };
  if (stock < qty) return { kind: "short", code, qty, available: stock };
  const claim = claimStock(stock, qty);
  return { kind: "order", code, qty, nextStock: claim.nextStock, soldOut: claim.soldOut };
}
