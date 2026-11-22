// Seller Website v2 — item 5: the cart (as the preview). "1 Cart › 2 Details › 3 Done", the free-shipping
// progress, the lines (photo, option, quantity never above stock, Remove), "Goes well with", and an order
// summary that stays in view (laptop: a column on the right; phone: Total + Checkout bar at the bottom).
// Lines whose product / option is gone or sold out drop out.
import { useT, tpl } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { money } from "../shopApi";
import { SmallPhoto } from "../ui";
import { type CartLine, type LineInfo, freeShipping, subtotalOf, MAX_QTY, productStock } from "../cart";
import { checkoutOf, freeOverOf } from "../shipPay";
import { cheapestDelivery } from "./productData";
import { Card } from "../v2/Card";
import { Steps } from "../checkoutPages";
import { VIcon } from "../v2/icons";
import { useNewLook } from "../v4/ctx";

type T = Record<string, string>;
export default function Cart({ shop, cur, nowMs, infos, lines, onQty, onRemove, onCheckout, onShop, saved, onSave, onOpen, onQuick }: {
  shop: Shop; cur: string; nowMs: number; infos: LineInfo[]; lines: CartLine[]; onQty: (i: number, q: number, stock: number) => void; onRemove: (i: number) => void; onCheckout: () => void; onShop: () => void;
  saved: number[]; onSave: (id: number) => void; onOpen: (id: number) => void; onQuick: (id: number) => void;
}) {
  const t = useT() as unknown as T;
  const k4 = useNewLook();
  const sub = subtotalOf(infos);
  const ck = checkoutOf(shop);
  const fo = freeOverOf(ck);
  const free = freeShipping(sub, fo ?? undefined);
  const cheap = cheapestDelivery(ck, sub);
  const count = infos.reduce((a, x) => a + x.line.qty, 0);
  const idx = (x: LineInfo) => lines.findIndex((l) => l.pid === x.line.pid && l.vid === x.line.vid);
  const inCart = new Set(infos.map((x) => x.product.id));
  const goesWith = shop.products.filter((p) => !inCart.has(p.id) && productStock(p) > 0).slice(0, 6);
  if (infos.length === 0) {
    return (
      <div className="v-wrap">
        <div className="v-empty" data-testid="cart-empty"><b>{t.rd_shop_cart_empty}</b><br />{t.rd_cart_find}<br /><br /><button type="button" className="v-btn" onClick={onShop}>{t.rd_shop_start}</button></div>
      </div>
    );
  }
  return (
    <div data-testid="cart-page">
      <div className="v-wrap" style={{ paddingBottom: 20 }}>
        <Steps at={1} t={t} />
        <div className="v-two">
          <div>
            {free && (
              <div className="v-note" data-testid="cart-free" style={{ marginBottom: 10 }}>
                {free.remaining > 0 ? tpl(t.rd_shop_free_more, { amount: money(cur, free.remaining) }) : k4 ? <><VIcon n="check" size={18} />{t.rd_shop_free_yes}</> : `🎉 ${t.rd_shop_free_yes}`}
                <div className="v-prog"><i style={{ width: `${Math.round(free.pct * 100)}%` }} /></div>
              </div>
            )}
            {infos.map((x) => {
              const i = idx(x);
              return (
                <div key={`${x.line.pid}:${x.line.vid}`} className="v-ci" data-testid="cart-line">
                  {x.photo ? <SmallPhoto path={x.photo} className="v-art" style={{ width: 74, height: 74, borderRadius: 8, objectFit: "cover", flex: "none" }} /> : <div className="v-art v-ph0" style={{ width: 74, height: 74, borderRadius: 8, flex: "none", fontSize: 24 }}>{x.product.name.slice(0, 1)}</div>}
                  <div className="v-m">
                    <b>{x.product.name}</b>
                    <small>{[x.label, x.product.code && (x.variant?.code || x.product.code)].filter(Boolean).join(" · ")}</small>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 }}>
                      <div className="v-qty">
                        <button type="button" aria-label="−" disabled={x.line.qty <= 1} onClick={() => onQty(i, x.line.qty - 1, x.stock)}>−</button>
                        <span data-testid="cart-qty">{x.line.qty}</span>
                        <button type="button" aria-label="+" data-testid="cart-plus" disabled={x.line.qty >= Math.min(x.stock, MAX_QTY)} onClick={() => onQty(i, x.line.qty + 1, x.stock)}>+</button>
                      </div>
                      <b style={{ color: "var(--s-acc)" }}>{money(cur, x.price * x.line.qty)}</b>
                    </div>
                    <button type="button" className="v-x" data-testid="cart-remove" onClick={() => onRemove(i)} style={{ minHeight: 28 }}>{t.rd_shop_remove}</button>
                  </div>
                </div>
              );
            })}
            {goesWith.length > 0 && (
              <div className="v-sec" data-testid="cart-goes-with">
                <div className="v-sech"><h3 style={{ fontSize: 16 }}>{t.rd_cart_goes_with}</h3></div>
                <div className="v-hs">{goesWith.map((p) => <Card key={p.id} p={p} cur={cur} nowMs={nowMs} saved={saved.includes(p.id)} onSave={() => onSave(p.id)} onOpen={() => onOpen(p.id)} onQuick={() => onQuick(p.id)} />)}</div>
              </div>
            )}
          </div>
          <div className="v-side">
            <div className="v-box" data-testid="cart-summary">
              <div className="v-lbl">{t.rd_shop_co_summary}</div>
              <div className="v-sum">
                <div><span>{tpl(t.rd_shop_items_n, { n: String(count) })}</span><b>{money(cur, sub)}</b></div>
                <div><span>{t.rd_shop_shipping}</span><b className={cheap && cheap.fee === 0 ? "v-g" : ""}>{cheap ? `${cheap.fee ? tpl(t.rd_cart_from, { amount: money(cur, cheap.fee) }) : t.rd_shop_co_free}` : t.rd_shop_at_checkout}</b></div>
                <div className="v-t"><span>{t.rd_shop_subtotal}</span><span data-testid="cart-subtotal">{money(cur, sub)}</span></div>
              </div>
              <div className="v-dbuy" style={{ marginTop: 12 }}><button type="button" className="v-btn" data-testid="cart-checkout" onClick={onCheckout}>{t.rd_shop_checkout}</button></div>
            </div>
          </div>
        </div>
      </div>
      <div className="v-buy">
        <div className="v-tot">{t.rd_shop_subtotal}<b>{money(cur, sub)}</b></div>
        <button type="button" className="v-btn" data-testid="cart-checkout-phone" onClick={onCheckout}>{tpl(t.rd_cart_checkout_n, { n: String(count) })}</button>
      </div>
    </div>
  );
}
