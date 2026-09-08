// Parcel Scan (Phase A1, ADMIN-ONLY dogfood) — scan handwritten parcel slips.
// Owner photographs slips with the normal camera app, multi-picks them here,
// each photo is downscaled + sent (one at a time) to the admin-guarded
// /admin/parcel-scan vision endpoint, the extracted fields are confirmed/edited
// per parcel, and confirmed rows insert into parcel_scans. Per-parcel 7-11
// encoding + the status queue come in Phase A2 — this screen is scan → confirm
// → save plus a simple read-on-open list of saved rows (ZERO poll).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import {
  fileToScanBase64, scanParcel, saveParcelScan, loadParcelScans, formErrors, amountWarns,
  checkEmapStore, saveStoreCheck, scanToXlsRow, splitScansForExport, markScansExported,
  deleteParcelScan, deleteExportedParcels,
  type ScanFields, type ScanConfidence, type ParcelScanRow, type ScanFormState, type StoreCheckStatus, type ExportReason,
} from "../adapters/parcelScan";
import { fetchShipTemplate, buildXlsmFromTemplate, deliverXlsm, exportFilename } from "../adapters/shippingExport";
import { loadShippingSettings } from "../adapters/shippingSettings";
import { SHIP_DEFAULT_FEE } from "../adapters/shipping";

const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 };
const errTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const warnTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--warn, #b45309)", marginTop: 3 };
const lowConfBorder = "1.5px solid var(--warn, #f59e0b)";

type Phase = "idle" | "scanning" | "confirm" | "error";

type FormState = ScanFormState;
const emptyForm: FormState = { name: "", phone: "", store: "", amount: "", notes: "" };

// E-Map verdict → row badge. valid/null are quiet (no badge). not_found is the
// actionable one (red); unknown + checking are grey/informational.
type BadgeKey = "rd_ps2_store_bad" | "rd_ps2_store_unknown" | "rd_ps2_store_checking";
function storeBadge(status: string | null): { icon: string; color: string; key: BadgeKey } | null {
  if (status === "not_found") return { icon: "❌", color: "var(--danger)", key: "rd_ps2_store_bad" };
  if (status === "unknown") return { icon: "⚠️", color: "var(--text-dim)", key: "rd_ps2_store_unknown" };
  if (status === "checking") return { icon: "⏳", color: "var(--text-dim)", key: "rd_ps2_store_checking" };
  return null; // valid | null → quiet
}

const fieldsToForm = (f: ScanFields): FormState => ({
  name: f.name ?? "",
  phone: f.phone ?? "",
  store: f.store_id ?? "",
  amount: f.amount === null ? "" : String(f.amount),
  notes: f.notes ?? "",
});
const formToFields = (f: FormState): ScanFields => ({
  name: f.name.trim() || null,
  phone: f.phone.trim() || null,
  store_id: f.store.trim() || null,
  amount: f.amount.trim() === "" ? null : Number(f.amount),
  notes: f.notes.trim() || null,
});

// Export attention reason → i18n key.
type ReasonKey = "rd_ps2_x_wrong_store" | "rd_ps2_x_bad_name" | "rd_ps2_x_bad_phone" | "rd_ps2_x_bad_store" | "rd_ps2_x_bad_amount";
const reasonKey = (r: ExportReason): ReasonKey =>
  r === "wrong_store" ? "rd_ps2_x_wrong_store"
    : r === "bad_name" ? "rd_ps2_x_bad_name"
      : r === "bad_phone" ? "rd_ps2_x_bad_phone"
        : r === "bad_store" ? "rd_ps2_x_bad_store"
          : "rd_ps2_x_bad_amount";

