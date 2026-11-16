// Seller Website — the text the buyer pastes into the seller's chat. PURE (unit-tested).
// It carries the W number, the lines, delivery, total, payment, the buyer's name and the order
// link — never the phone number (the seller already has it in the app).
import { tpl } from "../redesign/i18n";
import type { OrderView } from "./orderApi";
import type { ParcelState, ParcelView } from "./parcelView";
import { money } from "./shopApi";
import { shipLabel, payLabel } from "./shipPay";

type T = Record<string, string>;
const NEEDS_OF = { s711: "store711", fm: "storefm", home: "address", store: "store", pickup: "none" } as const;
/** The delivery's name: the picked option (v2) or, for older orders, the kind. Pure. */
export function deliveryLabel(t: T, d: OrderView["delivery"], shipId?: string, shipName?: string): string {
  if (shipId || shipName) return shipLabel(t, { id: shipId || "", name: shipName, needs: NEEDS_OF[d] });
  return d === "s711" ? "7-11" : d === "fm" ? t.rd_shop_fm : d === "store" ? t.rd_ship_n_store : d === "pickup" ? t.rd_ship_n_pickup : t.rd_shop_home;
}
/** Where it goes: the address, the store (+ #number), or nothing for pickup. Pure. */
export function deliveryWhere(o: { delivery: OrderView["delivery"]; address?: string | null; storeName?: string | null; storeId?: string | null }): string {
  if (o.delivery === "home") return o.address || "";
  if (o.delivery === "pickup") return "";
  return [o.storeName, o.storeId ? `#${o.storeId}` : ""].filter(Boolean).join(" ");
}
/** The payment's name: the picked method (v2) or, for older orders, the kind. Pure. */
export function paymentLabel(t: T, p: OrderView["payment"], payId?: string, payName?: string): string {
  if (payId || payName) return payLabel(t, { id: payId || "", name: payName, kind: p === "cod" ? "delivery" : "first" });
  return p === "bank" ? t.rd_shop_pay_bank : p === "qr" ? t.rd_shop_pay_qr : t.rd_shop_pay_cod;
}
export function orderMessage(t: T, o: OrderView, cur: string, link: string): string {
  const lines = [`${tpl(t.rd_shop_od_order, { no: o.orderNo })} — ${o.shop.name || ""}`.trim()];
  for (const i of o.items) lines.push(`• ${i.name}${i.label ? ` (${i.label})` : ""} ×${i.qty} — ${money(cur, i.price * i.qty)}`);
  const where = deliveryWhere(o);
  lines.push(`${t.rd_shop_shipping} (${deliveryLabel(t, o.delivery, o.shipId, o.shipName)}${where ? ` ${where}` : ""}): ${o.shipFee ? money(cur, o.shipFee) : t.rd_shop_co_free}`);
  lines.push(`${t.rd_shop_co_total}: ${money(cur, o.total)}`);
  lines.push(`${t.rd_shop_payment}: ${paymentLabel(t, o.payment, o.payId, o.payName)}`);
  lines.push(`${t.rd_shop_msg_name}: ${o.buyerName}`);
  if (link) lines.push(`${t.rd_shop_msg_link}: ${link}`);
  return lines.join("\n");
}
export const CHAT_APP_NAME: Record<string, string> = { messenger: "Messenger", line: "LINE", whatsapp: "WhatsApp", instagram: "Instagram" };
export type TimelineStep = { label: string; st: "dn" | "nw" | "" | "bad"; sub?: string };
/** Order tracking item 3: with a parcel (Pickup Status), the steps after Shipped. */
export interface TimelineParcel { parcel: ParcelView; when: (iso: string) => string; store: string }
/** The order's status, as a timeline (as the preview). Pure. Without a parcel: exactly as before. */
export function orderTimeline(t: T, v: OrderView, p?: TimelineParcel): TimelineStep[] {
  const base = baseTimeline(t, v);
  if (!p || v.status !== "shipped") return base;
  const st = p.parcel.state;
  const out: TimelineStep[] = base.map((x, i) => (i === base.length - 1 ? { ...x, st: "dn" } : x));
  const passed = (k: ParcelState) => ORDER_OF[st] > ORDER_OF[k] || st === "picked_up";
  out.push({ label: t.rd_tl_transit, st: passed("in_transit") ? "dn" : "nw", sub: t.rd_tl_transit_sub });
  const arrivedSub = [p.parcel.arrivedAt ? p.when(p.parcel.arrivedAt) : "", p.store].filter(Boolean).join(" · ");
  out.push(st === "in_transit" ? { label: t.rd_tl_arrived, st: "" } : { label: t.rd_tl_arrived, st: st === "at_store" ? "nw" : "dn", ...(arrivedSub ? { sub: arrivedSub } : {}) });
  if (st === "returned") out.push({ label: t.rd_tl_returned, st: "bad", ...(p.parcel.returnedAt ? { sub: p.when(p.parcel.returnedAt) } : {}) });
  else out.push(st === "picked_up" ? { label: t.rd_tl_picked, st: "dn", ...(p.parcel.pickedUpAt ? { sub: p.when(p.parcel.pickedUpAt) } : {}) } : { label: t.rd_tl_picked, st: "" });
  return out;
}
const ORDER_OF: Record<ParcelState, number> = { in_transit: 1, at_store: 2, picked_up: 3, returned: 3 };
function baseTimeline(t: T, v: OrderView): TimelineStep[] {
  const s = v.status;
  const shipped = s === "shipped";
  const shipLine = shipped ? [t.rd_tl_shipped, v.courier, v.tracking].filter(Boolean).join(" · ") : t.rd_tl_shipped;
  if (v.payment === "cod") {
    return [
      { label: t.rd_tl_placed, st: "dn" },
      { label: t.rd_tl_packing, st: shipped ? "dn" : "nw" },
      { label: shipLine, st: shipped ? "nw" : "" },
    ];
  }
  const paid = s === "paid" || shipped;
  return [
    { label: t.rd_tl_placed, st: "dn" },
    { label: paid ? t.rd_tl_paid : s === "payment_sent" ? t.rd_tl_receipt : t.rd_tl_waiting, st: paid ? "dn" : "nw" },
    { label: t.rd_tl_packing, st: shipped ? "dn" : paid ? "nw" : "" },
    { label: shipLine, st: shipped ? "nw" : "" },
  ];
}

