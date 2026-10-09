// Build 10b — preview/dogfood allowlists live in the database (sql/112), not in the bundle.
// my_feature_access() answers ONLY booleans for the signed-in user (login email). The gate
// helpers (fbPreviewEnabled, parcelCheckAllowed, …) read this module map; RedesignApp loads it
// once per signed-in user (useFeatureAccess) and re-renders when it arrives. Fail closed: no
// client / error / anything but a literal true → false. The last answer is kept per user in
// localStorage (booleans only) so a listed account (e.g. the Meta review login) sees its
// features from the first frame.
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

export const FEATURE_KEYS = [
  "fb_preview", "kiosk_launcher", "parcel_check", "parcel_cap_tester", "pin_print", "sticker_v2",
  "sticker_spacing", "session_v2", "session_numbering_fix", "shopee_preview", "live_source", "classic_text",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureAccess = Record<FeatureKey, boolean>;

const NONE = (): FeatureAccess => Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureAccess;
let current: FeatureAccess = NONE();
let loaded = false;

export const hasFeature = (k: FeatureKey): boolean => current[k] === true;
export const featureAccessLoaded = (): boolean => loaded;
export function setFeatureAccess(a: Partial<Record<FeatureKey, unknown>> | null, isLoaded = true): void {
  const next = NONE();
  for (const k of FEATURE_KEYS) next[k] = a?.[k] === true;
  current = next;
  loaded = isLoaded;
}

export function parseFeatureAccess(data: unknown): FeatureAccess {
  const out = NONE();
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const k of FEATURE_KEYS) out[k] = (data as Record<string, unknown>)[k] === true;
  }
  return out;
}

export async function loadFeatureAccess(): Promise<FeatureAccess> {
  if (!isSupabaseConfigured || !supabase) return NONE();
  try {
    const { data, error } = await supabase.rpc("my_feature_access");
    return error ? NONE() : parseFeatureAccess(data);
  } catch {
    return NONE();
  }
}

const LS_KEY = "sfl_rd_fa_";
function readCached(userId: string): FeatureAccess | null {
  try { const s = localStorage.getItem(LS_KEY + userId); return s ? parseFeatureAccess(JSON.parse(s)) : null; } catch { return null; }
}
function writeCached(userId: string, a: FeatureAccess): void {
  try { localStorage.setItem(LS_KEY + userId, JSON.stringify(a)); } catch { /* per-device convenience only */ }
}

// Once per signed-in user. Returns the map (its identity changes when the answer arrives, so
// the caller re-renders and every gate helper reads the fresh module map). A user change is
// applied during render (cached answer first), so the gates below the hook see it at once.
export function useFeatureAccess(userId: string | null | undefined): FeatureAccess {
  const id = userId || null;
  const [st, setSt] = useState<{ user: string | null; access: FeatureAccess }>(() => ({ user: null, access: current }));
  if (st.user !== id) {
    setFeatureAccess(id ? readCached(id) : null, false);
    setSt({ user: id, access: current });
  }
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void loadFeatureAccess().then((a) => {
      if (!alive) return;
      setFeatureAccess(a, true);
      writeCached(id, a);
      setSt({ user: id, access: current });
    });
    return () => { alive = false; };
  }, [id]);
  return st.access;
}
