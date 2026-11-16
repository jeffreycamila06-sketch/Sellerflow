// Seller Website v2 — shipping options + payment methods as the BUYER sees them (pure, unit-tested).
// The database answers them as website_shop().checkout2 (sql/167 website_checkout_v2). Before sql/167 is
// applied the shop only has the old 'checkout' answer → checkoutOf() derives the same list from it, with
// the same rules as the database's "nothing saved yet" branch.
import type { Shop, ShopCheckout } from "./shopApi";
import type { Delivery } from "./orderApi";

export type ShipNeeds = "store711" | "storefm" | "store" | "address" | "none";
export const SHIP_NEEDS: ShipNeeds[] = ["store711", "storefm", "store", "address", "none"];
export interface ShipOpt { id: string; name?: string; note?: string; fee: number; freeOver?: number; needs: ShipNeeds; cod: boolean }
export type PayKind = "first" | "delivery";
export interface PayOpt { id: string; name?: string; info?: string; qr?: string; kind: PayKind; bank?: { bankName?: string; accountName?: string; accountNumber?: string } }
export interface CheckoutV2 { options: ShipOpt[]; methods: PayOpt[]; autoCancelHours: number; taxIncluded?: boolean }

export const ID_RE = /^[a-z0-9_-]{1,24}$/;
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** The database's checkout2 answer → CheckoutV2 (defensive; null when absent or unreadable). Pure. */
export function toCheckoutV2(j: unknown): CheckoutV2 | null {
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.options) || !Array.isArray(o.methods)) return null;
  const options: ShipOpt[] = [];
  for (const x of o.options) {
    const e = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || !SHIP_NEEDS.includes(e.needs as ShipNeeds)) continue;
    const fo = num(e.freeOver);
    options.push({ id: e.id, fee: num(e.fee), needs: e.needs as ShipNeeds, cod: e.cod === true,
      ...(str(e.name, 40) ? { name: str(e.name, 40) } : {}), ...(str(e.note, 80) ? { note: str(e.note, 80) } : {}), ...(fo > 0 ? { freeOver: fo } : {}) });
  }
  const methods: PayOpt[] = [];
  for (const x of o.methods) {
    const e = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || (e.kind !== "first" && e.kind !== "delivery")) continue;
    const b = e.bank && typeof e.bank === "object" ? (e.bank as Record<string, unknown>) : null;
    methods.push({ id: e.id, kind: e.kind,
      ...(str(e.name, 40) ? { name: str(e.name, 40) } : {}), ...(str(e.info, 300) ? { info: str(e.info, 300) } : {}), ...(str(e.qr, 200) ? { qr: str(e.qr, 200) } : {}),
      ...(b ? { bank: { bankName: str(b.bankName, 60), accountName: str(b.accountName, 60), accountNumber: str(b.accountNumber, 40) } } : {}) });
  }
  const h = Math.round(num(o.autoCancelHours, 24));
  return { options, methods, autoCancelHours: Math.min(168, Math.max(1, h || 24)), ...(o.taxIncluded === true ? { taxIncluded: true } : {}) };
}

/** The old public checkout + the shop's country → the v2 list (mirror of the database's "nothing saved" branch). Pure. */
export function v2FromLegacy(ck: ShopCheckout, country: string): CheckoutV2 {
  const tw = (country || "TW").toUpperCase() === "TW";
  const fo = ck.freeOver && ck.freeOver > 0 ? { freeOver: ck.freeOver } : {};
  const options: ShipOpt[] = [];
  if (tw && ck.ship?.s711) options.push({ id: "s711", fee: num(ck.ship.s711.fee, 60), needs: "store711", cod: true, ...fo });
  if (tw && ck.ship?.fm) options.push({ id: "fm", fee: num(ck.ship.fm.fee, 60), needs: "storefm", cod: true, ...fo });
  if (ck.ship?.home) options.push({ id: "home", fee: num(ck.ship.home.fee, 120), needs: "address", cod: false, ...fo });
  if (!tw) options.push({ id: "pickup", fee: 0, needs: "none", cod: true });
  const methods: PayOpt[] = [];
  if (ck.bank) methods.push({ id: "bank", kind: "first", bank: { ...ck.bank } });
  if (ck.qr?.path) methods.push({ id: "qr", kind: "first", qr: ck.qr.path, ...(ck.qr.label ? { name: ck.qr.label.slice(0, 40) } : {}) });
  if (ck.cod) methods.push({ id: "cod", kind: "delivery" });
  return { options, methods, autoCancelHours: Math.min(168, Math.max(1, Math.round(num(ck.autoCancelHours, 24)) || 24)) };
}

/** What the buyer is offered: the database's v2 answer, else derived from the old one. Pure. */
export function checkoutOf(shop: Shop): CheckoutV2 {
  return shop.checkout2 ?? v2FromLegacy(shop.checkout, shop.country);
}
/** The order's delivery kind for an option. Pure. */
export function deliveryOfNeeds(n: ShipNeeds): Delivery {
  return n === "store711" ? "s711" : n === "storefm" ? "fm" : n === "store" ? "store" : n === "address" ? "home" : "pickup";
}
/** Pay methods a buyer may pick with this option (pay on delivery only where the option allows it). Pure. */
export function methodsFor(c: CheckoutV2, opt: ShipOpt | null | undefined): PayOpt[] {
  return c.methods.filter((m) => m.kind === "first" || !!opt?.cod);
}
/** The cheapest "free over" amount among the options (for the cart's progress bar), or null. Pure. */
export function freeOverOf(c: CheckoutV2): number | null {
  const xs = c.options.map((o) => o.freeOver).filter((x): x is number => !!x && x > 0);
  return xs.length ? Math.min(...xs) : null;
}

/** Ready-made option / method ids have a translated name; a seller-typed name always wins. */
export const SHIP_LABEL_KEY: Record<string, string> = { fm: "rd_shop_fm", home: "rd_shop_home", pickup: "rd_ship_n_pickup", std: "rd_ship_n_std", exp: "rd_ship_n_exp", jt: "rd_ship_n_jt", lbc: "rd_ship_n_lbc" };
export const PAY_LABEL_KEY: Record<string, string> = { bank: "rd_shop_pay_bank", qr: "rd_shop_pay_qr", cod: "rd_shop_pay_cod", pod: "rd_pay_n_pod", codph: "rd_pay_n_codph", interac: "rd_pay_n_interac", payid: "rd_pay_n_payid", gcash: "rd_pay_n_gcash", maya: "rd_pay_n_maya" };
const NEEDS_KEY: Record<ShipNeeds, string> = { store711: "", storefm: "rd_shop_fm", store: "rd_ship_n_store", address: "rd_shop_home", none: "rd_ship_n_pickup" };
export function shipLabel(t: Record<string, string>, o: { id: string; name?: string | null; needs?: ShipNeeds }): string {
  if (o.name?.trim()) return o.name.trim();
  if (o.id === "s711" || o.needs === "store711") return "7-11";
  return t[SHIP_LABEL_KEY[o.id]] || (o.needs ? t[NEEDS_KEY[o.needs]] : "") || o.id;
}
export function payLabel(t: Record<string, string>, m: { id: string; name?: string | null; kind?: PayKind }): string {
  return m.name?.trim() || t[PAY_LABEL_KEY[m.id]] || (m.kind === "delivery" ? t.rd_pay_n_pod : t.rd_shop_pay_bank) || m.id;
}
