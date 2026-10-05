// PARCEL SCAN — Dry / Frozen (常溫 / 冷凍) per parcel (sql/79).
//
// Who sees the control: app_settings parcel_frozen_public = 'true' exactly, OR an enabled
// parcel_frozen_access row for the signed-in seller — and the frozen settings must read cleanly.
// Anyone else gets today's Parcel Scan: no control, every parcel saved without a temp_layer (the
// column default 常溫) → byte-identical export. A failed read is "error": today's behaviour for a
// dry seller, but BLOCKED for an account whose local hint says it uses frozen (see FrozenState).
// A 冷凍 row is frozen no matter what this read returned (parcel_scans.temp_layer is always read).
//
// One read set per screen open (no poll): the 4 settings in ONE app_settings query + the own
// access row (+ the own mode row when allowed).
import { supabase, isSupabaseConfigured } from "../../supabase";
import type { ParcelScanRow, ScanXlsOpts } from "./parcelScan";

export const TEMP_DRY = "常溫";
export const TEMP_FROZEN = "冷凍"; // template enum values — NEVER translate
export type TempLayer = typeof TEMP_DRY | typeof TEMP_FROZEN;

export interface FrozenConfig {
  fee: number;                 // shipping for a frozen parcel (G, before the column cap)
  minTotal: number;            // amount + fee must be at least this
  feeColumnMax: number | null; // null = no cap (G = the whole fee)
}
// status: "loading" until the first read lands; "ok" = every read answered (allowed or a clean
// "no access"); "error" = a read failed (settings, access row or mode row), or access was granted
// but the frozen settings are unusable. blocked = "error" for a seller whose local hint says they
// use frozen → Parcel Scan must not save / import / export until a load succeeds (unknown is not
// Dry for a frozen user). "error" without the hint = today's behaviour (dry seller).
export type FrozenStatus = "loading" | "ok" | "error";
export interface FrozenState {
  status: FrozenStatus;
  blocked: boolean;
  allowed: boolean;            // show the Dry / Frozen control + save temp_layer
  mode: TempLayer;             // the seller's current mode (parcel_scan_prefs), default Dry
  cfg: FrozenConfig | null;    // null = settings missing / unreadable / invalid
}
export const FROZEN_LOADING: FrozenState = { status: "loading", blocked: false, allowed: false, mode: TEMP_DRY, cfg: null };
export const FROZEN_OFF: FrozenState = { status: "ok", blocked: false, allowed: false, mode: TEMP_DRY, cfg: null };

// Per-account local hint "this seller uses frozen" (localStorage, keyed by user id). Set when a
// load returns allowed, cleared when a load cleanly returns not allowed. Storage unavailable →
// no hint (never throws).
export const FROZEN_HINT_PREFIX = "sfl_parcel_frozen_hint_";
export function readFrozenHint(uid: string): boolean {
  try { return localStorage.getItem(FROZEN_HINT_PREFIX + uid) === "1"; } catch { return false; }
}
export function writeFrozenHint(uid: string, on: boolean): void {
  try { if (on) localStorage.setItem(FROZEN_HINT_PREFIX + uid, "1"); else localStorage.removeItem(FROZEN_HINT_PREFIX + uid); } catch { /* no storage → no hint */ }
}

export const FROZEN_KEYS = ["parcel_frozen_public", "parcel_frozen_fee", "parcel_frozen_min_total", "parcel_frozen_fee_column_max"] as const;
export const FROZEN_FEE_MAX = 500;
export const FROZEN_MIN_TOTAL_MAX = 20000;

