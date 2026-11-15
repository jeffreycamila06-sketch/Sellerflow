// Seller Website — the buyer side's ONLY data source: the public RPCs of sql/163 (website_shop,
// website_place_order, website_order, website_order_receipt). No table is read directly; the RPCs
// return a whitelist (never the seller's email / phone / plan). No buyer data is logged anywhere.
import { isSupabaseConfigured, supabase } from "../supabase";

export interface ShopVariant { id: number; values: string[]; price: number; stock: number; photo: number | null; code?: string }
export interface ShopProduct {
  id: number; name: string; price: number; stock: number; code?: string; category?: string; description?: string;
  createdAt?: string; photos: string[]; groups?: { name: string; values: string[] }[]; variants?: ShopVariant[];
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
      groups: Array.isArray(p.groups) ? (p.groups as { name: string; values: string[] }[]) : undefined, variants: variants && variants.length ? variants : undefined,
    };
  }).filter((p): p is ShopProduct => p !== null);
  const c = (o.checkout && typeof o.checkout === "object" ? o.checkout : {}) as ShopCheckout;
  const stats = (o.stats && typeof o.stats === "object" ? o.stats : {}) as Record<string, unknown>;
  return {
    online: true, sub: o.sub, shop: (o.shop && typeof o.shop === "object" ? o.shop : {}) as ShopDesign, country: String(o.country || "TW"),
    powered: o.powered !== false, verified: o.verified === true, stats: { orders: num(stats.orders), products: num(stats.products) },
    products, checkout: { ...c, ship: c.ship || {} },
  };
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
