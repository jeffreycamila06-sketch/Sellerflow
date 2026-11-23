// FREE PLAN — the free orders also belong to the LIVE ACCOUNT (sql/208).
//   • the refused save: a free login adding a live account whose free orders are all used gets the
//     database error "free_account_used" (only once the switch free_account_cap_enforce is on);
//   • the device id of a free login (log only — nothing is ever refused because of it);
//   • Admin: the logins sharing a live account or a device, and "Reset free orders".
// Every call answers and never throws. Before sql/208 the functions are missing: the device note
// does nothing and the Admin panel says it couldn't load.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { browserSessionId } from "./serverIdentity";
import type { RedesignT } from "../i18n";

export const FREE_ACCOUNT_USED = "free_account_used";

export const isFreeAccountUsedError = (e: unknown): boolean =>
  /free_account_used/.test(e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? e ?? ""));

// The one line of a refused save. iPhone app: no plan / price words.
export const freeAccountUsedText = (t: RedesignT, ios: boolean): string => (ios ? t.rd_free_acct_used_ios : t.rd_free_acct_used);

const client = () => (isSupabaseConfigured && supabase ? supabase : null);

// Once per app open for a FREE login (the database ignores a paid one too).
export async function noteMyDevice(): Promise<void> {
  const sb = client(); if (!sb) return;
  try { await sb.rpc("note_my_device", { p_device: browserSessionId() }); } catch { /* log only */ }
}

export interface SharingLogin { userId: string; email: string; plan: string; freeOrders: number }
export interface SharedAccount { platform: string; key: string; label: string; orders: number; logins: SharingLogin[] }
export interface SharedDevice { device: string; logins: SharingLogin[] }
export interface FreeSharing { cap: number; enforce: boolean; accounts: SharedAccount[]; devices: SharedDevice[]; wouldRefuse: number }

const loginsOf = (v: unknown): SharingLogin[] => (Array.isArray(v) ? (v as Record<string, unknown>[]).map((l) => ({
  userId: String(l.user_id ?? ""), email: String(l.email ?? ""), plan: String(l.plan ?? ""), freeOrders: Number(l.free_orders) || 0,
})) : []);

export async function loadFreeSharing(): Promise<FreeSharing | null> {
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("admin_free_sharing");
    if (error || !data || typeof data !== "object") return null;
    const x = data as Record<string, unknown>;
    return {
      cap: Number(x.cap) || 0, enforce: x.enforce === true,
      accounts: Array.isArray(x.accounts) ? (x.accounts as Record<string, unknown>[]).map((a) => ({
        platform: String(a.platform ?? ""), key: String(a.account_key ?? ""), label: String(a.label ?? a.account_key ?? ""),
        orders: Number(a.account_orders) || 0, logins: loginsOf(a.logins),
      })) : [],
      devices: Array.isArray(x.devices) ? (x.devices as Record<string, unknown>[]).map((d) => ({ device: String(d.device ?? ""), logins: loginsOf(d.logins) })) : [],
      wouldRefuse: Array.isArray(x.would_refuse) ? x.would_refuse.length : 0,
    };
  } catch { return null; }
}

export async function resetFreeAccount(platform: string, key: string): Promise<{ ok: boolean; was?: number }> {
  const sb = client(); if (!sb) return { ok: false };
  try {
    const { data, error } = await sb.rpc("admin_free_account_reset", { p_platform: platform, p_key: key });
    if (error || !data || typeof data !== "object") return { ok: false };
    const x = data as Record<string, unknown>;
    return x.ok === true ? { ok: true, was: Number(x.was) || 0 } : { ok: false };
  } catch { return { ok: false }; }
}
