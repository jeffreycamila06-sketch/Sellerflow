// 7-11 交貨便 shipping (P1) — PURE logic: session-window key, buyer grouping,
// the 賣貨便 field validators, and amount rules. REPLACES the old localStorage
// shipment manager (admin-gated port of old main; no real user data — Jeff
// 2026-07-03). DB CRUD lives in shippingDb.ts; the screen composes both.
//
// One bag = one buyer group = one shipping_entries row = one Excel row (P2).
// Grouping key = buyer# within the CURRENT session window (multi-day aware via
// useSessionWindow's computeWindowState) — matches how sellers physically sort
// mined items into per-buyer# bags.
import type { Buyer } from "../../lib/orderTypes";
import { computeWindowState } from "./useSessionWindow";

// ── Constants (賣貨便 訂單匯入 template rules, verified from the real file) ────
export const SHIP_MAX = 500;              // max rows per upload
export const SHIP_TEMP_AMBIENT = "常溫";  // template enum values — NEVER translate
export const SHIP_TEMP_FROZEN = "冷凍";
export const SHIP_DEFAULT_FEE = 60;       // NT$60 standard 本島
export const SHIP_MAX_FEE = 100;          // 運費金額 0–100
export const SHIP_MAX_ORDER = 20000;      // 訂單金額 0–20,000
export const SHIP_MIN_TOTAL = 55;         // 55 ≤ 訂單+運費 ≤ 20,000 per row
export const SHIP_MAX_TOTAL = 20000;
export const SHIP_MAX_DESC = 200;         // 商品 ≤ 200 chars
export const SHIP_NAME_BUDGET = 10;       // 取件人姓名 ≤ 10 (Chinese counts 2)
export const STORE_LOOKUP_URL = "https://emap.pcsc.com.tw/";

export type TempLayer = typeof SHIP_TEMP_AMBIENT | typeof SHIP_TEMP_FROZEN;
export type ShipStatus = "draft" | "encoded" | "exported";

export interface ShippingEntry {
  id: string;                 // uuid (client-generated on first save)
  sessionKey: string;
  buyerNumber: number;
  bagNumber: number;          // splits = P3; P1 always 1
  includedOrderIds: number[]; // orderNum epoch-ms of the included orders
  recipientName: string;
  phone: string;
  storeId: string;
  tempLayer: TempLayer;
  productDesc: string;
  orderAmount: number;
  shippingFee: number;
  buyerUsername: string;
  status: ShipStatus;
  exportBatchId: string | null;
  exportedAt: string | null;
}

// ── Session-window key ────────────────────────────────────────────────────────
// Active multi-day window → "<windowStart>~<N>d" (one bucket across the whole
// window, matching continued buyer#s). 1-day / expired / fresh → the Taipei day
// id, byte-identical to the single-day session bucket.
export function sessionKeyFor(todayId: string, windowStart: string | null, windowDays: number): string {
  const st = computeWindowState(todayId, windowStart, windowDays);
  return st.active && st.loadStart && st.n > 1 ? `${st.loadStart}~${st.n}d` : todayId;
}

// ── Buyer grouping — one group per buyer# from the already-loaded session ─────
// (RebuiltSession.buyers is already consolidated per buyer; zero new queries.)
export interface BuyerGroup {
  bNum: number;
  handle: string;
  name: string;
  items: number;
  total: number;
  orderIds: number[]; // orderNum epoch-ms
}
export function buyerGroupsFrom(buyers: Buyer[]): BuyerGroup[] {
  return buyers
    .map((b) => ({
      bNum: b.num,
      handle: b.handle || "",
      name: b.name || "",
      items: b.orders.length,
      total: b.orders.reduce((s, o) => s + (Number(o.total) || 0), 0),
      orderIds: b.orders.map((o) => o.orderNum),
    }))
    .sort((a, b) => a.bNum - b.bNum);
}

// Auto 商品 summary — includes the buyer# so the printed 寄件單 matches the bag.
export function defaultProductDesc(bNum: number, items: number): string {
  return `#${bNum} 商品x${items}`;
}

// Fresh (draft) entry for a buyer group that has no saved row yet.
export function draftEntryFor(g: BuyerGroup, sessionKey: string, id: string): ShippingEntry {
  return {
    id,
    sessionKey,
    buyerNumber: g.bNum,
    bagNumber: 1,
    includedOrderIds: g.orderIds,
    recipientName: "",
    phone: "",
    storeId: "",
    tempLayer: SHIP_TEMP_AMBIENT,
    productDesc: defaultProductDesc(g.bNum, g.items),
    orderAmount: g.total,
    shippingFee: SHIP_DEFAULT_FEE,
    buyerUsername: g.handle, // 其他資訊 col J — NEVER the recipient name (col A)
    status: "draft",
    exportBatchId: null,
    exportedAt: null,
  };
}

// ── Validators (賣貨便 rules; return ERROR CODES, the screen maps to i18n) ────
// 取件人姓名 width budget: max 10 half-width = 5 Chinese (full-width counts 2).
export function nameLength(s: string): number {
  return [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);
}
// Forbidden in col A: digits + ~!@#$%^&*()/\|,.<>'?"();:_+-=[]{} and backtick.
const NAME_FORBIDDEN = /[0-9~!@#$%^&*()/\\|,.<>'?"();:_+\-=[\]{}`]/;
export type NameError = "" | "required" | "too_long" | "forbidden";
export function validateRecipientName(s: string): NameError {
  const v = s.trim();
  if (!v) return "required";
  if (NAME_FORBIDDEN.test(v)) return "forbidden";
  if (nameLength(v) > SHIP_NAME_BUDGET) return "too_long";
  return "";
}
export const validPhone = (s: string): boolean => /^09\d{8}$/.test(s.trim());
export const validStore = (s: string): boolean => /^\d{6}$/.test(s.trim());

export type AmountError = "" | "fee_range" | "order_range" | "total_low" | "total_high";
export function validateAmounts(orderAmount: number, fee: number): AmountError {
  if (!Number.isFinite(fee) || fee < 0 || fee > SHIP_MAX_FEE) return "fee_range";
  if (!Number.isFinite(orderAmount) || orderAmount < 0 || orderAmount > SHIP_MAX_ORDER) return "order_range";
  const total = orderAmount + fee;
  if (total < SHIP_MIN_TOTAL) return "total_low";
  if (total > SHIP_MAX_TOTAL) return "total_high";
  return "";
}

export interface EntryErrors { name: NameError; phone: boolean; store: boolean; desc: boolean; amounts: AmountError }
export function validateEntry(e: ShippingEntry): EntryErrors {
  return {
    name: validateRecipientName(e.recipientName),
    phone: !validPhone(e.phone),
    store: !validStore(e.storeId),
    desc: !e.productDesc.trim() || e.productDesc.length > SHIP_MAX_DESC,
    amounts: validateAmounts(e.orderAmount, e.shippingFee),
  };
}
export function entryIsValid(e: ShippingEntry): boolean {
  const r = validateEntry(e);
  return !r.name && !r.phone && !r.store && !r.desc && !r.amounts;
}

// COD preview — the buyer pays 訂單金額 + 運費金額 at pickup.
export function codTotal(orderAmount: number, fee: number): number {
  return (Number(orderAmount) || 0) + (Number(fee) || 0);
}