const wholeIn = (v: string | null | undefined, max: number): number | null => {
  const s = (v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= max ? n : null;
};

// Pure: the app_settings rows → public flag + config. A missing or invalid fee / min total, or an
// invalid (non-empty, non-number) column cap, makes cfg null → frozen stays off (fail closed).
export function parseFrozenSettings(map: Record<string, string | null | undefined>): { isPublic: boolean; cfg: FrozenConfig | null } {
  const isPublic = map.parcel_frozen_public === "true";
  const fee = wholeIn(map.parcel_frozen_fee, FROZEN_FEE_MAX);
  const minTotal = wholeIn(map.parcel_frozen_min_total, FROZEN_MIN_TOTAL_MAX);
  const capRaw = (map.parcel_frozen_fee_column_max ?? "").trim();
  const feeColumnMax = capRaw === "" ? null : wholeIn(capRaw, FROZEN_FEE_MAX);
  const capBad = capRaw !== "" && feeColumnMax == null;
  return { isPublic, cfg: fee == null || minTotal == null || capBad ? null : { fee, minTotal, feeColumnMax } };
}

export function frozenAllowed(isPublic: boolean, access: { enabled?: unknown } | null, cfg: FrozenConfig | null): boolean {
  return cfg != null && (isPublic || access?.enabled === true);
}

export const isFrozenLayer = (layer: string | null | undefined): boolean => layer === TEMP_FROZEN;
export const feeForLayer = (layer: string | null | undefined, dryFee: number, cfg: FrozenConfig | null): number =>
  isFrozenLayer(layer) && cfg ? cfg.fee : dryFee;
export const minTotalForLayer = (layer: string | null | undefined, cfg: FrozenConfig | null): number | null =>
  isFrozenLayer(layer) && cfg ? cfg.minTotal : null;

// The export options for ONE row: a frozen row (temp_layer 冷凍) gets the frozen fee, D=冷凍 and
// the column cap; every other row gets `base` unchanged (today's export, byte for byte).
// A 冷凍 row WITHOUT frozen settings can never fall back to the dry options: it throws.
// (splitScansForExport already excludes such rows with "frozen_settings", so this is a backstop.)
export class FrozenSettingsMissing extends Error {
  constructor(id: string) { super(`frozen_settings_missing:${id}`); this.name = "FrozenSettingsMissing"; }
}
export function xlsOptsForRow(row: ParcelScanRow, base: ScanXlsOpts, cfg: FrozenConfig | null): ScanXlsOpts {
  if (!isFrozenLayer(row.tempLayer)) return base;
  if (!cfg) throw new FrozenSettingsMissing(row.id);
  return { ...base, fee: cfg.fee, tempLayer: TEMP_FROZEN, feeColumnMax: cfg.feeColumnMax };
}

async function me(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function loadFrozenState(): Promise<FrozenState> {
  const failed = (uid: string | null, cfg: FrozenConfig | null = null): FrozenState =>
    ({ status: "error", blocked: uid ? readFrozenHint(uid) : false, allowed: false, mode: TEMP_DRY, cfg });
  if (!isSupabaseConfigured || !supabase) return failed(null);
  const sb = supabase;
  let uid: string | null = null;
  try {
    uid = await me();
    if (!uid) return failed(null);
    const [settings, access] = await Promise.all([
      sb.from("app_settings").select("key, value").in("key", [...FROZEN_KEYS]),
      sb.from("parcel_frozen_access").select("user_id, enabled").eq("user_id", uid).maybeSingle(),
    ]);
    if (settings.error || access.error) return failed(uid);
    const map: Record<string, string | null> = {};
    for (const r of (settings.data ?? []) as { key: string; value: unknown }[]) map[r.key] = r.value == null ? null : String(r.value);
    const { isPublic, cfg } = parseFrozenSettings(map);
    const row = access.data && String((access.data as { user_id?: unknown }).user_id ?? "") === uid ? (access.data as { enabled?: unknown }) : null;
    const granted = isPublic || row?.enabled === true;
    if (!granted) { writeFrozenHint(uid, false); return { ...FROZEN_OFF, cfg }; } // clean "no access"
    if (!cfg) return failed(uid);                                                   // granted but settings unusable
    const pref = await sb.from("parcel_scan_prefs").select("temp_layer").eq("user_id", uid).maybeSingle();
    if (pref.error) return failed(uid, cfg);                                        // mode unknown → never default to Dry
    const mode: TempLayer = pref.data && (pref.data as { temp_layer?: unknown }).temp_layer === TEMP_FROZEN ? TEMP_FROZEN : TEMP_DRY;
    writeFrozenHint(uid, true);
    return { status: "ok", blocked: false, allowed: true, mode, cfg };
  } catch {
    return failed(uid);
  }
}

// The seller's own mode row (RLS: own row only). Never touches parcels already saved.
export async function saveParcelMode(layer: TempLayer): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const uid = await me();
  if (!uid) return { ok: false, error: "not signed in" };
  const { error } = await supabase
    .from("parcel_scan_prefs")
    .upsert({ user_id: uid, temp_layer: layer, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
