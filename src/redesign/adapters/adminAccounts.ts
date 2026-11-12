// Admin → Manage sellers: a seller's CONNECTED accounts (Facebook Pages / Instagram / Shopee
// shops, sql/153) next to the registered TikTok names, and the plan-downgrade removal.
//   • loadConnectedAccounts()  one small admin-only read per panel open (zero poll)
//   • loadSellerAccounts(uid)  one seller, all four platforms, oldest first (the dialog)
//   • downgradeRemoveRpc(...)  ONE database step: plan + removal of the chosen accounts
//   • stopRemovedLives(...)    best effort: the server stops a running live of a removed account
// The plan number is the TOTAL across TikTok + Facebook + Instagram + Shopee (Oct 8 rule).
import { isSupabaseConfigured, supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import { accountList, maxAcc } from "./connect";
import { withCodes } from "../../lib/errCodes.js";

export type AcctPlatform = "tiktok" | "facebook" | "instagram" | "shopee";
export interface ConnectedAccount { userId: string; platform: Exclude<AcctPlatform, "tiktok">; key: string; name: string; connectedAt: string | null }
export interface SellerAccount { platform: AcctPlatform; key: string; name: string; addedAt: string | null; rank: number }
export interface SellerAccounts { plan: string; limit: number; unlimited: boolean; total: number; accounts: SellerAccount[] }
export interface RemovalItem { platform: AcctPlatform; key: string; name: string }

const PLATFORMS: AcctPlatform[] = ["tiktok", "facebook", "instagram", "shopee"];
const isPlatform = (v: unknown): v is AcctPlatform => PLATFORMS.includes(v as AcctPlatform);
export const PLATFORM_LABEL: Record<AcctPlatform, string> = { tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", shopee: "Shopee" };

// ── every seller's connected accounts, by user id ─────────────────────────────
export function parseConnected(raw: unknown): Record<string, ConnectedAccount[]> | null {
  if (!Array.isArray(raw)) return null;
  const out: Record<string, ConnectedAccount[]> = {};
  for (const r of raw as unknown[]) {
    const x = (r || {}) as Record<string, unknown>;
    const userId = typeof x.user_id === "string" ? x.user_id : "";
    if (!userId || !isPlatform(x.platform) || x.platform === "tiktok" || typeof x.key !== "string" || !x.key) continue;
    (out[userId] ||= []).push({ userId, platform: x.platform, key: x.key, name: typeof x.name === "string" && x.name ? x.name : x.key, connectedAt: typeof x.connected_at === "string" ? x.connected_at : null });
  }
  return out;
}

// null = could not be read (not an admin, sql/153 not applied yet, network) → the card shows
// TikTok only, exactly as before.
export async function loadConnectedAccounts(): Promise<Record<string, ConnectedAccount[]> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("admin_connected_accounts");
    return error ? null : parseConnected(data);
  } catch {
    return null;
  }
}

// "Accounts N" on the card: registered TikTok names + connected Pages / Instagram / shops.
// The old typed Facebook list (seller_profiles.facebook) is NOT counted — the same as the plan rule.
export function accountsTotal(tiktokText: string | null | undefined, connected: ConnectedAccount[] | undefined): number {
  return accountList(tiktokText || "").length + (connected ? connected.length : 0);
}

// ── one seller, all four platforms, oldest first ──────────────────────────────
export function parseSellerAccounts(raw: unknown): SellerAccounts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const limit = Number(r.limit);
  if (!Number.isFinite(limit) || !Array.isArray(r.accounts)) return null;
  const accounts: SellerAccount[] = [];
  for (const a of r.accounts as unknown[]) {
    const x = (a || {}) as Record<string, unknown>;
    if (!isPlatform(x.platform) || typeof x.key !== "string" || !x.key) return null; // an account we cannot name → do not guess
    accounts.push({ platform: x.platform, key: x.key, name: typeof x.name === "string" && x.name ? x.name : x.key, addedAt: typeof x.added_at === "string" ? x.added_at : null, rank: Number(x.rank) || accounts.length + 1 });
  }
  accounts.sort((a, b) => a.rank - b.rank);
  return { plan: String(r.plan || ""), limit, unlimited: r.unlimited === true, total: accounts.length, accounts };
}

