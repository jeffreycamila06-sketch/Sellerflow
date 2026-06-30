// Business Pulse — READ-ONLY admin analytics adapter. Calls the SECURITY DEFINER
// RPC `admin_business_pulse` (is_admin()-gated server-side) which aggregates
// live_session_orders into activity counts ONLY — NO price/revenue is read or
// returned. Egress-safe: ONE RPC call per panel-open + a manual Refresh button.
// ⚠️ ZERO POLLING (no setInterval) — read-on-open + read-on-action only, per the
// egress rule. Web-only gating (isAppShell) is enforced by the caller (Admin.tsx);
// this hook is backend-agnostic.
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

export interface PulseSummary {
  active_15m: number; active_60m: number; orders_60m: number;
  active_today: number; orders_today: number;
}
export interface PulseHour { hr: number; orders: number }
export interface PulseSeller {
  store_name: string | null; email: string | null;
  orders_today: number; orders_60m: number; last_order_at: string | null;
}
export interface PulseData {
  summary: PulseSummary;
  hourly: PulseHour[];
  sellers: PulseSeller[];
  generatedAt: string | null;
}

// "idle" = not enabled / not yet loaded · "loading" = RPC in flight · "live" =
// real rows · "empty" = RPC ok but no activity today · "error" = not-admin / RPC
// failed (the panel shows a clear message — never fake data).
export type PulseState = "idle" | "loading" | "live" | "empty" | "error";

const ZERO_SUMMARY: PulseSummary = { active_15m: 0, active_60m: 0, orders_60m: 0, active_today: 0, orders_today: 0 };

// ── Pure parser (unit-tested; no Supabase/React) ──────────────────────────────
// Validates the RPC JSON shape → PulseData, or null if the gate rejected
// (`ok:false`) / the payload is malformed. Coerces every count to a finite number
// so a NULL aggregate (no rows) renders as 0, never NaN.
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function parsePulse(raw: unknown): PulseData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.ok === false) return null; // not_admin or server-side guard
  const s = (r.summary as Record<string, unknown>) || {};
  const summary: PulseSummary = {
    active_15m: num(s.active_15m), active_60m: num(s.active_60m), orders_60m: num(s.orders_60m),
    active_today: num(s.active_today), orders_today: num(s.orders_today),
  };
  const hourly: PulseHour[] = Array.isArray(r.hourly)
    ? (r.hourly as Record<string, unknown>[]).map((h) => ({ hr: num(h.hr), orders: num(h.orders) }))
    : [];
  const sellers: PulseSeller[] = Array.isArray(r.sellers)
    ? (r.sellers as Record<string, unknown>[]).map((u) => ({
        store_name: (u.store_name as string) ?? null,
        email: (u.email as string) ?? null,
        orders_today: num(u.orders_today), orders_60m: num(u.orders_60m),
        last_order_at: (u.last_order_at as string) ?? null,
      }))
    : [];
  return { summary, hourly, sellers, generatedAt: (r.generated_at as string) ?? null };
}

// Is there any activity to show? (drives "live" vs "empty")
export function pulseHasActivity(d: PulseData): boolean {
  return d.summary.orders_today > 0 || d.summary.orders_60m > 0 || d.sellers.length > 0;
}

// Highest hourly bucket for bar scaling (>=1 to avoid div-by-zero). Pure.
export function maxHourlyOrders(hours: PulseHour[]): number {
  return Math.max(1, ...hours.map((h) => h.orders), 0);
}

// 0..23 → "00:00" Taipei clock label (the RPC already buckets in Asia/Taipei). Pure.
export function hourLabel(hr: number): string {
  const h = ((Math.trunc(hr) % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────
// enabled should be true ONLY when: authed + admin + web (not app shell) + the
// Pulse panel is open. Toggling enabled false→true on each open re-runs load, so
// reopening the panel fetches fresh data WITHOUT any background polling.
export function useBusinessPulse(enabled: boolean): {
  data: PulseData | null; state: PulseState; refresh: () => void;
} {
  const [data, setData] = useState<PulseData | null>(null);
  const [state, setState] = useState<PulseState>("idle");
  const [reloadKey, setReloadKey] = useState(0); // one-shot manual refresh (no polling)

  const load = useCallback(() => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setState("idle"); return () => {}; }
    let active = true;
    setState("loading");
    supabase.rpc("admin_business_pulse")
      .then(({ data: raw, error }: { data: unknown; error: unknown }) => {
        if (!active) return;
        if (error) { setData(null); setState("error"); return; }
        const parsed = parsePulse(raw);
        if (!parsed) { setData(null); setState("error"); return; } // not_admin / malformed
        setData(parsed);
        setState(pulseHasActivity(parsed) ? "live" : "empty");
      })
      .catch(() => { if (active) { setData(null); setState("error"); } });
    return () => { active = false; };
  }, [enabled, reloadKey]);

  useEffect(() => load(), [load]);
  return { data, state, refresh: () => setReloadKey((k) => k + 1) };
}

export { ZERO_SUMMARY };
