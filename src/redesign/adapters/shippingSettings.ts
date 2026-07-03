// 7-11 shipping settings (P3b) — DB-BACKED per-seller defaults (cross-device),
// replacing the per-device localStorage sfl_rd_ship_fee as source of truth.
// Table: sql/11_shipping_settings.sql (user_id PK, RLS = auth.uid()).
//
// ⚠️ EGRESS-SAFE: ONE read per Shipping-screen open (alongside the entries
// load) + one upsert per settings change. ZERO poll.
//
//   defaultFee    — prefilled into NEW entries; the Free-shipping toggle pairs
//                   0 ↔ defaultFee. Factory NT$38 (standard 賣貨便 fee).
//   freeThreshold — free-shipping auto-rule: groups with order total ≥
//                   threshold get fee 0 at encode. null = rule OFF (default).
//                   The ≥NT$55 row-total validator still applies afterwards.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { SHIP_DEFAULT_FEE, SHIP_MAX_FEE } from "./shipping";

export interface ShippingSettings {
  defaultFee: number;
  freeThreshold: number | null; // null = auto-rule off
}
export const SHIP_SETTINGS_FACTORY: ShippingSettings = { defaultFee: SHIP_DEFAULT_FEE, freeThreshold: null };

// Legacy per-device preset (pre-P3b). Still read as the FALLBACK when the
// seller has no DB row yet, and still written on change so an offline open
// shows the last-picked fee. DB wins whenever a row exists.
const LEGACY_FEE_KEY = "sfl_rd_ship_fee";

// ── Pure helpers (no Supabase / React — unit-tested) ──────────────────────────
export function clampFee(v: unknown): number {
  if (v == null || v === "") return SHIP_DEFAULT_FEE; // Number(null) is 0 — a missing fee must NOT mean free shipping
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= SHIP_MAX_FEE ? n : SHIP_DEFAULT_FEE;
}
export function clampThreshold(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function rowToShippingSettings(row: Record<string, unknown>): ShippingSettings {
  return { defaultFee: clampFee(row.default_fee), freeThreshold: clampThreshold(row.free_threshold) };
}
// `now` injectable for deterministic tests.
export function settingsToRow(s: ShippingSettings, userId: string, nowIso: string): Record<string, unknown> {
  return { user_id: userId, default_fee: clampFee(s.defaultFee), free_threshold: clampThreshold(s.freeThreshold), updated_at: nowIso };
}

// The fee a NEW entry starts with: the auto-rule wins when the group's order
// total qualifies, else the configured default. The ≥NT$55 validator still
// guards the final save — a qualifying group under 55 total is blocked there.
export function defaultFeeFor(groupTotal: number, s: ShippingSettings): number {
  if (s.freeThreshold != null && groupTotal >= s.freeThreshold) return 0;
  return clampFee(s.defaultFee);
}

// ── Legacy localStorage fallback (per device) ─────────────────────────────────
export function legacyLocalSettings(): ShippingSettings {
  try {
    const raw = localStorage.getItem(LEGACY_FEE_KEY);
    const v = Number(raw);
    return { defaultFee: raw != null && Number.isFinite(v) && v >= 0 && v <= SHIP_MAX_FEE ? v : SHIP_DEFAULT_FEE, freeThreshold: null };
  } catch { return SHIP_SETTINGS_FACTORY; }
}
export function mirrorLegacyFee(fee: number): void {
  try { localStorage.setItem(LEGACY_FEE_KEY, String(clampFee(fee))); } catch { /* ignore */ }
}

// getSession() is LOCAL (no network) — same uid pattern as shippingDb.
async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ONE read per screen open. null = no row yet (caller keeps legacy/factory).
export async function loadShippingSettings(): Promise<ShippingSettings | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase
    .from("seller_shipping_settings")
    .select("default_fee,free_threshold")
    .eq("user_id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToShippingSettings(data as Record<string, unknown>);
}

// One upsert per settings change (write-on-action).
export async function saveShippingSettings(s: ShippingSettings): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const id = await uid();
  if (!id) return { ok: false, error: "not signed in" };
  const { error } = await supabase
    .from("seller_shipping_settings")
    .upsert(settingsToRow(s, id, new Date().toISOString()), { onConflict: "user_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
