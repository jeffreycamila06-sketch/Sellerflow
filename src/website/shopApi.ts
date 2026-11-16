// Seller Website — the buyer side's ONLY data source: the public RPCs of sql/163 (website_shop,
// website_place_order, website_order, website_order_receipt). No table is read directly; the RPCs
// return a whitelist (never the seller's email / phone / plan). No buyer data is logged anywhere.
import { toCheckoutV2, type CheckoutV2 } from "./shipPay";
import { isSupabaseConfigured, supabase } from "../supabase";

export interface ShopVariant { id: number; values: string[]; price: number; stock: number; photo: number | null; code?: string }
/** An option group; v2: `color` = the colour group, `swatches` = #rrggbb per value (validated on read). */
export interface ShopGroup { name: string; values: string[]; color?: boolean; swatches?: Record<string, string> }
export interface ShopProduct {
  id: number; name: string; price: number; stock: number; code?: string; category?: string; description?: string;
  createdAt?: string; photos: string[]; groups?: ShopGroup[]; variants?: ShopVariant[];
  // v2 (sql/165): optional — old price (struck through), a running flash sale (price + end), condition, size guide
  oldPrice?: number; flashPrice?: number; flashEnd?: string; condition?: string; sizeGuide?: string;
  sold?: number; // v2 (item 9): units sold, the product + its options (absent = none)
}
export type SocialKey = "facebook" | "instagram" | "tiktok" | "youtube" | "x" | "threads" | "shopee";
export type ChatKey = "messenger" | "line" | "whatsapp" | "instagram";
export interface ShopDesign {
  name?: string; tagline?: string; about?: string; logo?: string; cover?: string; color?: string; announcement?: string;
  live?: string; policy?: string; replyTime?: string; currency?: string; lang?: string;
  socials?: Partial<Record<SocialKey, string>>; chats?: Partial<Record<ChatKey, string>>;
  sections?: Partial<Record<"announcement" | "live" | "categories" | "about" | "policy" | "socials", boolean>>;
}
export interface ShopCheckout {
  ship: { s711?: { fee: number }; fm?: { fee: number }; home?: { fee: number } };
  freeOver?: number; bank?: { bankName?: string; accountName?: string; accountNumber?: string };
  qr?: { path: string; label?: string }; cod?: boolean; autoCancelHours?: number;
}
export interface Shop {
  online: true; sub: string; shop: ShopDesign; country: string; powered: boolean; verified: boolean;
  stats: { orders: number; products: number }; products: ShopProduct[]; checkout: ShopCheckout;
  /** v2 (sql/165): the seller's shipping options + payment methods. Absent before sql/165 → see shipPay.checkoutOf. */
  checkout2?: CheckoutV2;
}
export type ShopResult = Shop | { online: false };

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
/** RPC answer → a Shop (defensive: anything odd → offline). Pure. */
export function toShop(j: unknown): ShopResult {
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  if (!o || o.online !== true || typeof o.sub !== "string") return { online: false };
  const products = (Array.isArray(o.products) ? o.products : []).map((x): ShopProduct | null => {
    const p = x as Record<string, unknown>;
    if (!p || !Number.isFinite(Number(p.id))) return null;
    const variants = Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]).map((v) => ({
      id: num(v.id), values: Array.isArray(v.values) ? (v.values as unknown[]).map(String) : [], price: num(v.price), stock: Math.max(0, num(v.stock)),
      photo: v.photo === null || v.photo === undefined ? null : num(v.photo), code: str(v.code),
    })) : undefined;
    return {
      id: num(p.id), name: String(p.name ?? ""), price: num(p.price), stock: Math.max(0, num(p.stock)), code: str(p.code), category: str(p.category),
      description: str(p.description), createdAt: str(p.createdAt), photos: Array.isArray(p.photos) ? (p.photos as unknown[]).filter((x): x is string => typeof x === "string") : [],
      groups: Array.isArray(p.groups) ? cleanShopGroups(p.groups) : undefined, variants: variants && variants.length ? variants : undefined,
      ...(num(p.oldPrice, 0) > 0 ? { oldPrice: num(p.oldPrice) } : {}),
      ...(Number.isFinite(Number(p.flashPrice)) && p.flashPrice !== null && str(p.flashEnd) ? { flashPrice: num(p.flashPrice), flashEnd: str(p.flashEnd) } : {}),
      ...(str(p.condition) ? { condition: str(p.condition) } : {}), ...(str(p.sizeGuide) ? { sizeGuide: str(p.sizeGuide) } : {}),
      ...(num(p.sold, 0) > 0 ? { sold: Math.floor(num(p.sold)) } : {}),
    };
  }).filter((p): p is ShopProduct => p !== null);
  const c = (o.checkout && typeof o.checkout === "object" ? o.checkout : {}) as ShopCheckout;
  const stats = (o.stats && typeof o.stats === "object" ? o.stats : {}) as Record<string, unknown>;
  return {
    online: true, sub: o.sub, shop: (o.shop && typeof o.shop === "object" ? o.shop : {}) as ShopDesign, country: String(o.country || "TW"),
    powered: o.powered !== false, verified: o.verified === true, stats: { orders: num(stats.orders), products: num(stats.products) },
    products, checkout: { ...c, ship: c.ship || {} },
    ...(toCheckoutV2(o.checkout2) ? { checkout2: toCheckoutV2(o.checkout2)! } : {}),
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Option groups from the server, cleaned: names / values as strings, at most one colour group, swatches only #rrggbb. Pure. */
export function cleanShopGroups(raw: unknown): ShopGroup[] {
  let colour = false;
  return (Array.isArray(raw) ? raw : []).map((g): ShopGroup | null => {
    const o = g && typeof g === "object" ? (g as Record<string, unknown>) : null;
    if (!o || !Array.isArray(o.values)) return null;
    const out: ShopGroup = { name: String(o.name ?? ""), values: (o.values as unknown[]).map(String) };
    if (o.color === true && !colour) {
      colour = true; out.color = true;
      const sw = o.swatches && typeof o.swatches === "object" ? (o.swatches as Record<string, unknown>) : {};
      const ok: Record<string, string> = {};
      for (const v of out.values) if (typeof sw[v] === "string" && HEX.test(sw[v] as string)) ok[v] = sw[v] as string;
      if (Object.keys(ok).length) out.swatches = ok;
    }
    return out;
  }).filter((g): g is ShopGroup => g !== null);
}

export async function loadShop(sub: string): Promise<ShopResult | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("website_shop", { p_sub: sub });
    return error ? null : toShop(data);
  } catch { return null; }
}

