// FACEBOOK POST SALES — the "Posts" side of the Orders screen (sql/137, adapters/fbPostSales.ts).
// Rendered by Orders ONLY when RedesignApp passes `posts` (switch on + admin/tester + a connected
// Facebook Page). Built to the approved previews in docs/design/fb-post-sales/:
//   post-sales-orders-v2.png  → B (empty: megaphone tile + title + line + ONE button) and
//                               C (per-buyer cards: round initials, post titles, code-prefixed lines,
//                               Total, New/Printed pill; "Print new (N)" + "My posts").
//   post-sales-preview.png    → ① My posts (SELLING NOW / ENDED, thumbnail cards with count rows) and
//                               ② Sell on a post (one scrolling form: 1·PICK THE POST, 2·HOW BUYERS
//                               ORDER, 3·ITEMS table, Ends, Start selling).
// Everything is read-on-open (the parent loads); writes are one RPC per action. Print is MANUAL
// ("Print new") through the parent's existing sticker path. A tap on a My-posts card expands its
// items (Edit price/stock) and the "End now" action — the collapsed card is the preview's card.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useT, tpl } from "../i18n";
import { fmt, initials } from "../data";
import type { Product } from "../adapters/products";
import {
  type PostSale, type PostOrder, type PagePost, type NewPostItem, type PostSaleMode, type CreateResult, type BuyerGroup,
  groupPostOrders, itemCodeAndName, saleStatus, saleCounts, POST_SALE_DEFAULT_DAYS,
} from "../adapters/fbPostSales";

export interface PostsUi {
  state: "loading" | "ready" | "error";
  sales: PostSale[];
  orders: PostOrder[];
  waitlistCounts: Map<number, number>;
  pages: { pageId: string; name: string }[];
  products: Product[];
  busy: boolean;
  note: string | null;                               // last action result (toast-like line)
  onReload: () => void;
  onPrintNew: () => void;                            // prints every buyer's NEW orders, marks printed
  onCreate: (a: { pageId: string; postId: string; postMessage: string; postPicture: string; mode: PostSaleMode; endsAt: string; items: NewPostItem[] }) => Promise<CreateResult>;
  onEnd: (saleId: number) => Promise<boolean>;
  onUpdateItem: (itemId: number, price: number, stock: number | null) => Promise<boolean>;
  loadPosts: (pageId: string) => Promise<{ ok: true; posts: PagePost[] } | { ok: false; error: string }>;
}

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "14px 16px", boxShadow: "var(--shadow)" };
const mono = "var(--font-mono)";
const ui = "var(--font-ui)";
const btnPrimary: CSSProperties = { padding: "0 14px", minHeight: 48, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: ui };
const btnSoft: CSSProperties = { padding: "0 14px", minHeight: 48, borderRadius: 12, border: "none", background: "var(--accent-soft)", color: "var(--accent-fg)", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: ui };
const sectionLabel: CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: ".12em", color: "var(--text-muted)", margin: "16px 2px 8px" };
const pill = (tone: "new" | "printed" | "selling" | "soldout" | "ended"): CSSProperties => ({
  fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0,
  color: tone === "new" ? "#8a5a00" : tone === "selling" ? "#15803d" : tone === "soldout" ? "#be123c" : "var(--text-muted)",
  background: tone === "new" ? "#fdf1c7" : tone === "selling" ? "#dcfce7" : tone === "soldout" ? "#ffe4e6" : "var(--surface-2)",
});
const TZ = "Asia/Taipei";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const fmtTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const fmtMonthDay = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d);
const parse = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d; };
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const daysFrom = (local: string, nowMs: number) => Math.max(0, Math.round((new Date(local).getTime() - nowMs) / 86400000));

