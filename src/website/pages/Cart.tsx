// Seller Website — cart: lines with quantity (never above stock), remove, free-shipping progress,
// subtotal and Checkout. Lines whose product / variant is gone or sold out drop out.
import { useT, tpl } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { money } from "../shopApi";
import { SmallPhoto } from "../ui";
import { type CartLine, type LineInfo, freeShipping, subtotalOf, MAX_QTY } from "../cart";
import { mutedText } from "../shopStyle";

export default function Cart({ shop, cur, infos, lines, onQty, onRemove, onCheckout, onShop }: {
  shop: Shop; cur: string; infos: LineInfo[]; lines: CartLine[]; onQty: (i: number, q: number, stock: number) => void; onRemove: (i: number) => void; onCheckout: () => void; onShop: () => void;
}) {
  const t = useT();
  const sub = subtotalOf(infos);
  const free = freeShipping(sub, shop.checkout.freeOver);
  const count = infos.reduce((a, x) => a + x.line.qty, 0);
  const idx = (x: LineInfo) => lines.findIndex((l) => l.pid === x.line.pid && l.vid === x.line.vid);
  return (
    <div className="sfl-wrap" style={{ padding: "12px 12px 110px" }}>
      <h1 style={{ fontSize: 21, fontWeight: 800, margin: "4px 2px 12px" }}>{tpl(t.rd_shop_cart_n, { n: String(count) })}</h1>
      {infos.length === 0 ? (
        <div className="sfl-card" data-testid="cart-empty" style={{ padding: 24, textAlign: "center" }}>
          <div style={mutedText}>{t.rd_shop_cart_empty}</div>
          <button type="button" className="sfl-btn sfl-btn-main" style={{ marginTop: 14, padding: "0 20px" }} onClick={onShop}>{t.rd_shop_keep_shopping}</button>
        </div>
      ) : (
        <div className="sfl-side">
          <div>
            {free && (
              <div data-testid="cart-free" className="sfl-card" style={{ padding: "12px 14px", marginBottom: 10, background: "#FFF7F5" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{free.remaining > 0 ? tpl(t.rd_shop_free_more, { amount: money(cur, free.remaining) }) : t.rd_shop_free_yes}</div>
                <div style={{ height: 6, background: "#FDE2DA", borderRadius: 3, marginTop: 8, overflow: "hidden" }}><div style={{ width: `${Math.round(free.pct * 100)}%`, height: "100%", background: "var(--sc)" }} /></div>
              </div>
            )}
            <div className="sfl-card" style={{ padding: "4px 14px" }}>
              {infos.map((x) => {
                const i = idx(x);
                return (
                  <div key={`${x.line.pid}:${x.line.vid}`} data-testid="cart-line" style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid #F1F1F4" }}>
                    <div style={{ width: 72, height: 72, borderRadius: 12, overflow: "hidden", background: "#F3F4F6", flexShrink: 0 }}>{x.photo && <SmallPhoto path={x.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{x.product.name}</div>
                      <div style={mutedText}>{[x.product.code && (x.variant?.code || x.product.code), x.label].filter(Boolean).join(" · ")}</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6, gap: 8 }}>
                        <span style={{ fontWeight: 800, color: "var(--sc)" }}>{money(cur, x.price)}</span>
                        <div style={{ display: "flex", alignItems: "center", border: "1px solid #D1D5DB", borderRadius: 9 }}>
                          <button type="button" aria-label="−" disabled={x.line.qty <= 1} onClick={() => onQty(i, x.line.qty - 1, x.stock)} style={{ width: 36, height: 34, border: "none", background: "transparent", fontSize: 16, cursor: "pointer" }}>−</button>
                          <span data-testid="cart-qty" style={{ minWidth: 26, textAlign: "center", fontWeight: 800 }}>{x.line.qty}</span>
                          <button type="button" aria-label="+" data-testid="cart-plus" disabled={x.line.qty >= Math.min(x.stock, MAX_QTY)} onClick={() => onQty(i, x.line.qty + 1, x.stock)} style={{ width: 36, height: 34, border: "none", background: "transparent", fontSize: 16, cursor: "pointer" }}>+</button>
                        </div>
                      </div>
                      <button type="button" onClick={() => onRemove(i)} style={{ marginTop: 4, padding: 0, border: "none", background: "transparent", color: "#6B7280", fontSize: 12.5, textDecoration: "underline", cursor: "pointer", minHeight: 28 }}>{t.rd_shop_remove}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="sfl-card" style={{ padding: 14, marginTop: 12 }}>
            <Row a={tpl(t.rd_shop_items_n, { n: String(count) })} b={money(cur, sub)} />
            <Row a={t.rd_shop_shipping} b={t.rd_shop_at_checkout} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontWeight: 800, fontSize: 16 }}><span>{t.rd_shop_subtotal}</span><span data-testid="cart-subtotal" style={{ color: "var(--sc)" }}>{money(cur, sub)}</span></div>
            <button type="button" data-testid="cart-checkout" className="sfl-btn sfl-btn-main" style={{ width: "100%", marginTop: 14 }} onClick={onCheckout}>{t.rd_shop_checkout}</button>
          </div>
        </div>
      )}
    </div>
  );
}
function Row({ a, b }: { a: string; b: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: "#4B5563", padding: "3px 0" }}><span>{a}</span><span>{b}</span></div>;
}
