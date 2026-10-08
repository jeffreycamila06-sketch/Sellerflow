// F1 — Sales per platform (sql/89 sales_by_platform over live_session_orders, which keeps
// 10 days). Only Today / This session / 7 days. ZERO POLL: one RPC per (platform, range),
// cached; the billing orders ledger and the existing "All" view are untouched.
import { useCallback, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { addDaysISO } from "./minersReport";
import type { PlatformCounts } from "./platformWorld";

export type SalesPlatform = "TikTok" | "Facebook";
export type PlatformRange = "today" | "session" | "7d";

export interface PlatformBest { kind: "code" | "price"; label: string; qty: number; orders: number; rev: number }
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

// range → inclusive Taipei date bounds. Pure.
export function platformRange(range: PlatformRange, today: string, sessionStart: string): { from: string; to: string } {
  if (range === "today") return { from: today, to: today };
  if (range === "7d") return { from: addDaysISO(today, -6) || today, to: today };
  return { from: sessionStart || today, to: today };
}

export function mapPlatformSales(raw: unknown): PlatformSalesData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    platform: String(r.platform ?? ""), from: String(r.from ?? ""), to: String(r.to ?? ""),
    orders: num(r.orders), revenue: num(r.revenue), buyers: num(r.buyers),
    days: arr(r.days).map((x) => ({ d: String(x.d ?? ""), orders: num(x.orders), rev: num(x.rev) })),
    best: arr(r.best).map((x) => ({ kind: x.kind === "code" ? "code" : "price", label: String(x.label ?? ""), qty: num(x.qty), orders: num(x.orders), rev: num(x.rev) })),
  };
}

export type PlatformSalesState = "idle" | "loading" | "live" | "empty" | "error";
export interface UsePlatformSales {
  data: PlatformSalesData | null;
  state: PlatformSalesState;
  load: (platform: SalesPlatform, from: string, to: string) => void;
}

export function usePlatformSales(): UsePlatformSales {
  const [cache, setCache] = useState<Record<string, PlatformSalesData>>({});
  const [key, setKey] = useState("");
  const [state, setState] = useState<PlatformSalesState>("idle");
  const current = useRef("");   // a late answer for an older pick never sets the state

  const load = useCallback((platform: SalesPlatform, from: string, to: string) => {
    const k = `${platform}|${from}|${to}`;
    current.current = k;
    setKey(k);
    const hit = cache[k];
    if (hit) { setState(hit.orders > 0 ? "live" : "empty"); return; }
    if (!isSupabaseConfigured || !supabase) { setState("error"); return; }
    setState("loading");
    supabase.rpc("sales_by_platform", { p_from: from, p_to: to, p_platform: platform }).then(
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
