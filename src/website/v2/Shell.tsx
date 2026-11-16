// Seller Website v2 — the frame around every page (as the preview): announcement bar, header (back,
// logo, search, saved, cart; laptop: a category row + "Track my order"), footer (about + socials, Shop,
// Help, We accept / We ship with, language, "Powered by SellerFlowLive" unless Master), the phone bottom
// bar (Home · Shop · Cart · Orders · Chat), the chat button, sheets and toasts.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { photoUrl, money } from "../shopApi";
import { checkoutOf, freeOverOf, shipLabel, payLabel } from "../shipPay";
import { SOCIAL_ORDER, socialUrl, chatHref } from "../shopLinks";
import { BrandIcon, type BrandKey } from "../brandIcons";
import { VIcon } from "./icons";

export type NavKey = "home" | "shop" | "cart" | "orders" | "saved" | "other";
type T = Record<string, string>;

export function Logo({ shop, onHome, hideName }: { shop: Shop; onHome: () => void; hideName?: boolean }) {
  const d = shop.shop;
  const initial = (d.name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <button type="button" className="v-logo" data-testid="shop-logo" onClick={onHome} aria-label={d.name || ""}>
      {d.logo ? <img src={photoUrl(d.logo)} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} /> : <i aria-hidden="true">{initial}</i>}
      <span className={hideName ? "v-lname" : ""} data-testid="shop-name">{d.name}</span>
    </button>
  );
}

