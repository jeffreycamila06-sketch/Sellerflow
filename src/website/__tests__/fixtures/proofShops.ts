// Shops and helpers for the "same as main" proofs (sameAsMain.pages / sameAsMain.flow). This file and those
// two tests run UNCHANGED on main and on a branch: main's results are kept in pagesOnMain.json / flowOnMain.json.
// Demo data only: no real shop, and the buyer is the placeholder "Demo Buyer".
import type { Shop } from "../../shopApi";
import type { OrderApi, OrderView, PlaceInput } from "../../orderApi";
import { DEMO_SHOP } from "../fixtures";

export const NOW = Date.parse("2026-11-16T08:00:00Z");
export const TOKEN = "f".repeat(64);
const soon = new Date(NOW + 2 * 3600000).toISOString();
const PRODUCTS: Shop["products"] = [
  ...DEMO_SHOP.products,
  { id: 5, name: "Vintage sport tee", price: 280, stock: 0, category: "Tops", createdAt: "2026-11-10T00:00:00Z", photos: ["demo/p5.jpg", "demo/p5b.jpg"], oldPrice: 400, flashPrice: 249, flashEnd: soon, sold: 134, condition: "9/10", sizeGuide: "M · chest 52 cm",
    description: "Soft, broken-in feel.", groups: [{ name: "Color", values: ["Purple", "Black"], color: true, swatches: { Purple: "#7c3aed", Black: "#1f2937" } }, { name: "Size", values: ["M", "L"] }],
    variants: [{ id: 51, values: ["Purple", "M"], price: 280, stock: 2, photo: 0 }, { id: 52, values: ["Purple", "L"], price: 280, stock: 3, photo: null }, { id: 53, values: ["Black", "M"], price: 280, stock: 0, photo: 1 }] },
  { id: 6, name: "Plain tee, sizes only", price: 200, stock: 0, category: "Tops", createdAt: "2026-11-15T00:00:00Z", photos: ["demo/p6.jpg"], sold: 12,
    groups: [{ name: "Size", values: ["S", "M"] }], variants: [{ id: 61, values: ["S"], price: 200, stock: 2, photo: null }, { id: 62, values: ["M"], price: 200, stock: 0, photo: null }] },
];
const DESIGN: Shop["shop"] = {
  ...DEMO_SHOP.shop,
  slides: [{ title: "Friday drop", text: "One of each.", button: "Shop the drop", pic: "u1/site-slide-1.jpg" }, { title: "Hoodie season", text: "From NT$480.", cat: "Tops" }],
  trust: [{ title: "7-11 & FamilyMart", sub: "Free over NT$1,500" }, { title: "Pay on delivery OK" }],
  promo: { title: "Bundle any 3 tops", text: "Mix sizes.", button: "Shop tops", cat: "Tops" },
  faq: [{ q: "How long is shipping?", a: "2–3 days." }], catPics: { Tops: "u1/site-cat-1.jpg", Dresses: "u1/site-cat-2.jpg" },
  chats: { messenger: "budgetukay", line: "@budgetukay", whatsapp: "886912000111", instagram: "budgetukay.tw" },
};
const base: Shop = { ...DEMO_SHOP, products: PRODUCTS, shop: DESIGN };
const look = (l: object): Shop => ({ ...base, shop: { ...DESIGN, look: l as never } });
/** One shop per way a shop can look today. */
export const SHOPS: Record<string, Shop> = {
  pop: base,
  boutique: { ...base, shop: { ...DESIGN, theme: "boutique", color: undefined } },
  bold: { ...base, shop: { ...DESIGN, theme: "bold", color: "#22c55e" } },
  brandOcean: look({ layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" }),
  brandBlush: look({ layout: "brand", top1: "#f472b6", top2: "#fb923c", btn: "#be185d", sale: "#e11d48", dark: false, font: "friendly", corners: "round", tiles: ["Dresses"] }),
  marketDark: look({ layout: "market", top1: "#0b0b0f", top2: "#4c1d95", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "classic", corners: "sharp" }),
};
export const VIEW: OrderView = {
  orderNo: "W-0012", status: "awaiting_payment", paymentIssue: false,
  items: [{ pid: 1, vid: 12, name: "Floral midi dress, soft chiffon, lined", label: "M · Pink", price: 350, qty: 2 }, { pid: 2, vid: null, name: "Linen button shirt, oversized", price: 280, qty: 2 }],
  subtotal: 1260, shipFee: 60, total: 1320, delivery: "s711", storeId: "123456", storeName: "Test Store", payment: "bank", buyerName: "Demo Buyer", phoneTail: "000",
  receipt: false, createdAt: "2026-11-16T07:00:00Z", autoCancelAt: "2026-11-17T07:00:00Z",
  shop: { sub: "budgetukay", name: "BudgetUkay", chats: DESIGN.chats }, country: "TW",
  pay: { bank: { bankName: "Test Bank (000)", accountName: "BudgetUkay", accountNumber: "0000-0000-0000" } },
};
export interface Recorder { calls: unknown[][] }
export function recordingApi(rec: Recorder): OrderApi {
  return {
    place: async (sub: string, input: PlaceInput, device?: string) => { rec.calls.push(["place", sub, input, typeof device]); return { ok: true as const, orderNo: "W-0012", token: TOKEN, total: input.shownTotal ?? 0 }; },
    load: async (token: string) => { rec.calls.push(["load", token]); return VIEW; },
    uploadReceipt: async (token: string, f: File) => { rec.calls.push(["uploadReceipt", token, f.name, f.type]); return { ok: true as const }; },
  } as OrderApi;
}
export const CART = JSON.stringify([{ pid: 1, vid: 12, qty: 2 }, { pid: 2, vid: null, qty: 1 }]);
export const BUYER = JSON.stringify({ name: "Demo Buyer", phone: "0900 000 000", contact: "", address: "", stores: { s711: [{ id: "123456", name: "Test Store" }] } });
