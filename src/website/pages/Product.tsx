// Seller Website — product page: gallery, price, name, code, "Only N left", variant picker (a value
// with no stock left in the current choice is shown sold out and can't be picked), quantity limited
// by stock, Add to cart / Buy now, delivery + payment + returns, description.
import { useMemo, useState } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop, ShopProduct } from "../shopApi";
import { photoUrl, money } from "../shopApi";
import { MAX_QTY, productStock } from "../cart";
import { variantFor, valueAvailable } from "../shopLogic";
import { mutedText } from "../shopStyle";
import { checkoutOf } from "../shipPay";

export default function Product({ shop, product, cur, onAdd, onBuy }: { shop: Shop; product: ShopProduct; cur: string; onAdd: (vid: number | null, qty: number) => void; onBuy: (vid: number | null, qty: number) => void }) {
  const t = useT();
  const groups = product.groups?.length && product.variants?.length ? product.groups : [];
  const [pick, setPick] = useState<(string | null)[]>(() => groups.map(() => null));
  const [qty, setQty] = useState(1);
  const [slide, setSlide] = useState(0);
  const variant = useMemo(() => variantFor(product, pick), [product, pick]);
  const needsPick = groups.length > 0 && !variant;
  const stock = groups.length ? (variant ? variant.stock : productStock(product)) : product.stock;
  const price = variant ? variant.price : product.price;
  const photos = product.photos.length ? product.photos : [];
  const shownSlide = variant && variant.photo !== null && photos[variant.photo] ? variant.photo : slide;
  const maxQty = Math.max(0, Math.min(MAX_QTY, variant || !groups.length ? stock : 0));
  const c = shop.checkout;
  const ship: string[] = [];
  if (c.ship.s711) ship.push(`7-11 ${money(cur, c.ship.s711.fee)}`);
  if (c.ship.fm) ship.push(`${t.rd_shop_fm} ${money(cur, c.ship.fm.fee)}`);
  if (c.ship.home) ship.push(`${t.rd_shop_home} ${money(cur, c.ship.home.fee)}`);
  const pays = [c.bank && t.rd_shop_pay_bank, c.qr && t.rd_shop_pay_qr, c.cod && t.rd_shop_pay_cod].filter(Boolean).join(" · ");
  const canBuy = !needsPick && stock > 0 && qty >= 1 && qty <= maxQty;

  return (
    <div className="sfl-wrap" style={{ paddingBottom: 96 }}>
      <div className="sfl-two" style={{ padding: "0 0 0" }}>
        <div>
          <div data-testid="pd-gallery" style={{ position: "relative", background: "#F3F4F6", aspectRatio: "1 / 1", overflow: "hidden" }}>
            {photos.length
              ? <img src={photoUrl(photos[Math.min(shownSlide, photos.length - 1)])} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60, fontWeight: 800, color: "#D1D5DB" }}>{product.name.slice(0, 1)}</div>}
            {photos.length > 1 && <span style={{ position: "absolute", right: 12, bottom: 12, fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.45)", padding: "3px 8px", borderRadius: 999 }}>{Math.min(shownSlide, photos.length - 1) + 1}/{photos.length}</span>}
          </div>
          {photos.length > 1 && (
            <div className="sfl-hscroll" style={{ padding: "8px 12px" }}>
              {photos.map((ph, i) => (
                <button key={ph} type="button" aria-label={`${i + 1}`} onClick={() => setSlide(i)} style={{ width: 56, height: 56, padding: 0, borderRadius: 10, overflow: "hidden", border: i === shownSlide ? "2px solid var(--sc)" : "1px solid #E5E7EB", cursor: "pointer", flexShrink: 0 }}>
                  <img src={photoUrl(ph)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: "12px 14px" }}>
          <div data-testid="pd-price" style={{ fontSize: 26, fontWeight: 800, color: "var(--sc)" }}>{money(cur, price)}</div>
          {checkoutOf(shop).taxIncluded && <div data-testid="pd-tax" style={{ ...mutedText, fontSize: 12 }}>{t.rd_shop_tax_incl}</div>}
          <h1 data-testid="pd-name" style={{ fontSize: 19, fontWeight: 800, margin: "4px 0 6px", lineHeight: 1.3 }}>{product.name}</h1>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", ...mutedText }}>
            {product.code && <span>{t.rd_shop_code} <b style={{ color: "#111827" }}>{variant?.code || product.code}</b></span>}
            {stock > 0 && stock <= 5 && <span data-testid="pd-left" style={{ color: "var(--sc)", fontWeight: 800 }}>{tpl(t.rd_shop_only_left, { n: String(stock) })}</span>}
            {stock === 0 && !needsPick && <span data-testid="pd-soldout" style={{ color: "#6B7280", fontWeight: 800 }}>{t.rd_shop_sold_out}</span>}
          </div>

          {groups.map((g, gi) => (
            <div key={g.name} data-testid="pd-group" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{g.name}{pick[gi] ? <span style={{ fontWeight: 600, color: "#6B7280" }}> · {pick[gi]}</span> : null}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {g.values.map((val) => {
                  const on = pick[gi] === val;
                  const ok = valueAvailable(product, pick, gi, val);
                  return (
                    <button key={val} type="button" data-testid="pd-opt" aria-pressed={on} disabled={!ok} onClick={() => { setPick((p) => p.map((x, i) => (i === gi ? (x === val ? null : val) : x))); setQty(1); }}
                      style={{ minWidth: 48, minHeight: 42, padding: "6px 14px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: ok ? "pointer" : "not-allowed", border: on ? "2px solid var(--sc)" : "1px solid #D1D5DB", background: on ? "#FFF5F2" : "#fff", color: ok ? "#111827" : "#9CA3AF", textDecoration: ok ? "none" : "line-through" }}>
                      {val}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{t.rd_shop_qty}</span>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid #D1D5DB", borderRadius: 10, overflow: "hidden" }}>
              <button type="button" aria-label="−" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ width: 44, height: 42, border: "none", background: "#fff", fontSize: 18, cursor: "pointer" }}>−</button>
              <span data-testid="pd-qty" style={{ minWidth: 40, textAlign: "center", fontWeight: 800 }}>{qty}</span>
              <button type="button" aria-label="+" data-testid="pd-plus" disabled={qty >= maxQty} onClick={() => setQty((q) => Math.min(maxQty, q + 1))} style={{ width: 44, height: 42, border: "none", background: "#fff", fontSize: 18, cursor: "pointer" }}>+</button>
            </div>
            {variant && <span style={mutedText}>{tpl(t.rd_shop_available, { n: String(variant.stock) })}</span>}
          </div>
          {needsPick && <div data-testid="pd-pick" style={{ ...mutedText, marginTop: 8 }}>{t.rd_shop_pick_options}</div>}

          <div className="sfl-only-wide" style={{ marginTop: 18 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="sfl-btn sfl-btn-line" style={{ flex: 1 }} disabled={!canBuy} onClick={() => onAdd(variant?.id ?? null, qty)}>{t.rd_shop_add_cart}</button>
              <button type="button" className="sfl-btn sfl-btn-main" style={{ flex: 1 }} disabled={!canBuy} onClick={() => onBuy(variant?.id ?? null, qty)}>{t.rd_shop_buy_now}</button>
            </div>
          </div>

          <div className="sfl-card" style={{ marginTop: 18, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {ship.length > 0 && <Info title={t.rd_shop_delivery} text={`${ship.join(" · ")}${c.freeOver ? ` · ${tpl(t.rd_shop_free_over, { amount: money(cur, c.freeOver) })}` : ""}`} />}
            {pays && <Info title={t.rd_shop_payment} text={pays} />}
            {shop.shop.policy && <Info title={t.rd_shop_returns} text={shop.shop.policy} />}
          </div>
          {product.description && (
            <div className="sfl-card" data-testid="pd-desc" style={{ marginTop: 12, padding: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{t.rd_shop_details}</div>
              <p style={{ ...mutedText, fontSize: 13.5, margin: 0, whiteSpace: "pre-wrap" }}>{product.description}</p>
            </div>
          )}
        </div>
      </div>
      <div className="sfl-only-phone" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, background: "#fff", borderTop: "1px solid #ECECF1", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", gap: 10 }}>
        <button type="button" data-testid="pd-add" className="sfl-btn sfl-btn-line" style={{ flex: 1 }} disabled={!canBuy} onClick={() => onAdd(variant?.id ?? null, qty)}>{t.rd_shop_add_cart}</button>
        <button type="button" data-testid="pd-buy" className="sfl-btn sfl-btn-main" style={{ flex: 1 }} disabled={!canBuy} onClick={() => onBuy(variant?.id ?? null, qty)}>{t.rd_shop_buy_now}</button>
      </div>
    </div>
  );
}
function Info({ title, text }: { title: string; text: string }) {
  return <div><div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div><div style={{ ...mutedText, whiteSpace: "pre-wrap" }}>{text}</div></div>;
}
