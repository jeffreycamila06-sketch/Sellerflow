// Seller Website v2 — what the home page parts show (pure, unit-tested). The seller's own words win;
// without them each part is filled from the shop's real data (shipping options, payment methods, orders
// done, chat apps). No made-up numbers, no ratings.
import { tpl } from "../../redesign/i18n";
import type { Shop, ShopDesign, ShopProduct } from "../shopApi";
import { money } from "../shopApi";
import { checkoutOf, shipLabel, payLabel, freeOverOf } from "../shipPay";

type T = Record<string, string>;
export interface HomeSlide { title?: string; text?: string; button?: string; cat?: string; pic?: string }
/** The seller's slides (1–5); none → one made from the shop's name, tagline and cover. */
export function homeSlides(d: ShopDesign): HomeSlide[] {
  const own = (d.slides || []).filter((s) => s && (s.title || s.text || s.pic)).slice(0, 5);
  if (own.length) return own;
  return d.name ? [{ title: d.name, text: d.tagline, pic: d.cover }] : [];
}
const CHAT_NAME: Record<string, string> = { line: "LINE", messenger: "Messenger", whatsapp: "WhatsApp", instagram: "Instagram" };
export function homeTrust(t: T, shop: Shop, cur: string): { title: string; sub?: string }[] {
  const d = shop.shop, ck = checkoutOf(shop);
  const ships = ck.options.map((o) => shipLabel(t, o));
  const fo = freeOverOf(ck);
  const pod = ck.methods.some((m) => m.kind === "delivery");
  const first = ck.methods.filter((m) => m.kind === "first").map((m) => payLabel(t, m));
  const chat = (["line", "messenger", "whatsapp", "instagram"] as const).find((k) => d.chats?.[k]);
  const auto = [
    ships.length ? { title: ships.slice(0, 2).join(" & "), sub: fo ? tpl(t.rd_shop_free_over, { amount: money(cur, fo) }) : ships.length > 2 ? ships.slice(2).join(" · ") : undefined } : null,
    ck.methods.length ? (pod ? { title: t.rd_home_trust_pod, sub: first.join(" · ") || undefined } : { title: first[0], sub: first.slice(1).join(" · ") || undefined }) : null,
    shop.stats.orders > 0 ? { title: tpl(t.rd_home_orders_done, { n: shop.stats.orders.toLocaleString("en-US") }), sub: shop.verified ? t.rd_shop_verified : undefined } : null,
    d.replyTime || chat ? { title: d.replyTime ? tpl(t.rd_home_replies, { time: d.replyTime }) : t.rd_home_chat_us, sub: chat ? tpl(t.rd_home_chat_on, { app: CHAT_NAME[chat] }) : undefined } : null,
  ];
  const out: { title: string; sub?: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const own = d.trust?.[i];
    const a = auto[i];
    if (own?.title) out.push({ title: own.title, sub: own.sub ?? a?.sub });
    else if (a) out.push(own?.sub ? { title: a.title, sub: own.sub } : a);
  }
  return out;
}
export function homeSteps(t: T, shop: Shop): { title: string; text: string }[] {
  const ck = checkoutOf(shop);
  const ships = ck.options.map((o) => shipLabel(t, o)).slice(0, 3).join(", ");
  const pays = ck.methods.map((m) => payLabel(t, m)).slice(0, 3).join(", ");
  const auto = [
    { title: t.rd_home_step1_t, text: t.rd_home_step1 },
    { title: t.rd_home_step2_t, text: [ships, pays].filter(Boolean).join(" · ") || t.rd_shop_how2 },
    { title: t.rd_home_step3_t, text: t.rd_home_step3 },
  ];
  return auto.map((a, i) => ({ title: shop.shop.steps?.[i]?.title || a.title, text: shop.shop.steps?.[i]?.text || a.text }));
}
/** Categories in the order products show them, each with the seller's picture or its first product photo. */
export function categoriesOf(shop: Shop): { name: string; pic?: string }[] {
  const out: { name: string; pic?: string }[] = [];
  for (const p of shop.products) {
    if (!p.category || out.some((c) => c.name === p.category)) continue;
    const pic = shop.shop.catPics?.[p.category] || shop.products.find((x) => x.category === p.category && x.photos[0])?.photos[0];
    out.push({ name: p.category, ...(pic ? { pic } : {}) });
  }
  return out.slice(0, 20);
}
/** Ranked by real units sold (only products that sold), top 6. */
export const bestSellers = (list: ShopProduct[]) => list.filter((p) => (p.sold || 0) > 0).sort((a, b) => (b.sold || 0) - (a.sold || 0)).slice(0, 6);
/** The newest 10. */
export const newArrivals = (list: ShopProduct[]) => [...list].sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0) || b.id - a.id).slice(0, 10);
