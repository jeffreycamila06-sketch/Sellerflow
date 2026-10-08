// Combined account limit (sql/84) — the seller's own numbers + the blocked-add messages.
// account_quota() is one small RPC per screen open (zero poll). If it fails or does not
// exist yet, every caller shows nothing extra and behaves as before.
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { tpl, type RedesignT } from "../i18n";

export interface AccountQuota {
  used: number;
  limit: number;
  unlimited: boolean;
  locked: number;
  nextFreeAt: string | null;
  // Per-platform registered-account counts (sql/87). Absent on an older response → undefined.
  platforms?: { tiktok: number; facebook: number; shopee: number; instagram: number };
}

export function parseQuota(raw: unknown): AccountQuota | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const used = Number(r.used), limit = Number(r.limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
  return {
    used, limit,
    unlimited: r.unlimited === true,
    locked: Number(r.locked) || 0,
    nextFreeAt: typeof r.next_free_at === "string" ? r.next_free_at : null,
    platforms: parsePlatformCounts(r),
  };
}

function parsePlatformCounts(r: Record<string, unknown>): AccountQuota["platforms"] {
  const keys = ["tiktok", "facebook", "shopee", "instagram"] as const;
  const n = keys.map((k) => (typeof r[k] === "number" ? (r[k] as number) : NaN));
  if (n.some((v) => !Number.isFinite(v))) return undefined;
  return { tiktok: n[0], facebook: n[1], shopee: n[2], instagram: n[3] };
}

export async function loadAccountQuota(): Promise<AccountQuota | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("account_quota");
    return error ? null : parseQuota(data);
  } catch {
    return null;
  }
}

// reloadKey: change it (e.g. the account count) to re-read after an add/remove.
// enabled=false → no call at all (stays null).
export function useAccountQuota(reloadKey: unknown = 0, enabled = true): AccountQuota | null {
  const [q, setQ] = useState<AccountQuota | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadAccountQuota().then((r) => { if (live) setQ(r); });
    return () => { live = false; };
  }, [reloadKey, enabled]);
  return q;
}

// "Accounts used: X of Y" — null when unknown or unlimited (admin / exempt).
export function quotaLineText(q: AccountQuota | null, t: RedesignT): string | null {
  if (!q || q.unlimited) return null;
  return tpl(t.rd_acct_used, { used: q.used, max: q.limit });
}

export const isAccountLimitError = (e: unknown): boolean =>
  /account_limit/.test(e instanceof Error ? e.message : String(e ?? ""));

function freeTimeText(iso: string, lang: string, now: number): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  try {
    return d.toLocaleString(lang, sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toLocaleString();
  }
}

// The message for a refused add. q = the seller's numbers BEFORE the add (the refused add
// was rolled back). A seat lock is the cause when the seller's real accounts alone still
// leave room; otherwise the plan total is. iOS: neutral wording (no plan, no upgrade).
export function accountLimitText(
  t: RedesignT, q: AccountQuota | null,
  opts: { ios: boolean; planName: string; lang: string; now?: number },
): string {
  if (!q || q.unlimited) return opts.ios ? t.rd_acct_limit_generic_ios : t.rd_acct_limit_generic;
  if (q.locked > 0 && q.nextFreeAt && q.used - q.locked < q.limit) {
    return tpl(t.rd_acct_locked, { time: freeTimeText(q.nextFreeAt, opts.lang, opts.now ?? Date.now()) });
  }
  return opts.ios
    ? tpl(t.rd_acct_limit_ios, { max: q.limit, used: q.used })
    : tpl(t.rd_acct_limit, { plan: opts.planName, max: q.limit, used: q.used });
}

// Load the numbers, then build the message (one RPC).
export async function accountLimitMessage(t: RedesignT, opts: { ios: boolean; planName: string; lang: string }): Promise<string> {
  return accountLimitText(t, await loadAccountQuota(), opts);
}
