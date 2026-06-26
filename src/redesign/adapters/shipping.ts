// Shipping — byte-faithful port of App.tsx's seller shipment manager (1440-1634).
// Same localStorage keys (sf_shipments / sf_shipping_customer_data, keyed per
// seller), same daily-number grouping, same open/shipped lifecycle, same 7-ELEVEN
// MyShip xlsx export (exact Chinese header row). Pure helpers are unit-tested; the
// screen owns Date.now()/random/xlsx. Imports nothing from App.tsx.
import { taipeiDayId } from "../../lib/dateHelpers";

export interface ShipOrder { id: string; product: string; price: string }
export interface Shipment {
  id: string; buyerUsername: string; dayId: string; num: number;
  name: string; phone: string; store: string; fee: string;
  status: "open" | "shipped"; createdAt: string; orders: ShipOrder[];
}
// ShippingCustomer — the registry rows App.tsx's Customer Data page maintains.
export interface ShippingCustomer { username: string; name: string; phone: string; sevenCode: string; note: string; lastComment: string; firstSeen: string; status: string; isNew: boolean; num?: number }

export const SHIP_MAX = 500;                                       // App.tsx:1453
export const SHIP_TEMP = "常溫";                                   // 1454
export const SHIP_DEFAULT_FEE = "38";                             // 1455
// Official 7-ELEVEN MyShip header row (A–J) — must match EXACTLY or 7-11 rejects it.
export const MYSHIP_HEADERS = ["取件人姓名", "取件人手機", "取件門市", "溫層", "商品", "訂單金額", "運費金額", "買家下訂日期", "商品備註", "其他資訊 (FB/LINE/IG帳號)"]; // 1458

// Key helpers — replicate App.tsx sellerIdOf/sellerDataKey EXACTLY so the redesign
// reads/writes the SAME localStorage as production.
const sellerIdOf = (email: string) => email.trim().toLowerCase();
const sellerDataKey = (base: string, email: string) => (email ? `${base}:${sellerIdOf(email)}` : base);
export const shipmentsKey = (email: string) => sellerDataKey("sf_shipments", email);                 // 1461
export const shipmentsMigrationFlagKey = (email: string) => sellerDataKey("sf_shipments_migrated", email); // 1462
export const custDataKey = (email: string) => sellerDataKey("sf_shipping_customer_data", email);      // 156

const readArr = <X,>(key: string): X[] => { try { const v = localStorage.getItem(key); const p = v ? JSON.parse(v) : []; return Array.isArray(p) ? (p as X[]) : []; } catch { return []; } };

// ── Pure helpers — copied verbatim from App.tsx:1466-1505 ─────────────────────
export function nextDailyNum(list: Shipment[], dayId: string): number {
  return list.reduce((m, s) => (s.dayId === dayId && s.num > m ? s.num : m), 0) + 1;
}
export function findOpenShipment(list: Shipment[], username: string, dayId: string): Shipment | null {
  const u = username.trim().toLowerCase();
  return list.find((s) => s.dayId === dayId && s.status === "open" && s.buyerUsername.toLowerCase() === u) || null;
}
export function shipmentSubtotal(s: Shipment): number { return s.orders.reduce((sum, o) => sum + (Number(o.price) || 0), 0); }
export function shipmentGrandTotal(s: Shipment): number { return shipmentSubtotal(s) + (Number(s.fee) || 0); }
export function isValidShipment(s: unknown): s is Shipment {
  if (!s || typeof s !== "object") return false;
  const r = s as Partial<Shipment>;
  return typeof r.id === "string" && typeof r.buyerUsername === "string" && typeof r.dayId === "string"
    && typeof r.num === "number" && typeof r.name === "string" && typeof r.phone === "string"
    && typeof r.store === "string" && typeof r.fee === "string"
    && (r.status === "open" || r.status === "shipped") && Array.isArray(r.orders);
}
export function migrateLegacyShipping(email: string): Shipment[] {
  try { const k = shipmentsMigrationFlagKey(email); if (!localStorage.getItem(k)) localStorage.setItem(k, "true"); } catch { /* ignore */ }
  return [];
}

export function today(): string { return taipeiDayId(); }