export default function ParcelScan({ cur = "NT$", storeName = "" }: { cur?: string; storeName?: string }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Batch cursor — files are scanned strictly one at a time.
  const [files, setFiles] = useState<File[]>([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanErr, setScanErr] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [confid, setConfid] = useState<Record<keyof ScanFields, ScanConfidence> | null>(null);
  const [rawExtraction, setRawExtraction] = useState<{ fields: ScanFields; confidence?: Record<keyof ScanFields, ScanConfidence> } | null>(null);
  const [saveErr, setSaveErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  // 賣貨便 export: default fee (one settings read on open) + busy + last summary.
  const [fee, setFee] = useState(SHIP_DEFAULT_FEE);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [exportSummary, setExportSummary] = useState<{ exported: number; attention: { name: string; reason: ExportReason }[] } | null>(null);

  // Saved list — ONE read on screen open; saves append locally (no refetch).
  const [rows, setRows] = useState<ParcelScanRow[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  // Saved-list tab (Change 2): "all" (default) | "wrong" (not_found only).
  const [tab, setTab] = useState<"all" | "wrong">("all");
  // Delete (Change 3): a pending confirmation + await/error state. Never fires
  // a delete without the confirm; a failed delete surfaces inline, no silent no-op.
  const [confirm, setConfirm] = useState<{ kind: "row"; id: string } | { kind: "exported" } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  // Alive across the whole screen — guards fire-and-forget store-check verdicts
  // (runStoreCheck) that can land after unmount, not just the initial load.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => {
    loadParcelScans().then((r) => { if (aliveRef.current) { if (r.ok) setRows(r.rows); setListLoaded(true); } });
  }, []);
  // One settings read on open → the 運費 default for the export (factory NT$38).
  useEffect(() => {
    loadShippingSettings().then((s) => { if (aliveRef.current && s) setFee(s.defaultFee); });
  }, []);

  const scanOne = async (list: File[], i: number) => {
    setPhase("scanning"); setScanErr(""); setSaveErr("");
    try {
      const { base64, mediaType } = await fileToScanBase64(list[i]);
      const r = await scanParcel(base64, mediaType);
      if (!r.ok || !r.fields) { setScanErr(r.error || "scan_failed"); setPhase("error"); return; }
      setForm(fieldsToForm(r.fields));
      setConfid(r.confidence ?? null);
      setRawExtraction({ fields: r.fields, confidence: r.confidence });
      setPhase("confirm");
    } catch {
      setScanErr("image_decode_failed"); setPhase("error");
    }
  };

  const onPick = (picked: FileList | null) => {
    const list = Array.from(picked ?? []);
    if (fileRef.current) fileRef.current.value = ""; // re-picking the same files works
    if (!list.length) return;
    setFiles(list); setIdx(0);
    void scanOne(list, 0);
  };

  const advance = () => {
    const next = idx + 1;
    setForm(emptyForm); setConfid(null); setRawExtraction(null); setSaveErr("");
    if (next < files.length) { setIdx(next); void scanOne(files, next); }
    else { setFiles([]); setIdx(0); setPhase("idle"); }
  };

  // Fire-and-forget E-Map store-code check for one saved row. Sets the local
  // row to "checking", asks the server, persists + reflects the verdict. Never
  // blocks the scan flow; any failure lands as "unknown" (grey badge).
  const runStoreCheck = (rowId: string, storeId: string) => {
    if (!/^\d{6}$/.test(storeId)) return;
    setRows((prev) => prev.map((x) => (x.id === rowId ? { ...x, storeCheckStatus: "checking" } : x)));
    void (async () => {
      const res = await checkEmapStore(storeId);
      const status: StoreCheckStatus = res.status;
      void saveStoreCheck(rowId, status); // best-effort persist
      // Unmount guard (mirrors the load effect's `alive`): a late verdict must
      // not setRows on an unmounted screen.
      if (aliveRef.current) setRows((prev) => prev.map((x) => (x.id === rowId ? { ...x, storeCheckStatus: status } : x)));
    })();
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true); setSaveErr("");
    const fields = formToFields(form);
    const r = await saveParcelScan(fields, rawExtraction);
    setSaving(false);
    if (!r.ok) { setSaveErr(r.error || "save_failed"); return; }
    const rowId = r.id || `local-${Date.now()}`;
    const storeId = fields.store_id ?? "";
    setRows((prev) => [{
      id: rowId,
      customerName: fields.name ?? "",
      phone: fields.phone ?? "",
      storeId,
      amount: fields.amount,
      notes: fields.notes ?? "",
      status: "confirmed",
      storeCheckStatus: /^\d{6}$/.test(storeId) ? "checking" : null,
      createdAt: new Date().toISOString(),
    }, ...prev]);
    setToast(t.rd_ps2_saved_toast);
    setTimeout(() => setToast(""), 2500);
    // Only when we got a real DB id back can the async verdict be persisted +
    // matched to the row; skip the check on the local-id fallback.
    if (r.id) runStoreCheck(r.id, storeId);
    advance();
  };

  // ── 賣貨便 訂單匯入 Excel export — gate, build via the EXISTING builder, deliver.
  // No quota RPC (admin-only). Marks exported READY rows done so re-exports skip.
  // CHANGE 1: the button count is the READY count (passes validators AND
  // store_check_status != 'not_found'), NOT all non-exported rows — a wrong-code
  // parcel is never counted and never lands in the .xlsm. unknown/null store
  // checks stay READY (soft-warned). Same split the build below uses.
  const readyCount = splitScansForExport(rows, fee).ready.length;
  const runExport = async () => {
    if (exportBusy) return;
    setExportBusy(true); setExportErr(""); setExportSummary(null);
    try {
      const { ready, attention } = splitScansForExport(rows, fee);
      const attnList = attention.map((a) => ({ name: a.row.customerName || a.row.storeId || "—", reason: a.reason }));
      if (ready.length === 0) {
        setExportSummary({ exported: 0, attention: attnList });
        return;
      }
      const bytes = await buildXlsmFromTemplate(await fetchShipTemplate(), ready.map((r) => scanToXlsRow(r, { storeName, fee })));
      const d = await deliverXlsm(bytes, exportFilename(Date.now()));
      if (!d.ok) { setExportErr(d.error || "export_failed"); return; }
      const ids = ready.map((r) => r.id);
      void markScansExported(ids); // best-effort; re-exports skip these
      if (aliveRef.current) {
        setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, status: "exported" } : r)));
        setExportSummary({ exported: ready.length, attention: attnList });
      }
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };

  // ── Deletes (Change 3) — awaited, confirmed, prune only on success ──────────
  const exportedCount = rows.filter((r) => r.status === "exported").length;
  const doDelete = async () => {
    if (!confirm || deleting) return;
    setDeleting(true); setDeleteErr("");
    if (confirm.kind === "row") {
      const id = confirm.id;
      const r = await deleteParcelScan(id);
      setDeleting(false);
      if (!r.ok) { setDeleteErr(r.error || "delete_failed"); return; }
      if (aliveRef.current) { setRows((prev) => prev.filter((x) => x.id !== id)); setConfirm(null); }
    } else {
      const r = await deleteExportedParcels();
      setDeleting(false);
      if (!r.ok) { setDeleteErr(r.error || "delete_failed"); return; }
      if (aliveRef.current) { setRows((prev) => prev.filter((x) => x.status !== "exported")); setConfirm(null); }
    }
  };
  const askDelete = (c: { kind: "row"; id: string } | { kind: "exported" }) => { setDeleteErr(""); setConfirm(c); };

  const errs = formErrors(form);
  const saveBlocked = saving || errs.empty || errs.name || errs.phone || errs.store;
  const low = (f: keyof ScanFields): boolean => confid?.[f] === "low";
  const F = (patch: Partial<FormState>) => setForm((s) => ({ ...s, ...patch }));
  const busy = phase === "scanning" || phase === "confirm" || phase === "error";
  const flaggedCount = rows.filter((r) => r.storeCheckStatus === "not_found").length;
  // Change 2: the saved list re-renders by active tab (in-memory filter of the
  // already-loaded rows — zero-poll, no refetch/timers).
  const shown = tab === "wrong" ? rows.filter((r) => r.storeCheckStatus === "not_found") : rows;
  const progress = files.length > 1 ? { i: String(idx + 1), n: String(files.length) } : { i: "1", n: "1" };

  const timeOf = (iso: string): string => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  };

  return (
    <div>
      <div style={headerBar}>
        <div className="sfl-anim-beat" style={headerTitle}>{t.rd_ps2_title}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_ps2_sub}</div>
      </div>
      <div style={{ padding: "16px 14px 22px", display: "grid", gap: 12 }}>
        {toast && <div style={{ ...card, padding: 10, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--ok, #16a34a)" }} data-testid="ps-toast">{toast}</div>}

        {/* Picker — hidden until the current batch finishes */}
        {!busy && (
          <div style={card}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{ width: "100%", padding: "13px 14px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              data-testid="ps-pick"
            >📷 {t.rd_ps2_pick}</button>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>{t.rd_ps2_pick_hint}</div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden data-testid="ps-file" onChange={(e) => onPick(e.target.files)} />
          </div>
        )}

        {phase === "scanning" && (
          <div style={{ ...card, textAlign: "center", padding: 24 }} data-testid="ps-scanning">
            <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{tpl(t.rd_ps2_scanning, progress)}</div>
          </div>
        )}

        {phase === "error" && (
          <div style={{ ...card, borderColor: "var(--danger)" }} data-testid="ps-error">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>{t.rd_ps2_err_scan}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3, fontFamily: mono }}>{scanErr}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => void scanOne(files, idx)} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, cursor: "pointer" }} data-testid="ps-retry">{t.rd_ps2_retry}</button>
              <button onClick={advance} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }} data-testid="ps-skip-err">{t.rd_ps2_skip}</button>
            </div>
          </div>
        )}

        {phase === "confirm" && (
          <div style={card} data-testid="ps-confirm">
            <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>{tpl(t.rd_ps2_confirm, progress)}</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={lbl}>{t.rd_ps2_name}{low("name") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                <input value={form.name} onChange={(e) => F({ name: e.target.value })} style={{ ...input, ...(low("name") ? { border: lowConfBorder } : {}) }} data-testid="ps-name" />
                {errs.name && <div style={errTxt}>{t.rd_ps2_err_name}</div>}
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={lbl}>{t.rd_ps2_phone}{low("phone") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                  <input value={form.phone} onChange={(e) => F({ phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) })} inputMode="numeric" placeholder="09xxxxxxxx" style={{ ...input, fontFamily: mono, ...(low("phone") ? { border: lowConfBorder } : {}) }} data-testid="ps-phone" />
                  {errs.phone && <div style={errTxt}>{t.rd_ps2_err_phone}</div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={lbl}>{t.rd_ps2_store}{low("store_id") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                  <input value={form.store} onChange={(e) => F({ store: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })} inputMode="numeric" placeholder="123456" style={{ ...input, fontFamily: mono, ...(low("store_id") ? { border: lowConfBorder } : {}) }} data-testid="ps-store" />
                  {errs.store && <div style={errTxt}>{t.rd_ps2_err_store}</div>}
                </div>
              </div>
              <div>
                <label style={lbl}>{t.rd_ps2_amount} ({cur}){low("amount") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                <input value={form.amount} onChange={(e) => F({ amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="numeric" style={{ ...input, fontFamily: mono, ...(low("amount") ? { border: lowConfBorder } : {}) }} data-testid="ps-amount" />
                {amountWarns(form.amount) && <div style={warnTxt} data-testid="ps-amount-warn">{t.rd_ps2_amount_warn}</div>}
              </div>
              <div>
                <label style={lbl}>{t.rd_ps2_notes}{low("notes") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                <input value={form.notes} onChange={(e) => F({ notes: e.target.value })} style={input} data-testid="ps-notes" />
              </div>
              {saveErr && <div style={errTxt} data-testid="ps-save-err">{t.rd_ps2_err_save} <span style={{ fontFamily: mono }}>{saveErr}</span></div>}
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button onClick={() => void onSave()} disabled={saveBlocked} style={{ flex: 2, padding: "11px 12px", borderRadius: 10, border: "none", background: saveBlocked ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: saveBlocked ? "default" : "pointer" }} data-testid="ps-save">{t.rd_ps2_save}</button>
                <button onClick={advance} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }} data-testid="ps-skip">{t.rd_ps2_skip}</button>
              </div>
            </div>
          </div>
        )}

        {/* Summary — subtle, shows before the owner sits at the laptop. */}
        {flaggedCount > 0 && (
          <div style={{ ...card, padding: 10, borderColor: "var(--danger)", background: "var(--danger-soft, rgba(220,38,38,.08))", fontSize: 12, fontWeight: 700, color: "var(--danger)" }} data-testid="ps-attention">
            {tpl(t.rd_ps2_attention, { n: String(flaggedCount) })}
          </div>
        )}

        {/* 賣貨便 訂單匯入 Excel export — one file for the whole batch. */}
        <div style={card} data-testid="ps-export-card">
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>{t.rd_ps2_x_title}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 9, lineHeight: 1.5 }}>{t.rd_ps2_x_hint}</div>
          <button
            onClick={() => void runExport()}
            disabled={exportBusy || readyCount === 0}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "none", background: exportBusy || readyCount === 0 ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: exportBusy || readyCount === 0 ? "default" : "pointer" }}
            data-testid="ps-export-btn"
          >📄 {exportBusy ? t.rd_ps2_x_exporting : tpl(t.rd_ps2_x_button, { n: String(readyCount) })}</button>
          {exportErr && <div style={{ ...errTxt, marginTop: 8 }} data-testid="ps-export-err">{t.rd_ps2_x_failed} <span style={{ fontFamily: mono }}>{exportErr}</span></div>}
          {exportSummary && (
            <div style={{ marginTop: 10 }} data-testid="ps-export-summary">
              <div style={{ fontSize: 12, fontWeight: 800, color: exportSummary.exported > 0 ? "var(--ok, #16a34a)" : "var(--text-dim)" }}>
                {tpl(t.rd_ps2_x_result, { x: String(exportSummary.exported), y: String(exportSummary.attention.length) })}
              </div>
              {exportSummary.attention.length > 0 && (
                <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                  {exportSummary.attention.map((a, i) => (
                    <div key={i} style={{ fontSize: 11, color: "var(--danger)", display: "flex", justifyContent: "space-between", gap: 8 }} data-testid="ps-export-attn-row">
                      <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      <span style={{ flexShrink: 0 }}>{t[reasonKey(a.reason)]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Saved list — read-on-open snapshot + local appends. Full queue = A2. */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>{t.rd_ps2_saved} {rows.length > 0 && <span style={{ color: "var(--text-dim)", fontWeight: 700 }}>· {rows.length}</span>}</div>
            {exportedCount > 0 && (
              <button onClick={() => askDelete({ kind: "exported" })} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 10.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }} data-testid="ps-clear-exported">🗑 {t.rd_ps2_clear_exported}</button>
            )}
          </div>

          {/* Two-tab segmented toggle (Change 2). */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }} data-testid="ps-tabs">
            {([["all", `${t.rd_ps2_tab_all} · ${rows.length}`], ["wrong", `${t.rd_ps2_tab_wrong} · ${flaggedCount}`]] as const).map(([key, label]) => {
              const on = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{ flex: 1, padding: "7px 8px", borderRadius: 9, border: on ? "1px solid var(--accent)" : "1px solid var(--border-strong)", background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "#fff" : "var(--text-dim)", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}
                  data-testid={`ps-tab-${key}`}
                  aria-pressed={on}
                >{label}</button>
              );
            })}
          </div>

          {listLoaded && rows.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }} data-testid="ps-empty">{t.rd_ps2_empty}</div>}
          {listLoaded && tab === "wrong" && rows.length > 0 && flaggedCount === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }} data-testid="ps-wrong-empty">{t.rd_ps2_wrong_empty}</div>}
          {shown.map((r) => {
            const badge = storeBadge(r.storeCheckStatus);
            const canRecheck = !r.id.startsWith("local-") && /^\d{6}$/.test(r.storeId) && (r.storeCheckStatus === "not_found" || r.storeCheckStatus === "unknown");
            return (
              <div key={r.id} style={{ padding: "9px 2px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }} data-testid="ps-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.customerName || "—"}
                    {r.status === "exported" && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: "var(--ok, #16a34a)", border: "1px solid var(--ok, #16a34a)", borderRadius: 6, padding: "0 5px", verticalAlign: "middle" }} data-testid="ps-exported-tag">{t.rd_ps2_x_tag}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: mono }}>{[r.phone, r.storeId].filter(Boolean).join(" · ") || "—"}</div>
                  {badge && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 3, color: badge.color }} data-testid="ps-store-badge" data-status={r.storeCheckStatus || ""}>
                      {badge.icon} {t[badge.key]}
                      {canRecheck && <button onClick={() => runStoreCheck(r.id, r.storeId)} style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 10, fontWeight: 700, cursor: "pointer" }} data-testid="ps-recheck">{t.rd_ps2_recheck}</button>}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, fontFamily: mono }}>{r.amount !== null ? `${cur}${r.amount.toLocaleString()}` : "—"}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{timeOf(r.createdAt)}</div>
                  </div>
                  <button onClick={() => askDelete({ kind: "row", id: r.id })} aria-label={t.rd_ps2_delete_aria} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontSize: 13, cursor: "pointer", lineHeight: 1 }} data-testid="ps-row-delete">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete confirmation (Change 3) — matches PrinterModal/ExpiryModal tokens. */}
      {confirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }} data-testid="ps-confirm-overlay" onClick={() => { if (!deleting) setConfirm(null); }}>
          <div style={{ width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 20px", boxShadow: "0 -8px 40px rgba(0,0,0,.35)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.5, color: "var(--text)" }} data-testid="ps-confirm-msg">
              {confirm.kind === "exported" ? tpl(t.rd_ps2_clear_exported_q, { n: String(exportedCount) }) : t.rd_ps2_delete_row_q}
            </div>
            {deleteErr && <div style={{ ...errTxt, marginTop: 10 }} data-testid="ps-delete-err">{t.rd_ps2_delete_err} <span style={{ fontFamily: mono }}>{deleteErr}</span></div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirm(null)} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: deleting ? "default" : "pointer" }} data-testid="ps-confirm-cancel">{t.rd_ps2_cancel}</button>
              <button onClick={() => void doDelete()} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--danger)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.7 : 1 }} data-testid="ps-confirm-delete">{t.rd_ps2_delete}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
