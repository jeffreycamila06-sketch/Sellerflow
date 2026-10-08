// Build 2 — "Stop reasons" (switch fb_stop_reasons, sql/104), client half.
//   • When a Facebook connection stops, the server sends the reason on platform_status;
//     useLiveFeed records it (fbLastStop). useFbStopToast shows ONE plain-words toast when the
//     pill goes from green to gray for that Page — never when THIS device tapped Disconnect
//     (its off-latch is set), never for an unknown / missing reason.
//   • needsReconnect: a Page whose access ended (inactive, or its token expiry has passed).
// Display only: the status machine (green / gray / grace) is not touched.
import { useEffect, useRef } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import type { RedesignT } from "../i18n";

export interface FbStop { reason: string; scopeKey: string; at: number }

type ToastKey = "rd_fb_stop_session_end" | "rd_fb_stop_stalled" | "rd_fb_stop_max" | "rd_fb_stop_auth" | "rd_fb_stop_gate" | "rd_fb_stop_restart" | "rd_fb_stop_other_device";
// Seller words only: what happened + what to do next (no reason word, code or technical term).
export const FB_STOP_TOASTS: Record<string, { key: ToastKey; kind: "ok" | "err" }> = {
  session_end: { key: "rd_fb_stop_session_end", kind: "ok" },
  idle: { key: "rd_fb_stop_stalled", kind: "err" },
  fetch_error: { key: "rd_fb_stop_stalled", kind: "err" },
  shutdown: { key: "rd_fb_stop_stalled", kind: "err" },
  max_session: { key: "rd_fb_stop_max", kind: "err" },
  auth: { key: "rd_fb_stop_auth", kind: "err" },
  no_token: { key: "rd_fb_stop_auth", kind: "err" },
  inactive: { key: "rd_fb_stop_auth", kind: "err" },
  feature_gate: { key: "rd_fb_stop_gate", kind: "err" },
  restart: { key: "rd_fb_stop_restart", kind: "err" },
  disconnect: { key: "rd_fb_stop_other_device", kind: "err" }, // this device's own tap never toasts
};

const norm = (s: string | null | undefined) => String(s || "").trim().replace(/^@+/, "").toLowerCase();

// The toast for a green → gray fall, or null. green = the Page key + time the pill went green.
export function fbStopToastFor(a: { on: boolean; offByThisDevice: boolean; stop: FbStop | null; green: { key: string; at: number } | null }, t: RedesignT): { msg: string; kind: "ok" | "err" } | null {
  if (!a.on || a.offByThisDevice || !a.stop || !a.green) return null;
  if (a.stop.at < a.green.at) return null;                                    // a stop from an earlier connection
  if (a.green.key && a.stop.scopeKey && norm(a.green.key) !== norm(a.stop.scopeKey)) return null; // another Page
  const m = FB_STOP_TOASTS[a.stop.reason];
  return m ? { msg: t[m.key], kind: m.kind } : null;
}

// Fires onToast once per green → gray fall of the Facebook pill (mirror of connectToastGate).
export function useFbStopToast(a: { connected: boolean; liveKey: string; stop: FbStop | null; offByThisDevice: boolean; on: boolean; t: RedesignT; onToast: (x: { msg: string; kind: "ok" | "err" }) => void }): void {
  const greenRef = useRef<{ key: string; at: number } | null>(null);
  const argsRef = useRef(a);
  useEffect(() => { argsRef.current = a; });
  useEffect(() => {
    const cur = argsRef.current;
    if (cur.connected) {
      if (!greenRef.current) greenRef.current = { key: cur.liveKey, at: Date.now() };
      else if (cur.liveKey) greenRef.current.key = cur.liveKey;
      return;
    }
    const green = greenRef.current;
    greenRef.current = null;
    if (!green) return;
    const toast = fbStopToastFor({ on: cur.on, offByThisDevice: cur.offByThisDevice, stop: cur.stop, green }, cur.t);
    if (toast) cur.onToast(toast);
  }, [a.connected, a.liveKey]);
}

// A Page whose access ended: marked inactive by the server, or its token has expired.
export function needsReconnect(p: { active: boolean; tokenExpiresAt?: string | null }, nowMs: number): boolean {
  if (p.active === false) return true;
  if (!p.tokenExpiresAt) return false;
  const t = Date.parse(p.tokenExpiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

// Switch ON only: the token expiry of the seller's own Pages (no token, just the date).
export async function loadFbPageExpiries(): Promise<Record<string, string | null>> {
  if (!isSupabaseConfigured || !supabase) return {};
  try {
    const { data, error } = await supabase.from("fb_pages").select("page_id,token_expires_at");
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, string | null> = {};
    for (const r of data as { page_id?: unknown; token_expires_at?: unknown }[]) out[String(r.page_id ?? "")] = typeof r.token_expires_at === "string" ? r.token_expires_at : null;
    return out;
  } catch { return {}; }
}
