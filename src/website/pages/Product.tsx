// Seller Website v2 — item 4: the product page (as the preview). Gallery you can swipe + thumbnails,
// colour / size buttons (never a dropdown; sold-out choices can't be picked), "Only N left", quantity up
// to the stock, the total with the cheapest delivery right by the buy buttons, how to pay, the return
// policy, item details (condition, measurements / size guide, description), "You may also like", and a
// sticky Add to cart / Buy now bar on phones. No ratings or reviews (Build 2).
import { useEffect, useMemo, useRef, useState } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop, ShopProduct } from "../shopApi";
import { photoUrl, money } from "../shopApi";
import { MAX_QTY, productStock } from "../cart";
import { variantFor, valueAvailable } from "../shopLogic";
import { checkoutOf, shipLabel, payLabel } from "../shipPay";
import { flashOn, priceNow, wasPrice, percentOff, countdown } from "../pricing";
import { Card } from "../v2/Card";
import { Sheet } from "../v2/Shell";
import { VIcon } from "../v2/icons";
import { cheapestDelivery, relatedProducts } from "./productData";
import { useNewLook } from "../v4/ctx";

type T = Record<string, string>;
export interface ProductProps {
  shop: Shop; product: ShopProduct; cur: string; nowMs: number; onAdd: (vid: number | null, qty: number) => void; onBuy: (vid: number | null, qty: number) => void;
  saved: number[]; onSave: (id: number) => void; onOpen: (id: number) => void; onQuick: (id: number) => void; onChat: () => void; onShop: (cat?: string) => void; onHome: () => void;
}
export default function Product(p: ProductProps) {
  const { shop, product, cur, nowMs } = p;
  const t = useT() as unknown as T;
  const k4 = useNewLook(); // v4: drawn icons where the older looks have an emoji
  const groups = product.groups?.length && product.variants?.length ? product.groups : [];
  const [pick, setPick] = useState<(string | null)[]>(() => groups.map(() => null));
  const [qty, setQty] = useState(1);
  const [slide, setSlide] = useState(0);
  const [sheet, setSheet] = useState<"" | "size" | "returns">("");
  const gal = useRef<HTMLDivElement | null>(null);
  const variant = useMemo(() => variantFor(product, pick), [product, pick]);
  const needsPick = groups.length > 0 && !variant;
  const total = productStock(product);
  const stock = groups.length ? (variant ? variant.stock : total) : product.stock;
  const price = priceNow(product, nowMs, variant);
  const was = wasPrice(product, nowMs, variant);
  const off = percentOff(product, nowMs, variant);
  const photos = product.photos;
  const maxQty = Math.max(0, Math.min(MAX_QTY, variant || !groups.length ? stock : 0));
  const canBuy = !needsPick && stock > 0 && qty >= 1 && qty <= maxQty;
  const ck = checkoutOf(shop);
  const cheap = cheapestDelivery(ck, price * qty);
  const related = useMemo(() => relatedProducts(shop.products, product), [shop.products, product]);
  const saved = p.saved.includes(product.id);
  const go = (i: number) => { setSlide(i); const el = gal.current; if (el && el.scrollTo) el.scrollTo({ left: el.clientWidth * i, behavior: "smooth" }); };
  const onScroll = () => { const el = gal.current; if (el && el.clientWidth) setSlide(Math.round(el.scrollLeft / el.clientWidth)); };
  const choose = (gi: number, val: string) => {
    const next = pick.map((v, i) => (i === gi ? (v === val ? null : val) : v));
    setPick(next); setQty(1);
    // a picked option with its own photo shows it
    const v = variantFor(product, next);
    if (v && v.photo !== null && photos[v.photo]) go(v.photo);
  };
  const left = needsPick ? total : stock;

  return (
    <div className="v-wrap" data-testid="pd-page">
      <div className="v-crumb"><button type="button" onClick={p.onHome}>{t.rd_shop_nav_home}</button>{product.category && <> › <button type="button" onClick={() => p.onShop(product.category)}>{product.category}</button></>} › {product.name}</div>
      <div className="v-pdp">
        <div>
          <div className="v-gal" data-testid="pd-gallery">
            <div className="v-imgs" ref={gal} onScroll={onScroll}>
              {photos.length ? photos.map((ph, i) => <img key={ph} className="v-art" src={photoUrl(ph)} alt={i === 0 ? product.name : ""} style={{ flex: "0 0 100%", objectFit: "cover" }} />)
                : <div className="v-art v-ph0" style={{ flex: "0 0 100%", fontSize: 60 }}>{product.name.slice(0, 1)}</div>}
            </div>
            {photos.length > 1 && <div className="v-cnt" data-testid="pd-count">{Math.min(slide, photos.length - 1) + 1} / {photos.length}</div>}
          </div>
          {photos.length > 1 && <div className="v-ths">{photos.map((ph, i) => <button key={ph} type="button" aria-label={`${i + 1}`} className={i === slide ? "v-on" : ""} onClick={() => go(i)}><img src={photoUrl(ph)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></button>)}</div>}
        </div>

        <div className="v-pi" style={{ display: "grid", gap: 12 }}>
          <div>
            <h2 data-testid="pd-name">{product.name}</h2>
            <div className="v-sub">{product.sold ? tpl(t.rd_shop_n_sold, { n: product.sold.toLocaleString("en-US") }) : t.rd_pd_new_in}{product.code && <span>· {t.rd_shop_code} <b>{variant?.code || product.code}</b></span>}</div>
          </div>
          <div>
            <div className="v-pr"><b data-testid="pd-price">{money(cur, price)}</b>{was && <s data-testid="pd-was">{money(cur, was)}</s>}{off > 0 && <span className="v-off">-{off}%</span>}</div>
            {ck.taxIncluded && <div data-testid="pd-tax" className="v-sub" style={{ marginTop: 2 }}>{t.rd_shop_tax_incl}</div>}
          </div>
          {flashOn(product, nowMs) && <div className="v-note" data-testid="pd-flash">{k4 ? <VIcon n="clock" size={18} /> : "⚡"} {t.rd_pd_flash} · <Cd end={product.flashEnd} startMs={nowMs} label={t.rd_home_ends_in} /></div>}

          {groups.map((g, gi) => (
            <div key={g.name} data-testid="pd-group">
              <div className="v-lbl"><span>{g.name}{pick[gi] ? `: ${pick[gi]}` : ""}</span>{!g.color && product.sizeGuide && <button type="button" data-testid="pd-size-guide" onClick={() => setSheet("size")}>{t.rd_pd_size_guide}</button>}</div>
              <div className="v-opts">
                {g.values.map((val) => {
                  const on = pick[gi] === val;
                  const ok = valueAvailable(product, pick, gi, val);
                  return (
                    <button key={val} type="button" className={`v-opt${on ? " v-on" : ""}`} data-testid="pd-opt" aria-pressed={on} disabled={!ok} onClick={() => choose(gi, val)}>
                      {g.color && <i style={{ background: g.swatches?.[val] || "#9ca3af" }} />}{val}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!groups.length && product.sizeGuide && <button type="button" className="v-chip" data-testid="pd-size-guide" onClick={() => setSheet("size")} style={{ justifySelf: "start" }}>{t.rd_pd_size_guide}</button>}
          <div className="v-sub" data-testid="pd-stock">
            {total === 0 || (!needsPick && stock === 0) ? <b data-testid="pd-soldout">{t.rd_shop_sold_out} — {t.rd_pd_save_it}</b>
              : left <= 2 ? <b data-testid="pd-left" style={{ color: "#d97706" }}>{tpl(t.rd_pd_only_left, { n: String(left) })}</b>
              : <span>{tpl(t.rd_pd_in_stock, { n: String(left) })}</span>}
          </div>
          {needsPick && total > 0 && <div data-testid="pd-pick" className="v-sub">{t.rd_shop_pick_options}</div>}

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="v-qty">
              <button type="button" aria-label="−" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span data-testid="pd-qty">{qty}</span>
              <button type="button" aria-label="+" data-testid="pd-plus" disabled={qty >= maxQty} onClick={() => setQty((q) => Math.min(maxQty, q + 1))}>+</button>
            </div>
            <button type="button" className={`v-chip${saved ? " v-on" : ""}`} data-testid="pd-save" aria-pressed={saved} onClick={() => p.onSave(product.id)}>{k4 ? <><VIcon n="heart" size={17} filled={saved} />{saved ? t.rd_shop_saved : t.rd_shop_save}</> : saved ? `♥ ${t.rd_shop_saved}` : `♡ ${t.rd_shop_save}`}</button>
          </div>
          <div className="v-dbuy">
            <button type="button" className="v-btn v-o" data-testid="pd-add-wide" disabled={!canBuy} onClick={() => p.onAdd(variant?.id ?? null, qty)}>{t.rd_shop_add_cart}</button>
            <button type="button" className="v-btn" data-testid="pd-buy-wide" disabled={!canBuy} onClick={() => p.onBuy(variant?.id ?? null, qty)}>{t.rd_shop_buy_now}</button>
          </div>

          <div className="v-box v-rows" data-testid="pd-info">
            {cheap && (
              <div data-testid="pd-total"><VIcon n="truck" size={18} /><span><b>{tpl(t.rd_pd_total_from, { total: money(cur, price * qty + cheap.fee) })}</b> {tpl(t.rd_pd_with, { option: shipLabel(t, cheap.opt), fee: cheap.fee ? money(cur, cheap.fee) : t.rd_shop_co_free })}
                <small>{ck.options.filter((o) => o.id !== cheap.opt.id).map((o) => `${shipLabel(t, o)} ${o.fee ? money(cur, o.fee) : t.rd_shop_co_free}`).concat(cheap.opt.freeOver ? [tpl(t.rd_shop_free_over, { amount: money(cur, cheap.opt.freeOver) })] : []).join(" · ")}</small></span></div>
            )}
            {ck.methods.length > 0 && <div data-testid="pd-pay"><VIcon n="cash" size={18} /><span><b>{t.rd_pd_pay_way}</b><small>{ck.methods.map((m) => payLabel(t, m)).join(" · ")}</small></span></div>}
            {shop.shop.policy && <div data-testid="pd-returns"><VIcon n="shield" size={18} /><span><b>{t.rd_shop_returns}</b><small>{shop.shop.policy.slice(0, 80)}{shop.shop.policy.length > 80 ? "…" : ""} <u role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => setSheet("returns")}>{t.rd_pd_see_policy}</u></small></span></div>}
          </div>

          {(product.condition || product.description || product.code || product.category) && (
            <div className="v-box" data-testid="pd-desc">
              <div className="v-lbl">{t.rd_shop_details}</div>
              <div className="v-spec">
                {product.condition && <><span>{t.rd_pd_condition}</span><b>{product.condition}</b></>}
                {product.category && <><span>{t.rd_shop_f_category}</span><b>{product.category}</b></>}
                {product.code && <><span>{t.rd_shop_code}</span><b>{variant?.code || product.code}</b></>}
              </div>
              {product.description && <p style={{ color: "var(--s-mut)", fontSize: 13, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{product.description}</p>}
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <div className="v-sec" data-testid="pd-related">
          <div className="v-sech"><h3>{t.rd_pd_also_like}</h3></div>
          <div className="v-hs">{related.map((x) => <Card key={x.id} p={x} cur={cur} nowMs={nowMs} saved={p.saved.includes(x.id)} onSave={() => p.onSave(x.id)} onOpen={() => p.onOpen(x.id)} onQuick={() => p.onQuick(x.id)} />)}</div>
        </div>
      )}

      <div className="v-buy" data-testid="pd-buybar" style={{ marginTop: 18 }}>
        <button type="button" className="v-ib" aria-label={t.rd_shop_nav_chat} data-testid="pd-chat" onClick={p.onChat}><VIcon n="chat" /></button>
        <button type="button" className="v-btn v-o" data-testid="pd-add" disabled={!canBuy} onClick={() => p.onAdd(variant?.id ?? null, qty)}>{t.rd_shop_add_cart}</button>
        <button type="button" className="v-btn" data-testid="pd-buy" disabled={!canBuy} onClick={() => p.onBuy(variant?.id ?? null, qty)}>{total === 0 ? t.rd_shop_sold_out : t.rd_shop_buy_now}</button>
      </div>

      {sheet === "size" && <Sheet title={t.rd_pd_size_guide} onClose={() => setSheet("")}><p data-testid="pd-size-text" style={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>{product.sizeGuide}</p><p style={{ color: "var(--s-mut)", fontSize: 12.5 }}>{t.rd_pd_size_hint}</p></Sheet>}
      {sheet === "returns" && <Sheet title={t.rd_shop_returns} onClose={() => setSheet("")}><p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, color: "var(--s-mut)" }}>{shop.shop.policy}</p></Sheet>}
    </div>
  );
}

function Cd({ end, startMs, label }: { end?: string; startMs: number; label: string }) {
  const [now, setNow] = useState(startMs);
  useEffect(() => { const id = setInterval(() => setNow((n) => n + 1000), 1000); return () => clearInterval(id); }, []);
  return <span className="v-cd">{label} {countdown(end, now).split(":").map((x, k) => <span key={k}>{k ? ":" : ""}<i>{x}</i></span>)}</span>;
}
