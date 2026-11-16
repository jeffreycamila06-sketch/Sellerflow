// Seller Website — shop home: cover, logo, name, tagline, verified badge, stats, Chat with us,
// Follow us, live schedule, categories, search, sort, grid, about & return policy, footer.
import { useMemo, useState } from "react";
import { useT } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { photoUrl } from "../shopApi";
import { sortProducts, filterShop, compact, type Sort } from "../shopLogic";
import { ShopLogo, Icon } from "../ui";
import { Card } from "../v2/Card";
import { IC, mutedText } from "../shopStyle";
import { firstChatHref } from "../shopLinks";

export default function Home({ shop, cur, query, onOpen, catRef, nowMs, saved, onSave, onQuick }: { shop: Shop; cur: string; query: string; onOpen: (id: number) => void; catRef?: React.RefObject<HTMLDivElement | null>; nowMs: number; saved: number[]; onSave: (id: number) => void; onQuick: (id: number) => void }) {
  const t = useT();
  const d = shop.shop;
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const cats = useMemo(() => [...new Set(shop.products.map((p) => p.category).filter((c): c is string => !!c))], [shop.products]);
  const list = useMemo(() => sortProducts(filterShop(shop.products, query, cat), sort), [shop.products, query, cat, sort]);
  const chat = firstChatHref(shop);
  const cover = d.cover ? `url("${photoUrl(d.cover)}") center/cover` : "linear-gradient(135deg, var(--sc), #C026D3)";

  return (
    <div className="sfl-wrap" style={{ paddingBottom: 8 }}>
      <div style={{ height: 150, background: cover, borderRadius: "0 0 0 0" }} />
      <div style={{ padding: "0 12px" }}>
        <div className="sfl-card" data-testid="shop-card" style={{ marginTop: -60, padding: 16, position: "relative", boxShadow: "0 8px 24px rgba(17,24,39,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ShopLogo shop={shop} size={60} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <h1 data-testid="shop-title" style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#111827", overflowWrap: "anywhere" }}>{d.name}</h1>
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
            <div className="v-grid" data-testid="shop-grid">
              {list.map((p) => <Card key={p.id} p={p} cur={cur} nowMs={nowMs} saved={saved.includes(p.id)} onSave={() => onSave(p.id)} onOpen={() => onOpen(p.id)} onQuick={() => onQuick(p.id)} />)}
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
