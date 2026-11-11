// Parcel Scan FamilyMart (全家) — looks and works like the 7-11 Parcel Scan manual entry
// (ParcelScan.tsx), on its own table fm_parcel_scans (sql/120) and phonebook fm_parcel_customers
// (sql/121). Not here (7-11 only): camera / AI scan, E-Map store check, buyer checker, frozen layer,
// batch cap. Hidden from the seller: the order date (today in Taipei when the parcel is added) and
// the shipping fee (ONE global admin setting, app_settings 'fm_shipping_fee', fallback 39).
// Export = the 好賣+ 大量匯單 .xlsx (fmScan.ts, unchanged). Read on open + write on action (zero poll).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import { HeaderWithBack } from "../components/BackButton";
import { taipeiDayId } from "../../lib/dateHelpers";
import { isAppShell, isNarrowViewport } from "../adapters/appShell";
import { isAndroid } from "../adapters/platform";
import { decodeQrFromFile } from "../adapters/qrDecode";
import { handleFromQrPayload } from "../../lib/tiktokHandle";
import { validHandle, MAX_PENDING_PARCELS } from "../adapters/parcelScan";
import {
  FM_ERROR_KEY, FM_SCAN_DEFAULT_FEE, type FmScanError, type FmScanInput, type FmScanRow,
  buildFmExport, deleteFmExported, deleteFmScan, deliverFmFiles, loadFmGlobalFee, loadFmScans,
  markFmExported, saveFmScan, undoFmExport, validateFmScan,
} from "../adapters/fmScan";
import FmCustomerDetails from "./FmCustomerDetails";
import BuyerContactField from "../components/BuyerContactField";
import { normalizeContact, contactError, platformOf, type BuyerContactPlatform } from "../adapters/buyerContact";
import { readParcelDraft, writeParcelDraft, holdParcelDraftForSave } from "../adapters/parcelDrafts";
import { useScanQrLookup } from "../adapters/useScanQrLookup";
import { focusUnlessTyping } from "../adapters/scanQrLookup";
import ScanQrLookupBox from "../components/ScanQrLookupBox";
import { BridgeButton, StoreBadge } from "../components/ParcelBridge";

// Same field styles as the 7-11 screen.
const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 };
const errTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const rowBtn: CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontSize: 13, cursor: "pointer", lineHeight: 1 };

// Per-device "Export on this phone" switch, DEFAULT OFF (the 7-11 rule: a phone export marks the
// parcels exported, so they drop out of a laptop export). Own key — independent of the 7-11 switch.
const LS_PHONE_EXPORT = "sfl_rd_fm_export_phone";
const readPhoneExport = (): boolean => { try { return localStorage.getItem(LS_PHONE_EXPORT) === "1"; } catch { return false; } };
const writePhoneExport = (on: boolean): void => { try { if (on) localStorage.setItem(LS_PHONE_EXPORT, "1"); else localStorage.removeItem(LS_PHONE_EXPORT); } catch { /* ignore */ } };

type Form = { name: string; phone: string; store: string; amount: string; username: string };
const emptyForm: Form = { name: "", phone: "", store: "", amount: "", username: "" };
type Tab = "all" | "new" | "done";
type Confirm = { kind: "row"; id: string } | { kind: "exported" } | { kind: "export" } | { kind: "undo" } | { kind: "enablephone" };

const rowInput = (r: FmScanRow): FmScanInput => ({
  recipientName: r.recipientName, phone: r.phone, storeId: r.storeId, amount: String(r.amount),
  shippingFee: String(r.shippingFee), orderDate: r.orderDate, buyerUsername: r.buyerUsername ?? "",
});
const firstError = (e: ReturnType<typeof validateFmScan>): FmScanError | undefined =>
  e.recipientName ?? e.phone ?? e.storeId ?? e.amount ?? e.total ?? e.shippingFee ?? e.orderDate ?? e.buyerUsername;
// The newest export (by time) → offered for Undo when the screen opens.
function latestBatch(rows: FmScanRow[]): { id: string; ids: string[] } | null {
  let best: FmScanRow | null = null;
  for (const r of rows) if (r.exportBatchId && r.exportedAt && (!best || r.exportedAt > best.exportedAt!)) best = r;
  return best ? { id: best.exportBatchId!, ids: rows.filter((r) => r.exportBatchId === best!.exportBatchId).map((r) => r.id) } : null;
}

