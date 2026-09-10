// Global app_settings (key/value) — sql/32_app_settings.sql.
// RLS: any authenticated user READS (using true); is_admin() WRITES. So a
// seller can read a global value but never change it.
//
// EGRESS-SAFE: one read per screen open (caller-driven), one upsert per admin
// change. ZERO poll. Generic get/set here; typed wrappers (e.g. the shipping
// fee) live in shippingSettings.ts so they can reuse its clamp helpers.
import { isSupabaseConfigured, supabase } from "../../supabase";

export interface AppSetting { value: string | null; updatedAt: string | null }

// Read one setting. Returns null on no-row / not-configured / error — callers
// MUST supply their own safe default (never treat "couldn't read" as a value).
export async function getAppSetting(key: string): Promise<AppSetting | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value,updated_at")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { value?: unknown; updated_at?: unknown };
    return {
      value: row.value == null ? null : String(row.value),
      updatedAt: row.updated_at == null ? null : String(row.updated_at),
    };
  } catch {
    return null; // network / unexpected → caller's fail-safe default applies
  }
}

// Upsert one setting (admin-only — enforced by RLS is_admin(); a non-admin write
// is rejected by the DB, surfaced here as { ok:false }). Stamps updated_by with
// the caller's uid when available.
export async function setAppSetting(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  let updatedBy: string | null;
  try { updatedBy = (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { updatedBy = null; }
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString(), ...(updatedBy ? { updated_by: updatedBy } : {}) }, { onConflict: "key" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
