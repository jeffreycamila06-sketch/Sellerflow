// Sales Report v2 — historical periods from the billing `orders` ledger via the
// sql/15 `sales_report(period)` aggregate RPC (miners_stats pattern: SECURITY
// INVOKER + explicit own-row filter server-side, ONE small jsonb per call).
// ZERO POLL: one RPC per period switch, cached per period until reload.
// The "Today" view stays the existing session-derived computeSales — untouched.
// Timezone: all day/month bucketing happens IN THE RPC in Asia/Taipei; this
// module does no date math beyond picking the max-revenue day from the series.
import { useCallback, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

export type SalesPeriod = "7d" | "month" | "last_month";
export const SALES_PERIODS: SalesPeriod[] = ["7d", "month", "last_month"];

export interface SalesDay { d: string; rev: number; orders: number }
export interface SalesTopProduct { name: string; rev: number; orders: number }
export interface SalesTopBuyer { name: string; spent: number; orders: number }
export interface SalesHistData {
  revenue: number; orders: number; buyers: number; aov: number;
  // % deltas vs the equivalent previous period; null = no comparable base (prev = 0)
  dRevenue: number | null; dOrders: number | null; dBuyers: number | null; dAov: number | null;
  repeatPct: number | null;      // buyers with ≥2 orders / buyers, null when 0 buyers
  days: SalesDay[];              // Taipei-day revenue series (chart)
  bestDay: SalesDay | null;      // max-revenue day of the period
  topProducts: SalesTopProduct[];
  topBuyers: SalesTopBuyer[];
  start: string; end: string;    // inclusive period bounds (display)
}

// % change vs the previous period. prev ≤ 0 → null (no meaningful base; the
// screen renders a neutral "—" chip instead of a fake ±100%).
export function pctDelta(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

const num = (v: unknown): number => Number(v) || 0;

// sales_report RPC jsonb → screen shape (pure — unit-tested; garbage-safe).
export function mapSalesReport(raw: unknown): SalesHistData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cur = (r.cur && typeof r.cur === "object" ? r.cur : {}) as Record<string, unknown>;
  const prev = (r.prev && typeof r.prev === "object" ? r.prev : {}) as Record<string, unknown>;
  const revenue = num(cur.revenue), orders = num(cur.orders), buyers = num(cur.buyers);
  const pRevenue = num(prev.revenue), pOrders = num(prev.orders), pBuyers = num(prev.buyers);
  const aov = orders ? Math.round(revenue / orders) : 0;
  const pAov = pOrders ? Math.round(pRevenue / pOrders) : 0;
  const days: SalesDay[] = Array.isArray(r.days)
    ? (r.days as Record<string, unknown>[]).map((x) => ({ d: String(x.d ?? ""), rev: num(x.rev), orders: num(x.orders) }))
    : [];
  const bestDay = days.reduce<SalesDay | null>((best, d) => (best === null || d.rev > best.rev ? d : best), null);
  const mapTop = <T,>(v: unknown, f: (x: Record<string, unknown>) => T): T[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]).map(f) : [];
  return {
    revenue, orders, buyers, aov,
    dRevenue: pctDelta(revenue, pRevenue),
    dOrders: pctDelta(orders, pOrders),
    dBuyers: pctDelta(buyers, pBuyers),
    dAov: pctDelta(aov, pAov),
    repeatPct: buyers ? Math.round((num(cur.repeat_buyers) / buyers) * 100) : null,
    days, bestDay,
    topProducts: mapTop(r.top_products, (x) => ({ name: String(x.name ?? ""), rev: num(x.rev), orders: num(x.orders) })),
    topBuyers: mapTop(r.top_buyers, (x) => ({ name: String(x.name ?? ""), spent: num(x.spent), orders: num(x.orders) })),
    start: String(r.start ?? ""), end: String(r.end ?? ""),
  };
}

export type SalesHistState = "loading" | "live" | "empty" | "error";

export interface UseSalesReport {
  data: SalesHistData | null;      // null until the period's RPC resolves
  state: SalesHistState;
  load: (p: SalesPeriod) => void;  // one RPC per period; cached per period
  reload: () => void;              // drop the cache (pull-to-refresh path)
}

export function useSalesReport(enabled: boolean): UseSalesReport {
  const [cache, setCache] = useState<Partial<Record<SalesPeriod, SalesHistData>>>({});
  const [current, setCurrent] = useState<SalesPeriod | null>(null);
  const [state, setState] = useState<SalesHistState>("loading");
  // One RPC per period; no effects — load/reload are user-action driven
  // (write-on-action / read-on-tap; zero poll, zero mount reads).
  const fetchPeriod = useCallback((p: SalesPeriod) => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setState("error"); return; }
    setState("loading");
    supabase.rpc("sales_report", { p_period: p }).then(
      ({ data: raw, error }) => {
        if (error) { setState("error"); return; }
        const mapped = mapSalesReport(raw);
        setCache((c) => ({ ...c, [p]: mapped }));
        setState(mapped.orders > 0 ? "live" : "empty");
      },
      () => setState("error"),
    );
  }, [enabled]);
  const load = useCallback((p: SalesPeriod) => {
    setCurrent(p);
    const hit = cache[p];
    if (hit) { setState(hit.orders > 0 ? "live" : "empty"); return; }
    fetchPeriod(p);
  }, [cache, fetchPeriod]);
  const reload = useCallback(() => {
    setCache({});
    if (current) fetchPeriod(current);
  }, [current, fetchPeriod]);
  return { data: current ? cache[current] ?? null : null, state, load, reload };
}
