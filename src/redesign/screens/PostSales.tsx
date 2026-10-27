// FACEBOOK POST SALES — the "Posts" side of the Orders screen (sql/137, adapters/fbPostSales.ts).
// Rendered by Orders ONLY when RedesignApp passes `posts` (switch on + admin/tester + a connected
// Facebook Page). Four views: the empty state, the per-buyer order cards, the "Sell on a post"
// flow (pick post → mode → items → ends → start) and "My posts" (status, counts, end early, edit
// price/stock). Everything is read-on-open (the parent loads); writes are one RPC per action.
// Print is MANUAL ("Print new") and goes through the parent's existing sticker path.
// ⚠️ Built from the written spec — the approved UI previews were not attached; polish pending.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { fmt, avColor, initials } from "../data";
import type { Product } from "../adapters/products";
import {
  type PostSale, type PostOrder, type PagePost, type NewPostItem, type PostSaleMode, type CreateResult, type BuyerGroup,
  groupPostOrders, itemName, saleStatus, saleCounts, POST_SALE_DEFAULT_DAYS,
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

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "13px 14px", boxShadow: "var(--shadow)" };
const mono = "var(--font-mono)";
const btnPrimary: CSSProperties = { padding: "11px 14px", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 44 };
const btnGhost: CSSProperties = { padding: "11px 14px", borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 44 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-ui)", minHeight: 44 };
const label: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--text-muted)", marginBottom: 5 };
const pill = (tone: "new" | "ok" | "muted" | "warn"): CSSProperties => ({
  fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 7, whiteSpace: "nowrap",
  color: tone === "new" ? "#0369a1" : tone === "ok" ? "var(--ok)" : tone === "warn" ? "#b45309" : "var(--text-muted)",
  background: tone === "new" ? "#e0f2fe" : tone === "ok" ? "rgba(22,163,74,.12)" : tone === "warn" ? "#fef3c7" : "var(--surface-2)",
  border: `1px solid ${tone === "new" ? "#7dd3fc" : tone === "ok" ? "var(--ok)" : tone === "warn" ? "#f59e0b" : "var(--border)"}`,
});
const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d); };
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// ── the Posts tab body ───────────────────────────────────────────────────────
export default function PostsBody({ ui, cur }: { ui: PostsUi; cur: string }) {
  const t = useT();
  const [view, setView] = useState<"orders" | "sell" | "my">("orders");
  const groups = useMemo(() => groupPostOrders(ui.orders, ui.sales), [ui.orders, ui.sales]);
  const newCount = ui.orders.filter((o) => !o.printedAt).length;

  if (view === "sell") return <SellOnPost ui={ui} cur={cur} onClose={() => setView("orders")} />;
  if (view === "my") return <MyPosts ui={ui} cur={cur} onClose={() => setView("orders")} onSell={() => setView("sell")} />;

  return (
    <div data-testid="posts-body" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {ui.note && <div role="status" data-testid="posts-note" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", borderRadius: 10, padding: "8px 11px" }}>{ui.note}</div>}
      {ui.state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>{t.rd_fps_loading}</div>}
      {ui.state === "error" && (
        <div role="alert" style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>{t.rd_fps_load_failed}</div>
          <button type="button" onClick={ui.onReload} style={{ ...btnGhost, marginTop: 10 }}>{t.rd_fps_retry}</button>
        </div>
      )}
      {ui.state === "ready" && groups.length === 0 && (
        <div data-testid="posts-empty" style={{ ...card, textAlign: "center", padding: "26px 16px" }}>
          <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5 }}>{t.rd_fps_empty}</div>
          <button type="button" data-testid="posts-sell-btn" onClick={() => setView("sell")} style={{ ...btnPrimary, marginTop: 14, width: "100%" }}>{t.rd_fps_sell_btn}</button>
          {ui.sales.length > 0 && <button type="button" data-testid="posts-my-btn" onClick={() => setView("my")} style={{ ...btnGhost, marginTop: 8, width: "100%" }}>{t.rd_fps_my_posts}</button>}
        </div>
      )}
      {ui.state === "ready" && groups.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" data-testid="posts-print-new" disabled={ui.busy || newCount === 0} onClick={ui.onPrintNew} style={{ ...btnPrimary, flex: 1, opacity: newCount === 0 || ui.busy ? 0.55 : 1 }}>🖨 {tpl(t.rd_fps_print_new, { n: newCount })}</button>
            <button type="button" data-testid="posts-my-btn" onClick={() => setView("my")} style={{ ...btnGhost, flex: 1 }}>{t.rd_fps_my_posts}</button>
          </div>
          {groups.map((g) => <BuyerCard key={g.key} g={g} sales={ui.sales} cur={cur} />)}
        </>
      )}
    </div>
  );
}

