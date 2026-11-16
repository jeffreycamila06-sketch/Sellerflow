// Seller Website editor — PURE helpers (unit-tested): the seller's products → the shop's product list
// (same whitelist as the database's website_products_of), the settings → the buyer's checkout options
// (same rules as website_checkout_public), and the live preview Shop.
import type { Product } from "./products";
import type { Shop, ShopCheckout, ShopDesign, ShopProduct } from "../../website/shopApi";
import type { WebsiteSettings } from "./websiteSeller";
import { publicCheckoutV2 } from "./websiteShipPay";

const fee = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
/** settings → what a buyer sees at checkout (mirror of sql/163 website_checkout_public). */
export function checkoutFrom(st: WebsiteSettings): ShopCheckout {
  const s711 = st.ship?.s711?.enabled !== false, fm = st.ship?.fm?.enabled !== false, home = st.ship?.home?.enabled === true;
  const freeOver = Number(st.freeOver);
  const hours = Math.min(168, Math.max(1, Math.round(Number(st.autoCancelHours) || 24)));
  return {
    ship: { ...(s711 ? { s711: { fee: fee(st.ship?.s711?.fee, 60) } } : {}), ...(fm ? { fm: { fee: fee(st.ship?.fm?.fee, 60) } } : {}), ...(home ? { home: { fee: fee(st.ship?.home?.fee, 120) } } : {}) },
    ...(Number.isFinite(freeOver) && freeOver > 0 ? { freeOver } : {}),
    ...(st.bank?.enabled ? { bank: { bankName: st.bank.bankName, accountName: st.bank.accountName, accountNumber: st.bank.accountNumber } } : {}),
    ...(st.qr?.enabled && st.qr.path ? { qr: { path: st.qr.path, label: st.qr.label } } : {}),
    cod: st.cod?.enabled === true, autoCancelHours: hours,
  };
}
const soldOf = (id: number, kids: Product[], units?: Map<number, number>) => (units ? (units.get(id) || 0) + kids.reduce((a, c) => a + (units.get(c.id) || 0), 0) : 0);
/** The seller's products → the shop list: shown, top-level, newest first, variants under their product. */
export function shopProductsFrom(products: Product[], imagePaths: Map<number, string>, createdAt?: Map<number, string>, nowMs: number = Date.now(), soldUnits?: Map<number, number>): ShopProduct[] {
  const kids = new Map<number, Product[]>();
  for (const p of products) if (p.parentId !== undefined) kids.set(p.parentId, [...(kids.get(p.parentId) || []), p]);
  return products
    .filter((p) => p.parentId === undefined && p.showOnWebsite !== false)
    .map((p) => {
      const photos = [imagePaths.get(p.id), ...(p.photoPaths || [])].filter((x): x is string => !!x);
      const ch = (kids.get(p.id) || []).sort((a, b) => a.id - b.id);
      return {
        id: p.id, name: p.name, price: p.price, stock: p.stock, code: p.liveCode || undefined, category: p.category, description: p.description,
        createdAt: createdAt?.get(p.id), photos, groups: ch.length && p.variant?.groups?.length ? p.variant.groups : undefined,
        // v2 (sql/165): the same rule as website_products_of — a flash price only while its end time is ahead
        ...(p.oldPrice && p.oldPrice > 0 ? { oldPrice: p.oldPrice } : {}),
        ...(p.flashPrice !== undefined && p.flashPrice !== null && p.flashEnd && Date.parse(p.flashEnd) > nowMs ? { flashPrice: p.flashPrice, flashEnd: p.flashEnd } : {}),
        ...(p.condition?.trim() ? { condition: p.condition.trim() } : {}), ...(p.sizeGuide?.trim() ? { sizeGuide: p.sizeGuide.trim() } : {}),
        // v2 (item 9): the product + its options, as website_products_of
        ...(soldOf(p.id, kids.get(p.id) || [], soldUnits) > 0 ? { sold: soldOf(p.id, kids.get(p.id) || [], soldUnits) } : {}),
        variants: ch.length ? ch.map((c) => ({ id: c.id, values: c.variant?.values || [], price: c.price, stock: c.stock, photo: c.variant?.photo ?? null, code: c.liveCode || undefined })) : undefined,
      };
    })
    .sort((a, b) => b.id - a.id);
}
/** The editor's live preview (no network): the draft + products + settings as a buyer would see them. */
export function previewShop(sub: string, draft: ShopDesign, settings: WebsiteSettings, products: ShopProduct[], country: string, plan: string, orders = 0): Shop {
  return {
    online: true, sub: sub || "preview", shop: draft, country: (country || "TW").toUpperCase(), powered: String(plan).toLowerCase() !== "master", verified: true,
    stats: { orders, products: products.length }, products, checkout: checkoutFrom(settings), checkout2: publicCheckoutV2(settings, country || "TW"),
  };
}
/** Did the seller change anything since the last Publish? */
export function hasUnpublished(draft: ShopDesign, published: ShopDesign | null): boolean {
  return !!published && JSON.stringify(draft) !== JSON.stringify(published);
}
export const DEFAULT_SETTINGS: WebsiteSettings = { ship: { s711: { enabled: true, fee: 60 }, fm: { enabled: true, fee: 60 }, home: { enabled: false, fee: 120 } }, freeOver: 0, bank: { enabled: false }, qr: { enabled: false }, cod: { enabled: false }, autoCancelHours: 24 };
/** Payment & shipping form check: at least one delivery and one payment. Pure. */
export function settingsProblems(st: WebsiteSettings, country = "TW"): ("ship" | "pay")[] {
  const c = publicCheckoutV2(st, country);
  const out: ("ship" | "pay")[] = [];
  if (!c.options.length) out.push("ship");
  if (!c.methods.length) out.push("pay");
  return out;
}
