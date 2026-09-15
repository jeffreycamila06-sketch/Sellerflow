// Customer Details — a phonebook of parcel buyers, sitting next to Parcel Scan.
// Every parcel encode auto-populates it (the DB trigger — sql/35); here the
// seller searches a repeat buyer by name / phone / handle, types a price, and
// Imports → the buyer is saved straight into parcel_scans as a PENDING parcel
// (going through the SAME validation + batch cap as a fresh encode — no bypass).
//
// ⚠️ EGRESS-SAFE: one recent read on open + one search read per (debounced)
// query + one insert per Import + own-scoped edit/delete. ZERO poll. This is the
// PARCEL phonebook (parcel_customers) — NOT the live-selling CRM `customers`.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import {
  searchParcelCustomers, loadRecentParcelCustomers, updateParcelCustomer,
  deleteParcelCustomer, countPendingParcels, countParcelCustomers, type ParcelCustomer,
} from "../adapters/parcelCustomers";
import { saveParcelScan, validAmount, amountTooHigh, MIN_PARCEL_AMOUNT, MAX_PARCEL_TOTAL, MAX_PENDING_PARCELS } from "../adapters/parcelScan";
import { loadGlobalShippingFee } from "../adapters/shippingSettings";
import { SHIP_DEFAULT_FEE } from "../adapters/shipping";

const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 };
const errTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const SEARCH_DEBOUNCE_MS = 250;

type EditForm = { name: string; phone: string; store: string; notes: string };

