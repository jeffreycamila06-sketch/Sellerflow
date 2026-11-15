// Seller Website — the buyer's orders: place (ONE RPC, website_place_order), read the order link
// (website_order by token), upload a receipt (private bucket website-receipts + website_order_receipt).
// Everything the buyer types stays in these calls; nothing is logged or sent to analytics.
// The buyer's name / phone / last stores are remembered on THIS device only ("Not you?" clears it).
import { isSupabaseConfigured, supabase } from "../supabase";
import { compressProductImage } from "../redesign/adapters/productImages";

export type Delivery = "s711" | "fm" | "home";
export type Payment = "bank" | "qr" | "cod";
export interface OrderDraft {
  name: string; phone: string; contact: string; delivery: Delivery | null; storeId: string; storeName: string;
  address: string; payment: Payment | null; note: string;
}
export interface PlaceInput extends Omit<OrderDraft, "delivery" | "payment"> { delivery: Delivery; payment: Payment; items: { pid: number; vid: number | null; qty: number }[] }
export type PlaceError =
  | "shop_closed" | "bad_name" | "bad_phone" | "bad_delivery" | "bad_store" | "bad_address" | "bad_payment"
  | "blocked" | "too_many" | "bad_items" | "item_gone" | "pick_option" | "out_of_stock" | "network";
export type PlaceResult = { ok: true; orderNo: string; token: string; total: number } | { ok: false; error: PlaceError; pid?: number; vid?: number | null; left?: number };

export interface OrderItem { pid: number; vid?: number | null; name: string; label?: string; code?: string; price: number; qty: number; photo?: string }
export type OrderStatus = "awaiting_payment" | "payment_sent" | "paid" | "confirmed" | "shipped" | "cancelled";
export interface OrderView {
  orderNo: string; status: OrderStatus; paymentIssue: boolean; items: OrderItem[]; subtotal: number; shipFee: number; total: number;
  delivery: Delivery; storeId?: string; storeName?: string; address?: string; payment: Payment; buyerName: string; phoneTail: string; note?: string;
  receipt: boolean; receiptAt?: string; createdAt: string; autoCancelAt?: string; paidAt?: string; shippedAt?: string; cancelledAt?: string; cancelReason?: "seller" | "auto";
  shop: { sub: string; name?: string; logo?: string; color?: string; chats?: Record<string, string>; currency?: string }; country: string;
  pay?: { bank?: { bankName?: string; accountName?: string; accountNumber?: string }; qr?: { path: string; label?: string } };
}
export interface OrderApi {
  place(sub: string, input: PlaceInput, device: string): Promise<PlaceResult>;
  load(token: string): Promise<OrderView | null>;
  uploadReceipt(token: string, file: Blob): Promise<{ ok: true } | { ok: false; reason: "too_big" | "unreadable" | "failed" }>;
}

const ERRORS: PlaceError[] = ["shop_closed", "bad_name", "bad_phone", "bad_delivery", "bad_store", "bad_address", "bad_payment", "blocked", "too_many", "bad_items", "item_gone", "pick_option", "out_of_stock"];
/** A database error → the reason the buyer is told. Pure. */
export function placeError(e: { message?: string; hint?: string } | null | undefined): PlaceResult {
  const msg = String(e?.message || "");
  const error = ERRORS.find((x) => msg === x || msg.startsWith(`${x}`)) || "network";
  let extra: { pid?: number; vid?: number | null; left?: number } = {};
  try { const h = JSON.parse(String(e?.hint || "")); if (h && typeof h === "object") extra = { pid: Number(h.pid) || undefined, vid: h.vid === null || h.vid === undefined ? null : Number(h.vid), left: h.left === undefined ? undefined : Number(h.left) }; } catch { /* no hint */ }
  return { ok: false, error, ...extra };
}
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
/** RPC answer → OrderView (defensive). Pure. */
export function toOrderView(j: unknown): OrderView | null {
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  if (!o || o.found !== true || typeof o.orderNo !== "string") return null;
  const items = (Array.isArray(o.items) ? o.items : []).map((x) => {
    const i = x as Record<string, unknown>;
    return { pid: num(i.pid), vid: i.vid === undefined || i.vid === null ? null : num(i.vid), name: String(i.name ?? ""), label: typeof i.label === "string" ? i.label : undefined, code: typeof i.code === "string" ? i.code : undefined, price: num(i.price), qty: num(i.qty, 1), photo: typeof i.photo === "string" ? i.photo : undefined };
  });
  return { ...(o as unknown as OrderView), items, subtotal: num(o.subtotal), shipFee: num(o.shipFee), total: num(o.total), paymentIssue: o.paymentIssue === true, receipt: o.receipt === true, shop: (o.shop || { sub: "" }) as OrderView["shop"], country: String(o.country || "TW") };
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
export interface BuyerMemory { name: string; phone: string; contact: string; address: string; stores: Partial<Record<"s711" | "fm", { id: string; name: string }[]>> }
export const BUYER_KEY = "sfl_shop_buyer";
export const DEVICE_KEY = "sfl_shop_device";
export function readBuyer(): BuyerMemory | null {
  try {
    const j = JSON.parse(localStorage.getItem(BUYER_KEY) || "null");
    if (!j || typeof j !== "object" || typeof j.name !== "string") return null;
    return { name: j.name, phone: String(j.phone || ""), contact: String(j.contact || ""), address: String(j.address || ""), stores: j.stores && typeof j.stores === "object" ? j.stores : {} };
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
    localStorage.setItem(BUYER_KEY, JSON.stringify({ name: d.name.trim(), phone: d.phone.trim(), contact: d.contact.trim(), address: d.delivery === "home" ? d.address.trim() : prev?.address || "", stores }));
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
export type FieldError = "name" | "phone" | "delivery" | "store" | "address" | "payment";
export function draftErrors(d: OrderDraft, allowed: { delivery: Delivery[]; payment: Payment[] }): FieldError[] {
  const e: FieldError[] = [];
  if (!d.name.trim() || d.name.trim().length > 40) e.push("name");
  const digits = d.phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) e.push("phone");
  if (!d.delivery || !allowed.delivery.includes(d.delivery)) e.push("delivery");
  else if (d.delivery === "home") { if (d.address.trim().length < 5) e.push("address"); }
  else if (!/^\d{6}$/.test(d.storeId.trim())) e.push("store");
  if (!d.payment || !allowed.payment.includes(d.payment) || (d.payment === "cod" && d.delivery === "home")) e.push("payment");
  return e;
}