function BuyerCard({ g, sales, cur }: { g: BuyerGroup; sales: PostSale[]; cur: string }) {
  const t = useT();
  return (
    <div data-testid="posts-buyer-card" style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: avColor(g.buyerName || "?"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(g.buyerName || "?")}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.buyerName || t.rd_fps_anon}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl(t.rd_fps_from_post, { post: g.posts.join(" · ") })}</div>
        </div>
        <span data-testid="posts-pill" style={pill(g.printed ? "ok" : "new")}>{g.printed ? t.rd_fps_pill_printed : t.rd_fps_pill_new}</span>
      </div>
      <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
        {g.orders.map((o) => (
          <div key={o.id} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 0", fontSize: 13 }}>
            <span style={{ flex: 1, minWidth: 0, color: "var(--text-dim)", overflowWrap: "anywhere" }}>{itemName(o, sales) || o.commentText}{o.qty > 1 ? ` ×${o.qty}` : ""}</span>
            <span style={{ fontFamily: mono, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{fmtDate(o.createdAt)}</span>
            <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{cur}{fmt(o.price * o.qty)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>{t.rd_fps_total}</span>
          <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 600, color: "var(--text)" }}>{cur}{fmt(g.total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── "Sell on a post" flow ───────────────────────────────────────────────────
type Step = "post" | "mode" | "items" | "ends";
const blankItem = (): NewPostItem => ({ name: "", code: "", price: 0, stock: null, productId: null });

export function SellOnPost({ ui, cur, onClose }: { ui: PostsUi; cur: string; onClose: () => void }) {
  const t = useT();
  const [step, setStep] = useState<Step>("post");
  const [pageId, setPageId] = useState(ui.pages[0]?.pageId || "");
  // Loaded posts are keyed by the Page they came from: a different (or still-loading) Page = loading.
  const [loaded, setLoaded] = useState<{ pageId: string; state: "ready" | "error"; list: PagePost[] } | null>(null);
  const posts = loaded && loaded.pageId === pageId ? loaded : { state: pageId ? "loading" as const : "error" as const, list: [] as PagePost[] };
  const [post, setPost] = useState<PagePost | null>(null);
  const [mode, setMode] = useState<PostSaleMode>("code");
  const [items, setItems] = useState<NewPostItem[]>([blankItem()]);
  const [picker, setPicker] = useState<number | null>(null); // item row picking from Products
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + POST_SALE_DEFAULT_DAYS * 86400000).toISOString()));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    void ui.loadPosts(pageId).then((r) => { if (alive) setLoaded(r.ok ? { pageId, state: "ready", list: r.posts } : { pageId, state: "error", list: [] }); });
    return () => { alive = false; };
  }, [pageId, ui]);

  const pageName = ui.pages.find((p) => p.pageId === pageId)?.name || "";
  const rows = mode === "plus_one" ? items.slice(0, 1) : items;
  const setRow = (i: number, patch: Partial<NewPostItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const pickProduct = (i: number, p: Product) => { setRow(i, { name: p.name, code: p.liveCode || rows[i].code, price: p.price, stock: p.stock > 0 ? p.stock : null, productId: p.id }); setPicker(null); };
  const itemsValid = rows.length > 0 && rows.every((r) => r.name.trim() && (mode === "plus_one" || r.code.trim()) && r.price >= 0)
    && (mode === "plus_one" || new Set(rows.map((r) => r.code.trim().toLowerCase())).size === rows.length);

  const start = async () => {
    if (!post || !itemsValid) return;
    setSaving(true); setErr("");
    const r = await ui.onCreate({ pageId, postId: post.id, postMessage: post.message, postPicture: post.picture, mode, endsAt: new Date(endsAt).toISOString(), items: rows.map((x) => ({ ...x, code: mode === "plus_one" ? "+1" : x.code.trim(), name: x.name.trim() })) });
    setSaving(false);
    if (!("error" in r)) { onClose(); return; }
    setErr(r.error === "code_in_use" ? tpl(t.rd_fps_err_code_in_use, { code: r.code || "" }) : r.error === "too_many" ? t.rd_fps_err_too_many : r.error === "post_in_use" ? t.rd_fps_err_post_in_use : t.rd_fps_err_failed);
  };

  const head = (title: string, sub?: string) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 3 }}>{sub}</div>}
      </div>
      <button type="button" onClick={onClose} aria-label={t.rd_fps_cancel} data-testid="sell-close" style={{ width: 34, height: 34, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15 }}>✕</button>
    </div>
  );
  const nav = (back: Step | null, next: (() => void) | null, nextLabel = t.rd_fps_next, disabled = false) => (
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
      {back ? <button type="button" data-testid="sell-back" onClick={() => setStep(back)} style={{ ...btnGhost, flex: 1 }}>{t.rd_fps_back}</button> : <button type="button" onClick={onClose} style={{ ...btnGhost, flex: 1 }}>{t.rd_fps_cancel}</button>}
      {next && <button type="button" data-testid="sell-next" disabled={disabled} onClick={next} style={{ ...btnPrimary, flex: 2, opacity: disabled ? 0.55 : 1 }}>{nextLabel}</button>}
    </div>
  );
  const dots = ["post", "mode", "items", "ends"].map((s) => <span key={s} style={{ width: 7, height: 7, borderRadius: 999, background: s === step ? "var(--accent)" : "var(--border)" }} />);

  return (
    <div data-testid="sell-on-post" style={{ ...card, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>{dots}</div>
      {step === "post" && (
        <>
          {head(t.rd_fps_pick_post, tpl(t.rd_fps_pick_post_sub, { page: pageName }))}
          {ui.pages.length > 1 && (
            <select value={pageId} onChange={(e) => { setPageId(e.target.value); setPost(null); }} data-testid="sell-page" style={{ ...input, marginTop: 10 }}>
              {ui.pages.map((p) => <option key={p.pageId} value={p.pageId}>{p.name || p.pageId}</option>)}
            </select>
          )}
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: "52vh", overflowY: "auto" }}>
            {posts.state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 14 }}>{t.rd_fps_loading}</div>}
            {posts.state === "error" && <div role="alert" style={{ fontSize: 13, color: "var(--danger)", textAlign: "center", padding: 14 }}>{t.rd_fps_posts_failed}</div>}
            {posts.state === "ready" && posts.list.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 14 }}>{t.rd_fps_posts_none}</div>}
            {posts.list.map((p) => {
              const on = post?.id === p.id;
              return (
                <button key={p.id} type="button" data-testid="sell-post-row" aria-pressed={on} onClick={() => setPost(p)} style={{ display: "flex", gap: 10, alignItems: "center", textAlign: "left", padding: 9, borderRadius: 12, border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: on ? "var(--accent-soft)" : "var(--surface-2)", cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 44 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 9, background: "var(--chip-bg)", flexShrink: 0, overflow: "hidden" }}>{p.picture && <img src={p.picture} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.message || `#${p.id.split("_").pop()}`}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{fmtDate(p.createdTime)}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {nav(null, () => setStep("mode"), t.rd_fps_next, !post)}
        </>
      )}
      {step === "mode" && (
        <>
          {head(t.rd_fps_mode_title)}
          {([["code", t.rd_fps_mode_code, t.rd_fps_mode_code_sub], ["plus_one", t.rd_fps_mode_plus, t.rd_fps_mode_plus_sub]] as [PostSaleMode, string, string][]).map(([m, title, sub]) => (
            <button key={m} type="button" data-testid={`sell-mode-${m}`} aria-pressed={mode === m} onClick={() => setMode(m)} style={{ display: "flex", gap: 12, alignItems: "center", textAlign: "left", width: "100%", marginTop: 9, padding: "12px 13px", borderRadius: 13, border: mode === m ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: mode === m ? "var(--accent-soft)" : "var(--surface-2)", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: "var(--accent)", color: "var(--accent-text)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontFamily: mono, flexShrink: 0 }}>{m === "code" ? "A" : "+1"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{sub}</span>
              </span>
            </button>
          ))}
          {nav("post", () => setStep("items"))}
        </>
      )}
      {step === "items" && (
        <>
          {head(t.rd_fps_items_title)}
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r, i) => (
              <div key={i} data-testid="sell-item-row" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 10, background: "var(--surface-2)" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={label}>{t.rd_fps_col_name}</div>
                    <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} data-testid="sell-item-name" style={input} />
                  </div>
                  {mode === "code" && (
                    <div style={{ width: 84, flexShrink: 0 }}>
                      <div style={label}>{t.rd_fps_col_code}</div>
                      <input value={r.code} onChange={(e) => setRow(i, { code: e.target.value })} data-testid="sell-item-code" style={{ ...input, fontFamily: mono, textTransform: "uppercase" }} />
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={label}>{t.rd_fps_col_price} ({cur})</div>
                    <input type="number" inputMode="decimal" min={0} value={r.price || ""} onChange={(e) => setRow(i, { price: Math.max(0, Number(e.target.value) || 0) })} data-testid="sell-item-price" style={{ ...input, fontFamily: mono }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={label}>{t.rd_fps_col_stock}</div>
                    <input type="number" inputMode="numeric" min={0} placeholder={t.rd_fps_stock_unlimited} value={r.stock ?? ""} onChange={(e) => setRow(i, { stock: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) })} data-testid="sell-item-stock" style={{ ...input, fontFamily: mono }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  {ui.products.length > 0 && <button type="button" data-testid="sell-pick-product" onClick={() => setPicker(picker === i ? null : i)} style={{ ...btnGhost, padding: "7px 11px", minHeight: 36, fontSize: 12.5 }}>{t.rd_fps_pick_product}</button>}
                  {mode === "code" && rows.length > 1 && <button type="button" aria-label={t.rd_fps_remove} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} style={{ ...btnGhost, marginLeft: "auto", padding: "7px 11px", minHeight: 36, fontSize: 12.5, color: "var(--danger)" }}>✕</button>}
                </div>
                {picker === i && (
                  <div data-testid="sell-product-list" style={{ marginTop: 8, maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
                    {ui.products.map((p) => (
                      <button key={p.id} type="button" onClick={() => pickProduct(i, p)} style={{ display: "flex", width: "100%", gap: 8, alignItems: "center", textAlign: "left", padding: "9px 11px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text)" }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        {p.liveCode && <span style={{ fontFamily: mono, fontSize: 11.5, color: "var(--accent-fg)" }}>{p.liveCode}</span>}
                        <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700 }}>{cur}{fmt(p.price)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {mode === "code" && <button type="button" data-testid="sell-add-item" onClick={() => setItems((xs) => [...xs, blankItem()])} style={btnGhost}>＋ {t.rd_fps_add_item}</button>}
          </div>
          {!itemsValid && rows.some((r) => r.name || r.code) && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{t.rd_fps_err_items}</div>}
          {nav("mode", () => setStep("ends"), t.rd_fps_next, !itemsValid)}
        </>
      )}
      {step === "ends" && (
        <>
          {head(t.rd_fps_ends, t.rd_fps_ends_sub)}
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} data-testid="sell-ends" style={{ ...input, marginTop: 10 }} />
          <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post?.message || post?.id}</div>
            {rows.map((r, i) => <div key={i}>{mode === "code" ? <span style={{ fontFamily: mono, fontWeight: 700 }}>{r.code.toUpperCase()} </span> : <span style={{ fontFamily: mono, fontWeight: 700 }}>+1 </span>}{r.name} · {cur}{fmt(r.price)}{r.stock != null ? ` · ${r.stock}` : ""}</div>)}
          </div>
          {err && <div role="alert" data-testid="sell-error" style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 10, fontWeight: 600 }}>{err}</div>}
          {nav("items", () => { void start(); }, t.rd_fps_start, saving || !endsAt)}
        </>
      )}
    </div>
  );
}

// ── "My posts" ──────────────────────────────────────────────────────────────
export function MyPosts({ ui, cur, onClose, onSell }: { ui: PostsUi; cur: string; onClose: () => void; onSell: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ price: number; stock: number | null }>({ price: 0, stock: null });
  const [confirmEnd, setConfirmEnd] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const statusText = { selling: t.rd_fps_st_selling, sold_out: t.rd_fps_st_sold_out, ended: t.rd_fps_st_ended };
  const statusTone = { selling: "ok", sold_out: "warn", ended: "muted" } as const;

  const saveItem = async (id: number) => { setBusy(true); const ok = await ui.onUpdateItem(id, draft.price, draft.stock); setBusy(false); if (ok) setEditing(null); };
  const end = async (id: number) => { setBusy(true); await ui.onEnd(id); setBusy(false); setConfirmEnd(null); };

  return (
    <div data-testid="my-posts" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" data-testid="my-posts-back" onClick={onClose} style={{ ...btnGhost, padding: "8px 12px" }}>‹ {t.rd_fps_back}</button>
        <div style={{ flex: 1, fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{t.rd_fps_my_posts}</div>
        <button type="button" onClick={onSell} style={{ ...btnPrimary, padding: "8px 12px" }}>{t.rd_fps_sell_btn}</button>
      </div>
      {ui.sales.length === 0 && <div style={{ ...card, textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>{t.rd_fps_my_empty}</div>}
      {ui.sales.map((s) => {
        const st = saleStatus(s);
        const c = saleCounts(s, ui.orders, ui.waitlistCounts);
        return (
          <div key={s.id} data-testid="my-post-card" style={card}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 44, height: 44, borderRadius: 9, background: "var(--chip-bg)", flexShrink: 0, overflow: "hidden" }}>{s.postPicture && <img src={s.postPicture} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.postMessage || `#${s.postId.split("_").pop()}`}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{tpl(t.rd_fps_counts, { ...c })}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{tpl(t.rd_fps_ends_on, { date: fmtDate(s.endsAt) })}</div>
              </div>
              <span data-testid="my-post-status" style={pill(statusTone[st])}>{statusText[st]}</span>
            </div>
            <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              {s.items.map((it) => (
                <div key={it.id} data-testid="my-post-item" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: mono, fontWeight: 800, color: "var(--accent-fg)", minWidth: 28 }}>{s.mode === "plus_one" ? "+1" : it.code}</span>
                  <span style={{ flex: 1, minWidth: 80, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                  {editing === it.id ? (
                    <span style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
                      <input type="number" inputMode="decimal" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: Math.max(0, Number(e.target.value) || 0) }))} data-testid="my-post-edit-price" style={{ ...input, flex: 1, fontFamily: mono }} />
                      <input type="number" inputMode="numeric" placeholder={t.rd_fps_stock_unlimited} value={draft.stock ?? ""} onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} data-testid="my-post-edit-stock" style={{ ...input, flex: 1, fontFamily: mono }} />
                      <button type="button" disabled={busy} data-testid="my-post-save" onClick={() => void saveItem(it.id)} style={{ ...btnPrimary, padding: "8px 12px" }}>{t.rd_fps_save}</button>
                    </span>
                  ) : (
                    <>
                      <span style={{ fontFamily: mono, fontSize: 12.5, color: "var(--text-dim)" }}>{cur}{fmt(it.price)}</span>
                      <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{tpl(t.rd_fps_sold, { sold: it.sold })}{it.stock != null ? ` / ${it.stock}` : ""}</span>
                      {st !== "ended" && <button type="button" data-testid="my-post-edit" onClick={() => { setEditing(it.id); setDraft({ price: it.price, stock: it.stock }); }} style={{ ...btnGhost, padding: "5px 10px", minHeight: 32, fontSize: 12 }}>{t.rd_fps_edit}</button>}
                    </>
                  )}
                </div>
              ))}
            </div>
            {st !== "ended" && (
              confirmEnd === s.id ? (
                <div data-testid="my-post-end-confirm" style={{ marginTop: 9, fontSize: 12.5, color: "var(--text-dim)" }}>
                  {t.rd_fps_end_confirm}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" onClick={() => setConfirmEnd(null)} style={{ ...btnGhost, flex: 1, minHeight: 40 }}>{t.rd_fps_cancel}</button>
                    <button type="button" disabled={busy} data-testid="my-post-end-ok" onClick={() => void end(s.id)} style={{ ...btnPrimary, flex: 1, minHeight: 40, background: "#b45309" }}>{t.rd_fps_end_early}</button>
                  </div>
                </div>
              ) : (
                <button type="button" data-testid="my-post-end" onClick={() => setConfirmEnd(s.id)} style={{ ...btnGhost, marginTop: 9, width: "100%", minHeight: 40, color: "#b45309" }}>{t.rd_fps_end_early}</button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