// Load shipments (with migration + validity filter), App.tsx:1510-1517.
export function loadShipments(email: string): Shipment[] {
  try { migrateLegacyShipping(email); return readArr<Shipment>(shipmentsKey(email)).filter(isValidShipment); }
  catch { return []; }
}
export function saveShipments(email: string, list: Shipment[]): void {
  try { localStorage.setItem(shipmentsKey(email), JSON.stringify(list)); } catch { /* ignore */ }
}
// Registered shipping customers — same filter as App.tsx:1519 (name+phone+6-digit code).
export function loadShippingCustomers(email: string): ShippingCustomer[] {
  return readArr<ShippingCustomer>(custDataKey(email)).filter((c) => c.name.trim() && c.phone.trim() && /^\d{6}$/.test(c.sevenCode.trim()));
}

// ── Pure mutations (App.tsx addOrder/saveEdit/updateFee/deleteOrder) — ids/time
// injected for deterministic tests. ───────────────────────────────────────────
export interface AddResult { next: Shipment[]; existing: boolean; num: number }
// Append to an open shipment for (customer, day) or create a new one. Mirrors
// App.tsx addOrder (1547-1570). Caller validates + enforces SHIP_MAX first.
export function applyAddOrder(shipments: Shipment[], customer: ShippingCustomer, product: string, price: string, dayId: string, ids: { shipment: string; order: string }, createdAt: string): AddResult {
  const existing = findOpenShipment(shipments, customer.username, dayId);
  if (existing) {
    const next = shipments.map((s) => s.id === existing.id
      ? { ...s, name: customer.name, phone: customer.phone, store: customer.sevenCode, orders: [...s.orders, { id: ids.order, product, price }] }
      : s);
    return { next, existing: true, num: existing.num };
  }
  const num = nextDailyNum(shipments, dayId);
  const created: Shipment = {
    id: ids.shipment, buyerUsername: customer.username, dayId, num,
    name: customer.name, phone: customer.phone, store: customer.sevenCode,
    fee: SHIP_DEFAULT_FEE, status: "open", createdAt, orders: [{ id: ids.order, product, price }],
  };
  return { next: [...shipments, created], existing: false, num };
}
// Delete an order; auto-remove the shipment if it becomes empty (App.tsx 1574-1580).
export function applyDeleteOrder(shipments: Shipment[], shipmentId: string, orderId: string): Shipment[] {
  let next = shipments.map((s) => (s.id === shipmentId ? { ...s, orders: s.orders.filter((o) => o.id !== orderId) } : s));
  next = next.filter((s) => !(s.id === shipmentId && s.orders.length === 0));
  return next;
}
export function applyEditPrice(shipments: Shipment[], shipmentId: string, orderId: string, price: string): Shipment[] {
  return shipments.map((s) => (s.id === shipmentId ? { ...s, orders: s.orders.map((o) => (o.id === orderId ? { ...o, price } : o)) } : s));
}
export function applyUpdateFee(shipments: Shipment[], shipmentId: string, fee: string): Shipment[] {
  const cleaned = fee.replace(/[^\d.]/g, "");
  return shipments.map((s) => (s.id === shipmentId ? { ...s, fee: cleaned } : s));
}
// Mark a set of shipments shipped (post-export auto-close, App.tsx 1625-1626).
export function applyMarkShipped(shipments: Shipment[], ids: Set<string>): Shipment[] {
  return shipments.map((s) => (ids.has(s.id) ? { ...s, status: "shipped" as const } : s));
}

// MyShip export rows — one row per shipment, columns mapped to MYSHIP_HEADERS
// EXACTLY (App.tsx 1611-1620). Subtotal = summed order prices; fee separate.
export function buildMyShipRows(openToday: Shipment[]): (string | number)[][] {
  return openToday.map((s) => [
    s.name, s.phone, s.store, SHIP_TEMP,
    s.orders.map((o) => o.product).filter(Boolean).join(" / ") || s.orders[0]?.product || "",
    shipmentSubtotal(s), Number(s.fee) || 0, "", "", "",
  ]);
}

export const isNumericPrice = (pc: string): boolean => !(pc.trim() === "" || isNaN(Number(pc.trim())) || Number(pc.trim()) < 0);