export interface HeaderProps {
  shop: Shop; active: NavKey; onBack?: () => void; onHome: () => void; cartCount: number; onCart: () => void;
  query: string; onQuery: (q: string) => void; onSearch: (q: string) => void;
  savedCount?: number; onSaved?: () => void; cats: string[]; onCat?: (c: string) => void; onTrack?: () => void;
  /** v3 Brand store home: the header sits on the colour band, see-through until the buyer scrolls. */
  overBand?: boolean;
}
export function Header(p: HeaderProps) {
  const t = useT() as unknown as T;
  const d = p.shop.shop;
  const fo = freeOverOf(checkoutOf(p.shop));
  const ann = d.announcement && d.sections?.announcement !== false ? d.announcement : fo ? tpl(t.rd_shop_free_over, { amount: money(currencyOf(p.shop), fo) }) : "";
  const hdr = useRef<HTMLDivElement | null>(null);
  const [atTop, setAtTop] = useState(true);
  const over = !!p.overBand;
  // the band slides up under the header by the header's own height (--hh on the shop root)
  useLayoutEffect(() => {
    const el = hdr.current, root = el?.closest(".sfl-v2") as HTMLElement | null;
    if (over && el && root) root.style.setProperty("--hh", `${el.offsetHeight}px`);
  });
  useEffect(() => {
    if (!over) return;
    const f = () => setAtTop((window.scrollY || 0) < 24);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, [over]);
  return (
    <>
      {ann && <div className="v-ann" data-testid="shop-announcement">{ann}</div>}
      <div className={`v-hdr${over && atTop ? " v-top" : ""}`} ref={hdr}>
        <div className="v-wrap">
          <div className="v-row">
            {p.onBack && <button type="button" className="v-ib" data-testid="shop-back" aria-label={t.rd_shop_back} onClick={p.onBack}><VIcon n="back" /></button>}
            <Logo shop={p.shop} onHome={p.onHome} hideName={p.active !== "home"} />
            <label className="v-srch">
              <VIcon n="search" size={16} />
              <input data-testid="shop-search" value={p.query} aria-label={t.rd_shop_search} placeholder={`${t.rd_shop_search_in} ${d.name || ""}`.trim()}
                onChange={(e) => p.onQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") p.onSearch(p.query); }} />
            </label>
            {p.onSaved && <button type="button" className="v-ib" data-testid="shop-saved-btn" aria-label={t.rd_shop_saved} onClick={p.onSaved}><VIcon n="heart" />{p.savedCount ? <b data-testid="shop-saved-count">{p.savedCount}</b> : null}</button>}
            <button type="button" className="v-ib" data-testid="shop-cart-btn" aria-label={t.rd_shop_cart} onClick={p.onCart}><VIcon n="cart" />{p.cartCount > 0 && <b data-testid="shop-cart-count">{p.cartCount}</b>}</button>
          </div>
          {p.onCat && (
            <div className="v-nav" data-testid="shop-nav">
              <button type="button" onClick={() => p.onCat!("")}>{t.rd_shop_all_products}</button>
              {p.cats.slice(0, 8).map((c) => <button key={c} type="button" onClick={() => p.onCat!(c)}>{c}</button>)}
              {p.onTrack && <button type="button" onClick={p.onTrack}>{t.rd_shop_track}</button>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
const currencyOf = (s: Shop) => s.shop.currency || "";

export function Footer({ shop, cur, lang, onLang, links }: { shop: Shop; cur: string; lang: string; onLang: (l: string) => void; links: { label: string; go: () => void }[][] }) {
  const t = useT() as unknown as T;
  const d = shop.shop;
  const ck = checkoutOf(shop);
  const socials = SOCIAL_ORDER.map((k) => [k, socialUrl(k, d.socials?.[k] || "")] as const).filter(([, u]) => !!u);
  void cur;
  return (
    <footer className="v-foot" data-testid="shop-footer">
      <div className="v-wrap">
        <div className="v-fcols">
          <div>
            <b>{d.name}</b>{d.tagline || ""}
            {socials.length > 0 && d.sections?.socials !== false && (
              <div className="v-soc" data-testid="shop-socials" style={{ marginTop: 10 }}>
                {socials.map(([k, u]) => <a key={k} href={u!} target="_blank" rel="noreferrer noopener" aria-label={k} style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--s-bg)", border: "1px solid var(--s-line)", display: "grid", placeItems: "center" }}><BrandIcon brand={k as BrandKey} size={17} /></a>)}
              </div>
            )}
          </div>
          {[t.rd_shop_f_shop, t.rd_shop_f_help].map((title, i) => (
            <div key={title}><b>{title}</b>{links[i].map((l) => <button key={l.label} type="button" onClick={l.go} style={{ display: "block", border: 0, background: "none", color: "inherit", padding: "3px 0", font: "inherit", textAlign: "left", cursor: "pointer" }}>{l.label}</button>)}</div>
          ))}
          <div>
            {ck.methods.length > 0 && <><b>{t.rd_shop_f_accept}</b><div className="v-pay" data-testid="shop-accept">{ck.methods.map((m) => <span key={m.id}>{payLabel(t, m)}</span>)}</div></>}
            {ck.options.length > 0 && <><b style={{ marginTop: 10 }}>{t.rd_shop_f_ship}</b><div className="v-pay" data-testid="shop-ship-with">{ck.options.map((o) => <span key={o.id}>{shipLabel(t, o)}</span>)}</div></>}
          </div>
        </div>
        <div className="v-pw">
          © {new Date().getFullYear()} {d.name} · <LangSelect lang={lang} onPick={onLang} />
          {shop.powered && <> · <span data-testid="shop-powered">{t.rd_shop_powered} <a href="https://www.sellerflowlive.com" target="_blank" rel="noreferrer noopener" style={{ fontWeight: 700 }}>SellerFlowLive</a></span></>}
        </div>
      </div>
    </footer>
  );
}
const LANGS: [string, string][] = [["en", "English"], ["zh-TW", "繁體中文"], ["zh", "简体中文"], ["fil", "Filipino"], ["vi", "Tiếng Việt"], ["th", "ไทย"], ["id", "Bahasa Indonesia"], ["bg", "Български"]];
export function LangSelect({ lang, onPick }: { lang: string; onPick: (l: string) => void }) {
  return (
    <select data-testid="shop-lang" aria-label="Language" value={lang} onChange={(e) => onPick(e.target.value)} style={{ border: 0, background: "transparent", color: "inherit", font: "inherit", fontSize: 11.5, padding: 0, cursor: "pointer" }}>
      {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function BottomNav({ active, cartCount, onHome, onShop, onCart, onOrders, onChat }: { active: NavKey; cartCount: number; onHome: () => void; onShop: () => void; onCart: () => void; onOrders?: () => void; onChat: () => void }) {
  const t = useT() as unknown as T;
  const b = (k: NavKey, icon: Parameters<typeof VIcon>[0]["n"], label: string, go: () => void, badge = 0) => (
    <button type="button" className={active === k ? "v-on" : ""} data-testid={`bnav-${k}`} aria-current={active === k ? "page" : undefined} onClick={go}><VIcon n={icon} size={21} />{badge > 0 && <b>{badge}</b>}{label}</button>
  );
  return (
    <nav className="v-bnav" data-testid="shop-bottom-nav" style={onOrders ? undefined : { gridTemplateColumns: "repeat(4,1fr)" }}>
      {b("home", "home", t.rd_shop_nav_home, onHome)}
      {b("shop", "grid", t.rd_shop_nav_shop, onShop)}
      {b("cart", "cart", t.rd_shop_cart, onCart, cartCount)}
      {onOrders && b("orders", "box", t.rd_shop_nav_orders, onOrders)}
      <button type="button" data-testid="bnav-chat" onClick={onChat}><VIcon n="chat" size={21} />{t.rd_shop_nav_chat}</button>
    </nav>
  );
}

/** The chat sheet: every chat app the seller filled in, opened as a real link (works on iPhone). */
export function ChatSheet({ shop, onClose, text }: { shop: Shop; onClose: () => void; text?: string }) {
  const t = useT() as unknown as T;
  const d = shop.shop;
  const apps = (["line", "messenger", "whatsapp", "instagram"] as const).filter((k) => d.chats?.[k]);
  const color: Record<string, string> = { line: "#06c755", messenger: "#0084ff", whatsapp: "#25d366", instagram: "#d6249f" };
  const name: Record<string, string> = { line: "LINE", messenger: "Messenger", whatsapp: "WhatsApp", instagram: "Instagram" };
  return (
    <Sheet onClose={onClose} title={tpl(t.rd_shop_chat_with, { shop: d.name || "" })}>
      {d.replyTime && <p style={{ color: "var(--s-mut)", fontSize: 13, margin: "0 0 12px" }}>{tpl(t.rd_shop_replies_in, { time: d.replyTime })}</p>}
      {apps.length ? apps.map((k) => (
        <a key={k} className="v-cb" data-testid={`chat-${k}`} href={chatHref(k, d.chats![k]!, text) || "#"} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "none" }}>
          <i style={{ background: color[k] }}><BrandIcon brand={k as BrandKey} size={16} color="#fff" /></i>{name[k]}
        </a>
      )) : <p style={{ color: "var(--s-mut)", fontSize: 13 }}>{t.rd_shop_no_chat}</p>}
    </Sheet>
  );
}
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT() as unknown as T;
  return (
    <div className="v-sheet" role="dialog" aria-modal="true" aria-label={title} data-testid="shop-sheet" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <button type="button" className="v-btn v-o v-full" data-testid="sheet-close" onClick={onClose} style={{ marginTop: 6 }}>{t.rd_shop_close}</button>
      </div>
    </div>
  );
}
export function Fab({ onClick }: { onClick: () => void }) {
  const t = useT() as unknown as T;
  return <button type="button" className="v-fab" data-testid="shop-fab" aria-label={t.rd_shop_nav_chat} onClick={onClick}><VIcon n="chat" size={25} /></button>;
}
