// Seller Website — the buyer's orders: place (ONE RPC, website_place_order), read the order link
// (website_order by token), upload a receipt (private bucket website-receipts + website_order_receipt).
// Everything the buyer types stays in these calls; nothing is logged or sent to analytics.
// The buyer's name / phone / last stores are remembered on THIS device only ("Not you?" clears it).
import { cleanParcel, type ParcelView } from "./parcelView";
import { isSupabaseConfigured, supabase } from "../supabase";
import { compressProductImage } from "../redesign/adapters/productImages";
import type { PayOpt, ShipNeeds, ShipOpt } from "./shipPay";
import { addrFormOf, addressErrors, phoneOk, type AddrParts } from "./addressForm";

/** The order's delivery kind (website_orders.delivery). v2 adds 'store' (a typed store) and 'pickup'. */
export type Delivery = "s711" | "fm" | "home" | "store" | "pickup";
/** The order's payment kind (website_orders.payment): bank = pay first, qr = pay first with a QR, cod = on delivery. */
export type Payment = "bank" | "qr" | "cod";
/** delivery / payment = the picked shipping option id / payment method id (Taiwan's are s711 / fm / home, bank / qr / cod). */
export interface OrderDraft {
  name: string; phone: string; contact: string; delivery: string | null; storeId: string; storeName: string;
  address: string; payment: string | null; note: string;
  /** v2 (item 12): Canada / Australia address parts (else the one address box above is used). */
  addr?: AddrParts;
}
/** ship / pay = the option + method ids (sql/167); delivery / payment = the kinds (what sql/163 reads). */
export interface PlaceInput extends Omit<OrderDraft, "delivery" | "payment" | "addr"> {
  ship: string; pay: string; delivery: Delivery; payment: Payment; items: { pid: number; vid: number | null; qty: number }[];
  /** The total the page showed the buyer (items + shipping). sql/167 places NO order when its own total differs
   *  ("price_changed"); an older database ignores it. */
  shownTotal?: number;
}
/** What the database worked out when the price changed between view and order (sql/167 audit fix 1). */
export interface PriceNow { total: number; subtotal: number; shipFee: number; items: { pid: number; vid: number | null; price: number }[] }
export type PlaceError =
  | "shop_closed" | "bad_name" | "bad_phone" | "bad_delivery" | "bad_store" | "bad_address" | "bad_payment"
  | "blocked" | "too_many" | "bad_items" | "item_gone" | "pick_option" | "out_of_stock" | "price_changed" | "network";
export type PlaceResult = { ok: true; orderNo: string; token: string; total: number } | { ok: false; error: PlaceError; pid?: number; vid?: number | null; left?: number; priceNow?: PriceNow };

export interface OrderItem { pid: number; vid?: number | null; name: string; label?: string; code?: string; price: number; qty: number; photo?: string }
export type OrderStatus = "awaiting_payment" | "payment_sent" | "paid" | "confirmed" | "shipped" | "cancelled";
export interface OrderView {
  orderNo: string; status: OrderStatus; paymentIssue: boolean; items: OrderItem[]; subtotal: number; shipFee: number; total: number;
  delivery: Delivery; storeId?: string; storeName?: string; address?: string; payment: Payment; buyerName: string; phoneTail: string; note?: string;
  shipId?: string; shipName?: string; // v2 (sql/167): the picked option
  payId?: string; payName?: string;   // v2 (sql/167): the picked payment method
  receipt: boolean; receiptAt?: string; createdAt: string; autoCancelAt?: string; paidAt?: string; shippedAt?: string; cancelledAt?: string; cancelReason?: "seller" | "auto";
  courier?: string; tracking?: string; // v2 (sql/167): only once shipped
  parcel?: ParcelView; // sql/171: the parcel's state from Pickup Status (7-ELEVEN / FamilyMart, shipped, one match)
  shop: { sub: string; name?: string; logo?: string; color?: string; chats?: Record<string, string>; currency?: string }; country: string;
  pay?: { bank?: { bankName?: string; accountName?: string; accountNumber?: string }; qr?: { path: string; label?: string }; method?: PayOpt };
}
export interface OrderApi {
  place(sub: string, input: PlaceInput, device: string): Promise<PlaceResult>;
  load(token: string): Promise<OrderView | null>;
  uploadReceipt(token: string, file: Blob): Promise<{ ok: true } | { ok: false; reason: "too_big" | "unreadable" | "failed" }>;
}

