// Seller Website — the text the buyer pastes into the seller's chat. PURE (unit-tested).
// It carries the W number, the lines, delivery, total, payment, the buyer's name and the order
// link — never the phone number (the seller already has it in the app).
import { tpl } from "../redesign/i18n";
import type { OrderView } from "./orderApi";
import { money } from "./shopApi";

type T = Record<string, string>;
export function deliveryLabel(t: T, d: OrderView["delivery"]): string {
  return d === "s711" ? "7-11" : d === "fm" ? t.rd_shop_fm : t.rd_shop_home;
}
export function paymentLabel(t: T, p: OrderView["payment"]): string {
  return p === "bank" ? t.rd_shop_pay_bank : p === "qr" ? t.rd_shop_pay_qr : t.rd_shop_pay_cod;
}
export function orderMessage(t: T, o: OrderView, cur: string, link: string): string {
  const lines = [`${tpl(t.rd_shop_od_order, { no: o.orderNo })} — ${o.shop.name || ""}`.trim()];
  for (const i of o.items) lines.push(`• ${i.name}${i.label ? ` (${i.label})` : ""} ×${i.qty} — ${money(cur, i.price * i.qty)}`);
  const where = o.delivery === "home" ? (o.address || "") : [o.storeName, o.storeId ? `#${o.storeId}` : ""].filter(Boolean).join(" ");
  lines.push(`${t.rd_shop_shipping} (${deliveryLabel(t, o.delivery)}${where ? ` ${where}` : ""}): ${o.shipFee ? money(cur, o.shipFee) : t.rd_shop_co_free}`);
  lines.push(`${t.rd_shop_co_total}: ${money(cur, o.total)}`);
  lines.push(`${t.rd_shop_payment}: ${paymentLabel(t, o.payment)}`);
  lines.push(`${t.rd_shop_msg_name}: ${o.buyerName}`);
  if (link) lines.push(`${t.rd_shop_msg_link}: ${link}`);
  return lines.join("\n");
}
export const CHAT_APP_NAME: Record<string, string> = { messenger: "Messenger", line: "LINE", whatsapp: "WhatsApp", instagram: "Instagram" };
