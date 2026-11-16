// Seller Website v2 — the Shop page's filters (pure, unit-tested): category, size, in stock only, on sale,
// search, and the sort (newest · best selling · price up · price down). No "top rated" — no ratings in Build 1.
import type { ShopProduct } from "./shopApi";
import { productStock } from "./cart";
import { priceNow, wasPrice } from "./pricing";
import { filterShop } from "./shopLogic";

export type ShopSort = "new" | "best" | "lo" | "hi";
export interface ShopFilter { cat: string; size: string; stock: boolean; sale: boolean; q: string; sort: ShopSort }
export const NO_FILTER: ShopFilter = { cat: "", size: "", stock: false, sale: false, q: "", sort: "new" };

/** The sizes a buyer can filter by: the values of every non-colour option group, first seen first. */
export function sizesOf(list: ShopProduct[]): string[] {
  const out: string[] = [];
  for (const p of list) for (const g of p.groups || []) if (!g.color) for (const v of g.values) if (!out.includes(v)) out.push(v);
  return out.slice(0, 16);
}
function hasSize(p: ShopProduct, size: string, inStock: boolean): boolean {
  const gi = (p.groups || []).findIndex((g) => !g.color && g.values.includes(size));
  if (gi < 0) return false;
  return (p.variants || []).some((v) => v.values[gi] === size && (!inStock || v.stock > 0));
}
export function applyFilter(list: ShopProduct[], f: ShopFilter, nowMs: number): ShopProduct[] {
  const out = filterShop(list, f.q, f.cat).filter((p) =>
    (!f.size || hasSize(p, f.size, f.stock)) && (!f.stock || productStock(p) > 0) && (!f.sale || wasPrice(p, nowMs) !== null));
  const t = (p: ShopProduct) => Date.parse(p.createdAt || "") || 0;
  const by: Record<ShopSort, (a: ShopProduct, b: ShopProduct) => number> = {
    new: (a, b) => t(b) - t(a) || b.id - a.id,
    best: (a, b) => (b.sold || 0) - (a.sold || 0) || t(b) - t(a),
    lo: (a, b) => priceNow(a, nowMs) - priceNow(b, nowMs),
    hi: (a, b) => priceNow(b, nowMs) - priceNow(a, nowMs),
  };
  return [...out].sort(by[f.sort]);
}
export const isFiltered = (f: ShopFilter) => !!(f.cat || f.size || f.stock || f.sale || f.q);
