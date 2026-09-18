// Screen 3 — Products. REAL CRUD with CROSS-DEVICE sync: the local "sf_prods"
// cache (instant render + offline) is reconciled on load with the per-user
// public.products table via the productsDb adapter (DB wins; first signed-in load
// migrates pre-existing local products once). Add/edit/delete write through to the
// DB; search/CSV/status (derived from stock) unchanged. Read-on-load + write-on-
// action only — NO polling.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { avColor, initials, fmt } from "../data";
import { loadProducts, saveProducts, upsertProduct, deleteProduct, filterProducts, filterByStock, statusForStock, type Product, type ProductForm, type StockFilter } from "../adapters/products";
import { resolveInitialProducts, saveProductDbResult, deleteProductDb, adjustProductStock } from "../adapters/productsDb";
import { dayStamp } from "../adapters/csv";
import { exportBrandedXlsx, exportBrandedPdf, type ExportColumn } from "../adapters/brandedExport";
import { useT } from "../i18n";

const nowMs = () => Date.now(); // module-level (keeps the impure call out of the component's render-purity analysis)
const STOCK_ADJUST_DEBOUNCE_MS = 600; // coalesce rapid ±taps into ONE atomic write
const STATUS_HEX: Record<string, string> = { Active: "16A34A", "Low stock": "EA580C", "Out of stock": "DC2626" };

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const title: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
const mono = "var(--font-mono)";
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const lbl: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const EMPTY: ProductForm = { name: "", sku: "", price: "", stock: "", platform: "TikTok", liveCode: "" };
const stockColor = (s: number) => (s === 0 ? "var(--danger)" : s <= 5 ? "var(--warn)" : "var(--ok)");
const stepBtn = (disabled: boolean): CSSProperties => ({ width: 26, height: 26, flexShrink: 0, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: disabled ? "var(--text-muted)" : "var(--text)", fontSize: 15, fontWeight: 800, lineHeight: 1, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "var(--font-ui)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 });

export default function Products({ cur, onProductsChanged, seller }: {
  cur: string;
  // Auto Mode source (Sep 17): fire after an add/edit/delete so RedesignApp
  // re-derives the live code list. action tells it whether to touch the live
  // stock mirror (audit F1): "stock"/new → re-seed; "meta" (name/price/code) →
  // preserve the decremented count; "delete" → drop the entry. NOT called on the
  // mount reconcile (RedesignApp loads the catalog itself on auth).
  onProductsChanged?: (products: Product[], changedId?: number, action?: "stock" | "meta" | "delete") => void;
  seller?: { name?: string; email?: string }; // branded export header (optional)
}) {
  const t = useT();
  const [prods, setProds] = useState<Product[]>(() => loadProducts());
  const [q, setQ] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [eid, setEid] = useState<number | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY);
  const [formErr, setFormErr] = useState(""); // live-code validation error (inline, blocks save)
  // Batch D (#11): cloud-sync failure notice — the write-throughs used to be
  // fire-and-forget, so a failed upsert/delete was invisible (the seller thought
  // the product was cross-device / gone everywhere). Auto-dismissing pill in the
  // app-toast style; no new UI system.
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNote = (msg: string) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote(msg);
    noteTimer.current = setTimeout(() => setNote(null), 3200);
  };
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  const save = (p: Product[]) => { setProds(p); saveProducts(p); };
  // Latest list for the async stock-flush closures (avoids stale-closure bugs).
  const prodsRef = useRef(prods); useEffect(() => { prodsRef.current = prods; }, [prods]);

  // ── Quick stock edit (− / +) — RACE-SAFE (touches live stock Auto-mode decrements) ──
  // NEVER read-into-JS-then-write: taps accumulate a DELTA, debounced into ONE
  // atomic adjust_product_stock RPC (stock = stock + delta, own-scoped, clamp≥0).
  // authRef = last authoritative stock per id (batch baseline, == display between
  // batches); pendingRef = unsent delta; inflightRef = one write per product at a
  // time (its resolve re-flushes any taps that arrived mid-write). So 5 quick +taps
  // = exactly +5 in ONE settled write; a concurrent auto-order can't be lost.
  const authRef = useRef<Map<number, number>>(new Map());
  const pendingRef = useRef<Map<number, number>>(new Map());
  const inflightRef = useRef<Set<number>>(new Set());
  const stockTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => () => {
    stockTimers.current.forEach((t) => clearTimeout(t));
    // M1: persist any un-flushed delta on navigate-away (fire-and-forget) so a quick
    // edit isn't silently lost. Skip ids already mid-write — their remaining pending
    // is flushed by that write's resolve; flushing here too would double-apply.
    pendingRef.current.forEach((delta, id) => {
      if (delta !== 0 && !inflightRef.current.has(id)) void adjustProductStock(id, delta);
    });
  }, []);

  const setStock = (id: number, stock: number): Product[] => {
    const next = prodsRef.current.map((x) => (x.id === id ? { ...x, stock, status: statusForStock(stock) } : x));
    save(next); return next;
  };
  const flushStock = (id: number) => {
    if (inflightRef.current.has(id)) return;            // a write is running → its resolve re-flushes
    const delta = pendingRef.current.get(id) ?? 0;
    if (delta === 0) { pendingRef.current.delete(id); authRef.current.delete(id); return; }
    pendingRef.current.set(id, 0);                      // consume; new taps re-accumulate from 0
    // C1: optimistically advance the baseline by the in-flight delta so a tap that
    // arrives DURING the write recomputes the display from an in-flight-inclusive
    // baseline (no transient dip). Undone on failure below.
    authRef.current.set(id, (authRef.current.get(id) ?? 0) + delta);
    inflightRef.current.add(id);
    void adjustProductStock(id, delta).then((newStock) => {
      inflightRef.current.delete(id);
      const rem = pendingRef.current.get(id) ?? 0;      // taps that arrived during the write
      const base = authRef.current.get(id) ?? 0;        // = pre-write baseline + this in-flight delta (C1)
      if (newStock == null || newStock < 0) {           // FAILED / not-owner → undo the C1 advance, revert to authoritative(+rem)
        const reverted = base - delta;                  // back to the true pre-write baseline
        authRef.current.set(id, reverted);
        setStock(id, Math.max(0, reverted + rem));
        showNote(t.rd_prd_stock_failed);
      } else {                                          // SUCCESS → authoritative value (reflects concurrent auto decrements)
        authRef.current.set(id, newStock);
        const next = setStock(id, Math.max(0, newStock + rem));
        onProductsChanged?.(next, id, "stock");         // re-seed Auto-mode live stock to the DB truth
      }
      if ((pendingRef.current.get(id) ?? 0) !== 0) flushStock(id); // more taps → write again
      else { pendingRef.current.delete(id); authRef.current.delete(id); }
    });
  };
  const bumpStock = (id: number, delta: number) => {
    const p = prodsRef.current.find((x) => x.id === id);
    if (!p) return;
    if (!authRef.current.has(id)) authRef.current.set(id, p.stock); // batch baseline = current authoritative display
    const pend = (pendingRef.current.get(id) ?? 0) + delta;
    pendingRef.current.set(id, pend);
    setStock(id, Math.max(0, (authRef.current.get(id) ?? 0) + pend)); // optimistic (clamped ≥0)
    const prev = stockTimers.current.get(id); if (prev) clearTimeout(prev);
    stockTimers.current.set(id, setTimeout(() => flushStock(id), STOCK_ADJUST_DEBOUNCE_MS));
  };
  // Cross-device load: reconcile local cache with public.products (DB wins; first
  // signed-in load migrates pre-existing local products once). Read-on-load only.
  useEffect(() => {
    let active = true;
    void resolveInitialProducts(loadProducts()).then(({ products }) => {
      if (!active) return;
      setProds(products);
      saveProducts(products); // mirror the resolved list back to the local cache
    });
    return () => { active = false; };
  }, []);
  const openAdd = () => { setForm(EMPTY); setEid(null); setFormErr(""); setShow(true); };
  const openEdit = (p: Product) => { setForm({ name: p.name, sku: p.sku, price: String(p.price), stock: String(p.stock), platform: p.platform, liveCode: p.liveCode || "" }); setEid(p.id); setFormErr(""); setShow(true); };
  // Delete: if the CLOUD delete fails, the local delete is REVERTED (the DB row
  // survived and the DB-wins reconcile would resurrect it on next load anyway —
  // showing it gone now would be a lie) + the failure pill explains.
  const del = (id: number) => {
    if (!window.confirm(t.rd_prd_confirm_del)) return;
    const before = prods;
    const after = deleteProduct(prods, id);
    save(after);
    onProductsChanged?.(after, id, "delete"); // drop the code + its stock entry
    // Delete failed → restore the product AND re-seed its stock (its entry was
    // dropped above), so the code isn't stuck reading 0 (sold-out).
    void deleteProductDb(id).then((ok) => { if (ok === false) { save(before); onProductsChanged?.(before, id, "stock"); showNote(t.rd_prd_delete_failed); } });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Live code: one code per seller (case-insensitive). Client-side check catches
    // the same-device dup; the DB partial-unique index is the cross-device backstop.
    const code = form.liveCode.trim().toLowerCase();
    if (code && prods.some((p) => p.id !== eid && (p.liveCode || "").trim().toLowerCase() === code)) {
      setFormErr(t.rd_prd_code_dup); return; // block; keep the modal open
    }
    setFormErr("");
    const before = prods;
    const prev = eid !== null ? before.find((p) => p.id === eid) : null; // for the stock-change check
    const next = upsertProduct(prods, form, eid, nowMs());
    save(next);
    const changed = eid !== null ? next.find((p) => p.id === eid) : next[next.length - 1];
    // F1: re-seed the live stock ONLY when the stock value changed (a new product
    // always seeds; an edit seeds only if stock differs). A name/price/code edit =
    // "meta" → the code list re-derives but the decremented live count is preserved.
    const stockChanged = eid === null || (!!prev && !!changed && prev.stock !== changed.stock);
    onProductsChanged?.(next, changed?.id, stockChanged ? "stock" : "meta"); // apply the new/edited code immediately
    // Add/edit: local save is KEPT on a generic cloud failure (localStorage is this
    // screen's primary store; the pill says the CLOUD copy didn't sync). A live_code
    // COLLISION (23505 from another device) is different — the code isn't ours, so
    // REVERT the local save and show the dup error, mirroring the delete-revert.
    // I1: a meta edit (stock unchanged) OMITS the stock column so it can't clobber
    // an auto-order-decremented DB stock with this screen's stale in-memory value.
    if (changed) void saveProductDbResult(changed, { skipStock: !stockChanged }).then((r) => {
      if (r.ok) return;
      if (r.duplicateCode) { save(before); onProductsChanged?.(before); setFormErr(t.rd_prd_code_dup); setShow(true); }
      else showNote(t.rd_prd_sync_failed);
    });
    setShow(false);
  };
  const filtered = useMemo(() => filterByStock(filterProducts(prods, q), stockFilter), [prods, q, stockFilter]);
  const count = (s: string) => prods.filter((p) => p.status === s).length;
  // Translate the derived stock status for display (adapter returns canonical English).
  const statusLabel = (s: string) => (s === "Active" ? t.rd_prd_st_active : s === "Low stock" ? t.rd_prd_st_low : s === "Out of stock" ? t.rd_prd_st_out : s);

  // ── Branded export (Excel / PDF) — exports the CURRENTLY VISIBLE rows (`filtered`,
  // after search + the stock filter). Reusable module; the caller owns formatting:
  // currency-formatted price, translated + color-coded status, summary counts.
  // Map a TRANSLATED status label back to its canonical key so the color fn finds
  // the right hex (the cell text is already localized by statusLabel).
  const statusCanon: Record<string, string> = { [t.rd_prd_st_active]: "Active", [t.rd_prd_st_low]: "Low stock", [t.rd_prd_st_out]: "Out of stock" };
  const buildExport = () => {
    const columns: ExportColumn[] = [
      { header: t.rd_prd_name, width: 26 },
      { header: t.rd_prd_sku, width: 16 },
      { header: t.rd_prd_live_code, width: 12 },
      { header: t.rd_prd_price, width: 12, align: "right" },
      { header: t.rd_prd_stock, width: 9, align: "right" },
      { header: t.rd_prd_platform, width: 14 },
      { header: t.rd_prd_status_col, width: 14, color: (v) => STATUS_HEX[statusCanon[String(v)] ?? ""] },
    ];
    const rows = filtered.map((p) => [
      p.name, p.sku, p.liveCode || "", `${cur}${fmt(p.price)}`, p.stock, p.platform, statusLabel(p.status),
    ]);
    const summary = [
      { label: t.rd_prd_total, value: filtered.length },
      { label: t.rd_prd_instock, value: filtered.filter((p) => p.status === "Active").length },
      { label: t.rd_prd_low, value: filtered.filter((p) => p.status === "Low stock").length },
      { label: t.rd_prd_out, value: filtered.filter((p) => p.status === "Out of stock").length },
    ];
    return { title: t.rd_prd_title, seller, columns, rows, summary, filename: `sellerflow-products-${dayStamp()}` };
  };
  const doExportXlsx = () => { setExportOpen(false); void exportBrandedXlsx(buildExport()).catch(() => showNote(t.rd_prd_export_failed)); };
  const doExportPdf = () => { setExportOpen(false); exportBrandedPdf(buildExport()); };

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sfl-anim-beat" style={title}>{t.rd_prd_title}</div>
          <div style={{ display: "flex", gap: 7 }}>
            {prods.length > 0 && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setExportOpen((o) => !o)} data-testid="products-export" aria-haspopup="menu" aria-expanded={exportOpen} style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", color: "var(--on-header)", border: "none", padding: "7px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export} ▾</button>
                {exportOpen && (
                  <>
                    <div onClick={() => setExportOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 11, boxShadow: "0 12px 32px rgba(0,0,0,.28)", overflow: "hidden", minWidth: 152 }}>
                      <button role="menuitem" onClick={doExportXlsx} data-testid="export-xlsx" style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_export_excel}</button>
                      <button role="menuitem" onClick={doExportPdf} data-testid="export-pdf" style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_export_pdf}</button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 5, background: "#fff", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_add}</button>
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.16)", borderRadius: 11, padding: "9px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input className="sfl-header-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.rd_prd_search} style={{ flex: 1, border: "none", background: "transparent", color: "var(--on-header)", fontSize: 13, fontFamily: "var(--font-ui)", outline: "none" }} />
        </div>
      </div>

      <div style={{ padding: "14px 14px 4px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {[[t.rd_prd_total, prods.length, "var(--text)"], [t.rd_prd_instock, count("Active"), "var(--ok)"], [t.rd_prd_low, count("Low stock"), "var(--warn)"], [t.rd_prd_out, count("Out of stock"), "var(--danger)"]].map(([l, v, c]) => (
          <div key={l as string} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "9px 10px", textAlign: "center", boxShadow: "var(--shadow)" }}>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: c as string }}>{v as number}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>{l as string}</div>
          </div>
        ))}
      </div>

      {/* Stock filter pills — drive off the SAME statuses as the stat cards (filterByStock/statusForStock). */}
      <div style={{ padding: "8px 14px 0", display: "flex", gap: 7, overflowX: "auto" }}>
        {([["all", t.rd_prd_f_all, prods.length], ["in", t.rd_prd_instock, count("Active")], ["low", t.rd_prd_low, count("Low stock")], ["out", t.rd_prd_out, count("Out of stock")]] as [StockFilter, string, number][]).map(([f, label, n]) => {
          const on = stockFilter === f;
          return (
            <button key={f} onClick={() => setStockFilter(f)} data-testid={`filter-${f}`} aria-pressed={on} style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "6px 11px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-ui)", border: on ? "1px solid var(--accent)" : "1px solid var(--border)", background: on ? "var(--accent-soft)" : "var(--surface)", color: on ? "var(--accent-fg)" : "var(--text-dim)" }}>
              {label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
        {filtered.length === 0 && <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>{t.rd_prd_empty}</div>}
        {filtered.map((p) => (
          <div key={p.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, overflow: "hidden", boxShadow: "var(--shadow)" }}>
            <div style={{ height: 70, background: avColor(p.name), display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,.9)", fontFamily: "var(--font-display)" }}>{initials(p.name)}</span>
              <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9.5, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.3)", padding: "3px 7px", borderRadius: 6 }}>{p.platform}</span>
            </div>
            <div style={{ padding: "10px 11px 11px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.25 }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: "var(--text-muted)" }}>{p.sku}</span>
                {p.liveCode && p.liveCode.trim() && (
                  <span title={t.rd_prd_live_code} style={{ fontFamily: mono, fontSize: 10, fontWeight: 800, letterSpacing: ".03em", color: "var(--accent-fg)", background: "var(--accent-soft)", padding: "1px 6px", borderRadius: 5 }}>{p.liveCode.trim()}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7, gap: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(p.price)}</span>
                {/* Quick stock edit — atomic, debounced, race-safe (see bumpStock). */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }} title={t.rd_prd_quick_stock}>
                  <button onClick={() => bumpStock(p.id, -1)} disabled={p.stock === 0} data-testid={`stock-dec-${p.id}`} aria-label={t.rd_prd_stock_minus} style={stepBtn(p.stock === 0)}>−</button>
                  <span data-testid={`stock-val-${p.id}`} style={{ minWidth: 30, textAlign: "center", fontFamily: mono, fontSize: 13, fontWeight: 800, color: stockColor(p.stock) }}>{p.stock}</span>
                  <button onClick={() => bumpStock(p.id, 1)} data-testid={`stock-inc-${p.id}`} aria-label={t.rd_prd_stock_plus} style={stepBtn(false)}>+</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button onClick={() => openEdit(p)} style={{ flex: 1, fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "6px 0", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_edit_btn}</button>
                <button onClick={() => del(p.id)} style={{ flex: 1, fontSize: 11, fontWeight: 700, color: "var(--danger)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "6px 0", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_delete_btn}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Batch D #11 — cloud-sync failure pill (app-toast style, auto-dismiss) */}
      {note && (
        <div style={{ position: "sticky", bottom: 14, zIndex: 900, display: "flex", justifyContent: "center", padding: "0 16px", pointerEvents: "none" }}>
          <div style={{ maxWidth: "100%", background: "var(--danger)", color: "#fff", fontSize: 13, fontWeight: 700, padding: "10px 18px", borderRadius: 999, boxShadow: "0 8px 24px rgba(0,0,0,.3)", textAlign: "center", lineHeight: 1.35 }}>⚠ {note}</div>
        </div>
      )}

      {show && (
        <div onClick={(e) => e.target === e.currentTarget && setShow(false)} style={{ position: "absolute", inset: 0, zIndex: 1000, background: "rgba(8,6,24,.5)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,.4)", padding: 18, display: "flex", flexDirection: "column", gap: 11 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{eid !== null ? t.rd_prd_edit : t.rd_prd_add_title}</div>
            <div><label style={lbl}>{t.rd_prd_name}</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required style={input} /></div>
            <div><label style={lbl}>{t.rd_prd_sku}</label><input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} style={input} /></div>
            <div>
              <label style={lbl}>{t.rd_prd_live_code}</label>
              <input value={form.liveCode} onChange={(e) => { setForm((f) => ({ ...f, liveCode: e.target.value })); setFormErr(""); }} placeholder={t.rd_prd_live_code_ph} style={input} />
              {/* WARN (not block) on inner spaces — exact match still works, but qty
                  parsing "CODE N" is cleaner without them. */}
              {form.liveCode.trim().includes(" ") && <div style={{ fontSize: 10.5, color: "var(--warn)", marginTop: 4, lineHeight: 1.4 }}>{t.rd_prd_live_code_space}</div>}
              {/* F3: a live code on a price-0 product → auto orders would total 0. */}
              {form.liveCode.trim() && (parseFloat(form.price) || 0) === 0 && <div style={{ fontSize: 10.5, color: "var(--warn)", marginTop: 4, lineHeight: 1.4 }}>{t.rd_prd_live_code_price0}</div>}
              {formErr && <div style={{ fontSize: 10.5, color: "var(--danger)", marginTop: 4, lineHeight: 1.4 }}>{formErr}</div>}
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <div style={{ flex: 1 }}><label style={lbl}>{t.rd_prd_price} ({cur})</label><input type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required style={input} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>{t.rd_prd_stock}</label><input type="number" min="0" value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} required style={input} /></div>
            </div>
            <div><label style={lbl}>{t.rd_prd_platform}</label><select value={form.platform} onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))} style={input}><option>TikTok</option><option>Facebook</option><option>TikTok / FB</option></select></div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.rd_prd_status_will}<b style={{ color: stockColor(parseInt(form.stock, 10) || 0) }}>{statusLabel(statusForStock(parseInt(form.stock, 10) || 0))}</b></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
              <button type="button" onClick={() => setShow(false)} style={{ padding: "9px 14px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_cancel}</button>
              <button type="submit" style={{ padding: "9px 16px", border: "none", borderRadius: 10, background: "var(--accent)", color: "var(--accent-text)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
