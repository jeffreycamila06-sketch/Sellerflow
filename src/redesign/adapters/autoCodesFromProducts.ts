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
