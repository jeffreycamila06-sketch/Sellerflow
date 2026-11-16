// Seller Website v2 — product page helpers (pure, unit-tested).
import type { ShopProduct } from "../shopApi";
import type { CheckoutV2, ShipOpt } from "../shipPay";
import { productStock } from "../cart";

/** The cheapest delivery for this amount (its free-over counted), or null when the shop has none. */
export function cheapestDelivery(ck: CheckoutV2, amount: number): { opt: ShipOpt; fee: number } | null {
  let best: { opt: ShipOpt; fee: number } | null = null;
  for (const o of ck.options) {
    const fee = o.freeOver && amount >= o.freeOver ? 0 : o.fee;
    if (!best || fee < best.fee) best = { opt: o, fee };
  }
  return best;
}
/** "You may also like": the same category first, then others; in stock first; up to 6, never itself. */
export function relatedProducts(list: ShopProduct[], p: ShopProduct): ShopProduct[] {
  const others = list.filter((x) => x.id !== p.id);
  const rank = (x: ShopProduct) => (x.category && x.category === p.category ? 0 : 2) + (productStock(x) > 0 ? 0 : 1);
  return others.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((y) => y.x).slice(0, 6);
}