// `onImported` is optional: the standalone Settings screen omits it (an import
// shows a toast + resets, staying on the screen). When Parcel Scan embeds this
// as an overlay it passes onImported so a successful import can close the overlay
// and refresh the parent's Saved list + Batch count. Absent → byte-identical.
export default function CustomerDetails({ cur = "NT$", onImported }: { cur?: string; onImported?: () => void }) {
  const t = useT();

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ParcelCustomer[]>([]);
  const [mode, setMode] = useState<"recent" | "search">("recent"); // which list is shown
  const [loading, setLoading] = useState(true);   // initial recent load / active search
  const [listErr, setListErr] = useState("");
  const [fee, setFee] = useState<number>(SHIP_DEFAULT_FEE);
  // FULL phonebook total (never the searched subset) — its own head-only count
  // query. null = unknown/failed (line hidden).
  const [total, setTotal] = useState<number | null>(null);

  // Inline import: one row expanded at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [importErr, setImportErr] = useState("");
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");

  // Edit + delete modals.
  const [editing, setEditing] = useState<ParcelCustomer | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", phone: "", store: "", notes: "" });
  const [editErr, setEditErr] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ParcelCustomer | null>(null);
  const [delErr, setDelErr] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Refresh the full total (own head-count). Called on mount + after a delete
  // (total drops). Edit here updates a row in place (same id) so the total never
  // changes; Import saves a parcel, not a phonebook row (the trigger may later
  // add one, but not synchronously) — so neither refreshes the total.
  async function reloadCount() {
    const c = await countParcelCustomers();
    setTotal(c.ok ? c.count : null);
  }

  // ── Load the global fee + the full total once (the recent list is loaded by
  // the query effect below, which fires on mount with an empty query). ───────
  useEffect(() => {
    let live = true;
    void loadGlobalShippingFee().then((f) => { if (live) setFee(f); });
    void countParcelCustomers().then((c) => { if (live) setTotal(c.ok ? c.count : null); });
    return () => { live = false; };
  }, []);

  // ── Debounced search; blank query falls back to the recent list (also the
  // initial mount load). All state updates happen inside the scheduled async
  // run — never synchronously in the effect body (no cascading renders). ─────
  const reqSeq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const seq = ++reqSeq.current;
    const run = async () => {
      const isSearch = q !== "";
      setMode(isSearch ? "search" : "recent");
      setLoading(true);
      const r = isSearch ? await searchParcelCustomers(q) : await loadRecentParcelCustomers();
      if (seq !== reqSeq.current) return; // a newer query superseded this
      if (r.ok) { setRows(r.rows); setListErr(""); } else setListErr(t.rd_cd_load_err);
      setLoading(false);
    };
    const id = setTimeout(() => void run(), q === "" ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Reload the CURRENT view (recent or the active search) after an edit/delete.
  async function reloadCurrent() {
    const q = query.trim();
    const seq = ++reqSeq.current;
    const r = q === "" ? await loadRecentParcelCustomers() : await searchParcelCustomers(q);
    if (seq !== reqSeq.current) return;
    if (r.ok) { setRows(r.rows); setListErr(""); } else setListErr(t.rd_cd_load_err);
  }

  function toggleRow(id: string) {
    setImportErr("");
    setPrice("");
    setOpenId((cur0) => (cur0 === id ? null : id));
  }

  async function doImport(c: ParcelCustomer) {
    setImportErr("");
    // SAME rules as a fresh encode — no bypass of min/max or the batch cap.
    if (!validAmount(price, fee)) {
      setImportErr(amountTooHigh(price, fee)
        ? tpl(t.rd_ps2_err_amount_max, { max: `${cur}${MAX_PARCEL_TOTAL - fee}` })
        : tpl(t.rd_ps2_err_amount, { amt: `${cur}${MIN_PARCEL_AMOUNT}` }));
      return;
    }
    setImporting(true);
    try {
      const cnt = await countPendingParcels();
      if (!cnt.ok) { setImportErr(t.rd_cd_import_err); return; }
      if (cnt.count >= MAX_PENDING_PARCELS) { setImportErr(tpl(t.rd_ps2_batch_full, { max: String(MAX_PENDING_PARCELS) })); return; }
      const r = await saveParcelScan(
        { name: c.name || null, phone: c.phone || null, store_id: c.storeId || null, amount: Number(price), notes: c.notes || null },
        null,
      );
      if (!r.ok) { setImportErr(t.rd_cd_import_err); return; }
      setToast(t.rd_cd_imported_toast);
      setTimeout(() => setToast(""), 2500);
      setPrice("");
      setOpenId(null);
      // Embedded (Parcel Scan overlay): hand control back so the parent can close
      // the overlay + refresh its Saved list / Batch count. Standalone: no-op.
      onImported?.();
    } finally {
      setImporting(false);
    }
  }

  function openEdit(c: ParcelCustomer) {
    setEditing(c);
    setEditForm({ name: c.name, phone: c.phone, store: c.storeId, notes: c.notes });
    setEditErr("");
  }
  async function saveEdit() {
    if (!editing) return;
    setEditErr("");
    setSavingEdit(true);
    try {
      const r = await updateParcelCustomer(editing.id, {
        name: editForm.name.trim() || null,
        phone: editForm.phone.trim() || null,
        store_id: editForm.store.trim() || null,
        notes: editForm.notes.trim() || null,
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
      const r = await deleteParcelCustomer(confirmDel.id);
      if (!r.ok) { setDelErr(t.rd_cd_delete_err); return; }
      const id = confirmDel.id;
      setConfirmDel(null);
      setRows((prev) => prev.filter((x) => x.id !== id));
      if (openId === id) setOpenId(null);
      void reloadCount(); // total drops by one
    } finally {
      setDeleting(false);
    }
  }

  const showEmpty = !loading && !listErr && rows.length === 0;

  return (
    <div>
      <div style={headerBar}>
        <div className="sfl-anim-beat" style={headerTitle}>{t.rd_cd_title}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_cd_sub}</div>
      </div>
      <div style={{ padding: "16px 14px calc(28px + env(safe-area-inset-bottom))", display: "grid", gap: 12 }}>
        {toast && <div style={{ ...card, padding: 10, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--ok, #16a34a)" }} data-testid="cd-toast">{toast}</div>}

        {/* Search */}
        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.rd_cd_search_ph}
            style={{ ...input, paddingRight: query ? 34 : 12 }}
            data-testid="cd-search"
            aria-label={t.rd_cd_search_ph}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label={t.rd_cd_close}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: 15, cursor: "pointer" }}
              data-testid="cd-search-clear"
            >✕</button>
          )}
        </div>

        {/* FULL phonebook total — always the own total, never the searched subset. */}
        {total !== null && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", marginTop: -4 }} data-testid="cd-total">
            {tpl(total === 1 ? t.rd_cd_count_one : t.rd_cd_count_many, { n: String(total) })}
          </div>
        )}

        {/* List heading + count */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)" }} data-testid="cd-heading">
            {mode === "search" ? tpl(t.rd_cd_match_count, { n: String(rows.length) }) : t.rd_cd_recent}
          </div>
        </div>

        {loading && <div style={{ ...card, padding: 12, textAlign: "center", fontSize: 12, color: "var(--text-dim)" }} data-testid="cd-loading">{t.rd_cd_searching}</div>}
        {listErr && !loading && <div style={{ ...card, padding: 12, textAlign: "center", fontSize: 12, color: "var(--danger)" }} data-testid="cd-list-err">{listErr}</div>}
        {showEmpty && (
          <div style={{ ...card, padding: 16, textAlign: "center", fontSize: 12.5, color: "var(--text-dim)" }} data-testid="cd-empty">
            {mode === "search" ? t.rd_cd_no_results : t.rd_cd_empty}
          </div>
        )}

        {!loading && !listErr && rows.map((c, i) => {
          const open = openId === c.id;
          return (
            <div key={c.id} style={card} data-testid="cd-row" data-open={open ? "1" : undefined}>
              <button
                onClick={() => toggleRow(c.id)}
                style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                data-testid="cd-row-main"
              >
                {/* Row number over the VISIBLE list (1..N of what's on screen —
                    search results or recent), not a DB id. */}
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-dim)", fontFamily: mono, flexShrink: 0, minWidth: 20, textAlign: "right" }} data-testid="cd-row-num">{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="cd-row-name">{c.name || c.notes || c.phone}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: mono }} data-testid="cd-row-phone">{c.phone}</span>
                    {c.storeId && <span style={{ fontFamily: mono }} data-testid="cd-row-store">🏪 {c.storeId}</span>}
                    {c.notes && c.name && <span data-testid="cd-row-notes">{c.notes}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", flexShrink: 0 }}>{open ? "▾" : t.rd_cd_import}</span>
              </button>

              {open && (
                <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 8 }} data-testid="cd-import-panel">
                  {!c.storeId && <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--warn, #b45309)" }} data-testid="cd-no-store">{t.rd_cd_no_store}</div>}
                  <div>
                    <label style={lbl}>{t.rd_cd_price_ph}</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-dim)" }}>{cur}</span>
                      <input
                        value={price}
                        onChange={(e) => { setPrice(e.target.value); setImportErr(""); }}
                        inputMode="numeric"
                        placeholder={t.rd_cd_price_ph}
                        style={input}
                        data-testid="cd-price"
                        aria-label={t.rd_cd_price_ph}
                      />
                    </div>
                    {importErr && <div style={errTxt} data-testid="cd-import-err">{importErr}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => openEdit(c)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13, cursor: "pointer" }} data-testid="cd-edit" aria-label={t.rd_cd_edit_aria}>✏️ {t.rd_cd_edit}</button>
                    <button onClick={() => { setDelErr(""); setConfirmDel(c); }} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--danger)", fontWeight: 700, fontSize: 13, cursor: "pointer" }} data-testid="cd-delete" aria-label={t.rd_cd_delete_aria}>🗑</button>
                    <button
                      onClick={() => void doImport(c)}
                      disabled={importing}
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "none", background: importing ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: importing ? "default" : "pointer" }}
                      data-testid="cd-import"
                    >{importing ? t.rd_cd_importing : t.rd_cd_import}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit modal */}
      {editing && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="cd-edit-overlay" onClick={() => { if (!savingEdit) setEditing(null); }}>
          <div style={{ width: "100%", maxWidth: 440, maxHeight: "100%", overflowY: "auto", background: "var(--surface)", borderRadius: 18, padding: "22px 20px 20px", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 14 }}>{t.rd_cd_edit_title}</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div><label style={lbl}>{t.rd_cd_name_ph}</label><input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} style={input} data-testid="cd-edit-name" /></div>
              <div><label style={lbl}>{t.rd_cd_phone_ph}</label><input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} inputMode="numeric" style={input} data-testid="cd-edit-phone" /></div>
              <div><label style={lbl}>{t.rd_cd_store_ph}</label><input value={editForm.store} onChange={(e) => setEditForm((f) => ({ ...f, store: e.target.value }))} inputMode="numeric" style={input} data-testid="cd-edit-store" /></div>
              <div><label style={lbl}>{t.rd_cd_notes_ph}</label><input value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} style={input} data-testid="cd-edit-notes" /></div>
            </div>
            {editErr && <div style={{ ...errTxt, marginTop: 10 }} data-testid="cd-edit-err">{editErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEditing(null)} disabled={savingEdit} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: savingEdit ? "default" : "pointer" }} data-testid="cd-edit-cancel">{t.rd_cd_cancel}</button>
              <button onClick={() => void saveEdit()} disabled={savingEdit} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: savingEdit ? "default" : "pointer", opacity: savingEdit ? 0.7 : 1 }} data-testid="cd-edit-save">{t.rd_cd_save}</button>
            </div>
          </div>
        </div>,
        (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body,
      )}

      {/* Delete confirm */}
      {confirmDel && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="cd-del-overlay" onClick={() => { if (!deleting) setConfirmDel(null); }}>
          <div style={{ width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 18, padding: "22px 20px 20px", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.5, color: "var(--text)" }} data-testid="cd-del-msg">{tpl(t.rd_cd_delete_q, { name: confirmDel.name || confirmDel.notes || confirmDel.phone })}</div>
            {delErr && <div style={{ ...errTxt, marginTop: 10 }} data-testid="cd-del-err">{delErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirmDel(null)} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: deleting ? "default" : "pointer" }} data-testid="cd-del-cancel">{t.rd_cd_cancel}</button>
              <button onClick={() => void doDelete()} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--danger)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.7 : 1 }} data-testid="cd-del-go">{t.rd_cd_delete_go}</button>
            </div>
          </div>
        </div>,
        (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body,
      )}
    </div>
  );
}
