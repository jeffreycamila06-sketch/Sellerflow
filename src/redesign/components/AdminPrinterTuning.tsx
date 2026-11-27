// Admin → Manage sellers → a seller → "Printer tuning" (sql/230). ONE seller's own printer settings:
// the printer they last tested, quick-fix chips (each shows its change before Save), advanced settings
// (clamped like the database), the change history with Undo, "Reset to model" and "Save for this seller"
// (version-checked: someone else saved first → reload + say so). Every question is asked inside the page.
// A built-in printer (AIMO D520BT, Flash Y41BT, Xprinter XP-420B, Niimbot B1 / B1 Pro …) can't be tuned:
// the controls are off and the database refuses too. Admin only — sellers never see any of this.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT, tpl } from "../i18n";
import { approvedLayoutFor } from "../adapters/printerModels";
import { clampTuningNumber, TUNING_RANGE, type PrinterTuning, type Sensor } from "../adapters/printerTuning";
import {
  adminGetTuning, adminResetTuning, adminSetTuning, adminUndoTuning, tuningDiff, tuningFieldValue,
  type AdminTuning, type TuningField,
} from "../adapters/printerTuningAdmin";
import { CHIP_IDS, chipProposal, GENERIC_DEFAULTS, type ChipId, type ModelDefaults } from "../adapters/printerTuningChips";

const btn: CSSProperties = { minHeight: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" };
const solid: CSSProperties = { ...btn, border: "none", background: "var(--accent)", color: "var(--accent-text)" };
const danger: CSSProperties = { ...btn, border: "1px solid var(--danger)", color: "var(--danger)" };
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "11px 12px" };
const pill: CSSProperties = { fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap" };
const h: CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--text)", margin: "16px 0 7px", textTransform: "uppercase", letterSpacing: ".04em" };
const small: CSSProperties = { fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.45 };
const off = (on: boolean): CSSProperties => (on ? {} : { opacity: 0.45, cursor: "not-allowed" });

const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" });
};

const FIELD_KEY: Record<TuningField, string> = { sensor: "rd_ptu_f_sensor", gapMm: "rd_ptu_f_gap", shiftMm: "rd_ptu_f_shift", flip: "rd_ptu_f_flip", density: "rd_ptu_f_density", speed: "rd_ptu_f_speed", sendSpeed: "rd_ptu_f_send" };
const CHIP_KEY: Record<ChipId, string> = { blank_labels: "rd_ptu_c_blank", cut_edge: "rd_ptu_c_edge", upside_down: "rd_ptu_c_flip", light_dark: "rd_ptu_c_light", stops: "rd_ptu_c_stops", garbled: "rd_ptu_c_garbled" };

function Stepper({ id, label, value, model, onChange, enabled, k }: { id: string; label: string; value: number | undefined; model: string; onChange: (v: number | undefined) => void; enabled: boolean; k: keyof typeof TUNING_RANGE }) {
  const r = TUNING_RANGE[k];
  const base = value ?? (k === "gapMm" ? GENERIC_DEFAULTS.gapMm : k === "density" ? GENERIC_DEFAULTS.density : k === "speed" ? GENERIC_DEFAULTS.speed : 0);
  const step = (d: number) => onChange(clampTuningNumber(k, base + d * r.step));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 48 }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</div>
      <button data-testid={`${id}-minus`} aria-label={`${label} −`} disabled={!enabled} onClick={() => step(-1)} style={{ ...btn, width: 44, padding: 0, ...off(enabled) }}>−</button>
      <div data-testid={`${id}-value`} style={{ minWidth: 64, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: value === undefined ? "var(--text-muted)" : "var(--text)" }}>{value === undefined ? model : value}</div>
      <button data-testid={`${id}-plus`} aria-label={`${label} +`} disabled={!enabled} onClick={() => step(1)} style={{ ...btn, width: 44, padding: 0, ...off(enabled) }}>+</button>
      <button data-testid={`${id}-clear`} aria-label={`${label} ×`} disabled={!enabled || value === undefined} onClick={() => onChange(undefined)} style={{ ...btn, width: 44, padding: 0, ...off(enabled && value !== undefined) }}>×</button>
    </div>
  );
}

