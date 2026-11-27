// PRINTER TUNING (sql/230) — one seller's own settings for their printer, made by an Admin.
// Read ONCE per signed-in session (my_printer_tuning); a failed read, no row, or a built-in printer = no
// tuning = today's bytes exactly (the print code gets back the very same job / layout objects).
// Applies ONLY on the generic Bluetooth picture path (an Admin-approved or unknown TSPL / ESC-POS / CPCL
// printer). The AIMO D520, Niimbot, WiFi, the laptop and the native text sticker never read it.
//   TSPL:      media line (GAP n mm / BLINE n mm / continuous = GAP 0 mm), DENSITY, SPEED, shift, flip
//   ESC/POS · CPCL: shift + flip only (their raster jobs have no density / media line)
//   send_speed: stored for later — it needs a new app build (the BLE chunk timing lives in native code).
// Nothing here is ever logged or shown to the seller.
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { isBuiltInPrinterName, type TsplJobSettings } from "./printerModels";
import type { ApprovedLayout } from "./rasterShift";

export type Sensor = "gap" | "bline" | "continuous";
export interface PrinterTuning { gapMm?: number; sensor?: Sensor; shiftMm?: number; flip?: boolean; density?: number; speed?: number; sendSpeed?: "normal" | "slow" }
export interface MyTuning { enabled: boolean; tester: boolean; tuning: PrinterTuning | null; version: number | null }
export const NO_TUNING: MyTuning = { enabled: false, tester: false, tuning: null, version: null };

// The ranges = sql/230 printer_tuning_clean (both sides clamp; the database is the last word).
export const TUNING_RANGE = {
  gapMm: { min: 0, max: 6, step: 0.5 },
  shiftMm: { min: -5, max: 5, step: 0.5 },
  density: { min: 0, max: 15, step: 1 },
  speed: { min: 1, max: 6, step: 1 },
} as const;
type NumKey = keyof typeof TUNING_RANGE;
export function clampTuningNumber(k: NumKey, v: number): number {
  const r = TUNING_RANGE[k];
  const stepped = Math.round(v / r.step) * r.step;
  return Math.min(r.max, Math.max(r.min, Number(stepped.toFixed(1))));
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Database JSON (snake_case) → tuning, clamped. Unknown keys / wrong types are dropped; nothing usable = null. */
export function parseTuning(raw: unknown): PrinterTuning | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const t: PrinterTuning = {};
  const g = num(r.gap_mm); if (g != null) t.gapMm = clampTuningNumber("gapMm", g);
  const s = num(r.shift_mm); if (s != null) t.shiftMm = clampTuningNumber("shiftMm", s);
  const d = num(r.density); if (d != null) t.density = clampTuningNumber("density", d);
  const p = num(r.speed); if (p != null) t.speed = clampTuningNumber("speed", p);
  if (r.sensor === "gap" || r.sensor === "bline" || r.sensor === "continuous") t.sensor = r.sensor;
  if (typeof r.flip === "boolean") t.flip = r.flip;
  if (r.send_speed === "normal" || r.send_speed === "slow") t.sendSpeed = r.send_speed;
  return Object.keys(t).length ? t : null;
}
/** Tuning → the database JSON (snake_case), clamped. */
export function tuningToDb(t: PrinterTuning): Record<string, number | boolean | string> {
  const o: Record<string, number | boolean | string> = {};
  if (t.gapMm != null) o.gap_mm = clampTuningNumber("gapMm", t.gapMm);
  if (t.sensor) o.sensor = t.sensor;
  if (t.shiftMm != null) o.shift_mm = clampTuningNumber("shiftMm", t.shiftMm);
  if (t.flip != null) o.flip = t.flip;
  if (t.density != null) o.density = clampTuningNumber("density", t.density);
  if (t.speed != null) o.speed = clampTuningNumber("speed", t.speed);
  if (t.sendSpeed) o.send_speed = t.sendSpeed;
  return o;
}

// ── the session copy ─────────────────────────────────────────────────────────────────────────
let mine: MyTuning = NO_TUNING;
let readFor: string | null = null;
let read: Promise<MyTuning> | null = null;
export const myPrinterTuning = (): MyTuning => mine;
export function setMyPrinterTuning(v: MyTuning | null): void { mine = v ?? NO_TUNING; }
export function __resetPrinterTuning(): void { mine = NO_TUNING; read = null; readFor = null; }

export function parseMyTuning(data: unknown): MyTuning {
  if (!data || typeof data !== "object") return NO_TUNING;
  const d = data as Record<string, unknown>;
  const tuning = parseTuning(d.settings);
  const v = num(d.version);
  return { enabled: d.enabled === true, tester: d.tester === true, tuning, version: tuning && v != null && v >= 1 ? Math.trunc(v) : null };
}
/** One read per signed-in user; any failure = no tuning (today's printing). */
export function loadMyPrinterTuning(userId: string): Promise<MyTuning> {
  if (read && readFor === userId) return read;
  readFor = userId;
  read = (async () => {
    if (!isSupabaseConfigured || !supabase) return NO_TUNING;
    try {
      const { data, error } = await supabase.rpc("my_printer_tuning");
      return error ? NO_TUNING : parseMyTuning(data);
    } catch { return NO_TUNING; }
  })();
  return read;
}
/** Signed in → read once; signed out / another user → forget. Answers the value for the screens
 *  (`tester` = show the Printer setup test card); the print code reads the module copy. */
export function usePrinterTuning(userId: string | null | undefined): MyTuning {
  const [v, setV] = useState<{ for: string; value: MyTuning } | null>(null);
  useEffect(() => {
    if (!userId) { __resetPrinterTuning(); return; }
    let live = true;
    void loadMyPrinterTuning(userId).then((r) => { if (live && readFor === userId) { setMyPrinterTuning(r); setV({ for: userId, value: r }); } });
    return () => { live = false; };
  }, [userId]);
  return userId && v?.for === userId ? v.value : NO_TUNING;
}

// ── what the print code asks ─────────────────────────────────────────────────────────────────
/** The tuning for the saved printer of this name; null = none (no row, failed read, built-in printer). */
export function tuningFor(name: string | undefined | null): PrinterTuning | null {
  const t = mine.tuning;
  if (!t || !String(name || "").trim() || isBuiltInPrinterName(name)) return null;
  return t;
}
/** The TSPL job with the tuning on top; no tuning (or nothing for TSPL in it) = the SAME object back. */
export function tunedTsplJob(job: TsplJobSettings, t: PrinterTuning | null): TsplJobSettings {
  if (!t || (t.density == null && t.speed == null && t.sensor == null && t.gapMm == null)) return job;
  return {
    ...job,
    ...(t.density != null ? { density: t.density } : {}),
    ...(t.speed != null ? { speed: t.speed } : {}),
    ...(t.sensor != null || t.gapMm != null ? { media: { sensor: t.sensor ?? "gap", mm: t.gapMm ?? 2 } } : {}),
  };
}
/** The layout (flip / shift) with the tuning on top; no flip / shift in the tuning = the SAME object back.
 *  shiftMm > 0 = move left, < 0 = move right (8 dots per mm). */
export function tunedLayout(layout: ApprovedLayout, t: PrinterTuning | null): ApprovedLayout {
  if (!t || (t.flip == null && t.shiftMm == null)) return layout;
  return { flip: t.flip ?? layout.flip, shiftDots: t.shiftMm != null ? Math.round(t.shiftMm * 8) : layout.shiftDots };
}
