// FACEBOOK per-seller access (GET /fb/access) — lets the owner open Facebook for a tester by adding
// a row to fb_tester_access (sql/77), with no code change or deploy. The server answers
// { facebook, receipt }: facebook = the same decision as its Facebook lock (fb_enabled OR the
// hard-coded preview list OR an enabled tester row), receipt = fb_receipt_access.
// FAIL CLOSED: no answer yet, any error, a non-200 or an odd body → both false.
import { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";

export interface FbAccess { facebook: boolean; receipt: boolean }
export const FB_ACCESS_NONE: FbAccess = { facebook: false, receipt: false };
export const FB_ACCESS_REFRESH_MIN_MS = 5000; // focus/visible refreshes closer than this are skipped

// The app's two Facebook UI gates. fbEnabled = Facebook screens / connect; receiptUi = the
// Messenger receipt button + the Receipt format screen. Non-testers (all false) see neither.
export function fbUiGates(a: { fbFlag: boolean; fbPreview: boolean; access: FbAccess }): { fbEnabled: boolean; receiptUi: boolean } {
  return { fbEnabled: a.fbFlag || a.fbPreview || a.access.facebook, receiptUi: a.fbPreview || a.access.receipt };
}

async function bearer(): Promise<string> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    return session?.access_token || "";
  } catch {
    return "";
  }
}

// → the server's answer, or null on any failure (the caller treats null as no access).
export async function loadFbAccess(): Promise<FbAccess | null> {
  try {
    const r = await fetch(`${SERVER}/fb/access`, { method: "GET", headers: { Authorization: `Bearer ${await bearer()}` } });
    if (r.status !== 200) return null;
    const j = (await r.json().catch(() => null)) as { ok?: unknown; facebook?: unknown; receipt?: unknown } | null;
    if (!j || j.ok !== true) return null;
    return { facebook: j.facebook === true, receipt: j.receipt === true };
  } catch {
    return null;
  }
}

// Asks once per signed-in account (userKey) and again when the app regains focus / becomes
// visible. Until the first answer, and after a failed ask, both are false. A refresh keeps the
// last answer while it is in flight (no flicker on every focus); its failure → both false.
export function useFbAccess(enabled: boolean, userKey: string): FbAccess {
  const [state, setState] = useState<{ key: string; access: FbAccess }>({ key: "", access: FB_ACCESS_NONE });
  const key = enabled ? userKey : "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let last = 0;
    const ask = () => {
      const t = Date.now();
      if (t - last < FB_ACCESS_REFRESH_MIN_MS) return;
      last = t;
      void loadFbAccess().then((a) => { if (alive) setState({ key, access: a || FB_ACCESS_NONE }); });
    };
    ask();
    const onFocus = () => ask();
    const onVisible = () => { if (typeof document === "undefined" || document.visibilityState !== "hidden") ask(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);
  // An answer for another account (or none yet) never counts.
  return key && state.key === key ? state.access : FB_ACCESS_NONE;
}