// ── the Posts tab body ───────────────────────────────────────────────────────
export default function PostsBody({ ui: u, cur }: { ui: PostsUi; cur: string }) {
  const t = useT();
  const [view, setView] = useState<"orders" | "sell" | "my">("orders");
  const groups = useMemo(() => groupPostOrders(u.orders, u.sales), [u.orders, u.sales]);
  const newCount = groups.filter((g) => !g.printed).length; // buyers with something new to print (one sticker each)

  if (view === "sell") return <SellOnPost ui={u} cur={cur} onClose={() => setView("orders")} />;
  if (view === "my") return <MyPosts ui={u} cur={cur} onClose={() => setView("orders")} onSell={() => setView("sell")} />;

  return (
    <div data-testid="posts-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {u.note && <div role="status" data-testid="posts-note" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", borderRadius: 10, padding: "8px 11px" }}>{u.note}</div>}
      {u.state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>{t.rd_fps_loading}</div>}
      {u.state === "error" && (
        <div role="alert" style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>{t.rd_fps_load_failed}</div>
          <button type="button" onClick={u.onReload} style={{ ...btnSoft, marginTop: 10 }}>{t.rd_fps_retry}</button>
        </div>
      )}
      {u.state === "ready" && groups.length === 0 && (
        <div data-testid="posts-empty" style={{ textAlign: "center", padding: "34px 4px 8px" }}>
          <div aria-hidden="true" style={{ width: 76, height: 76, borderRadius: 20, margin: "0 auto", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>📣</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18.5, fontWeight: 700, color: "var(--text)", marginTop: 20 }}>{t.rd_fps_empty_title}</div>
          <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5, margin: "8px 10px 0" }}>{t.rd_fps_empty}</div>
          <button type="button" data-testid="posts-sell-btn" onClick={() => setView("sell")} style={{ ...btnPrimary, marginTop: 22, width: "100%" }}>{t.rd_fps_sell_btn}</button>
          {u.sales.length > 0 && <button type="button" data-testid="posts-my-link" onClick={() => setView("my")} style={{ marginTop: 14, border: "none", background: "transparent", color: "var(--accent-fg)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: ui }}>{t.rd_fps_my_posts} ›</button>}
        </div>
      )}
      {u.state === "ready" && groups.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" data-testid="posts-print-new" disabled={u.busy || newCount === 0} onClick={u.onPrintNew} style={{ ...btnPrimary, flex: 1, minWidth: 0, opacity: newCount === 0 || u.busy ? 0.55 : 1 }}>🖨 {tpl(t.rd_fps_print_new, { n: newCount })}</button>
            <button type="button" data-testid="posts-my-btn" onClick={() => setView("my")} style={{ ...btnSoft, flexShrink: 0 }}>{t.rd_fps_my_posts}</button>
          </div>
          {groups.map((g) => <BuyerCard key={g.key} g={g} sales={u.sales} cur={cur} />)}
        </>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, flexShrink: 0, fontFamily: ui }}>{initials(name || "?")}</div>;
}

