// Screen 3 — Products. REAL CRUD with CROSS-DEVICE sync: the local "sf_prods"
// cache (instant render + offline) is reconciled on load with the per-user
// public.products table via the productsDb adapter (DB wins; first signed-in load
// migrates pre-existing local products once). Add/edit/delete write through to the
// DB; search/CSV/status (derived from stock) unchanged. Read-on-load + write-on-
// action only — NO polling.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { avColor, initials, fmt } from "../data";
import { csvDL } from "../adapters/csv";
import { loadProducts, saveProducts, upsertProduct, deleteProduct, filterProducts, statusForStock, type Product, type ProductForm } from "../adapters/products";
import { resolveInitialProducts, saveProductDb, deleteProductDb } from "../adapters/productsDb";
import { useT } from "../i18n";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const title: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
const mono = "var(--font-mono)";
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const lbl: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const EMPTY: ProductForm = { name: "", sku: "", price: "", stock: "", platform: "TikTok" };
const stockColor = (s: number) => (s === 0 ? "var(--danger)" : s <= 5 ? "var(--warn)" : "var(--ok)");

export default function Products({ cur }: { cur: string }) {
  const t = useT();
  const [prods, setProds] = useState<Product[]>(() => loadProducts());
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [eid, setEid] = useState<number | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY);
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
  const openAdd = () => { setForm(EMPTY); setEid(null); setShow(true); };
  const openEdit = (p: Product) => { setForm({ name: p.name, sku: p.sku, price: String(p.price), stock: String(p.stock), platform: p.platform }); setEid(p.id); setShow(true); };
  // Delete: if the CLOUD delete fails, the local delete is REVERTED (the DB row
  // survived and the DB-wins reconcile would resurrect it on next load anyway —
  // showing it gone now would be a lie) + the failure pill explains.
  const del = (id: number) => {
    if (!window.confirm(t.rd_prd_confirm_del)) return;
    const before = prods;
    save(deleteProduct(prods, id));
    void deleteProductDb(id).then((ok) => { if (ok === false) { save(before); showNote(t.rd_prd_delete_failed); } });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = upsertProduct(prods, form, eid, Date.now());
    save(next);
    const changed = eid !== null ? next.find((p) => p.id === eid) : next[next.length - 1];
    // Add/edit: the local save is KEPT on cloud failure (localStorage is this
    // screen's primary store; the pill says the CLOUD copy didn't sync).
    if (changed) void saveProductDb(changed).then((ok) => { if (ok === false) showNote(t.rd_prd_sync_failed); });
    setShow(false);
  };
  const exportCsv = () => csvDL("products.csv", ["Name", "SKU", "Price", "Stock", "Platform", "Status"], prods.map((p) => [p.name, p.sku, p.price, p.stock, p.platform, p.status]));
  const filtered = useMemo(() => filterProducts(prods, q), [prods, q]);
  const count = (s: string) => prods.filter((p) => p.status === s).length;
  // Translate the derived stock status for display (adapter returns canonical English).
  const statusLabel = (s: string) => (s === "Active" ? t.rd_prd_st_active : s === "Low stock" ? t.rd_prd_st_low : s === "Out of stock" ? t.rd_prd_st_out : s);

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sfl-anim-beat" style={title}>{t.rd_prd_title}</div>
          <div style={{ display: "flex", gap: 7 }}>
            {prods.length > 0 && <button onClick={exportCsv} style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", color: "var(--on-header)", border: "none", padding: "7px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>}
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
              <div style={{ fontFamily: mono, fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.sku}</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 7 }}>
                <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(p.price)}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: stockColor(p.stock) }}>{p.stock === 0 ? t.rd_prd_out : `${p.stock} ${t.rd_prd_left}`}</span>
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