type Ask = null | "save" | "undo" | "reset";
export default function AdminPrinterTuning({ email, onClose, onToast }: { email: string; onClose: () => void; onToast?: (m: string, k: "ok" | "err") => void }) {
  const t = useT() as unknown as Record<string, string>;
  const [data, setData] = useState<AdminTuning | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<PrinterTuning>({});
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [lightOpen, setLightOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);

  const apply = useCallback((r: Awaited<ReturnType<typeof adminGetTuning>>, keepNote: boolean) => {
    setLoadErr(!r.ok);
    if (!r.ok) return;
    setData(r.data); setDraft({ ...(r.data.tuning ?? {}) }); setAsk(null);
    if (!keepNote) setNote(null);
  }, []);
  const load = useCallback(async (keepNote = false) => { apply(await adminGetTuning(email), keepNote); }, [email, apply]);
  useEffect(() => {
    let live = true;
    void adminGetTuning(email).then((r) => { if (live) apply(r, false); });
    return () => { live = false; };
  }, [email, apply]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const saved = data?.tuning ?? null;
  const builtIn = data?.builtIn === true;
  const canEdit = !!data && !builtIn && !busy;
  const layout = approvedLayoutFor(data?.printerName);
  const model: ModelDefaults = { ...GENERIC_DEFAULTS, shiftMm: layout.shiftDots / 8, flip: layout.flip };
  const cleanDraft: PrinterTuning | null = Object.keys(draft).length ? draft : null;
  const changes = tuningDiff(saved, cleanDraft);
  const lastReport = data?.reports[0];
  const needsTester = !!data && !data.switchOn && !data.tester;
  const canUndo = !!data && data.history.some((x) => !x.undone && x.action !== "undo");

  const setField = <F extends TuningField>(f: F, v: PrinterTuning[F] | undefined) => setDraft((d) => { const n = { ...d }; if (v === undefined) delete n[f]; else n[f] = v; return n; });
  const applyChip = (id: ChipId, darker = true) => { if (canEdit) setDraft((d) => chipProposal(id, Object.keys(d).length ? d : null, model, darker)); };
  const fail = async (code: string | undefined) => {
    if (code === "stale_version") { await load(true); setNote({ text: t.rd_ptu_stale, kind: "err" }); return; }
    setNote({ text: code === "built_in_printer" ? t.rd_ptu_builtin_err : code === "not_tester" ? t.rd_ptu_not_tester : t.rd_ptu_err, kind: "err" });
  };
  const doSave = async () => {
    if (!data) return;
    setBusy(true);
    const r = cleanDraft ? await adminSetTuning(email, cleanDraft, data.version) : await adminResetTuning(email, data.version);
    setBusy(false); setAsk(null);
    if (!r.ok) return fail(r.code);
    await load(true); setNote({ text: t.rd_ptu_saved, kind: "ok" }); onToast?.(t.rd_ptu_saved, "ok");
  };
  const doUndo = async () => {
    if (!data) return;
    setBusy(true);
    const r = await adminUndoTuning(email, data.version);
    setBusy(false); setAsk(null);
    if (!r.ok) return fail(r.code);
    await load(true); setNote({ text: r.data === -1 ? t.rd_ptu_nothing_undo : t.rd_ptu_undone, kind: "ok" });
  };
  const doReset = async () => {
    if (!data) return;
    setBusy(true);
    const r = await adminResetTuning(email, data.version);
    setBusy(false); setAsk(null);
    if (!r.ok) return fail(r.code);
    await load(true); setNote({ text: t.rd_ptu_reset_done, kind: "ok" });
  };

  const confirm = (q: string, yes: string, go: () => void, testid: string): ReactNode => (
    <div data-testid={testid} role="alertdialog" style={{ ...card, marginTop: 10, borderColor: "var(--accent)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.45, overflowWrap: "anywhere" }}>{q}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
        <button data-testid={`${testid}-yes`} disabled={busy} onClick={go} style={{ ...solid, ...off(!busy) }}>{busy ? t.rd_ptu_saving : yes}</button>
        <button data-testid={`${testid}-no`} disabled={busy} onClick={() => setAsk(null)} style={btn}>{t.rd_ptu_cancel}</button>
      </div>
    </div>
  );

  const body = (
    <div data-testid="ptu-sheet" role="dialog" aria-modal="true" aria-label={t.rd_ptu_title} style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,.45)", display: "flex", justifyContent: "center", alignItems: "stretch" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: "var(--surface)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(12px + env(safe-area-inset-top)) 14px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--text)" }}>{t.rd_ptu_title}</div>
            <div data-testid="ptu-email" style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div>
          </div>
          <button data-testid="ptu-close" aria-label={t.rd_ptu_close} onClick={onClose} style={{ ...btn, width: 44, padding: 0, fontSize: 18 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px calc(18px + env(safe-area-inset-bottom))" }}>
          <div data-testid="ptu-only-this" style={{ ...small, fontWeight: 700, color: "var(--text)" }}>{t.rd_ptu_only_this}</div>
          {loadErr && (
            <div data-testid="ptu-load-err" style={{ ...card, marginTop: 12, borderColor: "var(--danger)" }}>
              <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{t.rd_ptu_load_err}</div>
              <button data-testid="ptu-retry" onClick={() => void load()} style={{ ...btn, marginTop: 8 }}>{t.rd_ptu_retry}</button>
            </div>
          )}
          {!data && !loadErr && <div data-testid="ptu-loading" style={{ ...small, marginTop: 12 }}>{t.rd_ptu_loading}</div>}
          {data && (<>
            <div data-testid="ptu-printer" style={{ ...card, marginTop: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <div data-testid="ptu-printer-name" style={{ flex: "1 1 160px", minWidth: 0, fontSize: 14, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}>{data.printerName || t.rd_ptu_no_printer}</div>
                {data.lockedName && <span data-testid="ptu-locked" style={{ ...pill, color: "#fff", background: "#047857" }}>{tpl(t.rd_ptu_locked, { model: data.lockedName })}</span>}
                {builtIn && <span data-testid="ptu-builtin" style={{ ...pill, color: "var(--warn)", background: "var(--surface)", border: "1px solid var(--warn)" }}>{t.rd_ptu_builtin}</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 10, rowGap: 3, marginTop: 8, fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>{t.rd_ptu_size}</span><span data-testid="ptu-size" style={{ color: "var(--text)", fontWeight: 600 }}>{lastReport?.stickerSize || "—"}</span>
                <span style={{ color: "var(--text-muted)" }}>{t.rd_ptu_app}</span><span data-testid="ptu-app" style={{ color: "var(--text)", fontWeight: 600 }}>{lastReport?.appBuild != null ? tpl(t.rd_ptu_build, { n: String(lastReport.appBuild) }) : "—"}</span>
                <span style={{ color: "var(--text-muted)" }}>{t.rd_ptu_last_test}</span><span data-testid="ptu-last-test" style={{ color: "var(--text)", fontWeight: 600 }}>{lastReport ? `${when(lastReport.createdAt)} · ${lastReport.clean ? t.rd_ptu_clean : t.rd_ptu_not_clean}${lastReport.tuningVersion != null ? ` · v${lastReport.tuningVersion}` : ""}` : "—"}</span>
                <span style={{ color: "var(--text-muted)" }}>{t.rd_ptu_in_testers}</span><span data-testid="ptu-tester" style={{ color: data.tester ? "var(--ok)" : "var(--text-dim)", fontWeight: 800 }}>{data.tester ? "✓" : "✗"}</span>
                <span style={{ color: "var(--text-muted)" }}>{t.rd_ptu_version}</span><span data-testid="ptu-version" style={{ color: "var(--text)", fontWeight: 600 }}>{data.version ? `v${data.version} · ${when(data.updatedAt)}` : t.rd_ptu_none}</span>
              </div>
              {builtIn && <div data-testid="ptu-builtin-note" style={{ ...small, marginTop: 8 }}>{t.rd_ptu_builtin_note}</div>}
              {needsTester && !builtIn && <div data-testid="ptu-needs-tester" style={{ ...small, marginTop: 8, color: "var(--warn)", fontWeight: 700 }}>{t.rd_ptu_needs_tester}</div>}
            </div>

            <div style={h}>{t.rd_ptu_quick}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
              {CHIP_IDS.map((id) => (
                <button key={id} data-testid={`ptu-chip-${id}`} disabled={!canEdit} onClick={() => (id === "light_dark" ? setLightOpen((o) => !o) : applyChip(id))} style={{ ...btn, textAlign: "left", lineHeight: 1.3, padding: "8px 12px", ...off(canEdit), ...(id === "light_dark" && lightOpen ? { border: "2px solid var(--accent)" } : {}) }}>{t[CHIP_KEY[id]]}</button>
              ))}
            </div>
            {lightOpen && canEdit && (
              <div data-testid="ptu-light" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <button data-testid="ptu-darker" onClick={() => applyChip("light_dark", true)} style={btn}>{t.rd_ptu_darker}</button>
                <button data-testid="ptu-lighter" onClick={() => applyChip("light_dark", false)} style={btn}>{t.rd_ptu_lighter}</button>
              </div>
            )}

            <div data-testid="ptu-changes" style={{ ...card, marginTop: 12, ...(changes.length ? { borderColor: "var(--accent)" } : {}) }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>{changes.length ? t.rd_ptu_changes : t.rd_ptu_no_changes}</div>
              {changes.map((c) => (
                <div key={c.field} data-testid={`ptu-change-${c.field}`} style={{ fontSize: 12.5, color: "var(--text)", marginTop: 4, overflowWrap: "anywhere" }}>
                  <span style={{ color: "var(--text-muted)" }}>{t[FIELD_KEY[c.field]]}:</span> {tuningFieldValue(t, c.field, c.from)} → <b>{tuningFieldValue(t, c.field, c.to)}</b>
                </div>
              ))}
              {changes.some((c) => c.field === "sendSpeed") && <div data-testid="ptu-send-note" style={{ ...small, marginTop: 6 }}>{t.rd_ptu_send_note}</div>}
            </div>
            {ask !== "save" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <button data-testid="ptu-save" disabled={!canEdit || !changes.length} onClick={() => setAsk("save")} style={{ ...solid, ...off(canEdit && changes.length > 0) }}>{t.rd_ptu_save}</button>
                <button data-testid="ptu-discard" disabled={!canEdit || !changes.length} onClick={() => setDraft({ ...(saved ?? {}) })} style={{ ...btn, ...off(canEdit && changes.length > 0) }}>{t.rd_ptu_discard}</button>
              </div>
            )}
            {ask === "save" && confirm(tpl(t.rd_ptu_save_q, { email }), t.rd_ptu_save, () => void doSave(), "ptu-save-ask")}
            {note && <div data-testid="ptu-note" role="status" style={{ fontSize: 12.5, fontWeight: 700, marginTop: 10, color: note.kind === "ok" ? "var(--ok)" : "var(--danger)" }}>{note.text}</div>}

            <button data-testid="ptu-adv-toggle" aria-expanded={advOpen} onClick={() => setAdvOpen((o) => !o)} style={{ ...btn, width: "100%", marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>{t.rd_ptu_advanced}</span><span aria-hidden>{advOpen ? "▴" : "▾"}</span></button>
            {advOpen && (
              <div data-testid="ptu-adv" style={{ ...card, marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "4px 0 6px" }}>{t.rd_ptu_f_sensor}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {([undefined, "gap", "bline", "continuous"] as (Sensor | undefined)[]).map((s) => (
                    <button key={s ?? "model"} data-testid={`ptu-sensor-${s ?? "model"}`} aria-pressed={draft.sensor === s} disabled={!canEdit} onClick={() => setField("sensor", s)} style={{ ...btn, padding: "0 6px", fontSize: 12, ...off(canEdit), ...(draft.sensor === s ? { border: "2px solid var(--accent)" } : {}) }}>{s ? tuningFieldValue(t, "sensor", s) : t.rd_ptu_model}</button>
                  ))}
                </div>
                <Stepper id="ptu-gap" k="gapMm" label={`${t.rd_ptu_f_gap} (mm)`} value={draft.gapMm} model={t.rd_ptu_model} enabled={canEdit} onChange={(v) => setField("gapMm", v)} />
                <Stepper id="ptu-shift" k="shiftMm" label={`${t.rd_ptu_f_shift} (mm, + ${t.rd_ptu_left})`} value={draft.shiftMm} model={t.rd_ptu_model} enabled={canEdit} onChange={(v) => setField("shiftMm", v)} />
                <Stepper id="ptu-density" k="density" label={t.rd_ptu_f_density} value={draft.density} model={t.rd_ptu_model} enabled={canEdit} onChange={(v) => setField("density", v)} />
                <Stepper id="ptu-speed" k="speed" label={t.rd_ptu_f_speed} value={draft.speed} model={t.rd_ptu_model} enabled={canEdit} onChange={(v) => setField("speed", v)} />
                {(["flip", "sendSpeed"] as const).map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 48 }}>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t[FIELD_KEY[f]]}</div>
                    {([undefined, f === "flip" ? false : "normal", f === "flip" ? true : "slow"] as (boolean | string | undefined)[]).map((v) => (
                      <button key={String(v)} data-testid={`ptu-${f}-${String(v ?? "model")}`} aria-pressed={draft[f] === v} disabled={!canEdit} onClick={() => setField(f, v as never)} style={{ ...btn, padding: "0 10px", fontSize: 12, ...off(canEdit), ...(draft[f] === v ? { border: "2px solid var(--accent)" } : {}) }}>{v === undefined ? t.rd_ptu_model : tuningFieldValue(t, f, v as never)}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div style={h}>{t.rd_ptu_history}</div>
            {data.history.length === 0 && <div data-testid="ptu-history-empty" style={small}>{t.rd_ptu_history_empty}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.history.map((x) => (
                <div key={x.id} data-testid="ptu-history-row" style={{ ...card, padding: "8px 10px", opacity: x.undone ? 0.55 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t[`rd_ptu_h_${x.action}`]}{x.version ? ` · v${x.version}` : ""}{x.undone ? ` · ${t.rd_ptu_h_undone}` : ""} <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>· {when(x.at)}</span></div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, overflowWrap: "anywhere" }}>
                    {tuningDiff(x.before, x.after).map((c) => `${t[FIELD_KEY[c.field]]} ${tuningFieldValue(t, c.field, c.from)} → ${tuningFieldValue(t, c.field, c.to)}`).join(" · ") || "—"}
                  </div>
                </div>
              ))}
            </div>
            {ask !== "undo" && ask !== "reset" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <button data-testid="ptu-undo" disabled={!canEdit || !canUndo} onClick={() => setAsk("undo")} style={{ ...btn, ...off(canEdit && canUndo) }}>{t.rd_ptu_undo}</button>
                <button data-testid="ptu-reset" disabled={!canEdit || !data.version} onClick={() => setAsk("reset")} style={{ ...danger, ...off(canEdit && !!data.version) }}>{t.rd_ptu_reset}</button>
              </div>
            )}
            {ask === "undo" && confirm(t.rd_ptu_undo_q, t.rd_ptu_undo, () => void doUndo(), "ptu-undo-ask")}
            {ask === "reset" && confirm(t.rd_ptu_reset_q, t.rd_ptu_reset, () => void doReset(), "ptu-reset-ask")}
          </>)}
        </div>
      </div>
    </div>
  );
  return createPortal(body, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
