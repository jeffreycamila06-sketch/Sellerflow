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
import { isSupabaseConfigured } from "../../supabase";
import { loadTodaysLiveSession, getCustomersFromDatabase } from "../../db";
import { listUsers, type AccountUser } from "../../accountDb";
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
    role: u.role === "admin" ? "Admin" : "Seller",
    plan: planLabel(u.plan),
    days: planDaysLeft(u.planExpiry, nowMs), // real days remaining
    accounts: String(u.connectedAccounts.length),
    status: u.planStatus, // surfaces "expired"/"pending"/"active" in the panel
    planExpiry: u.planExpiry,
    planStatus: u.planStatus,
  }));
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

export function useCustomers(enabled: boolean): { customers: Customer[]; state: ReadState } {
  const [customers, setCustomers] = useState<Customer[]>(SAMPLE_CUSTOMERS);
  const [state, setState] = useState<ReadState>("sample");
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
  }, [enabled]);
  return { customers, state };
}

// Admin user list. enabled should be true ONLY for an admin profile — a seller's
// listUsers returns just their own row (RLS), which would look broken, so callers
// gate on role and otherwise keep sample.
export function useAdminUsers(enabled: boolean): { users: User[]; state: ReadState; reload: () => void } {
  const [users, setUsers] = useState<User[]>(SAMPLE_USERS);
  const [state, setState] = useState<ReadState>("sample");
  // 5h — reusable loader so the panel can refresh after an admin write.
  const load = useCallback(() => {
    if (!enabled || !isSupabaseConfigured) { setState("sample"); setUsers(SAMPLE_USERS); return () => {}; }
    let active = true;
    setState("loading");
    listUsers()
      .then((list) => {
        if (!active) return;
        const mapped = accountUsersToRedesign(list);
        if (mapped.length) { setUsers(mapped); setState("live"); }
        else { setUsers([]); setState("empty"); }
      })
      .catch(() => { if (active) { setUsers(SAMPLE_USERS); setState("sample"); } });
    return () => { active = false; };
  }, [enabled]);
  useEffect(() => load(), [load]);
  return { users, state, reload: load };
}