// ok | missing (sql/153 is not applied: the plan change goes on as before) | error (a real
// failure: the plan change is NOT made — a failed read is never treated as "nothing to remove").
export type SellerAccountsRead = { status: "ok"; data: SellerAccounts } | { status: "missing" } | { status: "error" };
export async function loadSellerAccounts(userId: string): Promise<SellerAccountsRead> {
  if (!isSupabaseConfigured || !supabase || !userId) return { status: "error" };
  try {
    const { data, error } = await supabase.rpc("admin_seller_accounts", { p_user: userId });
    if (error) {
      const e = error as { code?: string; message?: string };
      const missing = e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(String(e.message || ""));
      return missing ? { status: "missing" } : { status: "error" };
    }
    const parsed = parseSellerAccounts(data);
    return parsed ? { status: "ok", data: parsed } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

// ── the downgrade decision (PURE) ─────────────────────────────────────────────
const PLAN_RANK: Record<string, number> = { free: 0, trial: 1, basic: 2, plus: 3, pro: 4, master: 5 };
const planKey = (p: string | null | undefined) => String(p || "").trim().toLowerCase();
// true only for a known → known move to a lower tier (an unknown plan never opens the dialog).
export function isLowerPlan(from: string | null | undefined, to: string | null | undefined): boolean {
  const a = PLAN_RANK[planKey(from)], b = PLAN_RANK[planKey(to)];
  return a != null && b != null && b < a;
}
// How many accounts must go for the new plan (0 = nothing to do → no dialog).
export function extraAccounts(acc: SellerAccounts | null, newPlan: string): number {
  if (!acc || acc.unlimited) return 0;
  return Math.max(0, acc.total - maxAcc(planKey(newPlan)));
}
export const acctId = (a: { platform: string; key: string }): string => `${a.platform}:${a.key}`;
// The pre-checked ones: the NEWEST `count` accounts (highest rank = the ones the live-start
// rule would not cover on the new plan).
export function defaultRemoval(accounts: SellerAccount[], count: number): string[] {
  if (count <= 0) return [];
  return [...accounts].sort((a, b) => b.rank - a.rank).slice(0, count).map(acctId);
}
export function removalSummary(items: RemovalItem[]): string {
  return items.map((i) => `${PLATFORM_LABEL[i.platform]} ${i.platform === "tiktok" ? "@" : ""}${i.name}`).join(", ");
}

// ── the write: plan + removal in ONE database transaction ─────────────────────
export interface DowngradePatch { plan: string; planStatus?: string; planExpiry?: string; trialStartedAt?: string }
export async function downgradeRemoveRpc(userId: string, patch: DowngradePatch, items: RemovalItem[]): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "unavailable" };
  if (!userId || items.length === 0) return { ok: false, error: "bad_selection" };
  try {
    const { data, error } = await supabase.rpc("admin_downgrade_remove", {
      p_user: userId, p_plan: patch.plan,
      p_plan_status: patch.planStatus ?? null, p_plan_expiry: patch.planExpiry ?? null, p_trial_started_at: patch.trialStartedAt ?? null,
      p_remove: items.map((i) => ({ platform: i.platform, key: i.key })),
    });
    if (error) {
      const m = String((error as { message?: string }).message || "");
      const known = ["accounts_changed", "bad_selection", "not_limited", "forbidden", "not_found", "bad_request"].find((k) => m.includes(k));
      return { ok: false, error: known || "error" };
    }
    return (data as { ok?: boolean } | null)?.ok === true ? { ok: true } : { ok: false, error: "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}

// Best effort, AFTER the removal: the server stops a live that is still running for a removed
// Page / Instagram account / shop (it re-checks that the row is gone; a still-connected account
// is never stopped). false = the server could not be asked (e.g. not deployed yet) — the
// removal itself is already done; such a live simply runs until it ends.
export async function stopRemovedLives(userId: string, items: RemovalItem[]): Promise<boolean> {
  const accounts = items.filter((i) => i.platform !== "tiktok").map((i) => ({ platform: i.platform, key: i.key }));
  if (accounts.length === 0) return true;
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(withCodes(`${SERVER}/admin/accounts/stop-removed`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ user_id: userId, accounts }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// "Nov 7, 2026" (the admin's own locale for month names is not needed: short + unambiguous).
export function fmtAcctDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: "Asia/Taipei", month: "short", day: "numeric", year: "numeric" });
}
