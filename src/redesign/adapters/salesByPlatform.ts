// F1 — Sales per platform. Today / This session / 7 days read sql/89 sales_by_platform
// (live_session_orders, kept 10 days); 2 months reads sql/97 sales_by_platform_orders (the
// orders ledger's platform column, sql/96 — only orders created after it count). ZERO POLL:
// one RPC per (platform, range), cached; the existing "All" view is untouched.
import { useCallback, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { addDaysISO } from "./minersReport";
import type { PlatformCounts } from "./platformWorld";

export type SalesPlatform = "TikTok" | "Facebook";
export type PlatformRange = "today" | "session" | "7d" | "2months";

export interface PlatformBest { kind: "code" | "price" | "product"; label: string; qty: number; orders: number; rev: number }
export interface PlatformSalesData {
  platform: string; from: string; to: string;
  orders: number; revenue: number; buyers: number;
  days: { d: string; orders: number; rev: number }[];
  best: PlatformBest[];
}

const num = (v: unknown): number => Number(v) || 0;

// Which per-platform options a seller gets: only with 2+ platforms that have an account;
// then TikTok / Facebook when that one has an account. [] = no selector at all.
export function platformOptions(counts: PlatformCounts | null | undefined): SalesPlatform[] {
  if (!counts) return [];
  const used = (["tiktok", "facebook", "shopee", "instagram"] as const).filter((p) => counts[p] > 0).length;
  if (used < 2) return [];
  const out: SalesPlatform[] = [];
  if (counts.tiktok > 0) out.push("TikTok");
  if (counts.facebook > 0) out.push("Facebook");
  return out;
}

// A Sales-tab range → the per-platform range, or null when the per-platform view has no such
// range (custom, or anything unknown) — never silently "session". Pure.
export function platformRangeFor(range: string): PlatformRange | null {
  return range === "today" || range === "session" || range === "7d" || range === "2months" ? range : null;
}

// range → inclusive Taipei date bounds. Pure. 2 months = 1st of last month → today (sql/57).
export function platformRange(range: PlatformRange, today: string, sessionStart: string): { from: string; to: string } {
  if (range === "today") return { from: today, to: today };
  if (range === "7d") return { from: addDaysISO(today, -6) || today, to: today };
  if (range === "2months") {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
    if (!m) return { from: today, to: today };
    const y = Number(m[1]), mo = Number(m[2]);
    const py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1;
    return { from: `${py}-${String(pm).padStart(2, "0")}-01`, to: today };
  }
  return { from: sessionStart || today, to: today };
}

// Which RPC serves a per-platform range. Pure.
export const platformRpcFor = (range: PlatformRange): string => (range === "2months" ? "sales_by_platform_orders" : "sales_by_platform");

export function mapPlatformSales(raw: unknown): PlatformSalesData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    platform: String(r.platform ?? ""), from: String(r.from ?? ""), to: String(r.to ?? ""),
    orders: num(r.orders), revenue: num(r.revenue), buyers: num(r.buyers),
    days: arr(r.days).map((x) => ({ d: String(x.d ?? ""), orders: num(x.orders), rev: num(x.rev) })),
    best: arr(r.best).map((x) => ({ kind: x.kind === "code" ? "code" : x.kind === "product" ? "product" : "price", label: String(x.label ?? ""), qty: num(x.qty), orders: num(x.orders), rev: num(x.rev) })),
  };
}

export type PlatformSalesState = "idle" | "loading" | "live" | "empty" | "error";
export interface UsePlatformSales {
  data: PlatformSalesData | null;
  state: PlatformSalesState;
  load: (platform: SalesPlatform, from: string, to: string, rpc?: string) => void;
}

export function usePlatformSales(): UsePlatformSales {
  const [cache, setCache] = useState<Record<string, PlatformSalesData>>({});
  const [key, setKey] = useState("");
  const [state, setState] = useState<PlatformSalesState>("idle");
  const current = useRef("");   // a late answer for an older pick never sets the state

  const load = useCallback((platform: SalesPlatform, from: string, to: string, rpc = "sales_by_platform") => {
    const k = rpc === "sales_by_platform" ? `${platform}|${from}|${to}` : `${rpc}|${platform}|${from}|${to}`;
    current.current = k;
    setKey(k);
    const hit = cache[k];
    if (hit) { setState(hit.orders > 0 ? "live" : "empty"); return; }
    if (!isSupabaseConfigured || !supabase) { setState("error"); return; }
    setState("loading");
    supabase.rpc(rpc, { p_from: from, p_to: to, p_platform: platform }).then(
      ({ data, error }) => {
        if (error) { if (current.current === k) setState("error"); return; }
        const m = mapPlatformSales(data);
        setCache((c) => ({ ...c, [k]: m }));
        if (current.current === k) setState(m.orders > 0 ? "live" : "empty");
      },
      () => { if (current.current === k) setState("error"); },
    );
  }, [cache]);

  return { data: key ? cache[key] ?? null : null, state, load };
}
