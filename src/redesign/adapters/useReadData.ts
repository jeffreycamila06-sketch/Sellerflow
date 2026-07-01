// Phase 5b — READ-ONLY data adapters. Compose the EXISTING exported read
// functions (db.ts, accountDb.ts) + pure lib cores. NO writes happen here:
//   • loadTodaysLiveSession (db.ts)  → select live_session_orders (today, RLS)
//   • rebuildSessionFromRows (lib)   → pure rows → {buyers, orders}
//   • getCustomersFromDatabase (db.ts) → select customers (RLS)
//   • listUsers (accountDb.ts)       → select seller_profiles (RLS; admin sees all)
//
// Imports only — does NOT touch App.tsx / supabase.ts / db.ts / accountDb.ts /
// lib/*. Each hook falls back to the redesign sample data when Supabase is not
// configured or a read errors, and shows a proper empty state when a real query
// returns nothing (so the preview never looks broken, and a real-but-empty test
// account reads as empty rather than fake).
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { loadTodaysLiveSession, getCustomersFromDatabase } from "../../db";
import { listUsers, listAuditLogs, type AccountUser, type AccountAuditLog } from "../../accountDb";
import { rebuildSessionFromRows, type RebuiltSession } from "../../lib/orderLogic";
import { planLabel } from "./useAuthSession";
import {
  ORDERS as SAMPLE_ORDERS,
  CUSTOMERS as SAMPLE_CUSTOMERS,
  USERS as SAMPLE_USERS,
  type Order, type Customer, type User,
} from "../data";

// "sample" = not wired / unconfigured / error fallback · "loading" = query in
// flight · "live" = real rows · "empty" = real query returned nothing.
export type ReadState = "sample" | "loading" | "live" | "empty";

// ── Pure mappers (no Supabase / React — unit-tested) ──────────────────────────

export function relativeTime(iso: string | undefined | null, nowMs: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const diff = Math.max(0, nowMs - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const atHandle = (h: string): string => {
  const v = (h || "").trim();
  if (!v) return "";
  return v.startsWith("@") ? v : `@${v}`;
};

// Rebuilt live session → redesign Order[] (newest first for the list).
export function liveOrdersToRedesign(rebuilt: RebuiltSession): Order[] {
  return rebuilt.orders
    .map((o) => ({
      id: `#${o.bNum}`,
      buyer: o.name,
      handle: atHandle(o.handle),
      items: o.item,
      qty: o.qty,
      total: o.total,
      status: o.status,
      platform: o.platform,
      time: o.time, // clock string from created_at; screen renders without "ago" in live mode
    }))
    .reverse();
}

// customers rows (Supabase) → redesign Customer[].
export function customerRowsToRedesign(rows: Record<string, unknown>[], nowMs: number): Customer[] {
  return rows.map((r) => {
    const last = (r.updated_at as string) || (r.created_at as string) || "";
    return {
      name: (r.name as string) || (r.handle as string) || "",
      handle: atHandle((r.handle as string) || ""),
      orders: Number(r.total_orders) || 0,
      spent: Number(r.total_spent) || 0,
      last: relativeTime(last, nowMs),
      platform: (r.platform as string) || "",
    };
  });
}

// Days remaining on a plan (Taipei-agnostic; ceil so a partial day counts). Pure.
export function planDaysLeft(planExpiry: string | undefined | null, nowMs: number): number {
  const t = new Date(planExpiry || "").getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - nowMs) / 86400000));
}

// AccountUser[] (real profiles) → redesign admin User[]. `days` = real days left on
// the plan; planExpiry/planStatus are carried so admin "Add days" can extend the
// EXISTING expiry (cumulative) via adminUpdatePlan (5h).
export function accountUsersToRedesign(users: AccountUser[], nowMs: number = Date.now()): User[] {
  return users.map((u) => ({
    email: u.email,
    note: u.profile.adminContactNote || u.profile.fullName || "",
    // RAW contact note (no fullName fallback) so ContactChip parses the real
    // "<platform>:<name>" value — never misreads a full name as a contact.
    contactNote: u.profile.adminContactNote || "",
    role: u.role === "admin" ? "Admin" : "Seller",
    plan: planLabel(u.plan),
    days: planDaysLeft(u.planExpiry, nowMs), // real days remaining
    accounts: String(u.connectedAccounts.length),
    status: u.planStatus, // surfaces "expired"/"pending"/"active" in the panel
    planExpiry: u.planExpiry,
    planStatus: u.planStatus,
  }));
}