/** Order tracking item 7: the big title, from the order's state (+ the parcel's once it matched). Pure.
 *  (Right after checkout the page keeps "Order sent!" — this is for the order opened from its link.) */
export function orderHero(t: T, v: OrderView, parcel?: ParcelView): { title: string; sub?: string; icon: string; tone: "ok" | "warn" | "bad" | "grey" } {
  if (v.status === "cancelled") return { title: t.rd_shop_od_st_cancelled, icon: "✕", tone: "grey" };
  if (v.status === "awaiting_payment") return { title: t.rd_shop_od_st_awaiting_payment, icon: "⏳", tone: "warn" };
  if (v.status === "payment_sent") return { title: t.rd_ot_t_receipt, icon: "✓", tone: "ok" };
  if (v.status === "paid" || v.status === "confirmed") return { title: t.rd_tl_packing, icon: "✓", tone: "ok" };
  const st = parcel?.state;
  if (st === "in_transit") return { title: t.rd_ot_t_transit, sub: t.rd_ot_s_transit, icon: "✓", tone: "ok" };
  if (st === "at_store") return { title: t.rd_ot_t_store, sub: t.rd_ot_s_store, icon: "📦", tone: "warn" };
  if (st === "picked_up") return { title: t.rd_ot_t_picked, sub: t.rd_ot_s_picked, icon: "✓", tone: "ok" };
  if (st === "returned") return { title: t.rd_ot_t_returned, sub: t.rd_ot_s_returned, icon: "↩", tone: "bad" };
  return { title: t.rd_ot_t_shipped, sub: t.rd_ot_s_shipped, icon: "✓", tone: "ok" };
}
/** The small status pill: the order's status, or the parcel's once it matched. Pure. */
export function parcelPill(t: T, parcel: ParcelView): { text: string; tone: "ok" | "warn" | "bad" } {
  return parcel.state === "at_store" ? { text: t.rd_ot_t_store, tone: "warn" } : parcel.state === "returned" ? { text: t.rd_ot_p_returned, tone: "bad" }
    : parcel.state === "picked_up" ? { text: t.rd_tl_picked, tone: "ok" } : { text: t.rd_tl_transit, tone: "ok" };
}
