// Seller Website v2 — what price a buyer sees (PURE, unit-tested). The database decides the price of
// an order (website_place_order, sql/165); this only shows the same rule:
//   a running flash sale (flashPrice + flashEnd in the future) sets the price of the product and of
//   every option; the struck-through price is the old price when it is higher, else (during a flash
//   sale) the normal price; "-N%" compares the two.
import type { ShopProduct, ShopVariant } from "./shopApi";

export const flashOn = (p: ShopProduct, nowMs: number): boolean =>
  p.flashPrice !== undefined && p.flashPrice !== null && !!p.flashEnd && Date.parse(p.flashEnd) > nowMs;
/** The normal price (a variant's own, else the product's lowest option, else the product's). */
export const basePrice = (p: ShopProduct, v?: ShopVariant | null): number =>
  v ? v.price : p.variants?.length ? Math.min(...p.variants.map((x) => x.price)) : p.price;
/** The price the buyer pays now. */
export const priceNow = (p: ShopProduct, nowMs: number, v?: ShopVariant | null): number => (flashOn(p, nowMs) ? (p.flashPrice as number) : basePrice(p, v));
/** The struck-through price, or null. */
export function wasPrice(p: ShopProduct, nowMs: number, v?: ShopVariant | null): number | null {
  const now = priceNow(p, nowMs, v);
  if (p.oldPrice !== undefined && p.oldPrice > now) return p.oldPrice;
  const base = basePrice(p, v);
  return flashOn(p, nowMs) && base > now ? base : null;
}
/** "-N%" (whole number) or 0. */
export function percentOff(p: ShopProduct, nowMs: number, v?: ShopVariant | null): number {
  const was = wasPrice(p, nowMs, v), now = priceNow(p, nowMs, v);
  return was && was > 0 && now < was ? Math.round((1 - now / was) * 100) : 0;
}
/** "hh:mm:ss" left until `endIso` (0 when over); more than a day → "Nd hh:mm:ss". */
export function countdown(endIso: string | undefined, nowMs: number): string {
  const ms = Math.max(0, (endIso ? Date.parse(endIso) : nowMs) - nowMs);
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(x)}`;
}
/** The soonest end of the flash sales running now (the Flash sale section's countdown). */
export function soonestFlashEnd(products: ShopProduct[], nowMs: number): string | undefined {
  return products.filter((p) => flashOn(p, nowMs)).map((p) => p.flashEnd as string).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}
