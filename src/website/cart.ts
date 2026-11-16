// Seller Website — the buyer's cart (this device only, per shop). PURE helpers + localStorage.
// Prices and stock always come from the loaded shop; the server checks them again at order time.
import type { Shop, ShopProduct, ShopVariant } from "./shopApi";
import { priceNow } from "./pricing";

export interface CartLine { pid: number; vid: number | null; qty: number }
export interface LineInfo { line: CartLine; product: ShopProduct; variant: ShopVariant | null; price: number; stock: number; label: string; photo: string | undefined }

export const MAX_QTY = 99;
export function lineInfo(shop: Shop, line: CartLine, nowMs: number = Date.now()): LineInfo | null {
  const product = shop.products.find((p) => p.id === line.pid);
  if (!product) return null;
  if (product.variants?.length) {
    const variant = product.variants.find((v) => v.id === line.vid) || null;
    if (!variant) return null;
    const photo = variant.photo !== null && product.photos[variant.photo] ? product.photos[variant.photo] : product.photos[0];
    return { line, product, variant, price: priceNow(product, nowMs, variant), stock: variant.stock, label: variant.values.join(" · "), photo };
  }
  if (line.vid !== null) return null;
  return { line, product, variant: null, price: priceNow(product, nowMs), stock: product.stock, label: "", photo: product.photos[0] };
}
/** Total stock a product can sell (the sum of its variants when it has them). */
export const productStock = (p: ShopProduct) => (p.variants?.length ? p.variants.reduce((a, v) => a + v.stock, 0) : p.stock);
/** The lowest price shown on a card (a product with variants: from its cheapest variant). */
export const fromPrice = (p: ShopProduct) => (p.variants?.length ? Math.min(...p.variants.map((v) => v.price)) : p.price);

export function addLine(lines: CartLine[], pid: number, vid: number | null, qty: number, stock: number): CartLine[] {
  const i = lines.findIndex((l) => l.pid === pid && l.vid === vid);
  const have = i >= 0 ? lines[i].qty : 0;
  const next = Math.max(0, Math.min(stock, MAX_QTY, have + Math.max(1, Math.floor(qty))));
  if (next <= 0) return lines;
  if (i >= 0) return lines.map((l, k) => (k === i ? { ...l, qty: next } : l));
  return [...lines, { pid, vid, qty: next }];
}
export function setQty(lines: CartLine[], i: number, qty: number, stock: number): CartLine[] {
  const q = Math.max(1, Math.min(stock, MAX_QTY, Math.floor(qty)));
  return lines.map((l, k) => (k === i ? { ...l, qty: q } : l));
}
export const removeLine = (lines: CartLine[], i: number) => lines.filter((_, k) => k !== i);
/** Lines that still exist, each clamped to its stock (sold-out lines dropped). */
export function validLines(shop: Shop, lines: CartLine[], nowMs: number = Date.now()): LineInfo[] {
  return lines.map((l) => lineInfo(shop, l, nowMs)).filter((x): x is LineInfo => !!x && x.stock > 0).map((x) => ({ ...x, line: { ...x.line, qty: Math.min(x.line.qty, x.stock) } }));
}
export const subtotalOf = (infos: LineInfo[]) => infos.reduce((a, x) => a + x.price * x.line.qty, 0);
export const countOf = (lines: CartLine[]) => lines.reduce((a, l) => a + l.qty, 0);
/** Free-shipping progress: how much more, and the bar (0..1). No free-over amount → null. */
export function freeShipping(subtotal: number, freeOver: number | undefined): { remaining: number; pct: number } | null {
  if (!freeOver || freeOver <= 0) return null;
  return { remaining: Math.max(0, freeOver - subtotal), pct: Math.max(0, Math.min(1, subtotal / freeOver)) };
}

const key = (sub: string) => `sfl_shop_cart_${sub}`;
export function loadCart(sub: string): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(sub)) || "[]");
    return Array.isArray(raw) ? raw.filter((l) => l && Number.isFinite(l.pid) && (l.vid === null || Number.isFinite(l.vid)) && l.qty > 0).slice(0, 50) : [];
  } catch { return []; }
}
export function saveCart(sub: string, lines: CartLine[]): void { try { localStorage.setItem(key(sub), JSON.stringify(lines)); } catch { /* per-device */ } }
