// Nov 3, 2026 — admin side of the TikTok connection-limit cooldown: read today's Euler-429
// tally + the accounts on cooldown, and clear ONE account's cooldown without a server
// restart. Both calls hit admin-guarded routes (server-side is_admin, like broadcast-translate)
// with the caller's Supabase JWT. Read-on-open + manual refresh — zero polling.
import { SERVER } from "./serverIdentity";
import { supabase } from "../../supabase";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";

export interface CooldownEntry { username: string; sellerId: string; remainingMs: number }
export interface EulerUsage { roomsToday: number; concurrent: number; dailyLimit: number; concurrentLimit: number; warn: boolean }
export interface CooldownStatus { count: number; lastLabel: string | null; lastAt: number | null; cooldowns: CooldownEntry[]; usage: EulerUsage | null }

// Pure: the usage line's red banner — on from 70% of either plan limit (mirrors the server rule).
export const USAGE_WARN_RATIO = 0.7;
export const usageWarns = (u: EulerUsage | null): boolean =>
  !!u && (u.roomsToday >= u.dailyLimit * USAGE_WARN_RATIO || u.concurrent >= u.concurrentLimit * USAGE_WARN_RATIO);

async function authHeaders(): Promise<Record<string, string>> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` };
}

export async function loadTikTokCooldownStatus(): Promise<{ ok: boolean; status?: CooldownStatus; error?: string }> {
  try {
    const r = await fetch(withCodes(`${SERVER}/admin/tiktok-cooldown/status`), { headers: await authHeaders() });
    const j = decodeServerJson(await r.json().catch(() => ({} as { success?: boolean; today?: { count?: number; lastLabel?: string | null; lastAt?: number | null }; usage?: Partial<EulerUsage>; cooldowns?: CooldownEntry[] })));
    if (r.status === 403) return { ok: false, error: "forbidden" };
    if (!r.ok || !j.success) return { ok: false, error: "failed" };
    const u = j.usage;
    const usage: EulerUsage | null = u && Number.isFinite(Number(u.dailyLimit))
      ? { roomsToday: Number(u.roomsToday) || 0, concurrent: Number(u.concurrent) || 0, dailyLimit: Number(u.dailyLimit), concurrentLimit: Number(u.concurrentLimit) || 0, warn: !!u.warn }
      : null;
    return { ok: true, status: { count: Number(j.today?.count) || 0, lastLabel: j.today?.lastLabel ?? null, lastAt: j.today?.lastAt ?? null, cooldowns: Array.isArray(j.cooldowns) ? j.cooldowns : [], usage } };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export async function clearTikTokCooldown(username: string): Promise<{ ok: boolean; cleared?: number; error?: string }> {
  const u = String(username || "").trim().replace(/^@/, "");
  if (!u) return { ok: false, error: "username_required" };
  try {
    const r = await fetch(withCodes(`${SERVER}/admin/tiktok-cooldown/clear`), { method: "POST", headers: await authHeaders(), body: JSON.stringify({ username: u }) });
    const j = decodeServerJson(await r.json().catch(() => ({} as { success?: boolean; cleared?: number; error?: string })));
    if (r.status === 403) return { ok: false, error: "forbidden" };
    if (!r.ok || !j.success) return { ok: false, error: j.error || "failed" };
    return { ok: true, cleared: Number(j.cleared) || 0 };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}