// ── Admin subscription buckets — derived from the real seller list, byte-faithful
// to App.tsx (3344-3358). Admins excluded (sellerUsers). `days` = dLeft(planExpiry).
//   active   = active & days>0                                   (activeSellers 3346)
//   expired  = expired or days==0                                (expiredSellers 3347)
//   expiring = paid, non-pending, (expired or days<=1), sorted   (expiringSoonSellers 3356-3358,
//              the same definition behind main's "expiring soon" admin count)
export interface SubBuckets { active: User[]; expiring: User[]; expired: User[] }
export function deriveSubBuckets(users: User[]): SubBuckets {
  const sellers = users.filter((u) => u.role !== "Admin");
  const days = (u: User) => u.days ?? 0;
  const active = sellers.filter((u) => u.planStatus === "active" && days(u) > 0);
  const expired = sellers.filter((u) => u.planStatus === "expired" || days(u) === 0);
  const expiring = sellers
    .filter((u) => u.plan !== "Free" && u.planStatus !== "pending" && (u.planStatus === "expired" || days(u) <= 1))
    .sort((a, b) => days(a) - days(b));
  return { active, expiring, expired };
}

// One row from the admin RPC list_free_users_status (copied from App.tsx:60).
export interface FreeUserRow { email: string; store_name: string; full_name: string; count: number; cap: number; near_cap: boolean; capped: boolean; cycle_resets_in_days: number }

// ── User-base overview — DERIVED from the already-loaded seller list (no new
// backend). Tier headcount is grouped by PLAN LABEL (not status): free users have
// plan_expiry=null → days=0, so a status-based split would wrongly drop them into
// "expired". Free is identified by plan==="Free" only.
export interface UserBase {
  total: number; admins: number;
  free: number; trial: number; basic: number; pro: number; master: number;
  paid: number;          // basic + pro + master (incl. the owner's Master)
  paidSellers: number;   // paid excluding admins (the real paying customers)
  // status health within paid plans (real expiry-based; mutually exclusive active/expired):
  paidActive: number; paidExpiring: number; paidExpired: number;
}
export function deriveUserBase(users: User[]): UserBase {
  const tally = (label: string) => users.filter((u) => u.plan === label).length;
  const free = tally("Free"), trial = tally("Trial"), basic = tally("Basic"), pro = tally("Pro"), master = tally("Master");
  const paid = basic + pro + master;
  const admins = users.filter((u) => u.role === "Admin").length;
  const paidUsers = users.filter((u) => u.plan === "Basic" || u.plan === "Pro" || u.plan === "Master");
  const paidSellers = paidUsers.filter((u) => u.role !== "Admin").length;
  const days = (u: User) => u.days ?? 0;
  const paidActive = paidUsers.filter((u) => u.planStatus === "active" && days(u) > 0).length;
  const paidExpired = paidUsers.filter((u) => u.planStatus === "expired" || days(u) === 0).length;
  const paidExpiring = paidUsers.filter((u) => u.planStatus !== "pending" && (u.planStatus === "expired" || days(u) <= 1)).length;
  return { total: users.length, admins, free, trial, basic, pro, master, paid, paidSellers, paidActive, paidExpiring, paidExpired };
}

// Free-tier cap-progress summary from the already-wired list_free_users_status RPC.
export interface FreeSummary { total: number; nearCap: number; capped: number; orders: number; cap: number }
export function freeUsersSummary(freeUsers: FreeUserRow[]): FreeSummary {
  return {
    total: freeUsers.length,
    nearCap: freeUsers.filter((f) => f.near_cap && !f.capped).length,
    capped: freeUsers.filter((f) => f.capped).length,
    orders: freeUsers.reduce((s, f) => s + (f.count || 0), 0),
    cap: freeUsers[0]?.cap ?? 100,
  };
}

// Audit-log action → semantic color, byte-faithful to App.tsx:3595 (red/green/purple).
export function auditActionColor(action: string): "danger" | "ok" | "accent" {
  const a = action.toLowerCase();
  if (a.includes("delete") || a.includes("reject")) return "danger";
  if (a.includes("approve") || a.includes("created")) return "ok";
  return "accent";
}

// Filter audit logs by query across all displayed fields — App.tsx:3341-3343. Pure.
export function filterAuditLogs(logs: AccountAuditLog[], query: string): AccountAuditLog[] {
  const q = query.trim().toLowerCase();
  if (!q) return logs;
  return logs.filter((log) => [log.actorEmail, log.action, log.targetEmail, log.details, log.timestamp].some((v) => String(v || "").toLowerCase().includes(q)));
}

// ── Read hooks ────────────────────────────────────────────────────────────────

export function useLiveOrders(enabled: boolean): { orders: Order[]; state: ReadState } {
  const [orders, setOrders] = useState<Order[]>(SAMPLE_ORDERS);
  const [state, setState] = useState<ReadState>("sample");
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setState("sample"); setOrders(SAMPLE_ORDERS); return; }
    let active = true;
    setState("loading");
    loadTodaysLiveSession()
      .then((rows) => {
        if (!active) return;
        const mapped = liveOrdersToRedesign(rebuildSessionFromRows(rows));
        if (mapped.length) { setOrders(mapped); setState("live"); }
        else { setOrders([]); setState("empty"); }
      })
      .catch(() => { if (active) { setOrders(SAMPLE_ORDERS); setState("sample"); } });
    return () => { active = false; };
  }, [enabled]);
  return { orders, state };
}