// onBridge = the ⇄ 7-11 button (RedesignApp passes it ONLY when the seller may use BOTH Parcel Scans).
// pendingCap = the SAME per-account batch limit as the 7-11 screen (maxPendingParcels in RedesignApp),
// counted on FamilyMart parcels only. At the limit no NEW parcel can be saved until an export; edit
// and delete of saved parcels stay open.
export default function FmParcelScan({ cur = "NT$", contactOn = false, lookupOn = false, onBridge, pendingCap = MAX_PENDING_PARCELS, onBack }: { cur?: string; contactOn?: boolean; lookupOn?: boolean; onBridge?: () => void; pendingCap?: number; onBack?: () => void }) {
  const t = useT();
  // Bridge: the manual entry the seller left open here (typed, not saved) comes back as it was.
  const [draft0] = useState(() => readParcelDraft<Form>("fm"));
  const [rows, setRows] = useState<FmScanRow[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  // A NEW parcel needs the saved list read OK first (Batch N / CAP is only true then). Edit and
  // delete of rows already on screen are not affected.
  const [listOk, setListOk] = useState(false);
  const [fee, setFee] = useState(FM_SCAN_DEFAULT_FEE);
  const [form, setForm] = useState<Form>(() => draft0?.form ?? emptyForm);
  const [noHandle, setNoHandle] = useState(() => draft0?.noHandle ?? false);
  // Buyer contact platform (sql/140) — same rules as the 7-11 screen; stays after each save.
  const [platform, setPlatform] = useState<BuyerContactPlatform>(() => draft0?.platform ?? "tiktok");
  const platformToSave: string | null = noHandle || platform === "tiktok" ? null : platform;
  const [manual, setManual] = useState(() => draft0 !== null);
  const [manualCount, setManualCount] = useState(0);
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  const [toast, setToast] = useState("");
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const flash = (m: string, ms = 2500) => { setToast(m); setTimeout(() => { if (aliveRef.current) setToast(""); }, ms); };
  // Scan QR → look the username up in THIS screen's Customers (sql/149). lookupOn false (switch
  // off and login not listed) → scanned() returns at once: no read, nothing on screen.
  const amountRef = useRef<HTMLInputElement | null>(null);
  const lookup = useScanQrLookup({
    on: lookupOn, store: "fm", blocked: editing !== null, initial: draft0?.lookup ?? null,
    fields: { name: form.name, phone: form.phone, store: form.store, handle: form.username },
    setFields: (fn) => setForm((s) => ({ ...s, ...fn({ name: s.name, phone: s.phone, store: s.store }) })),
    onApplied: (how) => { if (how === "auto") focusUnlessTyping(amountRef.current); },
    onFailed: () => flash(t.rd_ql_failed, 3500),
  });
  // Keep the open manual entry for the bridge (an edit of a saved parcel is not kept).
  useEffect(() => {
    if (editing) return;
    writeParcelDraft<Form>("fm", manual ? { form, noHandle, platform, ...(lookup.mark ? { lookup: lookup.mark } : {}) } : null);
  }, [manual, editing, form, noHandle, platform, lookup.mark]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);
  const qrRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState(false);
  const [appFail, setAppFail] = useState(false);
  const [androidSaved, setAndroidSaved] = useState(false); // Android browser download landed → "saved to Downloads" line
  const [exportSummary, setExportSummary] = useState<{ exported: number; attention: { name: string; reason: FmScanError }[] } | null>(null);
  const [lastExportBatch, setLastExportBatch] = useState<{ id: string; ids: string[] } | null>(null);
  const [undoErr, setUndoErr] = useState(false);
  const [custOpen, setCustOpen] = useState(false);

  const [narrow, setNarrow] = useState(() => isNarrowViewport());
  useEffect(() => {
    const onResize = () => setNarrow(isNarrowViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const onMobile = isAppShell() || narrow;
  const [phoneExport, setPhoneExport] = useState(() => readPhoneExport());
  const enablePhoneExport = () => { writePhoneExport(true); setPhoneExport(true); setConfirm(null); };
  const disablePhoneExport = () => { writePhoneExport(false); setPhoneExport(false); };
  const exportHidden = onMobile && !phoneExport;

  const reloadSaved = () => {
    void loadFmScans().then((r) => { if (aliveRef.current && r.ok) { setRows(r.rows); setListOk(true); } });
  };
  useEffect(() => {
    void loadFmScans().then((r) => {
      if (!aliveRef.current) return;
      if (r.ok) { setRows(r.rows); setLastExportBatch(latestBatch(r.rows)); setListOk(true); }
      setListLoaded(true);
    }, () => { if (aliveRef.current) setListLoaded(true); });
    void loadFmGlobalFee().then((f) => { if (aliveRef.current) setFee(f); });
  }, []);

  const F = (patch: Partial<Form>) => setForm((s) => ({ ...s, ...patch }));
  const clearForm = () => { setForm(emptyForm); setNoHandle(false); lookup.reset(); };

  // The parcel as it will be saved. New: today (Taipei) + the FamilyMart fee. Edit: keeps its own.
  const today = taipeiDayId();
  const editRow = editing ? rows.find((r) => r.id === editing.id) : undefined;
  const parcel: FmScanInput = {
    recipientName: form.name, phone: form.phone, storeId: form.store, amount: form.amount,
    shippingFee: editRow ? String(editRow.shippingFee) : String(fee),
    orderDate: editRow ? editRow.orderDate : today,
    buyerUsername: noHandle ? "" : (contactOn ? normalizeContact(platform, form.username) : form.username),
  };
  const errs = validateFmScan(parcel, today);
  const handleBad = !noHandle && !validHandle(form.username);
  const contactBad = contactOn && !noHandle && contactError(platform, form.username) !== "";
  const isEmpty = Object.values(form).every((v) => v.trim() === "");
  // Batch = FamilyMart parcels not exported yet (its own count — never the 7-11 one).
  const pendingCount = rows.filter((r) => !r.exportedAt).length;
  const batchFull = pendingCount >= pendingCap;
  const newBlocked = !listOk || batchFull; // no NEW parcel until the list loaded OK, or when the batch is full
  const saveBlocked = saving || firstError(errs) !== undefined || handleBad || contactBad || (newBlocked && !editing);
  // Like 7-11: a field's problem shows once that field has something in it.
  const showErr = (filled: string, e?: FmScanError) => (filled.trim() !== "" && e ? <div style={errTxt} data-testid="fms-field-err">{t[FM_ERROR_KEY[e]]}</div> : null);

  const commitNew = async (): Promise<boolean> => {
    const r = contactOn ? await saveFmScan({ ...parcel, orderDate: taipeiDayId() }, undefined, platformToSave) : await saveFmScan({ ...parcel, orderDate: taipeiDayId() }); // the date at the moment of adding
    if (!r.ok || !r.row) { setSaveErr(true); return false; }
    setRows((prev) => [r.row!, ...prev]);
    flash(t.rd_ps2_saved_toast);
    return true;
  };
  const onManualSave = async () => {
    if (saveBlocked) return;
    setSaving(true); setSaveErr(false);
    // The kept entry goes blank BEFORE the save: ⇄ and back while it runs = an empty form, never
    // the same parcel a second time. A failed save puts it back.
    const restoreDraft = holdParcelDraftForSave("fm");
    let ok = false;
    try { ok = await commitNew(); } finally { if (!ok) restoreDraft(); }
    setSaving(false);
    if (!ok) return;
    setManualCount((c) => c + 1);
    clearForm(); // stays open, blank, for the next parcel
  };
  const onEditSave = async () => {
    if (!editing || saveBlocked) return;
    setSaving(true); setSaveErr(false);
    // picker on → its value; off → clear a STALE platform when the handle changed (v2 item 7).
    const usernameChanged = (editRow?.buyerUsername ?? "") !== parcel.buyerUsername.trim();
    const contactArg: string | null | undefined = contactOn ? platformToSave : (editRow?.contactPlatform != null && usernameChanged ? null : undefined);
    const r = contactArg === undefined ? await saveFmScan(parcel, editing.id) : await saveFmScan(parcel, editing.id, contactArg);
    setSaving(false);
    if (!r.ok || !r.row) { setSaveErr(true); return; }
    setRows((list) => list.map((x) => (x.id === editing.id ? r.row! : x)));
    setEditing(null); clearForm();
    flash(t.rd_ps2_saved_toast);
  };
  const openManual = () => { if (editing || newBlocked) return; setSaveErr(false); clearForm(); setManual(true); };
  const cancelManual = () => { setManual(false); clearForm(); setSaveErr(false); };
  const openEdit = (r: FmScanRow) => {
    if (r.exportedAt) return;
    setSaveErr(false); setManual(false);
    setForm({ name: r.recipientName, phone: r.phone, store: r.storeId, amount: String(r.amount), username: r.buyerUsername ?? "" });
    setNoHandle(false);
    setPlatform(platformOf(r.contactPlatform));
    lookup.reset(); // editing a saved parcel: no lookup, no box
    setEditing({ id: r.id });
  };
  const cancelEdit = () => { setEditing(null); clearForm(); setSaveErr(false); };

  // "Scan QR" — same as 7-11: read the buyer @username off the printed sticker.
  const onScanQr = async (files: FileList | null) => {
    const file = files && files[0];
    if (qrRef.current) qrRef.current.value = "";
    if (!file) return;
    setQrBusy(true);
    try {
      const decoded = await decodeQrFromFile(file);
      const handle = decoded ? handleFromQrPayload(decoded) : null;
      if (handle) {
        F({ username: handle.slice(0, 50) }); setNoHandle(false); if (contactOn) setPlatform("tiktok"); flash(t.rd_ps2_qr_filled);
        if (lookupOn && !editing) lookup.scanned(handle.slice(0, 50)); // then look this username up in Customers
      }
      else flash(t.rd_ps2_qr_none);
    } catch { flash(t.rd_ps2_qr_none); }
    finally { if (aliveRef.current) setQrBusy(false); }
  };

  // ── Export (好賣+ 大量匯單). Ready = not exported and passes FamilyMart's rules. ─────────────
  const pending = rows.filter((r) => !r.exportedAt);
  const problemOf = (r: FmScanRow) => firstError(validateFmScan(rowInput(r), today));
  const readyRows = pending.filter((r) => !problemOf(r));
  const readyCount = readyRows.length;
  const exportedCount = rows.length - pending.length;

  // Builds and hands over the files right inside the tap (the phone share sheet needs it).
  // Parcels are marked exported ONLY after the files were really delivered.
  const runExport = () => {
    if (exportBusy || !readyCount) return;
    setExportErr(false); setAppFail(false); setAndroidSaved(false); setExportSummary(null); setUndoErr(false);
    const ready = readyRows;
    const attention = pending.filter((r) => problemOf(r)).map((r) => ({ name: r.recipientName || r.phone || "—", reason: problemOf(r)! }));
    const { files, nowMs } = buildFmExport(ready);
    const appShell = isAppShell();
    setExportBusy(true);
    void deliverFmFiles(files, appShell).then(async (d) => {
      if (!d.ok) {
        if (!d.cancelled && aliveRef.current) { if (appShell) setAppFail(true); else setExportErr(true); }
        return;
      }
      const at = new Date(nowMs).toISOString();
      const batch = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${nowMs}`;
      const ids = ready.map((x) => x.id);
      const marked = await markFmExported(ids, batch, at);
      if (!aliveRef.current) return;
      if (!marked) { setExportErr(true); return; }
      setRows((list) => list.map((x) => (ids.includes(x.id) ? { ...x, exportedAt: at, exportBatchId: batch } : x)));
      setLastExportBatch({ id: batch, ids });
      setExportSummary({ exported: ids.length, attention });
      if (!appShell && isAndroid()) setAndroidSaved(true); // blob download on an Android browser
      flash(tpl(t.rd_fms_exported_toast, { n: ids.length, f: files.length }), 6000);
    }).finally(() => { if (aliveRef.current) setExportBusy(false); });
  };

  const doUndo = async () => {
    const batch = lastExportBatch;
    setConfirm(null);
    if (!batch) return;
    if (!(await undoFmExport(batch.id))) { if (aliveRef.current) setUndoErr(true); return; }
    if (!aliveRef.current) return;
    setRows((list) => list.map((x) => (x.exportBatchId === batch.id ? { ...x, exportedAt: null, exportBatchId: null } : x)));
    setLastExportBatch(null); setExportSummary(null);
  };

  const doDelete = async () => {
    if (!confirm || deleting) return;
    setDeleting(true); setDeleteErr(false);
    if (confirm.kind === "row") {
      const id = confirm.id;
      const ok = await deleteFmScan(id);
      setDeleting(false);
      if (!ok) { setDeleteErr(true); return; }
      if (!aliveRef.current) return;
      setRows((prev) => prev.filter((x) => x.id !== id));
      if (editing?.id === id) cancelEdit();
    } else {
      const ok = await deleteFmExported();
      setDeleting(false);
      if (!ok) { setDeleteErr(true); return; }
      if (!aliveRef.current) return;
      setRows((prev) => prev.filter((x) => !x.exportedAt));
      setLastExportBatch(null);
    }
    setConfirm(null);
  };
  const ask = (c: Confirm) => { setDeleteErr(false); setConfirm(c); };

  const tabDefs: [Tab, string][] = [
    ["all", `${t.rd_ps2_tab_all} · ${rows.length}`],
    ["new", `${t.rd_fms_tab_new} · ${pending.length}`],
    ["done", `${t.rd_fms_tab_done} · ${exportedCount}`],
  ];
  const shown = tab === "new" ? pending : tab === "done" ? rows.filter((r) => r.exportedAt) : rows;
  const timeOf = (iso: string): string => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  };
  const portalRoot = (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body;
  const btnFull = (on: boolean): CSSProperties => ({ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: on ? "var(--accent)" : "var(--border-strong)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: on ? "pointer" : "default" });
  const btnGhost: CSSProperties = { flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, cursor: "pointer" };

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5 }} data-testid="fms-top">
        <div style={{ ...headerBar, position: "relative", ...(onBridge ? { paddingRight: 104 } : {}) }}>
          <HeaderWithBack onBack={onBack}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="sfl-anim-beat" style={headerTitle}>{t.rd_fms_title}</div>
            <StoreBadge store="fm" />
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_fms_sub}</div>
          </HeaderWithBack>
          {onBridge && <BridgeButton to="711" onClick={onBridge} />}
        </div>
        {/* Batch = parcels not exported yet / the account's limit (same look as the 7-11 Batch pill).
            No "All OK" / "need attention" here — FamilyMart store codes are not checked yet. */}
        {listOk && (
          <div style={{ padding: "8px 14px", background: "var(--app-bg)", borderBottom: "1px solid var(--border)" }} data-testid="fms-topbar">
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ flex: "0 1 50%", padding: "7px 10px", borderRadius: 9, border: `1px solid ${batchFull ? "var(--danger)" : "var(--border-strong)"}`, background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, minWidth: 0 }} data-testid="fms-batch" data-full={batchFull ? "1" : undefined}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.rd_ps2_batch}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: batchFull ? "var(--danger)" : "var(--text)", fontFamily: mono, flexShrink: 0 }} data-testid="fms-batch-n">{pendingCount} / {pendingCap}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: "16px 14px calc(28px + env(safe-area-inset-bottom))", display: "grid", gap: 12 }}>
        {toast && <div style={{ ...card, padding: 10, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--ok, #16a34a)" }} data-testid="fms-toast">{toast}</div>}

        {listLoaded && !listOk && (
          <div style={{ ...card, borderColor: "var(--danger)", background: "var(--danger-soft, rgba(220,38,38,.08))" }} data-testid="fms-load-err">
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger)" }}>{t.rd_fms_load_err}</div>
          </div>
        )}
        {listOk && batchFull && (
          <div style={{ ...card, borderColor: "var(--danger)", background: "var(--danger-soft, rgba(220,38,38,.08))" }} data-testid="fms-batch-full">
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger)" }}>{tpl(t.rd_ps2_batch_full, { max: String(pendingCap) })}</div>
          </div>
        )}

        {!editing && !manual && (
          <button onClick={openManual} disabled={newBlocked} style={{ justifySelf: "center", background: "none", border: "none", color: newBlocked ? "var(--text-muted)" : "var(--text-dim)", fontSize: 12, fontWeight: 700, textDecoration: "underline", cursor: newBlocked ? "default" : "pointer", opacity: newBlocked ? 0.55 : 1, padding: "2px 4px" }} data-testid="fms-manual">✏️ {t.rd_fms_add}</button>
        )}

        {(editing || manual) && (
          <div style={card} data-testid="fms-confirm" data-editing={editing ? "1" : undefined} data-manual={manual ? "1" : undefined}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{editing ? t.rd_ps2_edit_title : t.rd_ps2_manual_title}</div>
              {contactOn ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <button type="button" onClick={() => qrRef.current?.click()} disabled={qrBusy} style={{ padding: "6px 10px", borderRadius: 9, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: qrBusy ? 0.6 : 1 }} data-testid="fms-scan-qr">
                    {qrBusy ? t.rd_ps2_qr_reading : `▣ ${t.rd_ps2_scan_qr}`}
                  </button>
                  {manual && (
                    <button onClick={() => { if (!newBlocked) setCustOpen(true); }} disabled={newBlocked} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 9, border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--accent)", fontWeight: 800, fontSize: 12, cursor: newBlocked ? "default" : "pointer", opacity: newBlocked ? 0.55 : 1, whiteSpace: "nowrap" }} data-testid="fms-open-customers">📇 {t.rd_ps2_from_customers}</button>
                  )}
                </div>
              ) : manual && (
                <button onClick={() => { if (!newBlocked) setCustOpen(true); }} disabled={newBlocked} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 9, border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--accent)", fontWeight: 800, fontSize: 12, cursor: newBlocked ? "default" : "pointer", opacity: newBlocked ? 0.55 : 1, whiteSpace: "nowrap" }} data-testid="fms-open-customers">📇 {t.rd_ps2_from_customers}</button>
              )}
            </div>
            {lookupOn && !editing && <ScanQrLookupBox view={lookup.view} onPick={lookup.pick} onDismiss={lookup.dismiss} testId="fms-ql" />}
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={lbl}>{t.rd_ps2_name}</label>
                <input value={form.name} onChange={(e) => F({ name: e.target.value })} style={input} data-testid="fms-name" />
                {showErr(form.name, errs.recipientName)}
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={lbl}>{t.rd_ps2_phone}</label>
                  <input value={form.phone} onChange={(e) => F({ phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) })} inputMode="numeric" placeholder="09xxxxxxxx" style={{ ...input, fontFamily: mono }} data-testid="fms-phone" />
                  {showErr(form.phone, errs.phone)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={lbl}>{t.rd_fms_store}</label>
                  <input value={form.store} onChange={(e) => F({ store: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })} inputMode="numeric" placeholder="022131" style={{ ...input, fontFamily: mono }} data-testid="fms-store" />
                  {showErr(form.store, errs.storeId)}
                </div>
              </div>
              <div>
                <label style={lbl}>{t.rd_ps2_amount} ({cur})</label>
                <input ref={amountRef} value={form.amount} onChange={(e) => F({ amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="numeric" style={{ ...input, fontFamily: mono }} data-testid="fms-amount" />
                {showErr(form.amount, errs.amount ?? errs.total)}
              </div>
              {contactOn ? (
                <div>
                  <input ref={qrRef} type="file" accept="image/*" hidden data-testid="fms-qr-file" onChange={(e) => void onScanQr(e.target.files)} />
                  <BuyerContactField platform={platform} onPlatform={setPlatform} value={form.username} onValue={(v) => F({ username: v })}
                    noContact={noHandle} onNoContact={(on) => { setNoHandle(on); if (on) F({ username: "" }); }}
                    invalid={handleBad && !isEmpty} testId="fms-bc" inputId="fms-handle" />
                </div>
              ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }} htmlFor="fms-handle">{t.rd_ps2_handle}</label>
                  <button type="button" onClick={() => qrRef.current?.click()} disabled={qrBusy} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 700, cursor: qrBusy ? "default" : "pointer", whiteSpace: "nowrap", opacity: qrBusy ? 0.6 : 1 }} data-testid="fms-scan-qr">
                    {qrBusy ? t.rd_ps2_qr_reading : `▣ ${t.rd_ps2_scan_qr}`}
                  </button>
                </div>
                <input ref={qrRef} type="file" accept="image/*" hidden data-testid="fms-qr-file" onChange={(e) => void onScanQr(e.target.files)} />
                <input id="fms-handle" value={form.username}
                  onChange={(e) => { const v = e.target.value.slice(0, 50); F({ username: v }); if (v.trim() !== "" && noHandle) setNoHandle(false); }}
                  maxLength={50} placeholder="@username" style={{ ...input, ...(noHandle ? { opacity: 0.5 } : {}) }} data-testid="fms-username" aria-invalid={handleBad && !isEmpty} />
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>{t.rd_ps2_handle_hint}</div>
                {handleBad && !isEmpty && <div style={errTxt} data-testid="fms-handle-err">{t.rd_ps2_err_handle}</div>}
                <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, cursor: "pointer", fontSize: 12, color: "var(--text-dim)" }}>
                  <input type="checkbox" checked={noHandle} onChange={(e) => { const on = e.target.checked; setNoHandle(on); if (on) F({ username: "" }); }} data-testid="fms-no-handle" />
                  {t.rd_ps2_no_handle}
                </label>
              </div>
              )}
              {saveErr && <div style={errTxt} data-testid="fms-save-err">{t.rd_ps2_err_save}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button onClick={() => void (editing ? onEditSave() : onManualSave())} disabled={saveBlocked} style={{ ...btnFull(!saveBlocked), flex: 2 }} data-testid="fms-save">{t.rd_ps2_save}</button>
                {editing
                  ? <button onClick={cancelEdit} style={btnGhost} data-testid="fms-edit-cancel">{t.rd_ps2_cancel}</button>
                  : <button onClick={cancelManual} style={btnGhost} data-testid="fms-manual-cancel">{manualCount > 0 ? t.rd_ps2_done : t.rd_ps2_cancel}</button>}
              </div>
            </div>
          </div>
        )}

        {onMobile && (
          <div style={{ ...card, display: "flex", alignItems: "center", gap: 12 }} data-testid="fms-export-switch">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{t.rd_ps2_phx_switch}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.45 }}>{t.rd_ps2_phx_switch_sub}</div>
            </div>
            <button aria-pressed={phoneExport} data-testid="fms-export-switch-toggle"
              onClick={() => { if (phoneExport) disablePhoneExport(); else setConfirm({ kind: "enablephone" }); }}
              style={{ width: 52, height: 30, borderRadius: 15, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", background: phoneExport ? "var(--accent)" : "var(--surface-2)", boxShadow: phoneExport ? "0 3px 10px var(--accent-soft)" : "inset 0 0 0 1px var(--border-strong)", transition: "background .15s" }}>
              <span style={{ position: "absolute", top: 3, left: phoneExport ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)", transition: "left .15s" }} />
            </button>
          </div>
        )}

        {!exportHidden && (
          <div style={card} data-testid="fms-export-card">
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>{t.rd_fms_x_title}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 9, lineHeight: 1.5 }}>{t.rd_fms_x_hint}</div>
            <button onClick={() => ask({ kind: "export" })} disabled={exportBusy || readyCount === 0}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "none", background: exportBusy || readyCount === 0 ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: exportBusy || readyCount === 0 ? "default" : "pointer" }}
              data-testid="fms-export-btn">📄 {exportBusy ? t.rd_ps2_x_exporting : tpl(t.rd_ps2_x_button, { n: String(readyCount) })}</button>
            {exportErr && <div style={{ ...errTxt, marginTop: 8 }} data-testid="fms-export-err">{t.rd_ps2_x_failed}</div>}
            {appFail && <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--danger)", background: "var(--danger-soft, rgba(225,29,72,.1))", border: "1px solid var(--danger)", borderRadius: 10, padding: "9px 11px", marginTop: 8, lineHeight: 1.5 }} data-testid="fms-export-appfail">{isAndroid() ? t.rd_ps2_x_app_fail_android : t.rd_ps2_x_app_fail}</div>}
            {androidSaved && <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ok, #16a34a)", marginTop: 8, lineHeight: 1.5 }} data-testid="fms-export-saved">{t.rd_ps2_x_saved_android_fm}</div>}
            {lastExportBatch && (
              <button onClick={() => { setUndoErr(false); ask({ kind: "undo" }); }} style={{ width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, fontSize: 13, cursor: "pointer" }} data-testid="fms-undo-btn">↩ {tpl(t.rd_ps2_undo_btn, { n: String(lastExportBatch.ids.length) })}</button>
            )}
            {undoErr && <div style={{ ...errTxt, marginTop: 8 }} data-testid="fms-undo-err">{t.rd_ps2_undo_failed}</div>}
            {exportSummary && (
              <div style={{ marginTop: 10 }} data-testid="fms-export-summary">
                <div style={{ fontSize: 12, fontWeight: 800, color: exportSummary.exported > 0 ? "var(--ok, #16a34a)" : "var(--text-dim)" }}>
                  {tpl(t.rd_ps2_x_result, { x: String(exportSummary.exported), y: String(exportSummary.attention.length) })}
                </div>
                {exportSummary.attention.length > 0 && (
                  <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                    {exportSummary.attention.map((a, i) => (
                      <div key={i} style={{ fontSize: 11, color: "var(--danger)", display: "flex", justifyContent: "space-between", gap: 8 }} data-testid="fms-export-attn-row">
                        <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                        <span style={{ flexShrink: 0 }}>{t[FM_ERROR_KEY[a.reason]]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={card} data-testid="fms-saved-list">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>{t.rd_ps2_saved} {rows.length > 0 && <span style={{ color: "var(--text-dim)", fontWeight: 700 }}>· {rows.length}</span>}</div>
            {exportedCount > 0 && (
              <button onClick={() => ask({ kind: "exported" })} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 10.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }} data-testid="fms-clear-exported">🗑 {t.rd_ps2_clear_exported}</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }} data-testid="fms-tabs">
            {tabDefs.map(([key, label]) => {
              const on = tab === key;
              return (
                <button key={key} onClick={() => setTab(key)} aria-pressed={on} data-testid={`fms-tab-${key}`}
                  style={{ flex: 1, minWidth: 78, padding: "7px 8px", borderRadius: 9, border: on ? "1px solid var(--accent)" : "1px solid var(--border-strong)", background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "#fff" : "var(--text-dim)", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>{label}</button>
              );
            })}
          </div>
          {listLoaded && shown.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }} data-testid="fms-empty">{t.rd_fms_empty}</div>}
          {shown.map((r) => {
            const problem = r.exportedAt ? undefined : problemOf(r);
            return (
              <div key={r.id} data-testid="fms-row" data-row-id={r.id} data-flag={problem ? "red" : ""}
                style={{ padding: problem ? "9px 8px" : "9px 2px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", ...(problem ? { border: "1.5px solid var(--danger, #dc2626)", borderRadius: 10, boxShadow: "0 0 6px -1px var(--danger, #dc2626)", margin: "4px 0" } : {}) }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.recipientName || "—"}
                    {r.exportedAt && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: "var(--ok, #16a34a)", border: "1px solid var(--ok, #16a34a)", borderRadius: 6, padding: "0 5px", verticalAlign: "middle" }} data-testid="fms-exported-tag">{t.rd_ps2_x_tag}</span>}
                    {!(r.buyerUsername && r.buyerUsername.trim()) && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: "var(--text-muted)", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "0 5px", verticalAlign: "middle" }} data-testid="fms-no-handle-chip">{t.rd_ps2_no_handle_chip}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: mono }}>{[r.phone, r.storeId].filter(Boolean).join(" · ") || "—"}</div>
                  {problem && <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 3, color: "var(--danger)" }} data-testid="fms-row-problem">{t[FM_ERROR_KEY[problem]]}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, fontFamily: mono }}>{`${cur}${r.amount.toLocaleString()}`}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{timeOf(r.createdAt)}</div>
                  </div>
                  {!r.exportedAt && <button onClick={() => openEdit(r)} aria-label={t.rd_ps2_edit_aria} style={rowBtn} data-testid="fms-row-edit">✏️</button>}
                  <button onClick={() => ask({ kind: "row", id: r.id })} aria-label={t.rd_ps2_delete_aria} style={rowBtn} data-testid="fms-row-delete">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirm && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="fms-confirm-overlay" onClick={() => { if (!deleting) setConfirm(null); }}>
          <div style={{ width: "100%", maxWidth: 440, maxHeight: "100%", overflowY: "auto", background: "var(--surface)", borderRadius: 18, padding: "22px 20px 20px", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.5, color: "var(--text)" }} data-testid="fms-confirm-msg">
              {confirm.kind === "enablephone"
                ? <>
                    <div>{t.rd_ps2_phx_title}</div>
                    <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.55 }}>{t.rd_fms_phx_body}</div>
                  </>
                : confirm.kind === "export" ? tpl(t.rd_ps2_x_confirm_q, { n: String(readyCount) })
                  : confirm.kind === "undo" ? tpl(t.rd_ps2_undo_q, { n: String(lastExportBatch?.ids.length ?? 0) })
                    : confirm.kind === "exported" ? tpl(t.rd_ps2_clear_exported_q, { n: String(exportedCount) })
                      : t.rd_ps2_delete_row_q}
            </div>
            {deleteErr && <div style={{ ...errTxt, marginTop: 10 }} data-testid="fms-delete-err">{t.rd_ps2_delete_err}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirm(null)} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: deleting ? "default" : "pointer" }} data-testid="fms-confirm-cancel">{t.rd_ps2_cancel}</button>
              {confirm.kind === "enablephone"
                ? <button onClick={enablePhoneExport} style={btnFull(true)} data-testid="fms-confirm-enablephone">{t.rd_ps2_phx_go}</button>
                : confirm.kind === "export"
                  // No await before the files are handed over — the phone share sheet keeps the tap.
                  ? <button onClick={() => { setConfirm(null); runExport(); }} style={btnFull(true)} data-testid="fms-confirm-export">📄 {t.rd_ps2_x_confirm_go}</button>
                  : confirm.kind === "undo"
                    ? <button onClick={() => void doUndo()} style={btnFull(true)} data-testid="fms-confirm-undo">↩ {t.rd_ps2_undo_go}</button>
                    : <button onClick={() => void doDelete()} disabled={deleting} style={{ ...btnFull(true), background: "var(--danger)", opacity: deleting ? 0.7 : 1, cursor: deleting ? "default" : "pointer" }} data-testid="fms-confirm-delete">{t.rd_ps2_delete}</button>}
            </div>
          </div>
        </div>,
        portalRoot,
      )}

      {custOpen && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(12px + env(safe-area-inset-top)) 10px calc(12px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="fms-customers-overlay" onClick={() => setCustOpen(false)}>
          <div style={{ position: "relative", width: "100%", maxWidth: 480, maxHeight: "100%", overflowY: "auto", background: "var(--surface)", borderRadius: 18, boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setCustOpen(false)} aria-label={t.rd_cd_close}
              style={{ position: "absolute", top: 10, right: 10, zIndex: 6, width: 32, height: 32, borderRadius: 8, border: "none", background: "rgba(0,0,0,.28)", color: "#fff", fontSize: 17, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}
              data-testid="fms-customers-close">✕</button>
            <FmCustomerDetails cur={cur} fee={fee} contactOn={contactOn} onImported={() => { setCustOpen(false); lookup.reset({ blankUntouched: true }); reloadSaved(); }} />
          </div>
        </div>,
        portalRoot,
      )}
    </div>
  );
}