const ERRORS: PlaceError[] = ["shop_closed", "bad_name", "bad_phone", "bad_delivery", "bad_store", "bad_address", "bad_payment", "blocked", "too_many", "bad_items", "item_gone", "pick_option", "out_of_stock", "price_changed"];
/** A database error → the reason the buyer is told. Pure. */
export function placeError(e: { message?: string; hint?: string } | null | undefined): PlaceResult {
  const msg = String(e?.message || "");
  const error = ERRORS.find((x) => msg === x || msg.startsWith(`${x}`)) || "network";
  let extra: { pid?: number; vid?: number | null; left?: number } = {};
  let priceNow: PriceNow | undefined;
  try {
    const h = JSON.parse(String(e?.hint || ""));
    if (h && typeof h === "object") {
      if (error === "price_changed") priceNow = toPriceNow(h);
      else extra = { pid: Number(h.pid) || undefined, vid: h.vid === null || h.vid === undefined ? null : Number(h.vid), left: h.left === undefined ? undefined : Number(h.left) };
    }
  } catch { /* no hint */ }
  // a price change the page can't show the new total for is treated as a network error (nothing was placed)
  if (error === "price_changed" && !priceNow) return { ok: false, error: "network" };
  return { ok: false, error, ...extra, ...(priceNow ? { priceNow } : {}) };
}
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
/** The 'price_changed' hint → PriceNow (null when it isn't one). Pure. */
export function toPriceNow(h: unknown): PriceNow | null {
  const o = h && typeof h === "object" ? (h as Record<string, unknown>) : null;
  const total = Number(o?.total), subtotal = Number(o?.subtotal), shipFee = Number(o?.shipFee);
  if (!o || ![total, subtotal, shipFee].every(Number.isFinite)) return null;
  const items = (Array.isArray(o.items) ? o.items : []).flatMap((x) => {
    const i = x as Record<string, unknown>; const pid = Number(i?.pid), price = Number(i?.price);
    return Number.isFinite(pid) && Number.isFinite(price) ? [{ pid, vid: i.vid === null || i.vid === undefined ? null : Number(i.vid), price }] : [];
  });
  return { total, subtotal, shipFee, items };
}
/** RPC answer → OrderView (defensive). Pure. */
export function toOrderView(j: unknown): OrderView | null {
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  if (!o || o.found !== true || typeof o.orderNo !== "string") return null;
  const items = (Array.isArray(o.items) ? o.items : []).map((x) => {
    const i = x as Record<string, unknown>;
    return { pid: num(i.pid), vid: i.vid === undefined || i.vid === null ? null : num(i.vid), name: String(i.name ?? ""), label: typeof i.label === "string" ? i.label : undefined, code: typeof i.code === "string" ? i.code : undefined, price: num(i.price), qty: num(i.qty, 1), photo: typeof i.photo === "string" ? i.photo : undefined };
  });
  return { ...(o as unknown as OrderView), items, subtotal: num(o.subtotal), shipFee: num(o.shipFee), total: num(o.total), paymentIssue: o.paymentIssue === true, receipt: o.receipt === true, shop: (o.shop || { sub: "" }) as OrderView["shop"], country: String(o.country || "TW"),
    courier: typeof o.courier === "string" && o.courier ? o.courier : undefined, tracking: typeof o.tracking === "string" && o.tracking ? o.tracking : undefined,
    parcel: cleanParcel(o.parcel) };
}

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024; // what the buyer may pick (it is shrunk to ≤ 400 KB before upload)
export const receiptPath = (token: string, now = Date.now()) => `${token}/r${now}.jpg`;

export const realOrderApi: OrderApi = {
  async place(sub, input, device) {
    if (!isSupabaseConfigured || !supabase) return { ok: false, error: "network" };
    try {
      const { data, error } = await supabase.rpc("website_place_order", { p_sub: sub, p_order: input, p_device: device });
      if (error) return placeError(error);
      const d = data as Record<string, unknown> | null;
      if (!d || d.ok !== true || typeof d.token !== "string") return { ok: false, error: "network" };
      return { ok: true, orderNo: String(d.orderNo), token: d.token, total: num(d.total) };
    } catch { return { ok: false, error: "network" }; }
  },
  async load(token) {
    if (!isSupabaseConfigured || !supabase) return null;
    try { const { data, error } = await supabase.rpc("website_order", { p_token: token }); return error ? null : toOrderView(data); } catch { return null; }
  },
  async uploadReceipt(token, file) {
    if (!file.type.startsWith("image/") || file.size > RECEIPT_MAX_BYTES) return { ok: false, reason: file.size > RECEIPT_MAX_BYTES ? "too_big" : "unreadable" };
    const c = await compressProductImage(file);
    if (c.ok === false) return { ok: false, reason: c.reason };
    if (!isSupabaseConfigured || !supabase) return { ok: false, reason: "failed" };
    const path = receiptPath(token);
    try {
      const up = await supabase.storage.from("website-receipts").upload(path, c.blob, { upsert: false, contentType: "image/jpeg" });
      if (up.error) return { ok: false, reason: "failed" };
      const { error } = await supabase.rpc("website_order_receipt", { p_token: token, p_path: path });
      return error ? { ok: false, reason: "failed" } : { ok: true };
    } catch { return { ok: false, reason: "failed" }; }
  },
};

