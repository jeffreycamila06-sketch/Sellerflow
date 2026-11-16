// Seller Website v2 — what a product card shows (pure, unit-tested).
import type { ShopProduct } from "../shopApi";
import { productStock } from "../cart";
import { priceNow, wasPrice, percentOff } from "../pricing";
import { NEW_DAYS } from "../shopLogic";

/** The card's facts (pure, unit-tested). */
export function cardFacts(p: ShopProduct, nowMs: number) {
  const stock = productStock(p);
  const off = stock > 0 ? percentOff(p, nowMs) : 0;
  const isNew = !!p.createdAt && nowMs - Date.parse(p.createdAt) < NEW_DAYS * 86400000;
  const colour = p.groups?.find((g) => g.color);
  const sizes = p.groups?.find((g) => !g.color);
  const choice = (p.variants?.length || 0) > 1;
  return { stock, off, isNew, colour, sizes, choice, now: priceNow(p, nowMs), was: wasPrice(p, nowMs), from: (p.variants?.length || 0) > 1 && new Set(p.variants!.map((v) => v.price)).size > 1 };
}