/** The small copy of a website photo ("…-p3.jpg" → "…-p3-s.jpg", ~600 px) for the grid, cart and
 *  order lists; photo 1 (the live product picture) has none → itself. Pure. */
export const smallOf = (path: string): string => (/-p\d+\.jpg$/.test(path) ? path.replace(/\.jpg$/, "-s.jpg") : path);
/** A photo path in the public product-images bucket → its URL. */
export function photoUrl(path: string | undefined | null): string {
  if (!path || !supabase) return "";
  return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}

// ── money / language ──────────────────────────────────────────────────────────
export const currencyFor = (s: Shop) => s.shop.currency || (s.country === "TW" ? "NT$" : s.country === "PH" ? "₱" : "NT$");
export function money(cur: string, n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  return `${cur}${v.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(v) ? 0 : 2 })}`;
}
const COUNTRY_LANG: Record<string, string> = { TW: "zh-TW", CN: "zh", PH: "fil", VN: "vi", TH: "th", ID: "id", BG: "bg" };
/** The shop's language: the buyer's own pick (this device) → the seller's choice → the seller's country (TW = 繁體中文). */
export function shopLang(s: Shop | null, picked: string | null): string {
  if (picked) return picked;
  if (s?.shop.lang) return s.shop.lang;
  return COUNTRY_LANG[(s?.country || "TW").toUpperCase()] || "en";
}
export const LANG_KEY = "sfl_shop_lang";
export function readPickedLang(): string | null { try { return localStorage.getItem(LANG_KEY); } catch { return null; } }
export function savePickedLang(l: string): void { try { localStorage.setItem(LANG_KEY, l); } catch { /* per-device */ } }
