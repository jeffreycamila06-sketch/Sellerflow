// Seller Website — checkout helpers (pure, unit-tested).
import { tpl } from "../redesign/i18n";
import type { Shop } from "./shopApi";
import type { LineInfo } from "./cart";
import type { PlaceResult } from "./orderApi";
import { checkoutOf, methodsFor } from "./shipPay";

export const STORE_MAPS: Record<"s711" | "fm", string> = {
  s711: "https://emap.pcsc.com.tw/",
  fm: "https://www.family.com.tw/Marketing/zh/Map",
};

/** The shipping option ids a buyer may pick (v2 list, or Taiwan's s711 / fm / home derived from the old settings). */
export function deliveriesOf(shop: Shop): string[] {
  return checkoutOf(shop).options.map((o) => o.id);
}
/** The payment method ids allowed with that option (pay on delivery only where the option allows it). */
export function paymentsOf(shop: Shop, delivery: string | null): string[] {
  const c = checkoutOf(shop);
  return methodsFor(c, c.options.find((o) => o.id === delivery)).map((m) => m.id);
}

export function placeFailText(t: Record<string, string>, r: Extract<PlaceResult, { ok: false }>, infos: LineInfo[]): string {
  if (r.error === "out_of_stock") {
    const x = infos.find((i) => i.line.pid === r.pid && (r.vid ?? null) === (i.line.vid ?? null));
    return tpl(t.rd_shop_co_err_stock, { name: x ? `${x.product.name}${x.label ? ` (${x.label})` : ""}` : "", n: String(r.left ?? 0) });
  }
  if (r.error === "item_gone" || r.error === "pick_option" || r.error === "bad_items") return t.rd_shop_co_err_gone;
  if (r.error === "too_many") return t.rd_shop_co_err_too_many;
  if (r.error === "blocked") return t.rd_shop_co_err_blocked;
  if (r.error === "shop_closed") return t.rd_shop_co_err_closed;
  if (r.error === "bad_name") return t.rd_shop_co_err_name;
  if (r.error === "bad_phone") return t.rd_shop_co_err_phone;
  if (r.error === "bad_store") return t.rd_shop_co_err_store;
  if (r.error === "bad_address") return t.rd_shop_co_err_address;
  if (r.error === "bad_payment") return t.rd_shop_co_err_payment;
  if (r.error === "bad_delivery") return t.rd_shop_co_err_delivery;
  return t.rd_shop_co_err_network;
}

/** Copy text: the Clipboard API, else a hidden textarea (older WebViews). */
export async function copyText(s: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(s); return true; } } catch { /* fall back */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = s; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

