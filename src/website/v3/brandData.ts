// Seller Website v3 — what the Brand store home shows (pure, unit-tested). It reuses the seller's Build 1
// home content: slide 1 → the band's title + text; the category pictures → the two big tiles and the
// category tiles ("from <lowest price>"); trust lines, promo, steps, FAQ as they are.
import type { Shop, ShopProduct } from "../shopApi";
import { categoriesOf, homeSlides } from "../pages/homeData";
import { cardFacts } from "../v2/cardFacts";
import { wasPrice, priceNow } from "../pricing";

export interface BrandCat { name: string; pic?: string; from: number }
/** The band: the seller's first slide (title + text), else the shop's name + tagline. */
export function brandBand(shop: Shop): { title?: string; text?: string } {
  const s = homeSlides(shop.shop)[0];
  return s ? { title: s.title, text: s.text } : {};
}
/** Every category with its picture and lowest price now (the cheapest option; sold-out products count too). */
export function brandCategories(shop: Shop, nowMs: number): BrandCat[] {
  return categoriesOf(shop).map((c) => {
    const prices = shop.products.filter((p) => p.category === c.name).map((p) => priceNow(p, nowMs));
    return { ...c, from: prices.length ? Math.min(...prices) : 0 };
  });
}
/** The two big tiles: the seller's pick (categories that still exist and have a picture), else the first two with pictures. */
export function brandTiles(cats: BrandCat[], pick?: string[]): BrandCat[] {
  const withPic = cats.filter((c) => !!c.pic);
  const chosen = (pick || []).map((n) => withPic.find((c) => c.name === n)).filter((c): c is BrandCat => !!c);
  const out = [...chosen];
  for (const c of withPic) { if (out.length >= 2) break; if (!out.some((x) => x.name === c.name)) out.push(c); }
  return out.slice(0, 2);
}
/** On sale = an old price or a running flash sale, in stock first. */
export const onSale = (list: ShopProduct[], nowMs: number) =>
  list.filter((p) => !!wasPrice(p, nowMs)).sort((a, b) => Number(cardFacts(b, nowMs).stock > 0) - Number(cardFacts(a, nowMs).stock > 0)).slice(0, 10);
