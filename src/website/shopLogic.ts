// Seller Website — buyer-side pure logic (sorting, search, the variant picker). Unit-tested.
import type { ShopProduct, ShopVariant } from "./shopApi";
import { fromPrice } from "./cart";

export type Sort = "newest" | "price_low" | "price_high";
export const NEW_DAYS = 7;
export function compact(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return n.toLocaleString("en-US");
}
export function sortProducts(list: ShopProduct[], sort: Sort): ShopProduct[] {
  const l = [...list];
  if (sort === "price_low") return l.sort((a, b) => fromPrice(a) - fromPrice(b));
  if (sort === "price_high") return l.sort((a, b) => fromPrice(b) - fromPrice(a));
  return l.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}
export function filterShop(list: ShopProduct[], q: string, cat: string): ShopProduct[] {
  const s = q.trim().toLowerCase();
  return list.filter((p) => (!cat || p.category === cat) && (!s || p.name.toLowerCase().includes(s) || (p.code || "").toLowerCase().includes(s) || (p.category || "").toLowerCase().includes(s)));
}

/** The variant for a full choice (one value per group), or null. Pure. */
export function variantFor(p: ShopProduct, pick: (string | null)[]): ShopVariant | null {
  if (!p.variants?.length || pick.some((v) => v === null)) return null;
  return p.variants.find((v) => v.values.length === pick.length && v.values.every((x, i) => x === pick[i])) || null;
}
/** Can value `val` of group `g` still be bought, given the other picks? (any matching variant with stock) Pure. */
export function valueAvailable(p: ShopProduct, pick: (string | null)[], g: number, val: string): boolean {
  return (p.variants || []).some((v) => v.stock > 0 && v.values[g] === val && v.values.every((x, i) => i === g || pick[i] === null || pick[i] === x));
}

