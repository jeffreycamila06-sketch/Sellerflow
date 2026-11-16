// Seller Website — the text the buyer pastes into the seller's chat. PURE (unit-tested).
// It carries the W number, the lines, delivery, total, payment, the buyer's name and the order
// link — never the phone number (the seller already has it in the app).
import { tpl } from "../redesign/i18n";
import type { OrderView } from "./orderApi";
import { money } from "./shopApi";
import { shipLabel } from "./shipPay";

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
export function paymentLabel(t: T, p: OrderView["payment"]): string {
  return p === "bank" ? t.rd_shop_pay_bank : p === "qr" ? t.rd_shop_pay_qr : t.rd_shop_pay_cod;
}
export function orderMessage(t: T, o: OrderView, cur: string, link: string): string {
  const lines = [`${tpl(t.rd_shop_od_order, { no: o.orderNo })} — ${o.shop.name || ""}`.trim()];
  for (const i of o.items) lines.push(`• ${i.name}${i.label ? ` (${i.label})` : ""} ×${i.qty} — ${money(cur, i.price * i.qty)}`);
  const where = deliveryWhere(o);
  lines.push(`${t.rd_shop_shipping} (${deliveryLabel(t, o.delivery, o.shipId, o.shipName)}${where ? ` ${where}` : ""}): ${o.shipFee ? money(cur, o.shipFee) : t.rd_shop_co_free}`);
  lines.push(`${t.rd_shop_co_total}: ${money(cur, o.total)}`);
  lines.push(`${t.rd_shop_payment}: ${paymentLabel(t, o.payment)}`);
  lines.push(`${t.rd_shop_msg_name}: ${o.buyerName}`);
  if (link) lines.push(`${t.rd_shop_msg_link}: ${link}`);
  return lines.join("\n");
}
export const CHAT_APP_NAME: Record<string, string> = { messenger: "Messenger", line: "LINE", whatsapp: "WhatsApp", instagram: "Instagram" };
