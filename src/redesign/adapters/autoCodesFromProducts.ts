// Auto Mode source (Sep 17) — the code list is now DERIVED from the products
// catalog: one product with a non-empty live_code = one AutoCode. Price = the
// product's price, stock = the product's stock (seeded elsewhere by productLocalId).
// This REPLACES the old seller_auto_codes read as the source of autoCodesRef; the
// pure matchers (matchCode / parseAutoComment / claimStock / planAutoOrder) and the
// order/dedup/print paths are unchanged — only where the AutoCode[] comes from.
import type { Product } from "./products";
import type { AutoCode } from "./autoMode";

// Products with a real (trimmed, non-empty) live_code → AutoCode rows. Blank codes
// (manual-only products) are skipped. The code is trimmed to match the DB's
// btrim-based uniqueness + the live matcher's normalize (trim + lowercase).
export function codesFromProducts(products: Product[]): AutoCode[] {
  const out: AutoCode[] = [];
  for (const p of products) {
    const code = (p.liveCode || "").trim();
    if (!code) continue;
    out.push({ code, productLocalId: p.id, price: p.price, productName: p.name });
  }
  return out;
}

// What a Products-screen change did to the live auto-stock mirror (audit F1):
//   • "stock"  — the product's STOCK value changed (restock / edited stock, or a
//                brand-new product) → re-seed autoStockRef to the catalog value.
//   • "meta"   — only name/price/code/platform changed → the code list re-derives
//                (price/code go live), but the live DECREMENTED count is PRESERVED
//                (a mid-live rename must not reset a product's remaining stock).
//   • "delete" — the product is gone → drop its stock entry.
export type ProductChange = "stock" | "meta" | "delete";

// Apply a change to the live-stock map IN PLACE (mutates). Pure/deterministic —
// unit-tested. Leaves the map untouched for "meta" (the whole point of F1) and
// for a missing changedId/action.
export function applyStockChange(stock: Map<number, number>, products: Product[], changedId: number | undefined, action: ProductChange | undefined): void {
  if (changedId == null) return;
  if (action === "delete") { stock.delete(changedId); return; }
  if (action === "stock") {
    const p = products.find((x) => x.id === changedId);
    if (p) stock.set(changedId, p.stock);
  }
  // "meta" / undefined → preserve the live decremented count
}