export function useCustomers(enabled: boolean): { customers: Customer[]; state: ReadState; reload: () => void } {
  const [customers, setCustomers] = useState<Customer[]>(SAMPLE_CUSTOMERS);
  const [state, setState] = useState<ReadState>("sample");
  const [reloadKey, setReloadKey] = useState(0); // one-shot reload trigger (no polling)
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setState("sample"); setCustomers(SAMPLE_CUSTOMERS); return; }
    let active = true;
    setState("loading");
    getCustomersFromDatabase()
      .then((rows) => {
        if (!active) return;
        const mapped = customerRowsToRedesign((rows || []) as Record<string, unknown>[], Date.now());
        if (mapped.length) { setCustomers(mapped); setState("live"); }
        else { setCustomers([]); setState("empty"); }
      })
      .catch(() => { if (active) { setCustomers(SAMPLE_CUSTOMERS); setState("sample"); } });
    return () => { active = false; };
  }, [enabled, reloadKey]);
  return { customers, state, reload: () => setReloadKey((k) => k + 1) };
}

// Admin user list. enabled should be true ONLY for an admin profile — a seller's
// listUsers returns just their own row (RLS), which would look broken, so callers
// gate on role and otherwise keep sample.
export function useAdminUsers(enabled: boolean): { users: User[]; rawByEmail: Record<string, AccountUser>; state: ReadState; reload: () => void } {
  const [users, setUsers] = useState<User[]>(SAMPLE_USERS);
  // Raw profiles keyed by email so the admin account-editor can prefill the real
  // tiktok/facebook usernames (the display User only carries the account COUNT).
  const [rawByEmail, setRawByEmail] = useState<Record<string, AccountUser>>({});
  const [state, setState] = useState<ReadState>("sample");
  // 5h — reusable loader so the panel can refresh after an admin write.
  const load = useCallback(() => {
    if (!enabled || !isSupabaseConfigured) { setState("sample"); setUsers(SAMPLE_USERS); setRawByEmail({}); return () => {}; }
    let active = true;
    setState("loading");
    listUsers()
      .then((list) => {
        if (!active) return;
        const map: Record<string, AccountUser> = {};
        for (const u of list) map[u.email] = u;
        setRawByEmail(map);
        const mapped = accountUsersToRedesign(list);
        if (mapped.length) { setUsers(mapped); setState("live"); }
        else { setUsers([]); setState("empty"); }
      })
      .catch(() => { if (active) { setUsers(SAMPLE_USERS); setRawByEmail({}); setState("sample"); } });
    return () => { active = false; };
  }, [enabled]);
  useEffect(() => load(), [load]);
  return { users, rawByEmail, state, reload: load };
}

// Audit log — same exported fn as App.tsx admin refresh (3017). Admin-only;
// READ-ON-LOAD (no poll). listAuditLogs returns newest-first (created_at desc, ≤80)
// + a localStorage fallback, exactly like production.
export function useAuditLogs(enabled: boolean): { logs: AccountAuditLog[]; state: ReadState; reload: () => void } {
  const [logs, setLogs] = useState<AccountAuditLog[]>([]);
  const [state, setState] = useState<ReadState>("sample");
  const load = useCallback(() => {
    if (!enabled || !isSupabaseConfigured) { setState("sample"); setLogs([]); return () => {}; }
    let active = true;
    setState("loading");
    listAuditLogs()
      .then((list) => { if (!active) return; setLogs(list); setState(list.length ? "live" : "empty"); })
      .catch(() => { if (active) { setLogs([]); setState("sample"); } });
    return () => { active = false; };
  }, [enabled]);
  useEffect(() => load(), [load]);
  return { logs, state, reload: load };
}

// Free-tier usage monitor — same RPC as App.tsx admin refresh (3020). Admin-only;
// READ-ON-LOAD (no poll). Returns [] when unconfigured / non-admin / error.
export function useFreeUsers(enabled: boolean): { freeUsers: FreeUserRow[]; state: ReadState; reload: () => void } {
  const [freeUsers, setFreeUsers] = useState<FreeUserRow[]>([]);
  const [state, setState] = useState<ReadState>("sample");
  const load = useCallback(() => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setState("sample"); setFreeUsers([]); return () => {}; }
    let active = true;
    setState("loading");
    supabase.rpc("list_free_users_status")
      .then(({ data }: { data: unknown }) => {
        if (!active) return;
        const rows = (data as FreeUserRow[]) || [];
        setFreeUsers(rows); setState(rows.length ? "live" : "empty");
      })
      .catch(() => { if (active) { setFreeUsers([]); setState("sample"); } });
    return () => { active = false; };
  }, [enabled]);
  useEffect(() => load(), [load]);
  return { freeUsers, state, reload: load };
}
