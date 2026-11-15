// Seller Website — shared buyer-side pieces: the page frame (announcement bar, header with search +
// cart, bottom nav on phones), the closed page, icons, shop colors. Mobile first; a laptop gets a
// centered column (max 1120 px) and a wider grid.
import type { CSSProperties, ReactNode } from "react";
import { IC } from "./shopStyle";
import { SOCIAL_ORDER, socialUrl } from "./shopLinks";

const px = (n: number) => `${n}px`;
import { useT } from "../redesign/i18n";
import { BrandIcon, type BrandKey } from "./brandIcons";
import type { Shop } from "./shopApi";
import { photoUrl } from "./shopApi";

export function Icon({ d, size = 20, stroke = "currentColor" }: { d: string; size?: number; stroke?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
/** The top of every shop page. */
export function ShopTop({ shop, cartCount, onHome, onCart, onBack, search, onSearch, children }: {
  shop: Shop; cartCount: number; onHome: () => void; onCart: () => void; onBack?: () => void; search?: string; onSearch?: (q: string) => void; children?: ReactNode;
}) {
  const t = useT();
  const d = shop.shop;
  const showAnn = d.announcement && d.sections?.announcement !== false;
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 20 }}>
      {showAnn && <div data-testid="shop-announcement" style={{ background: "var(--sc)", color: "#fff", fontSize: 12.5, fontWeight: 700, textAlign: "center", padding: "7px 12px", lineHeight: 1.35 }}>{d.announcement}</div>}
      <div style={{ background: "#fff", borderBottom: "1px solid #ECECF1" }}>
        <div className="sfl-wrap" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px" }}>
          {onBack
            ? <button type="button" aria-label={t.rd_shop_back} onClick={onBack} style={{ width: 40, height: 40, border: "none", background: "transparent", cursor: "pointer", color: "#111827", flexShrink: 0 }}><Icon d={IC.back} /></button>
            : null}
          <button type="button" onClick={onHome} className="sfl-only-wide" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, flexShrink: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><ShopLogo shop={shop} size={30} /><span style={{ fontWeight: 800, fontSize: 15, color: "#111827" }}>{d.name}</span></span>
          </button>
          <label style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, background: "#F3F4F6", borderRadius: 11, padding: "0 12px", minHeight: 40, color: "#6B7280" }}>
            <Icon d={IC.search} size={17} />
            <input data-testid="shop-search" value={search ?? ""} onChange={(e) => onSearch?.(e.target.value)} onFocus={() => { if (!onSearch) onHome(); }} placeholder={`${t.rd_shop_search_in} ${d.name || ""}`.trim()} aria-label={t.rd_shop_search}
              style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", color: "#111827", padding: "9px 0" }} />
          </label>
          <button type="button" data-testid="shop-cart-btn" aria-label={t.rd_shop_cart} onClick={onCart} style={{ position: "relative", width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer", color: "#111827", flexShrink: 0 }}>
            <Icon d={IC.cart} size={23} />
            {cartCount > 0 && <span data-testid="shop-cart-count" style={{ position: "absolute", top: 3, right: 2, minWidth: 18, height: 18, borderRadius: 9, background: "var(--sc)", color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{cartCount}</span>}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ShopLogo({ shop, size = 56 }: { shop: Shop; size?: number }) {
  const d = shop.shop;
  const initials = (d.name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  if (d.logo) return <img src={photoUrl(d.logo)} alt="" style={{ width: px(size), height: px(size), borderRadius: "50%", objectFit: "cover", border: "3px solid #fff", flexShrink: 0, background: "#fff" }} />;
  return <span aria-hidden="true" style={{ width: px(size), height: px(size), borderRadius: "50%", background: "var(--sc)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.36, border: "3px solid #fff", flexShrink: 0 }}>{initials}</span>;
}

export function SocialIcons({ shop, size = 34 }: { shop: Shop; size?: number }) {
  const links = SOCIAL_ORDER.map((k) => [k, socialUrl(k, shop.shop.socials?.[k] || "")] as const).filter(([, u]) => !!u);
  if (!links.length || shop.shop.sections?.socials === false) return null;
  return (
    <div data-testid="shop-socials" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {links.map(([k, u]) => (
        <a key={k} href={u!} target="_blank" rel="noreferrer noopener" aria-label={k} style={{ width: px(size), height: px(size), borderRadius: "50%", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BrandIcon brand={k as BrandKey} size={size * 0.5} />
        </a>
      ))}
    </div>
  );
}

export function BottomNav({ active, cartCount, onShop, onCategories, onCart, chatHref }: { active: "shop" | "cart"; cartCount: number; onShop: () => void; onCategories: () => void; onCart: () => void; chatHref: string | null }) {
  const t = useT();
  const item = (on: boolean): CSSProperties => ({ flex: 1, minHeight: 54, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 11, fontWeight: 700, border: "none", background: "transparent", color: on ? "var(--sc)" : "#6B7280", cursor: "pointer", textDecoration: "none", position: "relative" });
  return (
    <nav className="sfl-only-phone" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, background: "#fff", borderTop: "1px solid #ECECF1", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <button type="button" style={item(active === "shop")} onClick={onShop}><Icon d={IC.home} />{t.rd_shop_nav_shop}</button>
      <button type="button" style={item(false)} onClick={onCategories}><Icon d={IC.grid} />{t.rd_shop_nav_categories}</button>
      <button type="button" style={item(active === "cart")} onClick={onCart}><Icon d={IC.cart} />{t.rd_shop_cart}{cartCount > 0 && <span style={{ position: "absolute", top: 5, left: "55%", minWidth: 17, height: 17, borderRadius: 9, background: "var(--sc)", color: "#fff", fontSize: 10.5, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{cartCount}</span>}</button>
      {chatHref ? <a style={item(false)} href={chatHref} target="_blank" rel="noreferrer noopener"><Icon d={IC.chat} />{t.rd_shop_nav_chat}</a> : <span style={{ ...item(false), opacity: 0.4 }}><Icon d={IC.chat} />{t.rd_shop_nav_chat}</span>}
    </nav>
  );
}

export function ClosedPage() {
  const t = useT();
  return (
    <div data-testid="shop-closed" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F5F5F7", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 40 }} aria-hidden="true">🛍️</div>
        <h1 style={{ fontSize: 20, margin: "10px 0 6px", color: "#111827" }}>{t.rd_shop_closed}</h1>
        <p style={{ fontSize: 14, color: "#6B7280", margin: 0, lineHeight: 1.5 }}>{t.rd_shop_closed_sub}</p>
      </div>
    </div>
  );
}

export function LangPicker({ lang, onPick }: { lang: string; onPick: (l: string) => void }) {
  const opts: [string, string][] = [["zh-TW", "繁體中文"], ["en", "English"], ["fil", "Filipino"], ["zh", "简体中文"], ["vi", "Tiếng Việt"], ["th", "ไทย"], ["id", "Bahasa Indonesia"]];
  return (
    <select data-testid="shop-lang" aria-label="Language" value={lang} onChange={(e) => onPick(e.target.value)} style={{ minHeight: 40, borderRadius: 10, border: "1px solid #E5E7EB", background: "#fff", padding: "0 10px", color: "#111827" }}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

