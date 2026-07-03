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
export const SHIP_DEFAULT_FEE = 38;       // NT$38 — the standard OPEN POINT/賣貨便 fee in Taiwan (Jeff market correction 2026-07-03; NOT a promo)
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
  shippedAt: string | null;   // P3b mark-as-shipped stamp (status stays 'exported')
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
export interface GroupOrder { id: number; item: string; total: number } // id = orderNum epoch-ms
export interface BuyerGroup {
  bNum: number;
  handle: string;
  name: string;
  items: number;
  total: number;
  orderIds: number[];       // orderNum epoch-ms
  orderList: GroupOrder[];  // per-item detail (split-bags assignment UI)
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
      orderList: b.orders.map((o) => ({ id: o.orderNum, item: o.item || "", total: Number(o.total) || 0 })),
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
    shippedAt: null,
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

// ── Split bags (P3a) — one bag = one shipping_entries row (bag_number 1..N),
// items assigned per bag, per-bag amounts derived from the assigned orders,
// recipient fields shared across bags, each bag pays its own fee. ────────────
export const SPLIT_MAX_BAGS = 6;
// A group whose total exceeds the per-row order cap CANNOT ship as one row —
// the split prompt is mandatory (spec: total > NT$20,000).
export const mustSplit = (total: number): boolean => total > SHIP_MAX_ORDER;

export function bagDesc(bNum: number, items: number, i: number, n: number): string {
  return `${defaultProductDesc(bNum, items)} Bag ${i}/${n}`;
}

export interface BagSummary { orderIds: number[]; items: number; amount: number }
// assignment: orderNum → bag index (1-based). Orders missing from the map are
// UNASSIGNED (blocks save).
export function splitSummary(orderList: GroupOrder[], assignment: Record<number, number>, nBags: number): { bags: BagSummary[]; unassigned: number } {
  const bags: BagSummary[] = Array.from({ length: nBags }, () => ({ orderIds: [], items: 0, amount: 0 }));
  let unassigned = 0;
  for (const o of orderList) {
    const b = assignment[o.id];
    if (!b || b < 1 || b > nBags) { unassigned++; continue; }
    const bag = bags[b - 1];
    bag.orderIds.push(o.id);
    bag.items++;
    bag.amount += o.total;
  }
  return { bags, unassigned };
}

export interface SharedRecipient { recipientName: string; phone: string; storeId: string; tempLayer: TempLayer }
// Builds the N entries for a valid split. ids[i] keeps the EXISTING row id for
// that bag_number when re-editing (the upsert conflict target is the group key,
// so reusing ids avoids primary-key churn); fee applies per bag (own NT$38 each).
export function buildBagEntries(g: BuyerGroup, sessionKey: string, bags: BagSummary[], shared: SharedRecipient, fee: number, ids: string[]): ShippingEntry[] {
  const n = bags.length;
  return bags.map((bag, idx) => ({
    id: ids[idx],
    sessionKey,
    buyerNumber: g.bNum,
    bagNumber: idx + 1,
    includedOrderIds: bag.orderIds,
    recipientName: shared.recipientName,
    phone: shared.phone,
    storeId: shared.storeId,
    tempLayer: shared.tempLayer,
    productDesc: bagDesc(g.bNum, bag.items, idx + 1, n),
    orderAmount: bag.amount,
    shippingFee: fee,
    buyerUsername: g.handle,
    status: "encoded" as const,
    exportBatchId: null,
    exportedAt: null,
    shippedAt: null,
  }));
}

// Full split validation: every item assigned, every bag non-empty, every bag's
// amounts inside the 賣貨便 rules, shared recipient fields valid.
export interface SplitErrors { unassigned: number; emptyBags: number[]; bagAmounts: { bag: number; err: AmountError }[]; name: NameError; phone: boolean; store: boolean }
export function validateSplit(orderList: GroupOrder[], assignment: Record<number, number>, nBags: number, shared: SharedRecipient, fee: number): SplitErrors {
  const { bags, unassigned } = splitSummary(orderList, assignment, nBags);
  return {
    unassigned,
    emptyBags: bags.map((b, i) => (b.items === 0 ? i + 1 : 0)).filter(Boolean),
    bagAmounts: bags.map((b, i) => ({ bag: i + 1, err: validateAmounts(b.amount, fee) })).filter((x) => x.err),
    name: validateRecipientName(shared.recipientName),
    phone: !validPhone(shared.phone),
    store: !validStore(shared.storeId),
  };
}
export function splitIsValid(e: SplitErrors): boolean {
  return e.unassigned === 0 && e.emptyBags.length === 0 && e.bagAmounts.length === 0 && !e.name && !e.phone && !e.store;
}

// ── Late orders (P3b) — a buyer mines MORE items AFTER their group was
// exported. Exported entries are IMMUTABLE (RLS + UI), so the remainder ships
// as a NEW entry/bag: orders not covered by any EXPORTED bag, on the next free
// bag_number, recipient prefilled from the exported bag. ─────────────────────

// Late desc deliberately has NO "/n" — the already-printed 寄件單 labels
// (e.g. "Bag 1/2") must not be retro-invalidated by a new bag count.
export function lateBagDesc(bNum: number, items: number, bagNo: number): string {
  return `${defaultProductDesc(bNum, items)} Bag ${bagNo}`;
}

// Orders in the live group that no EXPORTED bag covers (the shippable remainder).
export function lateOrdersFor(g: BuyerGroup, bags: ShippingEntry[]): GroupOrder[] {
  const exported = bags.filter((e) => e.status === "exported");
  if (!exported.length) return []; // not a late-order case — normal edit flows cover it
  const covered = new Set(exported.flatMap((e) => e.includedOrderIds));
  return g.orderList.filter((o) => !covered.has(o.id));
}

// The ready-to-open form entry for the remainder — CREATE mode (no non-exported
// bag yet: next bag_number, recipient copied from the latest exported bag) or
// EDIT mode (a draft/encoded late bag exists: reuse its id/bag_number and the
// seller's edits, but ALWAYS refresh the covered orders/amount from the live
// group — new mines keep flowing in until export). Returns null when the group
// has no exported bag or nothing is uncovered.
export function lateFormEntry(g: BuyerGroup, bags: ShippingEntry[], sessionKey: string, newIdVal: string, fee: number): ShippingEntry | null {
  const lateOrders = lateOrdersFor(g, bags);
  if (!lateOrders.length) return null;
  const exported = bags.filter((e) => e.status === "exported").sort((a, b) => a.bagNumber - b.bagNumber);
  const editable = bags.find((e) => e.status !== "exported") ?? null;
  const prev = exported[exported.length - 1];
  const bagNumber = editable?.bagNumber ?? Math.max(...bags.map((b) => b.bagNumber)) + 1;
  return {
    id: editable?.id ?? newIdVal,
    sessionKey,
    buyerNumber: g.bNum,
    bagNumber,
    includedOrderIds: lateOrders.map((o) => o.id),
    recipientName: editable?.recipientName ?? prev.recipientName,
    phone: editable?.phone ?? prev.phone,
    storeId: editable?.storeId ?? prev.storeId,
    tempLayer: editable?.tempLayer ?? prev.tempLayer,
    productDesc: lateBagDesc(g.bNum, lateOrders.length, bagNumber),
    orderAmount: lateOrders.reduce((s, o) => s + o.total, 0),
    shippingFee: editable?.shippingFee ?? fee,
    buyerUsername: g.handle,
    status: "draft",
    exportBatchId: null,
    exportedAt: null,
    shippedAt: null,
  };
}
