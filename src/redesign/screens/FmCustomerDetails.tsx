// FamilyMart (全家) customers — the 7-11 Customer Details screen, for fm_parcel_customers (sql/121).
// Same look and flow: search by name / phone / @username, open a buyer, type the price (+ @username),
// Import → the buyer is added straight to Parcel Scan FamilyMart as a new parcel with today's date
// (Taipei) and the FamilyMart shipping fee. Every parcel add saves or updates its buyer (database
// trigger). No frozen layer, no batch cap (FamilyMart has neither). Read on open + per search.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import { taipeiDayId } from "../../lib/dateHelpers";
import { searchFmCustomers, loadRecentFmCustomers, updateFmCustomer, deleteFmCustomer, countFmCustomers, type FmCustomer } from "../adapters/fmCustomers";
import { FM_ERROR_KEY, FM_SCAN_DEFAULT_FEE, loadFmGlobalFee, saveFmScan, validateFmScan, type FmScanInput } from "../adapters/fmScan";
import { validHandle } from "../adapters/parcelScan";

const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 };
const errTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const SEARCH_DEBOUNCE_MS = 250;

type EditForm = { name: string; phone: string; store: string; username: string };

// feeOverride: Parcel Scan FamilyMart passes the fee it already read (no second read).
export default function FmCustomerDetails({ cur = "NT$", onImported, fee: feeOverride }: { cur?: string; onImported?: () => void; fee?: number }) {
  const t = useT();

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<FmCustomer[]>([]);
  const [mode, setMode] = useState<"recent" | "search">("recent");
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState("");
  const [ownFee, setOwnFee] = useState<number>(FM_SCAN_DEFAULT_FEE);
  const fee = feeOverride ?? ownFee;
  const [total, setTotal] = useState<number | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [handle, setHandle] = useState("");
  const [noHandle, setNoHandle] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");

  const [editing, setEditing] = useState<FmCustomer | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", phone: "", store: "", username: "" });
  const [editErr, setEditErr] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState<FmCustomer | null>(null);
  const [delErr, setDelErr] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function reloadCount() {
    const c = await countFmCustomers();
    setTotal(c.ok ? c.count : null);
  }

  useEffect(() => {
    let live = true;
    if (feeOverride === undefined) void loadFmGlobalFee().then((f) => { if (live) setOwnFee(f); });
    void countFmCustomers().then((c) => { if (live) setTotal(c.ok ? c.count : null); });
    return () => { live = false; };
  }, [feeOverride]);

  const reqSeq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const seq = ++reqSeq.current;
    const run = async () => {
      const isSearch = q !== "";
      setMode(isSearch ? "search" : "recent");
      setLoading(true);
      const r = isSearch ? await searchFmCustomers(q) : await loadRecentFmCustomers();
      if (seq !== reqSeq.current) return;
      if (r.ok) { setRows(r.rows); setListErr(""); } else setListErr(t.rd_cd_load_err);
      setLoading(false);
    };
    const id = setTimeout(() => void run(), q === "" ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function reloadCurrent() {
    const q = query.trim();
    const seq = ++reqSeq.current;
    const r = q === "" ? await loadRecentFmCustomers() : await searchFmCustomers(q);
    if (seq !== reqSeq.current) return;
    if (r.ok) { setRows(r.rows); setListErr(""); } else setListErr(t.rd_cd_load_err);
  }

  function toggleRow(c: FmCustomer) {
    setImportErr("");
    setPrice("");
    setHandle(c.buyerUsername || "");
    setNoHandle(false);
    setOpenId((cur0) => (cur0 === c.id ? null : c.id));
  }

  async function doImport(c: FmCustomer) {
    setImportErr("");
    // Same rules as a new parcel on the FamilyMart screen: today (Taipei) + the FamilyMart fee.
    const parcel: FmScanInput = {
      recipientName: c.name, phone: c.phone, storeId: c.storeId, amount: price,
      shippingFee: String(fee), orderDate: taipeiDayId(), buyerUsername: noHandle ? "" : handle,
    };
    const errs = validateFmScan(parcel, parcel.orderDate);
    const first = errs.recipientName ?? errs.phone ?? errs.storeId ?? errs.amount ?? errs.total ?? errs.buyerUsername;
    if (first) { setImportErr(t[FM_ERROR_KEY[first]]); return; }
    if (!noHandle && !validHandle(handle)) { setImportErr(t.rd_ps2_err_handle); return; }
    setImporting(true);
    try {
      const r = await saveFmScan(parcel);
      if (!r.ok) { setImportErr(t.rd_cd_import_err); return; }
      setToast(t.rd_cd_imported_toast);
      setTimeout(() => setToast(""), 2500);
      setPrice(""); setHandle(""); setNoHandle(false); setOpenId(null);
      onImported?.();
    } finally {
      setImporting(false);
    }
  }

  function openEdit(c: FmCustomer) {
    setEditing(c);
    setEditForm({ name: c.name, phone: c.phone, store: c.storeId, username: c.buyerUsername });
    setEditErr("");
  }
  async function saveEdit() {
    if (!editing) return;
    setEditErr("");
    setSavingEdit(true);
    try {
      const r = await updateFmCustomer(editing.id, {
        name: editForm.name.trim() || null,
        phone: editForm.phone.trim() || null,
        store_id: editForm.store.trim() || null,
        buyer_username: editForm.username.trim() || null,
      });
      if (!r.ok) { setEditErr(t.rd_cd_edit_err); return; }
      setEditing(null);
      await reloadCurrent();
    } finally {
      setSavingEdit(false);
    }
  }
  async function doDelete() {
    if (!confirmDel) return;
    setDelErr("");
    setDeleting(true);
    try {
      const r = await deleteFmCustomer(confirmDel.id);
      if (!r.ok) { setDelErr(t.rd_cd_delete_err); return; }
      const id = confirmDel.id;
      setConfirmDel(null);
      setRows((prev) => prev.filter((x) => x.id !== id));
      if (openId === id) setOpenId(null);
      void reloadCount();
    } finally {
      setDeleting(false);
    }
  }

  const showEmpty = !loading && !listErr && rows.length === 0;
  const portalRoot = (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body;

  return (
    <div>
      <div style={headerBar}>
        <div className="sfl-anim-beat" style={headerTitle}>{t.rd_cd_title}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_cd_sub}</div>
      </div>
      <div style={{ padding: "16px 14px calc(28px + env(safe-area-inset-bottom))", display: "grid", gap: 12 }}>
        {toast && <div style={{ ...card, padding: 10, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--ok, #16a34a)" }} data-testid="fcd-toast">{toast}</div>}

        <div style={{ position: "relative" }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.rd_cd_search_ph} style={{ ...input, paddingRight: query ? 34 : 12 }} data-testid="fcd-search" aria-label={t.rd_cd_search_ph} />
          {query && (
            <button onClick={() => setQuery("")} aria-label={t.rd_cd_close}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: 15, cursor: "pointer" }}
              data-testid="fcd-search-clear">✕</button>
          )}
        </div>

        {total !== null && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", marginTop: -4 }} data-testid="fcd-total">
            {tpl(total === 1 ? t.rd_cd_count_one : t.rd_cd_count_many, { n: String(total) })}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)" }} data-testid="fcd-heading">
          {mode === "search" ? tpl(t.rd_cd_match_count, { n: String(rows.length) }) : t.rd_cd_recent}
        </div>

        {loading && <div style={{ ...card, padding: 12, textAlign: "center", fontSize: 12, color: "var(--text-dim)" }} data-testid="fcd-loading">{t.rd_cd_searching}</div>}
        {listErr && !loading && <div style={{ ...card, padding: 12, textAlign: "center", fontSize: 12, color: "var(--danger)" }} data-testid="fcd-list-err">{listErr}</div>}
        {showEmpty && (
          <div style={{ ...card, padding: 16, textAlign: "center", fontSize: 12.5, color: "var(--text-dim)" }} data-testid="fcd-empty">
            {mode === "search" ? t.rd_cd_no_results : t.rd_cd_empty}
          </div>
        )}

        {!loading && !listErr && rows.map((c, i) => {
          const open = openId === c.id;
          return (
            <div key={c.id} style={card} data-testid="fcd-row" data-open={open ? "1" : undefined}>
              <button onClick={() => toggleRow(c)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }} data-testid="fcd-row-main">
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-dim)", fontFamily: mono, flexShrink: 0, minWidth: 20, textAlign: "right" }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="fcd-row-name">{c.name || c.buyerUsername || c.phone}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: mono }} data-testid="fcd-row-phone">{c.phone}</span>
                    {c.storeId && <span style={{ fontFamily: mono }} data-testid="fcd-row-store">🏪 {c.storeId}</span>}
                    {c.buyerUsername && c.name && <span data-testid="fcd-row-username">{c.buyerUsername}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", flexShrink: 0 }}>{open ? "▾" : t.rd_cd_import}</span>
              </button>

              {open && (
                <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 8 }} data-testid="fcd-import-panel">
                  <div>
                    <label style={lbl}>{t.rd_cd_price_ph}</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-dim)" }}>{cur}</span>
                      <input value={price} onChange={(e) => { setPrice(e.target.value.replace(/[^\d.]/g, "")); setImportErr(""); }} inputMode="numeric" placeholder={t.rd_cd_price_ph} style={input} data-testid="fcd-price" aria-label={t.rd_cd_price_ph} />
                    </div>
                    {importErr && <div style={errTxt} data-testid="fcd-import-err">{importErr}</div>}
                  </div>
                  <div>
                    <label style={lbl}>{t.rd_ps2_handle}</label>
                    <input value={handle}
                      onChange={(e) => { const v = e.target.value.slice(0, 50); setHandle(v); setImportErr(""); if (v.trim() !== "" && noHandle) setNoHandle(false); }}
                      maxLength={50} placeholder="@username" style={{ ...input, ...(noHandle ? { opacity: 0.5 } : {}) }} data-testid="fcd-handle" aria-label={t.rd_ps2_handle} />
                    <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, cursor: "pointer", fontSize: 12, color: "var(--text-dim)" }}>
                      <input type="checkbox" checked={noHandle} onChange={(e) => { const on = e.target.checked; setNoHandle(on); if (on) { setHandle(""); setImportErr(""); } }} data-testid="fcd-no-handle" />
                      {t.rd_ps2_no_handle}
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => openEdit(c)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13, cursor: "pointer" }} data-testid="fcd-edit" aria-label={t.rd_cd_edit_aria}>✏️ {t.rd_cd_edit}</button>
                    <button onClick={() => { setDelErr(""); setConfirmDel(c); }} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--danger)", fontWeight: 700, fontSize: 13, cursor: "pointer" }} data-testid="fcd-delete" aria-label={t.rd_cd_delete_aria}>🗑</button>
                    <button onClick={() => void doImport(c)} disabled={importing}
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "none", background: importing ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: importing ? "default" : "pointer" }}
                      data-testid="fcd-import">{importing ? t.rd_cd_importing : t.rd_cd_import}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="fcd-edit-overlay" onClick={() => { if (!savingEdit) setEditing(null); }}>
          <div style={{ width: "100%", maxWidth: 440, maxHeight: "100%", overflowY: "auto", background: "var(--surface)", borderRadius: 18, padding: "22px 20px 20px", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 14 }}>{t.rd_cd_edit_title}</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div><label style={lbl}>{t.rd_cd_name_ph}</label><input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} style={input} data-testid="fcd-edit-name" /></div>
              <div><label style={lbl}>{t.rd_cd_phone_ph}</label><input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) }))} inputMode="numeric" style={input} data-testid="fcd-edit-phone" /></div>
              <div><label style={lbl}>{t.rd_cd_store_ph}</label><input value={editForm.store} onChange={(e) => setEditForm((f) => ({ ...f, store: e.target.value.replace(/[^\d]/g, "").slice(0, 6) }))} inputMode="numeric" style={input} data-testid="fcd-edit-store" /></div>
              <div><label style={lbl}>{t.rd_ps2_handle}</label><input value={editForm.username} onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value.slice(0, 50) }))} style={input} data-testid="fcd-edit-username" /></div>
            </div>
            {editErr && <div style={{ ...errTxt, marginTop: 10 }} data-testid="fcd-edit-err">{editErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEditing(null)} disabled={savingEdit} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: savingEdit ? "default" : "pointer" }} data-testid="fcd-edit-cancel">{t.rd_cd_cancel}</button>
              <button onClick={() => void saveEdit()} disabled={savingEdit} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: savingEdit ? "default" : "pointer", opacity: savingEdit ? 0.7 : 1 }} data-testid="fcd-edit-save">{t.rd_cd_save}</button>
            </div>
          </div>
        </div>,
        portalRoot,
      )}

      {confirmDel && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="fcd-del-overlay" onClick={() => { if (!deleting) setConfirmDel(null); }}>
          <div style={{ width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 18, padding: "22px 20px 20px", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.5, color: "var(--text)" }}>{tpl(t.rd_cd_delete_q, { name: confirmDel.name || confirmDel.buyerUsername || confirmDel.phone })}</div>
            {delErr && <div style={{ ...errTxt, marginTop: 10 }} data-testid="fcd-del-err">{delErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirmDel(null)} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: deleting ? "default" : "pointer" }} data-testid="fcd-del-cancel">{t.rd_cd_cancel}</button>
              <button onClick={() => void doDelete()} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--danger)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.7 : 1 }} data-testid="fcd-del-go">{t.rd_cd_delete_go}</button>
            </div>
          </div>
        </div>,
        portalRoot,
      )}
    </div>
  );
}
