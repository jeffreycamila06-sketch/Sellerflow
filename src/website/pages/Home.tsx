// Seller Website — shop home: cover, logo, name, tagline, verified badge, stats, Chat with us,
// Follow us, live schedule, categories, search, sort, grid, about & return policy, footer.
import { useMemo, useState } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { photoUrl, money } from "../shopApi";
import { fromPrice, productStock } from "../cart";
import { sortProducts, filterShop, compact, NEW_DAYS, type Sort } from "../shopLogic";
import { ShopLogo, SocialIcons, Icon } from "../ui";
import { IC, mutedText } from "../shopStyle";
import { firstChatHref } from "../shopLinks";

export default function Home({ shop, cur, query, onOpen, catRef, nowMs }: { shop: Shop; cur: string; query: string; onOpen: (id: number) => void; catRef?: React.RefObject<HTMLDivElement | null>; nowMs: number }) {
  const t = useT();
  const d = shop.shop;
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const cats = useMemo(() => [...new Set(shop.products.map((p) => p.category).filter((c): c is string => !!c))], [shop.products]);
  const list = useMemo(() => sortProducts(filterShop(shop.products, query, cat), sort), [shop.products, query, cat, sort]);
  const chat = firstChatHref(shop);
  const cover = d.cover ? `url("${photoUrl(d.cover)}") center/cover` : "linear-gradient(135deg, var(--sc), #C026D3)";

  return (
    <div className="sfl-wrap" style={{ paddingBottom: 90 }}>
      <div style={{ height: 150, background: cover, borderRadius: "0 0 0 0" }} />
      <div style={{ padding: "0 12px" }}>
        <div className="sfl-card" data-testid="shop-card" style={{ marginTop: -60, padding: 16, position: "relative", boxShadow: "0 8px 24px rgba(17,24,39,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ShopLogo shop={shop} size={60} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <h1 data-testid="shop-name" style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#111827", overflowWrap: "anywhere" }}>{d.name}</h1>
                {shop.verified && <span data-testid="shop-verified" style={{ fontSize: 11, fontWeight: 800, color: "#059669", background: "#ECFDF5", padding: "2px 7px", borderRadius: 999 }}>✓ {t.rd_shop_verified}</span>}
              </div>
              {d.tagline && <div style={{ ...mutedText, fontSize: 13 }}>{d.tagline}</div>}
            </div>
          </div>
          <div data-testid="shop-stats" style={{ display: "grid", gridTemplateColumns: d.replyTime ? "repeat(3,1fr)" : "repeat(2,1fr)", gap: 8, marginTop: 14 }}>
            <Stat n={compact(shop.stats.orders)} label={t.rd_shop_orders_done} />
            <Stat n={compact(shop.stats.products)} label={t.rd_shop_products} />
            {d.replyTime && <Stat n={d.replyTime} label={t.rd_shop_chat_reply} />}
          </div>
          {chat && <a data-testid="shop-chat" href={chat} target="_blank" rel="noreferrer noopener" className="sfl-btn sfl-btn-main" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, padding: "0 16px", textDecoration: "none", lineHeight: "46px" }}><Icon d={IC.chat} size={18} />{t.rd_shop_chat_us}</a>}
          {(d.socials && Object.values(d.socials).some(Boolean)) && d.sections?.socials !== false && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid #F1F1F4" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#6B7280" }}>{t.rd_shop_follow}</span>
              <SocialIcons shop={shop} />
            </div>
          )}
        </div>

        {d.live && d.sections?.live !== false && (
          <div data-testid="shop-live" style={{ marginTop: 12, background: "#111827", color: "#fff", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 5, background: "#EF4444", flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{d.live}</span>
          </div>
        )}

        <div ref={catRef} style={{ marginTop: 16 }} />
        {cats.length > 0 && d.sections?.categories !== false && (
          <div className="sfl-hscroll" data-testid="shop-cats" style={{ padding: "2px 0 6px" }}>
            <button type="button" className="sfl-chip" aria-pressed={cat === ""} onClick={() => setCat("")}>{t.rd_shop_all}</button>
            {cats.map((c) => <button key={c} type="button" className="sfl-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "12px 0 10px", flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{cat || t.rd_shop_all_products}</h2>
          <div style={{ display: "flex", gap: 4, background: "#fff", border: "1px solid #ECECF1", borderRadius: 10, padding: 3 }}>
            {(["newest", "price_low", "price_high"] as Sort[]).map((s) => (
              <button key={s} type="button" data-testid={`shop-sort-${s}`} aria-pressed={sort === s} onClick={() => setSort(s)} style={{ minHeight: 32, padding: "4px 10px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: sort === s ? "#111827" : "transparent", color: sort === s ? "#fff" : "#6B7280" }}>
                {s === "newest" ? t.rd_shop_sort_new : s === "price_low" ? t.rd_shop_sort_low : t.rd_shop_sort_high}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0
          ? <div data-testid="shop-empty" style={{ ...mutedText, textAlign: "center", padding: "30px 0" }}>{query ? t.rd_shop_no_match : t.rd_shop_no_products}</div>
          : (
            <div className="sfl-grid" data-testid="shop-grid">
              {list.map((p) => {
                const stock = productStock(p);
                const isNew = p.createdAt && nowMs - Date.parse(p.createdAt) < NEW_DAYS * 86400000;
                return (
                  <button key={p.id} type="button" data-testid="shop-item" onClick={() => onOpen(p.id)} className="sfl-card" style={{ padding: 0, overflow: "hidden", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column" }}>
                    <span style={{ position: "relative", display: "block", width: "100%", paddingBottom: "100%", background: "#F3F4F6" }}>
                      {p.photos[0] ? <img src={photoUrl(p.photos[0])} alt={p.name} loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800, color: "#D1D5DB" }}>{p.name.slice(0, 1)}</span>}
                      {stock === 0 ? <Badge bg="#6B7280">{t.rd_shop_sold_out}</Badge> : isNew ? <Badge bg="#111827">{t.rd_shop_new}</Badge> : stock <= 3 ? <Badge bg="var(--sc)">{tpl(t.rd_shop_only_left, { n: String(stock) })}</Badge> : null}
                    </span>
                    <span style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "#111827", lineHeight: 1.3, minHeight: "2.6em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--sc)" }}>{p.variants?.length ? `${t.rd_shop_from} ` : ""}{money(cur, fromPrice(p))}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

        {d.about && d.sections?.about !== false && (
          <section className="sfl-card" data-testid="shop-about" style={{ marginTop: 18, padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "0 0 6px" }}>{t.rd_shop_about}</h2>
            <p style={{ ...mutedText, fontSize: 13.5, margin: 0, whiteSpace: "pre-wrap" }}>{d.about}</p>
          </section>
        )}
        {d.policy && d.sections?.policy !== false && (
          <section className="sfl-card" data-testid="shop-policy" style={{ marginTop: 12, padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "0 0 6px" }}>{t.rd_shop_policy}</h2>
            <p style={{ ...mutedText, fontSize: 13.5, margin: 0, whiteSpace: "pre-wrap" }}>{d.policy}</p>
          </section>
        )}
        <footer data-testid="shop-footer" style={{ textAlign: "center", padding: "22px 0 8px", ...mutedText }}>
          <div>© {d.name}</div>
          {shop.powered && <div data-testid="shop-powered" style={{ marginTop: 4 }}>{t.rd_shop_powered} <a href="https://www.sellerflowlive.com" target="_blank" rel="noreferrer noopener" style={{ color: "#6B7280", fontWeight: 700 }}>SellerFlowLive</a></div>}
        </footer>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div style={{ textAlign: "center", background: "#F9FAFB", borderRadius: 12, padding: "9px 4px" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>{n}</div>
      <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>{label}</div>
    </div>
  );
}
function Badge({ bg, children }: { bg: string; children: React.ReactNode }) {
  return <span style={{ position: "absolute", left: 8, top: 8, fontSize: 10.5, fontWeight: 800, color: "#fff", background: bg, padding: "3px 7px", borderRadius: 6 }}>{children}</span>;
}
