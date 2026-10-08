// Global feature switches (app_settings, seeded 'false' by sql/93). Jeff flips one in the
// database — no deploy. ONE small select per sign-in, zero poll. FAIL CLOSED: not signed in,
// no row, any error, or any value other than the exact string 'true' → off.
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

export const FEATURE_SWITCH_KEYS = {
  salesPlatform: "sales_platform_enabled",
  fbSoldout: "fb_soldout_enabled",
  fbWaitlist: "fb_waitlist_enabled",
  inventoryV2: "inventory_v2_enabled",
  productImages: "product_images_enabled",
  fbAutoReceipt: "fb_auto_receipt_enabled", // B1 automatic receipt after a Facebook live (sql/100)
} as const;
export type FeatureSwitch = keyof typeof FEATURE_SWITCH_KEYS;
export type FeatureSwitches = Record<FeatureSwitch, boolean>;
export const SWITCHES_OFF: FeatureSwitches = { salesPlatform: false, fbSoldout: false, fbWaitlist: false, inventoryV2: false, productImages: false, fbAutoReceipt: false };

// rows from app_settings → switches. Pure.
export function parseSwitches(rows: unknown): FeatureSwitches {
  const out: FeatureSwitches = { ...SWITCHES_OFF };
  if (!Array.isArray(rows)) return out;
  for (const r of rows as { key?: unknown; value?: unknown }[]) {
    for (const [name, key] of Object.entries(FEATURE_SWITCH_KEYS) as [FeatureSwitch, string][]) {
      if (r && r.key === key) out[name] = r.value === "true";
    }
  }
  return out;
}

export async function loadFeatureSwitches(): Promise<FeatureSwitches> {
  if (!isSupabaseConfigured || !supabase) return SWITCHES_OFF;
  try {
    const { data, error } = await supabase.from("app_settings").select("key,value").in("key", Object.values(FEATURE_SWITCH_KEYS));
    return error ? SWITCHES_OFF : parseSwitches(data);
  } catch {
    return SWITCHES_OFF;
  }
}

// userKey: the signed-in user's id ("" = signed out → no read, all off).
export function useFeatureSwitches(userKey: string): FeatureSwitches {
  const [state, setState] = useState<{ key: string; sw: FeatureSwitches }>({ key: "", sw: SWITCHES_OFF });
  useEffect(() => {
    if (!userKey) return;
    let live = true;
    void loadFeatureSwitches().then((sw) => { if (live) setState({ key: userKey, sw }); });
    return () => { live = false; };
  }, [userKey]);
  return state.key === userKey && userKey ? state.sw : SWITCHES_OFF;
}
