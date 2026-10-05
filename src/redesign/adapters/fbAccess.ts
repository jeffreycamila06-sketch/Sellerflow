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
export const FB_ACCESS_RETRY_FIRST_MS = 10_000;  // first automatic retry after a failed call
export const FB_ACCESS_RETRY_EVERY_MS = 30_000;  // further retries, until one succeeds

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
// visible (at most every FB_ACCESS_REFRESH_MIN_MS). Only a SUCCESSFUL answer changes access, in
// either direction: a failed call keeps this account's last successful answer (a short network
// drop or a server restart mid-live must not switch Facebook off), and before the first
// successful answer access is false. After any failed call it retries by itself — after 10 s,
// then every 30 s — until one succeeds; a success cancels the pending retry. Everything stops on
// unmount, sign-out and an account change.
export function useFbAccess(enabled: boolean, userKey: string): FbAccess {
  const [state, setState] = useState<{ key: string; access: FbAccess }>({ key: "", access: FB_ACCESS_NONE });
  const key = enabled ? userKey : "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let last = 0;
    let inFlight = false;
    let fails = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const clearRetry = () => { if (retry != null) { clearTimeout(retry); retry = null; } };
    const ask = (force = false) => {
      if (inFlight) return;
      const t = Date.now();
      if (!force && t - last < FB_ACCESS_REFRESH_MIN_MS) return;
      last = t;
      inFlight = true;
      void loadFbAccess().then((a) => {
        inFlight = false;
        if (!alive) return;
        clearRetry();
        if (a) {
          fails = 0;
          setState({ key, access: a });
          return;
        }
        // Failed: keep the last successful answer; try again by itself.
        const wait = fails === 0 ? FB_ACCESS_RETRY_FIRST_MS : FB_ACCESS_RETRY_EVERY_MS;
        fails += 1;
        retry = setTimeout(() => { retry = null; ask(true); }, wait);
      });
    };
    ask(true);
    const onFocus = () => ask();
    const onVisible = () => { if (typeof document === "undefined" || document.visibilityState !== "hidden") ask(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearRetry();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);
  // An answer for another account (or none yet) never counts.
  return key && state.key === key ? state.access : FB_ACCESS_NONE;
}
