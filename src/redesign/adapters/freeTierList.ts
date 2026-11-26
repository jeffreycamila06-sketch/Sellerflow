// Admin → Free tier list (2026-11-26): three groups (Using now / Finished / No orders yet),
// filter chips, and the look-alike warning. Pure helpers + the ONE read of last order times
// (sql/228 admin_free_tier_activity, is_admin() inside). A warning only: nothing here writes.
import { supabase } from "../../supabase";
import type { AccountUser } from "../../accountDb";
import { accountList } from "./connect";
import { signupTime, signupCompare, type FreeUserRow } from "./useReadData";

export const ACTIVE_DAYS = 7;
export const RECENT_MS = 24 * 3600 * 1000;           // "Last order" green inside this
export const LOOKALIKE_MIN_KEY = 4;                   // shorter keys are ignored

// ── look-alike key ───────────────────────────────────────────────────────────
// lower case, digits / dots / underscores / dashes / spaces removed (and a leading "@").
// "budgetukay1", "budget_ukay2", "@BudgetUkay4" → "budgetukay". Shorter than 4 → null.
export function lookalikeKey(text: string | null | undefined): string | null {
  const k = String(text ?? "").normalize("NFKC").toLowerCase().replace(/^@+/, "").replace(/[0-9._\-\s@]/g, "");
  return k.length >= LOOKALIKE_MIN_KEY ? k : null;
}

/** Every TikTok username of the login (saved list) — the same parser the account cap uses. */
export function usernamesOf(raw: AccountUser | undefined): string[] {
  return accountList(raw?.profile?.tiktok || "").map((h) => h.replace(/^@+/, "").trim()).filter(Boolean);
}

/** The keys of one free row: each TikTok username + the shop name. */
export function keysOf(row: FreeUserRow, raw: AccountUser | undefined): string[] {
  const out = new Set<string>();
  for (const u of usernamesOf(raw)) { const k = lookalikeKey(u); if (k) out.add(k); }
  const shop = lookalikeKey(row.store_name || raw?.profile?.storeName);
  if (shop) out.add(shop);
  return [...out];
}

/**
 * Groups of 2+ FREE rows that share a key (joined through any shared key).
 * Only the rows passed in are compared — the caller passes the free list only,
 * so a paid seller is never compared or shown. Returns email → the group's emails.
 */
export function lookalikeGroups(rows: FreeUserRow[], rawByEmail: Record<string, AccountUser>): Map<string, string[]> {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const byKey = new Map<string, number>();
  rows.forEach((r, i) => {
    for (const k of keysOf(r, rawByEmail[r.email])) {
      const j = byKey.get(k);
      if (j === undefined) byKey.set(k, i); else parent[find(i)] = find(j);
    }
  });
  const sets = new Map<number, string[]>();
  rows.forEach((r, i) => { const root = find(i); sets.set(root, [...(sets.get(root) || []), r.email]); });
  const out = new Map<string, string[]>();
  for (const emails of sets.values()) if (emails.length >= 2) for (const e of emails) out.set(e, emails);
  return out;
}

// ── last order times ────────────────────────────────────────────────────────
/** email → last order time (ms) or null. null = the read failed / function missing. */
export async function loadFreeLastOrders(): Promise<Map<string, number | null> | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("admin_free_tier_activity");
    if (error || !Array.isArray(data)) return null;
    const out = new Map<string, number | null>();
    for (const r of data as { email?: unknown; last_order_at?: unknown }[]) {
      if (typeof r?.email !== "string") continue;
      const ms = typeof r.last_order_at === "string" ? Date.parse(r.last_order_at) : NaN;
      out.set(r.email, Number.isFinite(ms) ? ms : null);
    }
    return out;
  } catch { return null; }
}

export const lastOf = (last: Map<string, number | null> | null, email: string): number | null => last?.get(email) ?? null;
export const isActive7 = (ms: number | null, now: number): boolean => ms !== null && now - ms <= ACTIVE_DAYS * 864e5;

// Descending by time, rows with no time last, stable.
const byLastDesc = (last: Map<string, number | null> | null) => (a: FreeUserRow, b: FreeUserRow) =>
  signupCompare(lastOf(last, a.email) ?? -Infinity, lastOf(last, b.email) ?? -Infinity);

export interface FreeGroups { using: FreeUserRow[]; finished: FreeUserRow[]; none: FreeUserRow[] }
/**
 * a. Using now — used > 0 and < cap, newest last order first.
 * b. Finished — used ≥ cap, newest last order first.
 * c. No orders yet — used 0, newest joined first.
 */
export function groupFreeRows(rows: FreeUserRow[], last: Map<string, number | null> | null, rawByEmail: Record<string, AccountUser>): FreeGroups {
  const used = (r: FreeUserRow) => Number(r.count) || 0;
  const capOf = (r: FreeUserRow) => Number(r.cap) || 0;
  const using = rows.filter((r) => used(r) > 0 && used(r) < capOf(r)).sort(byLastDesc(last));
  const finished = rows.filter((r) => used(r) > 0 && used(r) >= capOf(r)).sort(byLastDesc(last));
  const none = rows.filter((r) => used(r) <= 0)
    .sort((a, b) => signupCompare(signupTime(rawByEmail[a.email]?.createdAt), signupTime(rawByEmail[b.email]?.createdAt)));
  return { using, finished, none };
}

export type FreeFilter = "all" | "active" | "look";
export function filterFreeRows(rows: FreeUserRow[], f: FreeFilter, last: Map<string, number | null> | null, groups: Map<string, string[]>, now: number): FreeUserRow[] {
  if (f === "active") return rows.filter((r) => isActive7(lastOf(last, r.email), now));
  if (f === "look") return rows.filter((r) => groups.has(r.email));
  return rows;
}

/** "just now" / "5m" / "3h" / "2d" — kind + number for the i18n template. */
export function agoParts(ms: number, now: number): { kind: "now" | "m" | "h" | "d"; n: number } {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return { kind: "now", n: 0 };
  if (s < 3600) return { kind: "m", n: Math.floor(s / 60) };
  if (s < 86400) return { kind: "h", n: Math.floor(s / 3600) };
  return { kind: "d", n: Math.floor(s / 86400) };
}

// Signup day (Taiwan time), "Nov 1". Same as the old list.
export function joinedDay(createdAt: string | undefined | null): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Taipei" });
}

