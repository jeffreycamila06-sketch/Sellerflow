// Admin → Manage sellers → a seller → Printer Tuning (sql/230). Every RPC checks is_admin() inside.
// The panel reads ONE answer (admin_printer_tuning_get) and writes through set / undo / reset, each with
// the version it read — someone else saving first answers "stale" and the panel reloads.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { parseTuning, tuningToDb, type PrinterTuning } from "./printerTuning";

export interface TuningHistoryRow { id: number; action: "set" | "undo" | "reset"; before: PrinterTuning | null; after: PrinterTuning | null; version: number | null; undone: boolean; at: string }
export interface TuningReportRow { id: string; printerName: string; stickerSize: string; lang: string; createdAt: string; clean: boolean; sendOk: boolean; tuningVersion: number | null; appBuild: number | null }
export interface AdminTuning {
  tuning: PrinterTuning | null; version: number; updatedAt: string | null; switchOn: boolean; tester: boolean;
  printerName: string | null; builtIn: boolean; lockedName: string | null;
  history: TuningHistoryRow[]; reports: TuningReportRow[];
}
export type TuningCode = "stale_version" | "built_in_printer" | "not_tester" | "bad_settings" | "no_user";
const CODES: readonly TuningCode[] = ["stale_version", "built_in_printer", "not_tester", "bad_settings", "no_user"];
export const tuningCode = (message: unknown): TuningCode | undefined => {
  const m = typeof message === "string" ? message : "";
  return CODES.find((c) => m.includes(c));
};
export type TuningResult<T> = { ok: true; data: T } | { ok: false; code?: TuningCode };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? Math.trunc(n) : null; };
export function parseAdminTuning(d: unknown): AdminTuning | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const r = d as Record<string, unknown>;
  const hist = Array.isArray(r.history) ? r.history : [];
  const reps = Array.isArray(r.reports) ? r.reports : [];
  return {
    tuning: parseTuning(r.settings), version: int(r.version) ?? 0, updatedAt: str(r.updated_at) || null,
    switchOn: r.switch_on === true, tester: r.tester === true,
    printerName: str(r.printer_name) || null, builtIn: r.built_in === true, lockedName: str(r.locked_name) || null,
    history: hist.flatMap((h) => {
      if (!h || typeof h !== "object") return [];
      const x = h as Record<string, unknown>;
      const action = x.action === "set" || x.action === "undo" || x.action === "reset" ? x.action : null;
      if (!action) return [];
      return [{ id: int(x.id) ?? 0, action, before: parseTuning(x.before), after: parseTuning(x.after), version: int(x.version), undone: x.undone === true, at: str(x.at) }];
    }),
    reports: reps.flatMap((p) => {
      if (!p || typeof p !== "object") return [];
      const x = p as Record<string, unknown>;
      return [{ id: str(x.id), printerName: str(x.printer_name), stickerSize: str(x.sticker_size), lang: str(x.lang), createdAt: str(x.created_at), clean: x.clean === true, sendOk: x.send_ok === true, tuningVersion: int(x.tuning_version), appBuild: int(x.app_build) }];
    }),
  };
}

async function call<T>(fn: string, args: Record<string, unknown>, pick: (d: unknown) => T | null): Promise<TuningResult<T>> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { const code = tuningCode((error as { message?: unknown }).message); return code ? { ok: false, code } : { ok: false }; }
    const v = pick(data);
    return v === null ? { ok: false } : { ok: true, data: v };
  } catch { return { ok: false }; }
}
export const adminGetTuning = (email: string) => call("admin_printer_tuning_get", { p_email: email }, parseAdminTuning);
/** → the new version */
export const adminSetTuning = (email: string, t: PrinterTuning, expected: number) =>
  call("admin_printer_tuning_set", { p_email: email, p_settings: tuningToDb(t), p_expected_version: expected }, (d) => int(d));
/** → the new version; 0 = settings removed; null answer = nothing to undo (ok with data -1) */
export const adminUndoTuning = (email: string, expected: number) =>
  call("admin_printer_tuning_undo", { p_email: email, p_expected_version: expected }, (d) => (d === null ? -1 : int(d)));
/** → true = removed, false = there was nothing */
export const adminResetTuning = (email: string, expected: number) =>
  call("admin_printer_tuning_reset", { p_email: email, p_expected_version: expected }, (d) => (typeof d === "boolean" ? d : null));

/** What changes, field by field (for "shown before Save"). Same value on both sides = not listed. */
export type TuningField = "gapMm" | "sensor" | "shiftMm" | "flip" | "density" | "speed" | "sendSpeed";
export const TUNING_FIELDS: readonly TuningField[] = ["sensor", "gapMm", "shiftMm", "flip", "density", "speed", "sendSpeed"];
export function tuningDiff(a: PrinterTuning | null, b: PrinterTuning | null): { field: TuningField; from: PrinterTuning[TuningField]; to: PrinterTuning[TuningField] }[] {
  const out: { field: TuningField; from: PrinterTuning[TuningField]; to: PrinterTuning[TuningField] }[] = [];
  for (const f of TUNING_FIELDS) { const x = a?.[f], y = b?.[f]; if (x !== y) out.push({ field: f, from: x, to: y }); }
  return out;
}

// The words the Admin panel shows for one value (t = the text table). undefined = the model's own setting.
export function tuningFieldValue(t: Record<string, string>, f: TuningField, v: PrinterTuning[TuningField]): string {
  if (v === undefined) return t.rd_ptu_model;
  if (f === "sensor") return v === "bline" ? t.rd_ptu_s_bline : v === "continuous" ? t.rd_ptu_s_cont : t.rd_ptu_s_gap;
  if (f === "flip") return v ? t.rd_ptu_on : t.rd_ptu_off;
  if (f === "sendSpeed") return v === "slow" ? t.rd_ptu_slow : t.rd_ptu_normal;
  if (f === "gapMm") return `${v} mm`;
  if (f === "shiftMm") { const n = v as number; return n === 0 ? "0 mm" : `${Math.abs(n)} mm ${n > 0 ? t.rd_ptu_left : t.rd_ptu_right}`; }
  return String(v);
}
