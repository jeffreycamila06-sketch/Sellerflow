// Sales tab data — the billing `orders` ledger via the sql/56 sales_report RPC
// (ranges: today / session / 7 days / 2 months / custom). ZERO POLL: one RPC per
// range switch, cached per range key. Reuses mapSalesReport (same jsonb shape as
// the Sales Report screen) — tiles + daily trend + top buyers, all server-side
// aggregated in Asia/Taipei. p_top=50 so the top-buyers list is searchable.
import { useCallback, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { mapSalesReport, type SalesHistData } from "./salesReport";

export type SalesTabRange = "today" | "session" | "7d" | "2months" | "custom";
export const SALES_TAB_TOP = 50;

// range → sales_report RPC args. session/custom become a Taipei date 'range';
// the client owns the bounds (session = [windowStart..today], custom = pickers).
export function rpcArgsFor(range: SalesTabRange, bounds: { sessionStart: string; today: string; from?: string; to?: string }): Record<string, unknown> {
  const base = { p_top: SALES_TAB_TOP };
  if (range === "today") return { p_period: "today", ...base };
  if (range === "7d") return { p_period: "7d", ...base };
  if (range === "2months") return { p_period: "2months", ...base };
  if (range === "session") return { p_period: "range", p_from: bounds.sessionStart || bounds.today, p_to: bounds.today, ...base };
  // custom — only valid with both pickers set (the screen gates the call)
  return { p_period: "range", p_from: bounds.from, p_to: bounds.to, ...base };
}
// a cache key that distinguishes custom ranges (and today's shifting session)
export function rangeKey(range: SalesTabRange, bounds: { sessionStart: string; today: string; from?: string; to?: string }): string {
  if (range === "session") return `session:${bounds.sessionStart}:${bounds.today}`;
  if (range === "custom") return `custom:${bounds.from ?? ""}:${bounds.to ?? ""}`;
  return `${range}:${bounds.today}`; // today/7d/2months roll with the Taipei day
}

export type SalesTabState = "loading" | "live" | "empty" | "error";
export interface UseSalesTab {
  data: SalesHistData | null;
  state: SalesTabState;
  range: SalesTabRange;
  load: (range: SalesTabRange, bounds: { sessionStart: string; today: string; from?: string; to?: string }) => void;
  reload: () => void;
}

export function useSalesTab(enabled: boolean): UseSalesTab {
  const [cache, setCache] = useState<Record<string, SalesHistData>>({});
  const [range, setRange] = useState<SalesTabRange>("session");
  const [key, setKey] = useState<string>("");
  const [lastArgs, setLastArgs] = useState<Record<string, unknown> | null>(null);
  const [state, setState] = useState<SalesTabState>("loading");

  const fetchArgs = useCallback((k: string, args: Record<string, unknown>) => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setState("error"); return; }
    setState("loading");
    supabase.rpc("sales_report", args).then(
      ({ data: raw, error }) => {
        if (error) { setState("error"); return; }
        const mapped = mapSalesReport(raw);
        setCache((c) => ({ ...c, [k]: mapped }));
        setState(mapped.orders > 0 ? "live" : "empty");
      },
      () => setState("error"),
    );
  }, [enabled]);

  const load = useCallback((r: SalesTabRange, bounds: { sessionStart: string; today: string; from?: string; to?: string }) => {
    setRange(r);
    // custom with incomplete pickers → don't call; the screen shows a prompt
    if (r === "custom" && (!bounds.from || !bounds.to)) { setKey(""); setLastArgs(null); setState("empty"); return; }
    const k = rangeKey(r, bounds);
    const args = rpcArgsFor(r, bounds);
    setKey(k); setLastArgs(args);
    const hit = cache[k];
    if (hit) { setState(hit.orders > 0 ? "live" : "empty"); return; }
    fetchArgs(k, args);
  }, [cache, fetchArgs]);

  const reload = useCallback(() => {
    if (!key || !lastArgs) return;
    setCache((c) => { const n = { ...c }; delete n[key]; return n; });
    fetchArgs(key, lastArgs);
  }, [key, lastArgs, fetchArgs]);

  return { data: key ? cache[key] ?? null : null, state, range, load, reload };
}
