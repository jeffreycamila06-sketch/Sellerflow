// Parcel Scan FamilyMart (全家) — type each parcel, export the 好賣+ 大量匯單 .xlsx (sql/120).
// Reached only from the FamilyMart tile when fm_scan_enabled (or the fm_pickup preview) is on.
// Read on open + write on action only (zero poll).
import { useEffect, useMemo, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { headerBar, headerTitle, card } from "../ui";
import { useT, tpl } from "../i18n";
import { taipeiDayId } from "../../lib/dateHelpers";
import { isAppShell } from "../adapters/appShell";
import {
  FM_SCAN_DEFAULT_FEE, type FmScanError, type FmScanField, type FmScanInput, type FmScanRow,
  buildFmExport, deleteFmScan, deliverFmFiles, loadFmFee, loadFmScans, markFmExported,
  saveFmFee, saveFmScan, validateFmScan,
} from "../adapters/fmScan";

type T = ReturnType<typeof useT>;
const input: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 11px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2, var(--surface))", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-ui)" };
const label: CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--text-dim)", marginBottom: 4, display: "block" };
const errText: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const btn: CSSProperties = { padding: "10px 14px", borderRadius: 11, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" };
const primary: CSSProperties = { ...btn, background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--accent-text)" };
const ghost: CSSProperties = { ...btn, background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text)" };

function errorText(e: FmScanError, t: T): string {
  switch (e) {
    case "name_required": return t.rd_fms_e_name_required;
    case "name_long": return t.rd_fms_e_name_long;
    case "phone": return t.rd_fms_e_phone;
    case "store": return t.rd_fms_e_store;
    case "amount": return t.rd_fms_e_amount;
    case "fee": return t.rd_fms_e_fee;
    case "total": return t.rd_fms_e_total;
    case "date": return t.rd_fms_e_date;
    default: return t.rd_fms_e_username_long;
  }
}

const blank = (fee: number, today: string): FmScanInput => ({ recipientName: "", phone: "", storeId: "", amount: "", shippingFee: String(fee), orderDate: today, buyerUsername: "" });
const rowToInput = (r: FmScanRow): FmScanInput => ({
  recipientName: r.recipientName, phone: r.phone, storeId: r.storeId, amount: String(r.amount), shippingFee: String(r.shippingFee),
  orderDate: r.orderDate, buyerUsername: r.buyerUsername ?? "",
});

export default function FmParcelScan({ cur = "NT$" }: { cur?: string }) {
  const t = useT();
  const today = taipeiDayId();
  const [rows, setRows] = useState<FmScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fee, setFee] = useState(FM_SCAN_DEFAULT_FEE);
  const [feeDraft, setFeeDraft] = useState(String(FM_SCAN_DEFAULT_FEE));
  const [form, setForm] = useState<FmScanInput>(() => blank(FM_SCAN_DEFAULT_FEE, today));
  const [editId, setEditId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"new" | "done">("new");
  const [toast, setToast] = useState("");
  const show = (m: string, ms = 4000) => { setToast(m); setTimeout(() => setToast(""), ms); };

  useEffect(() => {
    let live = true;
    void Promise.all([loadFmScans(), loadFmFee()]).then(([res, f]) => {
      if (!live) return;
      if (res.ok) setRows(res.rows);
      setFee(f); setFeeDraft(String(f));
      setForm((x) => (x.amount || x.recipientName ? x : { ...x, shippingFee: String(f) }));
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const errors = validateFmScan(form, today);
  const hasErrors = Object.keys(errors).length > 0;
  const set = (k: keyof FmScanInput) => (e: { target: { value: string } }) => setForm((x) => ({ ...x, [k]: e.target.value }));
  const fieldErr = (k: FmScanField) => (touched && errors[k] ? <div style={errText} data-testid={`fms-err-${k}`}>{errorText(errors[k]!, t)}</div> : null);

  const onSave = async () => {
    setTouched(true);
    if (hasErrors || saving) return;
    setSaving(true);
    const res = await saveFmScan(form, editId ?? undefined);
    setSaving(false);
    if (!res.ok || !res.row) { show(t.rd_fms_err_save); return; }
    setRows((list) => (editId ? list.map((r) => (r.id === editId ? res.row! : r)) : [res.row!, ...list]));
    setEditId(null); setTouched(false);
    setForm(blank(fee, today));
  };
  const onEdit = (r: FmScanRow) => { setEditId(r.id); setTouched(true); setForm(rowToInput(r)); };
  const onCancel = () => { setEditId(null); setTouched(false); setForm(blank(fee, today)); };
  const onDelete = async (r: FmScanRow) => {
    if (!(await deleteFmScan(r.id))) { show(t.rd_fms_err_save); return; }
    setRows((list) => list.filter((x) => x.id !== r.id));
    if (editId === r.id) onCancel();
  };
  const onSaveFee = async () => {
    const n = Number(feeDraft);
    if (!(feeDraft.trim() !== "" && n >= 0 && n <= 200)) return;
    if (!(await saveFmFee(n))) { show(t.rd_fms_err_save); return; }
    setFee(n); show(t.rd_fms_saved, 1500);
    if (!editId && !form.amount && !form.recipientName) setForm((x) => ({ ...x, shippingFee: String(n) }));
  };

  const shown = useMemo(() => rows.filter((r) => (tab === "new" ? !r.exportedAt : !!r.exportedAt)), [rows, tab]);
  const total = shown.reduce((s, r) => s + r.amount + r.shippingFee, 0);
  const ready = shown.filter((r) => Object.keys(validateFmScan(rowToInput(r), today)).length === 0);
  const skipped = shown.length - ready.length;

  // Builds the files right here (no await) so the phone share sheet keeps the tap.
  const onExport = () => {
    if (!ready.length) { if (skipped) show(tpl(t.rd_fms_skipped, { n: skipped }), 5000); return; }
    const { files, nowMs: now } = buildFmExport(ready);
    void deliverFmFiles(files, isAppShell()).then(async (r) => {
      if (!r.ok) { if (!r.cancelled) show(t.rd_fms_err_export); return; }
      const at = new Date(now).toISOString();
      const batch = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${now}`;
      const ids = ready.map((x) => x.id);
      if (await markFmExported(ids, batch, at)) {
        setRows((list) => list.map((x) => (ids.includes(x.id) ? { ...x, exportedAt: at, exportBatchId: batch } : x)));
      }
      const msg = tpl(t.rd_fms_exported_toast, { n: ready.length, f: files.length });
      show(skipped ? `${msg} ${tpl(t.rd_fms_skipped, { n: skipped })}` : msg, 6000);
    });
  };

  const field = (k: keyof FmScanInput & FmScanField, text: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div>
      <label style={label}>{text}</label>
      <input style={input} value={form[k]} onChange={set(k)} data-testid={`fms-${k}`} {...extra} />
      {fieldErr(k)}
    </div>
  );

  return (
    <div>
      <div style={headerBar} data-hb-top>
        <div style={headerTitle}>{t.rd_fms_title}</div>
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>{t.rd_fms_sub}</div>
      </div>
      <div style={{ padding: 16, maxWidth: 620, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ ...card, display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={label}>{t.rd_fms_default_fee}</label>
            <input style={input} inputMode="numeric" value={feeDraft} onChange={(e) => setFeeDraft(e.target.value)} data-testid="fms-default-fee" />
          </div>
          <button style={ghost} onClick={() => void onSaveFee()} data-testid="fms-save-fee">{t.rd_fms_save}</button>
        </div>

        <div style={{ ...card, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} data-testid="fms-form">
          <div style={{ gridColumn: "1 / -1" }}>{field("recipientName", t.rd_fms_name)}</div>
          {field("phone", t.rd_fms_phone, { inputMode: "numeric", placeholder: "09xxxxxxxx" })}
          {field("storeId", t.rd_fms_store, { inputMode: "numeric", placeholder: "022131" })}
          {field("amount", `${t.rd_fms_amount} (${cur})`, { inputMode: "numeric" })}
          {field("shippingFee", `${t.rd_fms_fee} (${cur})`, { inputMode: "numeric" })}
          {touched && errors.total && <div style={{ ...errText, gridColumn: "1 / -1", marginTop: -4 }} data-testid="fms-err-total">{errorText(errors.total, t)}</div>}
          {field("orderDate", t.rd_fms_date, { type: "date", max: today })}
          {field("buyerUsername", t.rd_fms_username, { placeholder: "@username" })}
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button style={{ ...primary, flex: 1, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => void onSave()} data-testid="fms-save">{editId ? t.rd_fms_update : t.rd_fms_add}</button>
            {editId && <button style={ghost} onClick={onCancel} data-testid="fms-cancel">{t.rd_fms_cancel}</button>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {(["new", "done"] as const).map((x) => (
            <button key={x} onClick={() => setTab(x)} aria-pressed={tab === x} data-testid={`fms-tab-${x}`}
              style={{ ...btn, padding: "7px 12px", fontSize: 12.5, background: tab === x ? "var(--accent-soft)" : "transparent", color: tab === x ? "var(--accent-fg)" : "var(--text-dim)", border: "1px solid var(--border)" }}>
              {x === "new" ? t.rd_fms_tab_new : t.rd_fms_tab_done}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-dim)" }} data-testid="fms-summary">{tpl(t.rd_fms_summary, { n: shown.length, total: `${cur}${total}` })}</div>
          <button style={{ ...primary, opacity: ready.length ? 1 : 0.5 }} disabled={!ready.length} onClick={onExport} data-testid="fms-export">{tpl(t.rd_fms_export, { n: ready.length })}</button>
        </div>

        {!loading && !shown.length && <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }} data-testid="fms-empty">{t.rd_fms_empty}</div>}
        {shown.map((r) => {
          const bad = Object.keys(validateFmScan(rowToInput(r), today)).length > 0;
          return (
            <div key={r.id} style={{ ...card, padding: "11px 13px", display: "flex", gap: 10, alignItems: "center", ...(bad ? { borderColor: "var(--danger)" } : {}) }} data-testid="fms-row">
              <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: "var(--text)" }}>{r.recipientName} · {r.phone}</div>
                <div style={{ color: "var(--text-dim)", marginTop: 2 }}>{r.storeId} · {cur}{r.amount} + {cur}{r.shippingFee} · {r.orderDate.replace(/-/g, "/")}{r.buyerUsername ? ` · ${r.buyerUsername}` : ""}</div>
                {r.exportedAt && <span style={{ display: "inline-block", marginTop: 4, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--border-strong)", fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)" }}>{t.rd_fms_exported_chip}</span>}
              </div>
              <button style={{ ...ghost, padding: "6px 10px", fontSize: 12 }} onClick={() => onEdit(r)} data-testid="fms-edit">{t.rd_fms_edit}</button>
              <button style={{ ...ghost, padding: "6px 10px", fontSize: 12, color: "var(--danger)" }} onClick={() => void onDelete(r)} data-testid="fms-delete">{t.rd_fms_delete}</button>
            </div>
          );
        })}
      </div>
      {toast && <div role="status" data-testid="fms-toast" style={{ position: "fixed", left: 16, right: 16, bottom: 90, margin: "0 auto", maxWidth: 520, padding: "11px 14px", borderRadius: 12, background: "var(--text)", color: "var(--surface)", fontSize: 13, fontWeight: 600, textAlign: "center", zIndex: 50 }}>{toast}</div>}
    </div>
  );
}
