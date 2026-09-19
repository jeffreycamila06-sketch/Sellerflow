// Miners v2 — ACCURATE, ledger-backed leaderboard. Reads the sql/42
// `miners_report(p_start, p_end, p_limit)` aggregate RPC (SECURITY INVOKER +
// explicit own-row filter server-side, ONE small jsonb per call), which computes
// from the public.orders LEDGER — so a DELETED order immediately drops out (no
// more customers-aggregate drift). Date-range + top-N + repeat-buyer are all
// computed IN THE RPC (never download rows to aggregate client-side — that was
// the 1,000-row cap bug). ZERO POLL: one RPC per range/N change, cached per key,
// plus an explicit Refresh (drops the cache). Timezone: all bucketing is Taipei,
// server-side; this module's date math is pure string arithmetic on Taipei day
// ids passed in (no clock).
import { useCallback, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

// ── Range presets ─────────────────────────────────────────────────────────────
export type MinersRange = "session" | "today" | "7days" | "month" | "custom";
// "All" sends this sentinel; the RPC clamps to [1, 5000] (same value here).
export const MINERS_TOP_ALL = 5000;
export type MinersTopN = 10 | 20 | 50 | typeof MINERS_TOP_ALL;
export const MINERS_TOP_OPTIONS: MinersTopN[] = [10, 20, 50, MINERS_TOP_ALL];

// Pure YYYY-MM-DD arithmetic (UTC-anchored so it's tz-neutral — the inputs are
// already Taipei day ids). Returns "" on a malformed input (never throws).
export function addDaysISO(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return "";
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
export function monthStartISO(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[1]}-${m[2]}-01` : "";
}

// Map a preset → an INCLUSIVE [start, end] Taipei date pair for the RPC.
// todayISO = the app's Taipei day id; sessionStartISO = the current session
// window start (windowStart || today). Custom uses the picker values, swapped if
// reversed; a blank custom bound falls back to today (never an inverted range).
export function minersRangeBounds(
  preset: MinersRange, todayISO: string, sessionStartISO: string,
  customFrom: string, customTo: string,
): { start: string; end: string } {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  switch (preset) {
    case "today":   return { start: today, end: today };
    case "7days":   return { start: addDaysISO(today, -6) || today, end: today };
    case "month":   return { start: monthStartISO(today) || today, end: today };
    case "session": return { start: sessionStartISO || today, end: today };
    case "custom": {
      const a = customFrom || today, b = customTo || today;
      return a <= b ? { start: a, end: b } : { start: b, end: a };
    }
  }
}

// ── Shapes ────────────────────────────────────────────────────────────────────
export interface MinersBuyer {
  name: string; handle: string; platform: string;
  spent: number; orders: number; activeDays: number; repeat: boolean;
}
export interface MinersReportData {
  spent: number; orders: number; buyers: number; avg: number;
  tiktokPct: number; fbPct: number;   // ALL-TIME platform split (orders has no platform)
  top: MinersBuyer[];
  start: string; end: string; limit: number;
}

const num = (v: unknown): number => Number(v) || 0;
const atHandle = (h: string): string => { const s = String(h || "").trim(); return s && !s.startsWith("@") ? `@${s}` : s; };

// miners_report RPC jsonb → screen shape (pure — unit-tested; garbage-safe).
export function mapMinersReport(raw: unknown): MinersReportData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const spent = num(r.spent), orders = num(r.orders), buyers = num(r.buyers);
  const ttAll = num(r.platform_all_tiktok), totAll = num(r.platform_all_total);
  const tiktokPct = totAll ? Math.round((ttAll / totAll) * 100) : 0;
  const top: MinersBuyer[] = Array.isArray(r.top)
    ? (r.top as Record<string, unknown>[]).map((t) => ({
        name: String(t.name ?? ""),
        handle: atHandle(String(t.handle ?? "")),
        platform: String(t.platform ?? ""),
        spent: num(t.spent),
        orders: num(t.orders),
        activeDays: num(t.active_days),
        // trust the server flag but recompute defensively (2+ distinct Taipei days)
        repeat: t.repeat === true || num(t.active_days) >= 2,
      }))
    : [];
  return {
    spent, orders, buyers,
    avg: orders ? Math.round(spent / orders) : 0,
    tiktokPct, fbPct: totAll ? 100 - tiktokPct : 0,
    top,
    start: String(r.start ?? ""), end: String(r.end ?? ""), limit: num(r.limit),
  };
}

export type MinersReportState = "loading" | "live" | "empty" | "error";

export interface UseMinersReport {
  data: MinersReportData | null;
  state: MinersReportState;
  load: (start: string, end: string, limit: number) => void; // one RPC per (start|end|limit); cached
  reload: () => void;                                         // drop cache + refetch current (Refresh)
}

const keyOf = (start: string, end: string, limit: number) => `${start}|${end}|${limit}`;

export function useMinersReport(enabled: boolean): UseMinersReport {
  const [cache, setCache] = useState<Record<string, MinersReportData>>({});
  const [current, setCurrent] = useState<{ start: string; end: string; limit: number } | null>(null);
  const [state, setState] = useState<MinersReportState>("loading");

  const fetchOne = useCallback((start: string, end: string, limit: number) => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setState("error"); return; }
    setState("loading");
    supabase.rpc("miners_report", { p_start: start, p_end: end, p_limit: limit }).then(
      ({ data: raw, error }) => {
        if (error) { setState("error"); return; }
        const mapped = mapMinersReport(raw);
        setCache((c) => ({ ...c, [keyOf(start, end, limit)]: mapped }));
        setState(mapped.orders > 0 ? "live" : "empty");
      },
      () => setState("error"),
    );
  }, [enabled]);

  const load = useCallback((start: string, end: string, limit: number) => {
    setCurrent({ start, end, limit });
    const hit = cache[keyOf(start, end, limit)];
    if (hit) { setState(hit.orders > 0 ? "live" : "empty"); return; }
    fetchOne(start, end, limit);
  }, [cache, fetchOne]);

  const reload = useCallback(() => {
    setCache({});
    if (current) fetchOne(current.start, current.end, current.limit);
  }, [current, fetchOne]);

  return { data: current ? cache[keyOf(current.start, current.end, current.limit)] ?? null : null, state, load, reload };
}
