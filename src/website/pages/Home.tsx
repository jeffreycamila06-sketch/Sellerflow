// Seller Website v2 — item 1: the home page, in the preview's order. Every part can be turned off by the
// seller and hides by itself when it has nothing to show:
//   banner slides (1–5, swipe, never rotates by itself) · 4 trust badges · categories with pictures ·
//   next live · flash sale (countdown) · best sellers (ranked by real sold units) · promo banner ·
//   new arrivals · about + shop numbers · how to order · good to know (FAQ + return policy).
// The announcement bar and the footer are the frame's (v2/Shell). No ratings / reviews / vouchers (Build 2).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop, SectionKey, ShopProduct } from "../shopApi";
import { photoUrl } from "../shopApi";
import { Card } from "../v2/Card";
import { VIcon, type IconName } from "../v2/icons";
import { checkoutOf } from "../shipPay";
import { flashOn, soonestFlashEnd, countdown } from "../pricing";
import { compact } from "../shopLogic";
import { socialUrl } from "../shopLinks";
import type { ShopFilter } from "../shopFilter";
import { homeSlides, homeTrust, homeSteps, categoriesOf, bestSellers, newArrivals, type HomeSlide } from "./homeData";

type T = Record<string, string>;
export interface HomeProps {
  shop: Shop; cur: string; nowMs: number; saved: number[]; onSave: (id: number) => void; onOpen: (id: number) => void; onQuick: (id: number) => void;
  onShop: (f?: Partial<ShopFilter>) => void;
}
export default function Home({ shop, cur, nowMs, saved, onSave, onOpen, onQuick, onShop }: HomeProps) {
  const t = useT() as unknown as T;
  const d = shop.shop;
  const on = (k: SectionKey) => d.sections?.[k] !== false;
  const ck = checkoutOf(shop);
  const slides = useMemo(() => homeSlides(d), [d]);
  const cats = useMemo(() => categoriesOf(shop), [shop]);
  const flash = useMemo(() => shop.products.filter((p) => flashOn(p, nowMs)), [shop.products, nowMs]);
  const best = useMemo(() => bestSellers(shop.products), [shop.products]);
  const fresh = useMemo(() => newArrivals(shop.products), [shop.products]);
  const trust = homeTrust(t, shop, cur);
  const steps = homeSteps(t, shop);
  const sold = shop.products.reduce((a, p) => a + (p.sold || 0), 0);
  const faq: { q: string; a: string; policy?: boolean }[] = [...(d.faq || []), ...(d.policy && on("policy") ? [{ q: t.rd_shop_returns, a: d.policy, policy: true }] : [])];
  const liveUrl = socialUrl("tiktok", d.socials?.tiktok || "") || socialUrl("facebook", d.socials?.facebook || "");
  const card = (p: ShopProduct, rank?: number) => <Card key={p.id} p={p} cur={cur} nowMs={nowMs} saved={saved.includes(p.id)} onSave={() => onSave(p.id)} onOpen={() => onOpen(p.id)} onQuick={() => onQuick(p.id)} rank={rank} />;
  const icons: IconName[] = ["truck", "cash", "shield", "bolt"];

  return (
    <div className="v-wrap" data-testid="shop-home">
      {on("slides") && slides.length > 0 && <Hero slides={slides} t={t} onGo={(cat) => onShop(cat ? { cat } : {})} />}

      {on("trust") && trust.length > 0 && (
        <div className="v-trust" data-testid="shop-trust">
          {trust.map((x, i) => <div key={i}><VIcon n={icons[i]} size={20} /><span>{x.title}{x.sub && <small>{x.sub}</small>}</span></div>)}
        </div>
      )}

      {on("categories") && cats.length > 0 && (
        <div className="v-sec">
          <div className="v-sech"><h3>{t.rd_home_by_cat}</h3></div>
          <div className="v-cats" data-testid="shop-cats">
            {cats.map((c) => (
              <button key={c.name} type="button" className="v-cat" data-testid="shop-cat" onClick={() => onShop({ cat: c.name })}>
                {c.pic ? <img className="v-art" src={photoUrl(c.pic)} alt="" loading="lazy" /> : <span className="v-art v-ph0" style={{ display: "grid", fontSize: 24 }}>{c.name.slice(0, 1)}</span>}
                {c.name}
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

      {on("flash") && flash.length > 0 && (
        <div className="v-sec">
          <div className="v-flash" data-testid="shop-flash">
            <div className="v-sech"><h3>⚡ {t.rd_home_flash}</h3><Countdown end={soonestFlashEnd(flash, nowMs)} startMs={nowMs} label={t.rd_home_ends_in} /></div>
            <div className="v-hs">{flash.map((p) => card(p))}</div>
          </div>
        </div>
      )}

      {on("best") && best.length > 0 && (
        <div className="v-sec" data-testid="shop-best">
          <div className="v-sech"><h3>{t.rd_shop_best_sellers}</h3><button type="button" onClick={() => onShop({ sort: "best" })}>{t.rd_home_see_all} ›</button></div>
          <div className="v-hs">{best.map((p, i) => card(p, i + 1))}</div>
        </div>
      )}

      {on("promo") && d.promo?.title && (
        <div className="v-sec">
          <div className="v-promo" data-testid="shop-promo" style={d.promo.pic ? { background: `linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.15)), url("${photoUrl(d.promo.pic)}") center/cover`, color: "#fff" } : undefined}>
            <div><h3>{d.promo.title}</h3>{d.promo.text && <p>{d.promo.text}</p>}</div>
            <button type="button" className="v-btn v-w" onClick={() => onShop(d.promo?.cat ? { cat: d.promo.cat } : {})}>{d.promo.button || t.rd_home_shop_now}</button>
          </div>
        </div>
      )}

      {on("newest") && fresh.length > 0 && (
        <div className="v-sec">
          <div className="v-sech"><h3>{t.rd_shop_new_arrivals}</h3><button type="button" onClick={() => onShop({ sort: "new" })}>{t.rd_home_see_all} ›</button></div>
          <div className="v-grid" data-testid="shop-grid">{fresh.map((p) => card(p))}</div>
        </div>
      )}
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
  );
}

function Hero({ slides, t, onGo }: { slides: HomeSlide[]; t: T; onGo: (cat?: string) => void }) {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const onScroll = () => { const el = ref.current; if (el && el.clientWidth) setI(Math.round(el.scrollLeft / el.clientWidth)); };
  return (
    <>
      <div className="v-hero" ref={ref} onScroll={onScroll} data-testid="shop-slides">
        {slides.map((s, k) => {
          const bg: CSSProperties = s.pic ? { background: `linear-gradient(90deg, rgba(0,0,0,.6), rgba(0,0,0,.08)), url("${photoUrl(s.pic)}") center/cover` } : { background: "var(--s-hero)" };
          return (
            <div key={k} className="v-slide" style={bg} data-testid="shop-slide">
              <div>
                {s.title && <h2>{s.title}</h2>}
                {s.text && <p>{s.text}</p>}
                <button type="button" className="v-btn v-w" onClick={() => onGo(s.cat)}>{s.button || t.rd_home_shop_now}</button>
              </div>
            </div>
          );
        })}
      </div>
      {slides.length > 1 && <div className="v-dots" aria-hidden="true">{slides.map((_, k) => <i key={k} className={k === i ? "v-on" : ""} />)}</div>}
    </>
  );
}

function Countdown({ end, startMs, label }: { end: string | undefined; startMs: number; label: string }) {
  const [now, setNow] = useState(startMs);
  useEffect(() => { const id = setInterval(() => setNow((n) => n + 1000), 1000); return () => clearInterval(id); }, []);
  const parts = countdown(end, now).split(":");
  return <span className="v-cd" data-testid="shop-flash-cd">{label} {parts.map((p, k) => <span key={k}>{k ? ":" : ""}<i>{p}</i></span>)}</span>;
}
