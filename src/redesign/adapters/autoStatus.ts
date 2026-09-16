// Auto Mode Rule 3 — low-stock + sold-out derivation. PURE + a tiny localStorage
// threshold. Source of truth for the LIVE indicators is the seller's code→stock
// snapshot (RedesignApp keeps a reactive mirror of autoStockRef, updated on each
// auto order + on restock via the onSaved lift). No DB read, no poll.
export const AUTO_LOWSTOCK_KEY = "sfl_rd_auto_lowstock";
export const DEFAULT_LOW_STOCK = 3;
export const MAX_LOW_STOCK = 99;

// Seller-configurable low-stock threshold (default 3). Clamped 0..99; 0 disables the
// low-stock warning (sold-out at 0 still always shows). Never throws.
export function loadLowStockThreshold(): number {
  try {
    const raw = localStorage.getItem(AUTO_LOWSTOCK_KEY);
    if (raw == null) return DEFAULT_LOW_STOCK;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return DEFAULT_LOW_STOCK;
    return Math.min(n, MAX_LOW_STOCK);
  } catch { return DEFAULT_LOW_STOCK; }
}
export function saveLowStockThreshold(n: number): void {
  try { localStorage.setItem(AUTO_LOWSTOCK_KEY, String(Math.max(0, Math.min(MAX_LOW_STOCK, Math.floor(n) || 0)))); } catch { /* ignore */ }
}

export interface AutoCodeStock { code: string; productLocalId: number; productName: string; stock: number }
export interface AutoStatus { lowStock: AutoCodeStock[]; soldOut: AutoCodeStock[] }

// PURE — split the live code→stock list into sold-out (stock <= 0) and low-stock
// (0 < stock <= threshold). PER CODE (Jeff: "A1 · 3 left") — two codes on the same
// product each show. threshold <= 0 disables the low-stock list; sold-out is always
// derived. Rows keep the caller's order (the seller's code order).
export function deriveAutoStatus(codes: AutoCodeStock[], threshold: number): AutoStatus {
  const lowStock: AutoCodeStock[] = [];
  const soldOut: AutoCodeStock[] = [];
  for (const c of codes) {
    if (c.stock <= 0) soldOut.push(c);
    else if (threshold > 0 && c.stock <= threshold) lowStock.push(c);
  }
  return { lowStock, soldOut };
}

// Build the reactive code→stock snapshot from the live matcher refs (codes + a
// productLocalId→stock map). PURE so RedesignApp can rebuild it at load / restock /
// after each order without duplicating the shape.
export function buildAutoCodeStock(
  codes: { code: string; productLocalId: number; productName: string }[],
  stockOf: (localId: number) => number,
): AutoCodeStock[] {
  return codes.map((c) => ({ code: c.code, productLocalId: c.productLocalId, productName: c.productName, stock: stockOf(c.productLocalId) }));
}
