// Seller Website v3 — item 4: the Brand store's size sheet (phones: the "+" on a card) and the cart panel that
// opens after adding (right side on laptop, from the bottom on phones). The panel uses the cart page's own
// helpers (quantity never above stock, free-shipping progress, subtotal); the full cart page still exists.
import { useRef } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { money } from "../shopApi";
import { SmallPhoto } from "../ui";
import { type CartLine, type LineInfo, freeShipping, subtotalOf, MAX_QTY } from "../cart";
import { checkoutOf, freeOverOf } from "../shipPay";
import { cardFacts } from "../v2/cardFacts";
import { quickPlan } from "./quickAdd";
import { useAboveKeyboard } from "../v2/useAboveKeyboard";
import { VIcon } from "../v2/icons";
import { useNewLook } from "../v4/ctx";

type T = Record<string, string>;

export function SizeSheet({ shop, pid, cur, nowMs, onPick, onClose }: { shop: Shop; pid: number; cur: string; nowMs: number; onPick: (vid: number) => void; onClose: () => void }) {
  const t = useT() as unknown as T;
  const layer = useRef<HTMLDivElement | null>(null);
  useAboveKeyboard(layer);
  const p = shop.products.find((x) => x.id === pid);
  if (!p) return null;
  const plan = quickPlan(p);
  if (plan.kind !== "sizes") return null;
  return (
    <div className="v-sheet" role="dialog" aria-modal="true" aria-label={p.name} data-testid="brand-size-sheet" onClick={onClose} ref={layer}>
      <div onClick={(e) => e.stopPropagation()}>
        <h3>{p.name}</h3>
        <p style={{ margin: 0, color: "var(--s-mut)", fontSize: 13 }}>{cardFacts(p, nowMs).from ? `${t.rd_shop_from} ` : ""}{money(cur, cardFacts(p, nowMs).now)} · {t.rd_brand_pick_size}</p>
        <div className="v-qsz">{plan.sizes.map((s) => <button key={s.vid} type="button" disabled={s.stock <= 0} data-testid="brand-size" onClick={() => onPick(s.vid)}>{s.label}</button>)}</div>
        <button type="button" className="v-btn v-o v-full" data-testid="sheet-close" onClick={onClose}>{t.rd_shop_close}</button>
      </div>
    </div>
  );
}

export function CartPanel({ shop, cur, infos, lines, onQty, onRemove, onCheckout, onClose }: {
  shop: Shop; cur: string; infos: LineInfo[]; lines: CartLine[]; onQty: (i: number, q: number, stock: number) => void; onRemove: (i: number) => void; onCheckout: () => void; onClose: () => void;
}) {
  const t = useT() as unknown as T;
  const sub = subtotalOf(infos);
  const free = freeShipping(sub, freeOverOf(checkoutOf(shop)) ?? undefined);
  const count = infos.reduce((a, x) => a + x.line.qty, 0);
  const idx = (x: LineInfo) => lines.findIndex((l) => l.pid === x.line.pid && l.vid === x.line.vid);
  const title = tpl(t.rd_brand_bag, { n: String(count) });
  const k4 = useNewLook();
  const layer = useRef<HTMLDivElement | null>(null);
  useAboveKeyboard(layer);
  return (
    <div className="v-drawer" role="dialog" aria-modal="true" aria-label={title} data-testid="brand-cart-panel" onClick={onClose} ref={layer}>
      <div onClick={(e) => e.stopPropagation()}>
        <h3>{title}<button type="button" aria-label={t.rd_shop_close} data-testid="panel-x" onClick={onClose}>×</button></h3>
        {infos.length === 0 ? (
          <>
            <div className="v-empty" data-testid="panel-empty"><b>{t.rd_shop_cart_empty}</b></div>
            <button type="button" className="v-btn v-full" onClick={onClose}>{t.rd_shop_keep_shopping}</button>
          </>
        ) : (
          <>
            {infos.map((x) => {
              const i = idx(x);
              return (
                <div key={`${x.line.pid}:${x.line.vid}`} className="v-ci" data-testid="panel-line">
                  {x.photo ? <SmallPhoto path={x.photo} className="v-art" style={{ width: 64, height: 64, borderRadius: "var(--s-r)", objectFit: "cover", flex: "none" }} /> : <div className="v-art v-ph0" style={{ width: 64, height: 64, borderRadius: "var(--s-r)", flex: "none", fontSize: 22 }}>{x.product.name.slice(0, 1)}</div>}
                  <div className="v-m">
                    <b>{x.product.name}</b>
                    {x.label && <small>{x.label}</small>}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 }}>
                      <div className="v-qty">
                        <button type="button" aria-label="−" data-testid="panel-minus" disabled={x.line.qty <= 1} onClick={() => onQty(i, x.line.qty - 1, x.stock)}>−</button>
                        <span data-testid="panel-qty">{x.line.qty}</span>
                        <button type="button" aria-label="+" data-testid="panel-plus" disabled={x.line.qty >= Math.min(x.stock, MAX_QTY)} onClick={() => onQty(i, x.line.qty + 1, x.stock)}>+</button>
                      </div>
                      <b>{money(cur, x.price * x.line.qty)}</b>
                    </div>
                    <button type="button" className="v-x" data-testid="panel-remove" onClick={() => onRemove(i)} style={{ minHeight: 28 }}>{t.rd_shop_remove}</button>
                  </div>
                </div>
              );
            })}
            {free && (
              <div className="v-note" data-testid="panel-free">
                {free.remaining > 0 ? tpl(t.rd_shop_free_more, { amount: money(cur, free.remaining) }) : k4 ? <><VIcon n="check" size={18} />{t.rd_shop_free_yes}</> : `🎉 ${t.rd_shop_free_yes}`}
                <div className="v-prog"><i style={{ width: `${Math.round(free.pct * 100)}%` }} /></div>
              </div>
            )}
            <div className="v-sum"><div className="v-t"><span>{t.rd_shop_subtotal}</span><span data-testid="panel-subtotal">{money(cur, sub)}</span></div></div>
            <button type="button" className="v-btn v-full" data-testid="panel-checkout" onClick={onCheckout}>{t.rd_shop_checkout}</button>
            <button type="button" className="v-btn v-o v-full" data-testid="panel-keep" onClick={onClose}>{t.rd_shop_keep_shopping}</button>
          </>
        )}
      </div>
    </div>
  );
}
