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
  checkEmapStore, saveStoreCheck,
  type ScanFields, type ScanConfidence, type ParcelScanRow, type ScanFormState, type StoreCheckStatus,
} from "../adapters/parcelScan";

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

export default function ParcelScan({ cur = "NT$" }: { cur?: string }) {
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

  // Saved list — ONE read on screen open; saves append locally (no refetch).
  const [rows, setRows] = useState<ParcelScanRow[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  // Alive across the whole screen — guards fire-and-forget store-check verdicts
  // (runStoreCheck) that can land after unmount, not just the initial load.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => {
    loadParcelScans().then((r) => { if (aliveRef.current) { if (r.ok) setRows(r.rows); setListLoaded(true); } });
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

  const errs = formErrors(form);
  const saveBlocked = saving || errs.empty || errs.name || errs.phone || errs.store;
  const low = (f: keyof ScanFields): boolean => confid?.[f] === "low";
  const F = (patch: Partial<FormState>) => setForm((s) => ({ ...s, ...patch }));
  const busy = phase === "scanning" || phase === "confirm" || phase === "error";
  const flaggedCount = rows.filter((r) => r.storeCheckStatus === "not_found").length;
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

        {/* Saved list — read-on-open snapshot + local appends. Full queue = A2. */}
        <div style={card}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>{t.rd_ps2_saved} {rows.length > 0 && <span style={{ color: "var(--text-dim)", fontWeight: 700 }}>· {rows.length}</span>}</div>
          {listLoaded && rows.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }} data-testid="ps-empty">{t.rd_ps2_empty}</div>}
          {rows.map((r) => {
            const badge = storeBadge(r.storeCheckStatus);
            const canRecheck = !r.id.startsWith("local-") && /^\d{6}$/.test(r.storeId) && (r.storeCheckStatus === "not_found" || r.storeCheckStatus === "unknown");
            return (
              <div key={r.id} style={{ padding: "9px 2px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }} data-testid="ps-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.customerName || "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: mono }}>{[r.phone, r.storeId].filter(Boolean).join(" · ") || "—"}</div>
                  {badge && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 3, color: badge.color }} data-testid="ps-store-badge" data-status={r.storeCheckStatus || ""}>
                      {badge.icon} {t[badge.key]}
                      {canRecheck && <button onClick={() => runStoreCheck(r.id, r.storeId)} style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 10, fontWeight: 700, cursor: "pointer" }} data-testid="ps-recheck">{t.rd_ps2_recheck}</button>}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, fontFamily: mono }}>{r.amount !== null ? `${cur}${r.amount.toLocaleString()}` : "—"}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{timeOf(r.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