// ── this device only ──────────────────────────────────────────────────────────
export interface BuyerMemory { name: string; phone: string; contact: string; address: string; addr?: AddrParts; stores: Partial<Record<"s711" | "fm", { id: string; name: string }[]>> }
export const BUYER_KEY = "sfl_shop_buyer";
export const DEVICE_KEY = "sfl_shop_device";
export function readBuyer(): BuyerMemory | null {
  try {
    const j = JSON.parse(localStorage.getItem(BUYER_KEY) || "null");
    if (!j || typeof j !== "object" || typeof j.name !== "string") return null;
    const a = j.addr && typeof j.addr === "object" ? j.addr : null;
    const addr = a ? { street: String(a.street || ""), city: String(a.city || ""), region: String(a.region || ""), post: String(a.post || "") } : undefined;
    return { name: j.name, phone: String(j.phone || ""), contact: String(j.contact || ""), address: String(j.address || ""), ...(addr ? { addr } : {}), stores: j.stores && typeof j.stores === "object" ? j.stores : {} };
  } catch { return null; }
}
/** Remember after an order: name, phone, chat name, address, and the store (last 3 per carrier). Pure part = rememberStore. */
export function rememberStore(m: BuyerMemory["stores"], k: "s711" | "fm", id: string, name: string): BuyerMemory["stores"] {
  const list = [{ id, name }, ...(m[k] || []).filter((s) => s.id !== id)].slice(0, 3);
  return { ...m, [k]: list };
}
export function saveBuyer(d: OrderDraft): void {
  try {
    const prev = readBuyer();
    let stores = prev?.stores || {};
    if ((d.delivery === "s711" || d.delivery === "fm") && /^\d{6}$/.test(d.storeId)) stores = rememberStore(stores, d.delivery, d.storeId, d.storeName.trim());
    localStorage.setItem(BUYER_KEY, JSON.stringify({ name: d.name.trim(), phone: d.phone.trim(), contact: d.contact.trim(), address: d.address.trim() || prev?.address || "", ...(d.addr?.street.trim() ? { addr: d.addr } : prev?.addr ? { addr: prev.addr } : {}), stores }));
  } catch { /* private mode */ }
}
export function forgetBuyer(): void { try { localStorage.removeItem(BUYER_KEY); } catch { /* */ } }
export function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d || !/^[A-Za-z0-9-]{8,64}$/.test(d)) { d = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9-]/g, ""); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch { return ""; }
}

// ── checks before the call (the server checks everything again) ────────────────
export type FieldError = "name" | "phone" | "delivery" | "store" | "address" | "postal" | "payment";
/** Taiwan's ready ids without a list (old tests / old shops): 7-11 + FamilyMart need a store, home an address. */
const LEGACY_OPT: Record<string, { needs: ShipNeeds; cod: boolean }> = { s711: { needs: "store711", cod: true }, fm: { needs: "storefm", cod: true }, home: { needs: "address", cod: false } };
export interface DraftRules { delivery: string[]; payment: string[]; options?: ShipOpt[]; methods?: PayOpt[]; country?: string }
export function draftErrors(d: OrderDraft, allowed: DraftRules): FieldError[] {
  const e: FieldError[] = [];
  if (!d.name.trim() || d.name.trim().length > 40) e.push("name");
  if (!phoneOk(allowed.country || "", d.phone)) e.push("phone");
  const opt = (d.delivery && (allowed.options?.find((o) => o.id === d.delivery) ?? LEGACY_OPT[d.delivery])) || null;
  if (!d.delivery || !allowed.delivery.includes(d.delivery) || !opt) e.push("delivery");
  else if (opt.needs === "address") {
    const form = addrFormOf(allowed.country || "");
    if (form === "free") { if (d.address.trim().length < 5) e.push("address"); }
    else {
      const ae = addressErrors(form, d.addr ?? { street: "", city: "", region: "", post: "" });
      if (ae.some((x) => x !== "post")) e.push("address");
      if (ae.includes("post")) e.push("postal");
    }
  }
  else if (opt.needs === "store711" || opt.needs === "storefm") { if (!/^\d{6}$/.test(d.storeId.trim())) e.push("store"); }
  else if (opt.needs === "store") { if (!d.storeName.trim()) e.push("store"); }
  const kind = d.payment ? (allowed.methods?.find((m) => m.id === d.payment)?.kind ?? (d.payment === "cod" ? "delivery" : "first")) : null;
  if (!d.payment || !allowed.payment.includes(d.payment) || (kind === "delivery" && !opt?.cod)) e.push("payment");
  return e;
}