function BuyerCard({ g, sales, cur }: { g: BuyerGroup; sales: PostSale[]; cur: string }) {
  const t = useT();
  return (
    <div data-testid="posts-buyer-card" style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar name={g.buyerName} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.buyerName || t.rd_fps_anon}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.posts.join(" · ")}</div>
        </div>
        <span data-testid="posts-pill" style={pill(g.printed ? "printed" : "new")}>{g.printed ? t.rd_fps_pill_printed : t.rd_fps_pill_new}</span>
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        {g.orders.map((o) => {
          const { code, name } = itemCodeAndName(o, sales);
          return (
            <div key={o.id} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0", fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{code ? `${code} ` : ""}{name || o.commentText}{o.qty > 1 ? ` ×${o.qty}` : ""}</span>
              <span style={{ fontFamily: mono, fontWeight: 600, color: "var(--text-dim)", flexShrink: 0 }}>{fmt(o.price * o.qty)}</span>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0 0", fontSize: 14.5 }}>
          <span style={{ fontWeight: 800, color: "var(--text)" }}>{t.rd_fps_total}</span>
          <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(g.total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── "Sell on a post" — one scrolling form (preview ②) ──────────────────────
const blankItem = (): NewPostItem => ({ name: "", code: "", price: 0, stock: null, productId: null });
const cell: CSSProperties = { boxSizing: "border-box", width: "100%", padding: "9px 8px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontFamily: mono, fontWeight: 700, minHeight: 42, outline: "none" };
const TABLE_COLS = "minmax(0,1fr) 62px 74px 56px";

function SubHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 4px" }}>
      <button type="button" onClick={onBack} data-testid="posts-back" aria-label={title} style={{ width: 40, height: 40, borderRadius: 999, border: "none", background: "var(--surface)", color: "var(--text)", fontSize: 20, lineHeight: 1, cursor: "pointer", flexShrink: 0, boxShadow: "var(--shadow)" }}>‹</button>
      <div style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      {right}
    </div>
  );
}

export function SellOnPost({ ui: u, cur, onClose }: { ui: PostsUi; cur: string; onClose: () => void }) {
  const t = useT();
  const [pageId, setPageId] = useState(u.pages[0]?.pageId || "");
  // Loaded posts are keyed by the Page they came from: a different (or still-loading) Page = loading.
  const [loaded, setLoaded] = useState<{ pageId: string; state: "ready" | "error"; list: PagePost[] } | null>(null);
  const posts = loaded && loaded.pageId === pageId ? loaded : { state: pageId ? "loading" as const : "error" as const, list: [] as PagePost[] };
  const [post, setPost] = useState<PagePost | null>(null);
  const [mode, setMode] = useState<PostSaleMode>("code");
  const [items, setItems] = useState<NewPostItem[]>([blankItem()]);
  const [picker, setPicker] = useState(false);
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + POST_SALE_DEFAULT_DAYS * 86400000).toISOString()));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [nowMs] = useState(() => Date.now()); // one clock read at open (pure render)

  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    void u.loadPosts(pageId).then((r) => { if (alive) setLoaded(r.ok ? { pageId, state: "ready", list: r.posts } : { pageId, state: "error", list: [] }); });
    return () => { alive = false; };
  }, [pageId, u]);

  const rows = mode === "plus_one" ? items.slice(0, 1) : items;
  const setRow = (i: number, patch: Partial<NewPostItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addRow = (p?: Product) => {
    setItems((xs) => {
      const row: NewPostItem = p ? { name: p.name, code: p.liveCode || "", price: p.price, stock: p.stock > 0 ? p.stock : null, productId: p.id } : blankItem();
      const blank = xs.findIndex((x) => !x.name && !x.code && !x.price); // fill an empty row before adding
      return blank >= 0 ? xs.map((x, j) => (j === blank ? row : x)) : [...xs, row];
    });
    setPicker(false);
  };
  // Rows the seller left completely blank are ignored; a half-filled row blocks Start.
  const filled = rows.filter((r) => r.name.trim() || r.code.trim() || r.price > 0 || r.stock != null);
  const complete = (r: NewPostItem) => !!r.name.trim() && (mode === "plus_one" || !!r.code.trim()) && r.price > 0;
  const itemsValid = filled.length > 0 && filled.every(complete)
    && (mode === "plus_one" || new Set(filled.map((r) => r.code.trim().toLowerCase())).size === filled.length);
  const canStart = !!post && itemsValid && !!endsAt && !saving;

  const start = async () => {
    if (!canStart || !post) return;
    setSaving(true); setErr("");
    const r = await u.onCreate({ pageId, postId: post.id, postMessage: post.message, postPicture: post.picture, mode, endsAt: new Date(endsAt).toISOString(), items: filled.map((x) => ({ ...x, code: mode === "plus_one" ? "+1" : x.code.trim(), name: x.name.trim() })) });
    setSaving(false);
    if (!("error" in r)) { onClose(); return; }
    setErr(r.error === "code_in_use" ? tpl(t.rd_fps_err_code_in_use, { code: r.code || "" }) : r.error === "too_many" ? t.rd_fps_err_too_many : r.error === "post_in_use" ? t.rd_fps_err_post_in_use : r.error === "not_allowed" ? t.rd_fps_err_not_allowed : t.rd_fps_err_failed);
  };
  const postedLine = (iso: string) => {
    const d = parse(iso); if (!d) return "";
    const today = dayKey(new Date(nowMs)), yday = dayKey(new Date(nowMs - 86400000)), k = dayKey(d);
    return k === today ? tpl(t.rd_fps_posted_today, { time: fmtTime(d) }) : k === yday ? tpl(t.rd_fps_posted_yday, { time: fmtTime(d) }) : `${fmtMonthDay(d)}, ${fmtTime(d)}`;
  };
  const endsD = parse(endsAt);

  return (
    <div data-testid="sell-on-post">
      <SubHeader title={t.rd_fps_sell_title} onBack={onClose} />
      {u.pages.length > 1 && (
        <select value={pageId} onChange={(e) => { setPageId(e.target.value); setPost(null); }} data-testid="sell-page" style={{ ...cell, fontFamily: ui, fontWeight: 700, marginTop: 8 }}>
          {u.pages.map((p) => <option key={p.pageId} value={p.pageId}>{p.name || p.pageId}</option>)}
        </select>
      )}
      <div style={sectionLabel}>{t.rd_fps_step_post}</div>
      <div style={{ ...card, padding: "6px 12px" }}>
        {posts.state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 14 }}>{t.rd_fps_loading}</div>}
        {posts.state === "error" && <div role="alert" style={{ fontSize: 13, color: "var(--danger)", textAlign: "center", padding: 14 }}>{t.rd_fps_posts_failed}</div>}
        {posts.state === "ready" && posts.list.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 14 }}>{t.rd_fps_posts_none}</div>}
        {posts.list.map((p) => {
          const on = post?.id === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} data-testid="sell-post-row" onClick={() => setPost(p)} style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", padding: "9px 0", border: "none", background: "transparent", cursor: "pointer", fontFamily: ui, minHeight: 56 }}>
              <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 999, flexShrink: 0, border: on ? "7px solid var(--accent)" : "2px solid var(--border-strong)", background: "var(--surface)", boxSizing: "border-box" }} />
              <span style={{ width: 56, height: 56, borderRadius: 12, flexShrink: 0, overflow: "hidden", background: "linear-gradient(135deg, #dbe4ff, #ffd6e8)" }}>{p.picture && <img src={p.picture} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: on ? "var(--text)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.message || `#${p.id.split("_").pop()}`}</span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{postedLine(p.createdTime)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={sectionLabel}>{t.rd_fps_step_mode}</div>
      <div role="radiogroup" data-testid="sell-mode" style={{ display: "flex", gap: 4, background: "var(--accent-soft)", borderRadius: 12, padding: 4 }}>
        {([["code", t.rd_fps_mode_code], ["plus_one", t.rd_fps_mode_plus]] as [PostSaleMode, string][]).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} data-testid={`sell-mode-${m}`} onClick={() => setMode(m)} style={{ flex: 1, minHeight: 44, borderRadius: 9, border: "none", background: mode === m ? "var(--surface)" : "transparent", color: mode === m ? "var(--accent-fg)" : "var(--text-dim)", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: ui, boxShadow: mode === m ? "var(--shadow)" : "none" }}>{label}</button>
        ))}
      </div>

      <div style={sectionLabel}>{t.rd_fps_step_items}</div>
      <div style={{ ...card, padding: "12px 12px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: TABLE_COLS, gap: 6, fontSize: 11.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", padding: "0 2px 8px" }}>
          <span>{t.rd_fps_col_item}</span><span>{t.rd_fps_col_code}</span><span>{t.rd_fps_col_price}</span><span>{t.rd_fps_col_stock}</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} data-testid="sell-item-row" style={{ display: "grid", gridTemplateColumns: TABLE_COLS, gap: 6, alignItems: "center", padding: "4px 0" }}>
            <input value={r.name} placeholder={t.rd_fps_col_name} onChange={(e) => setRow(i, { name: e.target.value })} data-testid="sell-item-name" style={{ ...cell, fontFamily: ui, fontWeight: 600, border: "none", background: "transparent", padding: "9px 2px" }} />
            {mode === "code"
              ? <input value={r.code} onChange={(e) => setRow(i, { code: e.target.value.toUpperCase() })} data-testid="sell-item-code" style={{ ...cell, textTransform: "uppercase" }} />
              : <span style={{ ...cell, display: "flex", alignItems: "center", color: "var(--accent-fg)" }}>+1</span>}
            <input type="number" inputMode="decimal" min={0} value={r.price || ""} onChange={(e) => setRow(i, { price: Math.max(0, Number(e.target.value) || 0) })} data-testid="sell-item-price" style={cell} />
            <input type="number" inputMode="numeric" min={0} placeholder="∞" value={r.stock ?? ""} onChange={(e) => setRow(i, { stock: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) })} data-testid="sell-item-stock" style={cell} />
          </div>
        ))}
        {mode === "code" && (
          <button type="button" data-testid="sell-add-item" onClick={() => (u.products.length ? setPicker((v) => !v) : addRow())} style={{ ...btnSoft, width: "100%", minHeight: 46, marginTop: 10, fontSize: 14.5 }}>{t.rd_fps_add_pick}</button>
        )}
        {picker && (
          <div data-testid="sell-product-list" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            <button type="button" data-testid="sell-add-blank" onClick={() => addRow()} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontFamily: ui, fontSize: 13.5, fontWeight: 700, color: "var(--accent-fg)" }}>{t.rd_fps_add_blank}</button>
            {u.products.map((p) => (
              <button key={p.id} type="button" data-testid="sell-pick-product" onClick={() => addRow(p)} style={{ display: "flex", width: "100%", gap: 8, alignItems: "center", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontFamily: ui, fontSize: 13.5, color: "var(--text)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                {p.liveCode && <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--accent-fg)" }}>{p.liveCode}</span>}
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{cur}{fmt(p.price)}</span>
              </button>
            ))}
          </div>
        )}
        {!itemsValid && filled.length > 0 && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 8 }}>{t.rd_fps_err_items}</div>}
      </div>

      <div style={{ ...card, marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <label htmlFor="sell-ends" style={{ flex: 1, fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{t.rd_fps_ends}</label>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <span aria-hidden="true" style={{ ...cell, display: "inline-flex", alignItems: "center", width: "auto", fontFamily: ui, fontWeight: 700, padding: "0 12px", pointerEvents: "none" }}>{endsD ? `${fmtMonthDay(endsD)}, ${fmtTime(endsD)} (${tpl(t.rd_fps_days_n, { n: daysFrom(endsAt, nowMs) })})` : "—"}</span>
          <input id="sell-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} data-testid="sell-ends" aria-label={t.rd_fps_ends} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
        </div>
      </div>
      {err && <div role="alert" data-testid="sell-error" style={{ fontSize: 13, color: "var(--danger)", marginTop: 10, fontWeight: 600 }}>{err}</div>}
      <button type="button" data-testid="sell-start" disabled={!canStart} onClick={() => { void start(); }} style={{ ...btnPrimary, width: "100%", minHeight: 52, marginTop: 14, fontSize: 16, opacity: canStart ? 1 : 0.5 }}>{t.rd_fps_start}</button>
    </div>
  );
}

// ── "My posts" (preview ①) ─────────────────────────────────────────────────
export function MyPosts({ ui: u, cur, onClose, onSell }: { ui: PostsUi; cur: string; onClose: () => void; onSell: () => void }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ price: number; stock: number | null }>({ price: 0, stock: null });
  const [confirmEnd, setConfirmEnd] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const statusText = { selling: t.rd_fps_st_selling, sold_out: t.rd_fps_st_sold_out, ended: t.rd_fps_st_ended } as const;
  const tone = { selling: "selling", sold_out: "soldout", ended: "ended" } as const;
  const withStatus = u.sales.map((s) => ({ s, st: saleStatus(s) }));
  const selling = withStatus.filter((x) => x.st !== "ended");
  const ended = withStatus.filter((x) => x.st === "ended");

  const saveItem = async (id: number) => { setBusy(true); const ok = await u.onUpdateItem(id, draft.price, draft.stock); setBusy(false); if (ok) setEditing(null); };
  const end = async (id: number) => { setBusy(true); await u.onEnd(id); setBusy(false); setConfirmEnd(null); };
  const count = (n: number, label: string) => <span key={label} style={{ fontSize: 14, color: "var(--text-dim)" }}><b style={{ color: "var(--text)", fontWeight: 800 }}>{n}</b> {label}</span>;

  const saleCard = ({ s, st }: { s: PostSale; st: "selling" | "sold_out" | "ended" }) => {
    const c = saleCounts(s, u.orders, u.waitlistCounts);
    const endD = parse(s.endsAt);
    const sub = `${tpl(st === "ended" ? t.rd_fps_ended_short : t.rd_fps_ends_short, { date: endD ? fmtMonthDay(endD) : "" })} · ${s.items.length === 1 ? t.rd_fps_item_1 : tpl(t.rd_fps_items_n, { n: s.items.length })}${s.items.length === 1 ? ` · ${cur}${fmt(s.items[0].price)}` : ""}`;
    const expanded = open === s.id;
    return (
      <div key={s.id} data-testid="my-post-card" style={{ ...card, padding: 0, overflow: "hidden" }}>
        <button type="button" data-testid="my-post-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "14px 16px", border: "none", background: "transparent", cursor: "pointer", fontFamily: ui }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, flexShrink: 0, overflow: "hidden", background: st === "ended" ? "linear-gradient(135deg, #ffe7c7, #ffd4d4)" : "linear-gradient(135deg, #dbe4ff, #ffd6e8)" }}>{s.postPicture && <img src={s.postPicture} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.postMessage || `#${s.postId.split("_").pop()}`}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>{sub}</div>
            </div>
            <span data-testid="my-post-status" style={pill(tone[st])}>{st === "selling" ? "● " : ""}{statusText[st]}</span>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            {count(c.orders, t.rd_fps_c_orders)}{count(c.buyers, t.rd_fps_c_buyers)}{st !== "ended" && count(c.waitlist, t.rd_fps_c_waitlist)}
          </div>
        </button>
        {expanded && (
          <div data-testid="my-post-detail" style={{ padding: "0 16px 14px" }}>
            {s.items.map((it) => (
              <div key={it.id} data-testid="my-post-item" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 14, flexWrap: "wrap" }}>
                <span style={{ fontFamily: mono, fontWeight: 800, color: "var(--accent-fg)", minWidth: 30 }}>{s.mode === "plus_one" ? "+1" : it.code}</span>
                <span style={{ flex: 1, minWidth: 80, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                {editing === it.id ? (
                  <span style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
                    <input type="number" inputMode="decimal" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: Math.max(0, Number(e.target.value) || 0) }))} data-testid="my-post-edit-price" style={{ ...cell, flex: 1 }} />
                    <input type="number" inputMode="numeric" placeholder="∞" value={draft.stock ?? ""} onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} data-testid="my-post-edit-stock" style={{ ...cell, flex: 1 }} />
                    <button type="button" disabled={busy} data-testid="my-post-save" onClick={() => void saveItem(it.id)} style={{ ...btnPrimary, minHeight: 42, padding: "0 12px", fontSize: 13.5 }}>{t.rd_fps_save}</button>
                  </span>
                ) : (
                  <>
                    <span style={{ fontFamily: mono, fontSize: 13, color: "var(--text-dim)" }}>{cur}{fmt(it.price)}</span>
                    <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{tpl(t.rd_fps_sold, { sold: it.sold })}{it.stock != null ? ` / ${it.stock}` : ""}</span>
                    {st !== "ended" && <button type="button" data-testid="my-post-edit" onClick={() => { setEditing(it.id); setDraft({ price: it.price, stock: it.stock }); }} style={{ ...btnSoft, minHeight: 34, padding: "0 12px", fontSize: 13 }}>{t.rd_fps_edit}</button>}
                  </>
                )}
              </div>
            ))}
            {st !== "ended" && (
              confirmEnd === s.id ? (
                <div data-testid="my-post-end-confirm" style={{ marginTop: 8, fontSize: 13, color: "var(--text-dim)" }}>
                  {t.rd_fps_end_confirm}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" onClick={() => setConfirmEnd(null)} style={{ ...btnSoft, flex: 1, minHeight: 42, fontSize: 14 }}>{t.rd_fps_cancel}</button>
                    <button type="button" disabled={busy} data-testid="my-post-end-ok" onClick={() => void end(s.id)} style={{ ...btnPrimary, flex: 1, minHeight: 42, fontSize: 14, background: "#be123c" }}>{t.rd_fps_end_early}</button>
                  </div>
                </div>
              ) : (
                <button type="button" data-testid="my-post-end" onClick={() => setConfirmEnd(s.id)} style={{ ...btnSoft, width: "100%", minHeight: 42, marginTop: 8, fontSize: 14, color: "#be123c", background: "#ffe4e6" }}>{t.rd_fps_end_early}</button>
              )
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="my-posts">
      <SubHeader title={t.rd_fps_my_posts} onBack={onClose} />
      <button type="button" data-testid="my-posts-sell" onClick={onSell} style={{ ...btnPrimary, width: "100%", minHeight: 52, marginTop: 10, fontSize: 16 }}>{t.rd_fps_sell_fb_btn}</button>
      {u.sales.length === 0 && <div style={{ ...card, marginTop: 14, textAlign: "center", fontSize: 13.5, color: "var(--text-muted)" }}>{t.rd_fps_my_empty}</div>}
      {selling.length > 0 && <div style={sectionLabel}>{t.rd_fps_selling_now}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{selling.map(saleCard)}</div>
      {ended.length > 0 && <div style={sectionLabel}>{t.rd_fps_ended_sec}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{ended.map(saleCard)}</div>
    </div>
  );
}
