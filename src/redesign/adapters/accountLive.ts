// Account total, Build 2 (sql/85) — which of the seller's accounts may go live.
// account_live_coverage() is one small RPC per screen open (zero poll). If it fails, does
// not exist yet, or enforcement is off, everything here returns "no change" and every
// screen behaves exactly as today.
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { tpl, type RedesignT } from "../i18n";

export type LivePlatform = "tiktok" | "facebook" | "shopee";
export interface CoverageAccount { platform: LivePlatform; key: string; rank: number; covered: boolean }
export interface Coverage { enforce: boolean; limit: number; unlimited: boolean; total: number; accounts: CoverageAccount[] }

export function parseCoverage(raw: unknown): Coverage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const limit = Number(r.limit), total = Number(r.total);
  if (!Number.isFinite(limit) || !Number.isFinite(total) || !Array.isArray(r.accounts)) return null;
  const accounts: CoverageAccount[] = [];
  for (const a of r.accounts as unknown[]) {
    const x = (a || {}) as Record<string, unknown>;
    if ((x.platform === "tiktok" || x.platform === "facebook" || x.platform === "shopee") && typeof x.key === "string") {
      accounts.push({ platform: x.platform, key: x.key, rank: Number(x.rank) || 0, covered: x.covered === true });
    }
  }
  return { enforce: r.enforce === true, limit, unlimited: r.unlimited === true, total, accounts };
}

export async function loadCoverage(): Promise<Coverage | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("account_live_coverage");
    return error ? null : parseCoverage(data);
  } catch {
    return null;
  }
}

// reloadKey: change it (e.g. the account list) to re-read after an add/remove.
export function useAccountCoverage(reloadKey: unknown = 0): Coverage | null {
  const [c, setC] = useState<Coverage | null>(null);
  useEffect(() => {
    let live = true;
    void loadCoverage().then((r) => { if (live) setC(r); });
    return () => { live = false; };
  }, [reloadKey]);
  return c;
}

// The over-limit view (Manage shows every account + labels; the picker offers the oldest)
// applies ONLY while enforcing, to a seller with more registered accounts than the plan.
export function overLimitView(c: Coverage | null): c is Coverage {
  return !!c && c.enforce && !c.unlimited && c.total > c.limit;
}

// Same key as the database (account_tiktok_keys): trim (JS trim + U+200B), strip leading
// @, lowercase. Page / shop ids are compared as given.
export function liveKeyOf(platform: LivePlatform, name: string): string {
  const s = String(name ?? "");
  return platform === "tiktok" ? s.replace(/^[\s\u200b]+|[\s\u200b]+$/g, "").replace(/^@+/, "").toLowerCase() : s.trim();
}

// true / false while the over-limit view applies; null otherwise (no label, no change).
export function isCovered(c: Coverage | null, platform: LivePlatform, name: string): boolean | null {
  if (!overLimitView(c)) return null;
  const k = liveKeyOf(platform, name);
  const hit = c.accounts.find((a) => a.platform === platform && a.key === k);
  return hit ? hit.covered : null;
}

// The live picker's TikTok list. Over the limit (enforcing only): the covered names, oldest
// first. Otherwise null → the caller keeps today's list.
export function coveredTikTokNames(names: string[], c: Coverage | null): string[] | null {
  if (!overLimitView(c)) return null;
  const rank = new Map(c.accounts.filter((a) => a.platform === "tiktok" && a.covered).map((a) => [a.key, a.rank]));
  return names.filter((n) => rank.has(liveKeyOf("tiktok", n))).sort((a, b) => rank.get(liveKeyOf("tiktok", a))! - rank.get(liveKeyOf("tiktok", b))!);
}

// The connect refusal (server code account_not_covered). iOS: no plan / upgrade words.
export const ACCOUNT_NOT_COVERED = "account_not_covered";
export function liveRefusedText(t: RedesignT, opts: { ios: boolean; planName: string; max: number }): string {
  return opts.ios ? tpl(t.rd_acct_live_refused_ios, { max: opts.max }) : tpl(t.rd_acct_live_refused, { plan: opts.planName, max: opts.max });
}
export function notCoveredLabel(t: RedesignT, ios: boolean): string {
  return ios ? t.rd_acct_not_covered_ios : t.rd_acct_not_covered;
}
