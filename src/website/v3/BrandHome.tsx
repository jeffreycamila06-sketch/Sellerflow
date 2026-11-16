// Seller Website v3 — item 1: the Brand store home (docs/design/seller-website-v3/site-v3.html, VIEWS.home
// in the brand layout). In the preview's order:
//   colour band (the header sits on it, see-through at the top) with slide 1's title + text and two big
//   category tiles · the trust line · product rows that scroll sideways (best sellers, on sale, new
//   arrivals; arrows on laptop) · promo · category tiles "from <lowest price>" · next live · about ·
//   how to order · good to know.
// Every part the seller turned off, or that has nothing to show, stays hidden (as Build 1).
import { Fragment, useMemo, useRef, type ReactNode } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop, SectionKey, ShopProduct } from "../shopApi";
import { money, photoUrl } from "../shopApi";
import { Card } from "../v2/Card";
import { compact } from "../shopLogic";
import { socialUrl } from "../shopLinks";
import { checkoutOf } from "../shipPay";
import type { ShopFilter } from "../shopFilter";
import { homeTrust, homeSteps, bestSellers, newArrivals } from "../pages/homeData";
import { brandBand, brandCategories, brandTiles, onSale } from "./brandData";
import type { ShopLook } from "./look";

type T = Record<string, string>;
export interface BrandHomeProps {
  shop: Shop; look: ShopLook; cur: string; nowMs: number; saved: number[]; onSave: (id: number) => void; onOpen: (id: number) => void; onQuick: (id: number) => void;
  onShop: (f?: Partial<ShopFilter>) => void;
  /** The product card (item 3 passes the Brand store card); default = Build 1's. */
  renderCard?: (p: ShopProduct) => ReactNode;
}
export default function BrandHome({ shop, look, cur, nowMs, saved, onSave, onOpen, onQuick, onShop, renderCard }: BrandHomeProps) {
  const t = useT() as unknown as T;
  const d = shop.shop;
  const on = (k: SectionKey) => d.sections?.[k] !== false;
  const ck = checkoutOf(shop);
  const band = brandBand(shop);
  const cats = useMemo(() => brandCategories(shop, nowMs), [shop, nowMs]);
  const tiles = useMemo(() => brandTiles(cats, look.tiles), [cats, look.tiles]);
  const best = useMemo(() => bestSellers(shop.products), [shop.products]);
  const sale = useMemo(() => onSale(shop.products, nowMs), [shop.products, nowMs]);
  const fresh = useMemo(() => newArrivals(shop.products).slice(0, 8), [shop.products]);
  const trust = homeTrust(t, shop, cur);
  const steps = homeSteps(t, shop);
  const sold = shop.products.reduce((a, p) => a + (p.sold || 0), 0);
  const faq: { q: string; a: string; policy?: boolean }[] = [...(d.faq || []), ...(d.policy && on("policy") ? [{ q: t.rd_shop_returns, a: d.policy, policy: true }] : [])];
  const liveUrl = socialUrl("tiktok", d.socials?.tiktok || "") || socialUrl("facebook", d.socials?.facebook || "");
  const card = (p: ShopProduct) => <Fragment key={p.id}>{renderCard ? renderCard(p) : <Card p={p} cur={cur} nowMs={nowMs} saved={saved.includes(p.id)} onSave={() => onSave(p.id)} onOpen={() => onOpen(p.id)} onQuick={() => onQuick(p.id)} />}</Fragment>;
  const showBandText = on("slides") && (band.title || band.text);
  const showTiles = on("categories") && tiles.length > 0;

  return (
    <div data-testid="shop-home" data-layout="brand">
      <div className="v-band" data-testid="brand-band">
        <div className="v-wrap">
          {showBandText ? <>{band.title && <h2>{band.title}</h2>}{band.text && <p>{band.text}</p>}</> : <div className="v-noband" />}
          {showTiles && (
            <div className={`v-tiles2${tiles.length === 1 ? " v-one" : ""}`} data-testid="brand-tiles">
              {tiles.map((c) => (
                <button key={c.name} type="button" className="v-tile" data-testid="brand-tile" onClick={() => onShop({ cat: c.name })}>
                  <img src={photoUrl(c.pic!)} alt="" loading="lazy" /><span>{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="v-wrap">
        {on("trust") && trust.length > 0 && <div className="v-tline" data-testid="brand-trust">{trust.map((x, i) => <span key={i}>{["🚚", "💵", "✓", "⚡"][i]} {x.title}</span>)}</div>}

        {on("best") && best.length > 0 && <Row id="best" title={t.rd_shop_best_sellers} t={t} onAll={() => onShop({ sort: "best" })} testid="brand-best">{best.map((p) => card(p))}</Row>}
        {on("flash") && sale.length > 0 && <Row id="sale" title={t.rd_shop_on_sale} t={t} onAll={() => onShop({ sale: true })} testid="brand-sale">{sale.map((p) => card(p))}</Row>}

        {on("promo") && d.promo?.title && (
          <div className="v-sec">
            <div className="v-promo" data-testid="shop-promo" style={d.promo.pic ? { background: `linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.15)), url("${photoUrl(d.promo.pic)}") center/cover`, color: "#fff" } : undefined}>
              <div><h3>{d.promo.title}</h3>{d.promo.text && <p>{d.promo.text}</p>}</div>
              <button type="button" className="v-btn v-w" onClick={() => onShop(d.promo?.cat ? { cat: d.promo.cat } : {})}>{d.promo.button || t.rd_home_shop_now}</button>
            </div>
          </div>
        )}

        {on("categories") && cats.length > 0 && (
          <div className="v-sec">
            <div className="v-sech"><h3>{t.rd_home_by_cat}</h3></div>
            <div className="v-ptiles" data-testid="brand-cats">
              {cats.slice(0, 8).map((c) => (
                <button key={c.name} type="button" className="v-pt" data-testid="brand-cat" onClick={() => onShop({ cat: c.name })}>
                  {c.pic ? <img className="v-art" src={photoUrl(c.pic)} alt="" loading="lazy" /> : <span className="v-art v-ph0" style={{ display: "grid", fontSize: 30 }}>{c.name.slice(0, 1)}</span>}
                  {c.name}{c.from > 0 && <small data-testid="brand-cat-from">{tpl(t.rd_cart_from, { amount: money(cur, c.from) })}</small>}
                </button>
              ))}
            </div>
          </div>
        )}

        {on("live") && d.live && (
          <div className="v-sec">
            <div className="v-live" data-testid="shop-live">
              <div className="v-tx"><span className="v-pill">● LIVE</span><b>{tpl(t.rd_home_next_live, { when: d.live })}</b><span>{t.rd_home_live_sub}</span></div>
              {liveUrl && <a className="v-btn" href={liveUrl} target="_blank" rel="noreferrer noopener" data-testid="shop-live-go" style={{ textDecoration: "none" }}>{t.rd_home_live_go}</a>}
            </div>
          </div>
        )}

        {on("newest") && fresh.length > 0 && <Row id="new" title={t.rd_shop_new_arrivals} t={t} onAll={() => onShop({ sort: "new" })} testid="brand-new">{fresh.map((p) => card(p))}</Row>}
        {shop.products.length === 0 && <div className="v-empty" data-testid="shop-empty">{t.rd_shop_no_products}</div>}

        {on("about") && (d.about || shop.stats.orders > 0) && (
          <div className="v-sec">
            <div className="v-about" data-testid="shop-about">
              <h3 style={{ fontSize: 19 }}>{tpl(t.rd_home_about, { shop: d.name || "" })} {shop.verified && <span data-testid="shop-verified" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--s-ok)", fontFamily: "var(--s-font)", whiteSpace: "nowrap" }}>✓ {t.rd_shop_verified}</span>}</h3>
              {d.about && <p style={{ whiteSpace: "pre-wrap" }}>{d.about}</p>}
              <div className="v-stats" data-testid="shop-stats">
                <div><b>{compact(shop.stats.orders)}</b><span>{t.rd_shop_orders_done}</span></div>
                <div><b>{compact(shop.stats.products)}</b><span>{t.rd_shop_products}</span></div>
                {sold > 0 ? <div><b>{compact(sold)}</b><span>{t.rd_home_items_sold}</span></div>
                  : d.replyTime ? <div><b>{d.replyTime}</b><span>{t.rd_shop_chat_reply}</span></div>
                  : <div><b>{ck.options.length}</b><span>{t.rd_home_ways_ship}</span></div>}
              </div>
            </div>
          </div>
        )}

        {on("steps") && (
          <div className="v-sec" data-testid="shop-steps">
            <div className="v-sech"><h3>{t.rd_shop_f_how}</h3></div>
            <div className="v-steps">{steps.map((s, i) => <div className="v-step" key={i}><i>{i + 1}</i><span><b>{s.title}</b><span>{s.text}</span></span></div>)}</div>
          </div>
        )}

        {on("faq") && faq.length > 0 && (
          <div className="v-sec" data-testid="shop-faq">
            <div className="v-sech"><h3>{t.rd_home_good_to_know}</h3></div>
            {faq.map((f, i) => <details key={i} data-testid={f.policy ? "shop-policy" : "shop-faq-item"}><summary>{f.q}</summary><p style={{ whiteSpace: "pre-wrap" }}>{f.a}</p></details>)}
          </div>
        )}
        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}

/** A product row that scrolls sideways; on laptop two arrows scroll it by most of its width. */
function Row({ id, title, t, onAll, testid, children }: { id: string; title: string; t: T; onAll: () => void; testid: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const by = (dir: number) => { const el = ref.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" }); };
  return (
    <div className="v-sec" data-testid={testid}>
      <div className="v-sech">
        <h3>{title}</h3>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" className="v-va" data-testid={`${testid}-all`} onClick={onAll}>{t.rd_home_see_all}</button>
          <span className="v-arrows">
            <button type="button" data-testid={`${testid}-prev`} aria-label={t.rd_shop_back} onClick={() => by(-1)}>‹</button>
            <button type="button" data-testid={`${testid}-next`} aria-label={t.rd_brand_next} onClick={() => by(1)}>›</button>
          </span>
        </span>
      </div>
      <div className="v-hs" ref={ref} data-row={id}>{children}</div>
    </div>
  );
}
