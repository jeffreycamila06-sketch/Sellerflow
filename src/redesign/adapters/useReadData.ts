// Phase 5b — READ-ONLY data adapters. Compose the EXISTING exported read
// functions (accountDb.ts) + pure lib cores. NO writes happen here:
//   • customers: own-filtered paged select + miners_stats() aggregate RPC
//     (sql/14) — NOT db.ts getCustomersFromDatabase, whose unfiltered select
//     hit the 1,000-row PostgREST cap and the admin-wide RLS scope (2026-07-05)
//   • listUsers (accountDb.ts)       → select seller_profiles (RLS; admin sees all)
//
// Imports only — does NOT touch App.tsx / supabase.ts / db.ts / accountDb.ts /
// lib/*. Each hook falls back to the redesign sample data when Supabase is not
// configured or a read errors, and shows a proper empty state when a real query
// returns nothing (so the preview never looks broken, and a real-but-empty test
// account reads as empty rather than fake).
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { listUsers, listAuditLogs, type AccountUser, type AccountAuditLog } from "../../accountDb";
import type { RebuiltSession } from "../../lib/orderLogic";
import { planDaysLeft, daysDisplay, isActivePaid, isExpiredPaid, isExpiringNotExpired, EXPIRING_WINDOW_DAYS } from "../../lib/planWindow";
import { isAdminRole } from "../../lib/roles";
import { accountList } from "./connect";
import { planLabel } from "./useAuthSession";

// Shared plan-expiry core (single source of truth with App.tsx) — re-exported
// so screens keep importing from this adapter.
export { planDaysLeft, daysDisplay, EXPIRING_WINDOW_DAYS };
import {
  CUSTOMERS as SAMPLE_CUSTOMERS,
  USERS as SAMPLE_USERS,
  PLAN_PRICE,
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
      // Orders search (2026-07-13) — additive: orderNum identifies the order
      // for Reprint resolution; date drives the per-row date chip (history
      // rows + earlier days of a multi-day window).
      orderNum: o.orderNum,
      date: o.date,
    }))
    .reverse();
}

// Unified Orders search (torn-sticker recovery, 2026-07-13) — ONE input, every
// field: the sorter types WHATEVER survived the tear and never picks a field.
// Haystack per row: "#bNum" (both "23" and "#23" hit — o.id IS `#${bNum}`,
// verified not a UUID), buyer name, @handle (with or without @ — stored with
// @), item/price-code text, clock time, total, platform. Contains match,
// case-insensitive — same mechanics as filterCustomers, wider net.
export function filterOrders(orders: Order[], query: string): Order[] {
  const q = query.trim().toLowerCase();
  if (!q) return orders;
  return orders.filter((o) =>
    `${o.id} ${o.buyer} ${o.handle} ${o.items} ${o.time} ${o.total} ${o.platform}`.toLowerCase().includes(q));
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
    role: isAdminRole(u.role) ? "Admin" : "Seller", // Batch E #16 — shared predicate (db-cased "admin")
    plan: planLabel(u.plan),
    days: planDaysLeft(u.planExpiry, nowMs), // real days remaining
    // "Accounts N" = the ACTUAL saved TikTok handles, parsed with the SAME shared
    // helper the Edit modal + account-cap + connect flow use (accountList: comma/
    // newline split, trim, drop blanks, dedup). Was `connectedAccounts.length` —
    // a DIFFERENT column (connected_accounts = platform markers, often empty) that
    // undercounted to 0 for sellers whose tiktok field held a handle (2026-07-24).
    accounts: String(accountList(u.profile.tiktok).length),
    status: u.planStatus, // surfaces "expired"/"pending"/"active" in the panel
    planExpiry: u.planExpiry,
    planStatus: u.planStatus,
  }));
}

// ── Admin subscription buckets — derived from the real seller list via the
// SHARED lib/planWindow predicates (single source of truth with App.tsx).
// Admins excluded. Time-limited plans only (free = cap-limited, never here);
// pending excluded from expired/expiring (its expiry is set to now() by the
// pending flow). `days` = planDaysLeft (Infinity = no expiry).
//   active   = paid, status active, days>0
//   expired  = paid, non-pending, (status expired or days==0)
//   expiring = paid, non-pending, days 1..EXPIRING_WINDOW_DAYS, NOT expired
//              (isExpiringNotExpired = still-alive subset, DISJOINT from expired —
//               so a days==0 seller is in Expired only, never both lists)
// Active + Expiring sort by days-left ASC (soonest expiry on top — the order
// self-updates as days pass), ties alphabetical by email. Infinity-safe:
// no-expiry rows sink to the bottom without a NaN comparator.
// Expired sorts DIFFERENTLY (2026-07-28): days-left is useless there (every
// past-due row clamps to 0), so the Expired list orders by the actual expiry
// TIMESTAMP, most-recently-expired first / oldest last, ties alphabetical by
// email. Missing/invalid expiry sinks to the bottom (never crashes, never top).
export interface SubBuckets { active: User[]; expiring: User[]; expired: User[] }
const planState = (u: User) => ({ plan: u.plan, planStatus: u.planStatus || "", daysLeft: u.days ?? Infinity });
export function compareByDaysLeft(a: User, b: User): number {
  const da = a.days ?? Infinity, db = b.days ?? Infinity;
  if (da !== db) return da < db ? -1 : 1;
  return a.email.localeCompare(b.email);
}
// Parse plan_expiry to epoch ms; missing/invalid → -Infinity (sorts last under
// the descending comparator). Same new Date(...).getTime() semantics as
// lib/planWindow.planDaysLeft, so parsing can never diverge between the two.
const expiryMs = (s?: string): number => {
  const ms = s ? new Date(s).getTime() : NaN;
  return Number.isFinite(ms) ? ms : -Infinity;
};
export function compareByExpiryDesc(a: User, b: User): number {
  const ta = expiryMs(a.planExpiry), tb = expiryMs(b.planExpiry);
  if (ta !== tb) return ta > tb ? -1 : 1; // most-recently-expired (largest ts) first
  return a.email.localeCompare(b.email);
}
export function deriveSubBuckets(users: User[]): SubBuckets {
  const sellers = users.filter((u) => !isAdminRole(u.role)); // Batch E #16
  const active = sellers.filter((u) => isActivePaid(planState(u))).sort(compareByDaysLeft);
  const expired = sellers.filter((u) => isExpiredPaid(planState(u))).sort(compareByExpiryDesc);
  const expiring = sellers.filter((u) => isExpiringNotExpired(planState(u))).sort(compareByDaysLeft);
  return { active, expiring, expired };
}

// One row from the admin RPC list_free_users_status (copied from App.tsx:60).
export interface FreeUserRow { email: string; store_name: string; full_name: string; count: number; cap: number; near_cap: boolean; capped: boolean; cycle_resets_in_days: number }

// ── User-base overview — DERIVED from the already-loaded seller list (no new
// backend). Tier headcount is grouped by PLAN LABEL (not status): free users are
// cap-limited (plan_expiry null → days=Infinity), so a status-based split would
// misplace them. Free is identified by plan==="Free" only.
export interface UserBase {
  total: number; admins: number;
  free: number; trial: number; basic: number; pro: number; master: number;
  paid: number;          // basic + pro + master plan-label tally (incl. expired + the owner's Master); internal aggregate, NOT the paying-customer count
  paidSellers: number;   // paid plan-label tally minus admins (still incl. expired); internal aggregate
  // status health within paid plans — the SAME deriveSubBuckets source as the
  // Subscriptions cards + the paying headline (non-admin; shared lib/planWindow
  // predicates; mutually exclusive active/expired). Admin/owner excluded.
  paidActive: number; paidExpiring: number; paidExpired: number;
  // THE "paying customers" headline — the ONE definition, shared with the Active-paid
  // card and deriveMrr via deriveSubBuckets(...).active: active + paid + non-admin,
  // expired excluded (isActivePaid), admin/owner excluded (deriveSubBuckets filters
  // !isAdminRole). Use THIS for any "paying" display, never `paid`/`paidSellers`.
  paying: number;
}
export function deriveUserBase(users: User[]): UserBase {
  const tally = (label: string) => users.filter((u) => u.plan === label).length;
  const free = tally("Free"), trial = tally("Trial"), basic = tally("Basic"), pro = tally("Pro"), master = tally("Master");
  const paid = basic + pro + master;
  const admins = users.filter((u) => isAdminRole(u.role)).length; // Batch E #16
  const paidUsers = users.filter((u) => u.plan === "Basic" || u.plan === "Pro" || u.plan === "Master");
  const paidSellers = paidUsers.filter((u) => !isAdminRole(u.role)).length;
  // Paid status-health tiles AND the paying headline ALL read from the ONE shared
  // source (deriveSubBuckets: non-admin, then the shared lib/planWindow predicates),
  // so the panel tiles agree with the headline AND the Subscriptions cards. No new
  // predicate. (Was: paidActive filtered paidUsers directly, leaving the admin owner
  // in → 39, contradicting the headline's 38.)
  const buckets = deriveSubBuckets(users);
  const paidActive = buckets.active.length;
  const paidExpired = buckets.expired.length;
  const paidExpiring = buckets.expiring.length;
  const paying = buckets.active.length; // == paidActive; the explicit headline field
  return { total: users.length, admins, free, trial, basic, pro, master, paid, paidSellers, paidActive, paidExpiring, paidExpired, paying };
}

// REAL monthly recurring revenue estimate for the Admin home tile (Batch B #2 —
// replaced the hardcoded "4.2M / ▲12% MoM" sample). Derived from data the admin
// screen ALREADY loads (zero new queries): ACTIVE paid plans × real NT$ tier
// price. Estimate semantics: what active subscriptions are worth per month —
// not cash collected (payments are manual Wise+Telegram; no ledger exists).
export function deriveMrr(users: User[]): number {
  return deriveSubBuckets(users).active.reduce((sum, u) => sum + (PLAN_PRICE[u.plan] ?? 0), 0);
}

// Client-side search over the LOADED customer pages (Batch B #4 — the search bar
// was a dead decoration). Case-insensitive contains on name + handle. Pure.
export function filterCustomers(customers: Customer[], query: string): Customer[] {
  const q = query.trim().toLowerCase();
  if (!q) return customers;
  return customers.filter((c) => `${c.name} ${c.handle}`.toLowerCase().includes(q));
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

// ── Free-tier modal: newest-first sort by signup date (extracted from Admin.tsx
// FreeUserList so it's unit-testable; the component now imports these). Pure.

// Signup timestamp (ms) — the SAME createdAt the "Joined" line shows. Missing /
// not-yet-loaded / invalid → -Infinity so those ("Joined —") rows sink to the
// bottom of a descending sort instead of scrambling it or throwing.
export function signupTime(createdAt: string | undefined | null): number {
  if (!createdAt) return -Infinity;
  const ms = new Date(createdAt).getTime();
  return isNaN(ms) ? -Infinity : ms;
}

// Subtraction-free DESCENDING comparator for signup timestamps. ⚠️ MUST stay this
// exact form — `bm - am` would return NaN for two -Infinity (missing) rows, the
// exact trap this avoids. Equal keys (incl. both-missing) → 0 → stable order.
export function signupCompare(am: number, bm: number): number {
  return am === bm ? 0 : am > bm ? -1 : 1;
}

// Sort a COPY of user-ish rows newest-first by signup date, joining each row to its
// createdAt via rawByEmail (same source as the Joined line). Used by BOTH the
// free-tier list AND the full Manage-sellers list (hence the plan-agnostic name).
// NEVER mutates the input list. (Only reads `.createdAt` off the lookup →
// structural param type.)
export function sortUsersBySignup<T extends { email: string }>(
  list: T[],
  rawByEmail: Record<string, { createdAt?: string } | undefined>,
): T[] {
  return [...list].sort((a, b) =>
    signupCompare(signupTime(rawByEmail[a.email]?.createdAt), signupTime(rawByEmail[b.email]?.createdAt)),
  );
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

// Phone normalization for the Manage Sellers search: digits-only + a Taiwan
// +886/886 → local 0 fold, so a number typed with spaces/dashes/a +886 prefix
// still matches the clean stored format (09xxxxxxxx). Defensive — the DB data is
// already clean, but the QUERY comes from a human. Non-string → "".
export function normPhone(value: string | null | undefined): string {
  let d = String(value ?? "").replace(/\D/g, "");
  if (d.startsWith("886")) d = "0" + d.slice(3); // +886 958… → 0958…
  return d;
}

// Manage Sellers search predicate (ADMIN-ONLY panel; RLS + useAdminUsers gate).
// Text haystack = email + connected @handles + admin contact note (the existing
// behavior, byte-unchanged). PLUS a phone match: the phone lives on the already-
// loaded rawByEmail AccountUser (listUsers select("*")), NOT on the trimmed
// display User — so it is pulled from `raw`. The phone match is SCOPED to the
// phone field only (never dates/ids), normalized both sides, and gated on a
// >=3-digit query so a short/no-digit text search can't phone-match everyone.
// A seller with no phone still matches on the text fields (no crash on "").
export function sellerMatchesQuery(u: User, raw: AccountUser | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const handles = (raw?.connectedAccounts || []).join(" ");
  if (`${u.email} ${handles} ${u.contactNote || ""}`.toLowerCase().includes(q)) return true;
  const qDigits = normPhone(query);
  if (qDigits.length >= 3) {
    const phone = normPhone(raw?.profile.phone);
    if (phone && phone.includes(qDigits)) return true;
  }
  return false;
}

// ── Read hooks ────────────────────────────────────────────────────────────────
// (F-batch sweep: the 5b useLiveOrders hook is gone — superseded in 5e when the
// Orders tab + Dashboard summary switched to the ONE live-session source
// (liveOrdersToRedesign(liveSession.session) in RedesignApp). Nothing called it,
// and its .catch fell back to the sample ORDERS demo — a fake-display risk.)

// ── Customers (paginated, OWN rows only) ─────────────────────────────────────
// 2026-07-05 accuracy fix. The old path (getCustomersFromDatabase = select *
// with no filter/limit) had two real bugs: PostgREST caps at 1,000 rows (4
// sellers already exceed that → silently truncated lists), and the customers
// SELECT RLS is (own OR is_admin()) → an ADMIN downloaded EVERYONE's rows.
// Now: explicit user_id filter (admin sees own data, like every seller) +
// range() pages of 200 accumulated behind a "Load more" button (egress-safe:
// one page per tap, no full-table download on app open).
export const CUSTOMERS_PAGE_SIZE = 200;
// Returns the page's raw rows, or null on any failure (caller keeps prior state).
async function loadOwnCustomersPage(page: number): Promise<Record<string, unknown>[] | null> {
  if (!supabase) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const from = page * CUSTOMERS_PAGE_SIZE;
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("user_id", user.id) // explicit — RLS alone would give an admin ALL sellers' rows
      .order("created_at", { ascending: false })
      .range(from, from + CUSTOMERS_PAGE_SIZE - 1);
    if (error) return null;
    return (data || []) as Record<string, unknown>[];
  } catch {
    return null;
  }
}

export function useCustomers(enabled: boolean): { customers: Customer[]; state: ReadState; hasMore: boolean; loadingMore: boolean; loadMore: () => void; reload: () => void } {
  const [customers, setCustomers] = useState<Customer[]>(SAMPLE_CUSTOMERS);
  const [state, setState] = useState<ReadState>("sample");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0); // next page index to fetch
  const [reloadKey, setReloadKey] = useState(0); // one-shot reload trigger (no polling)
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setState("sample"); setCustomers(SAMPLE_CUSTOMERS); setHasMore(false); return; }
    let active = true;
    setState("loading");
    loadOwnCustomersPage(0).then((rows) => {
      if (!active) return;
      if (rows === null) { setCustomers(SAMPLE_CUSTOMERS); setState("sample"); setHasMore(false); return; }
      const mapped = customerRowsToRedesign(rows, Date.now());
      setCustomers(mapped);
      setPage(1);
      setHasMore(rows.length === CUSTOMERS_PAGE_SIZE);
      if (mapped.length) setState("live");
      else setState("empty");
    });
    return () => { active = false; };
  }, [enabled, reloadKey]);
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || state !== "live") return;
    setLoadingMore(true);
    loadOwnCustomersPage(page).then((rows) => {
      setLoadingMore(false);
      if (rows === null) return; // transient failure: keep the list, button stays for retry
      setCustomers((prev) => [...prev, ...customerRowsToRedesign(rows, Date.now())]);
      setPage((p) => p + 1);
      setHasMore(rows.length === CUSTOMERS_PAGE_SIZE);
    });
  }, [page, hasMore, loadingMore, state]);
  return { customers, state, hasMore, loadingMore, loadMore, reload: () => { setPage(0); setReloadKey((k) => k + 1); } };
}

// ── Miners (aggregate RPC — own totals + top-5, one tiny response) ───────────
// Same 2026-07-05 accuracy fix, server-side: sql/14 `miners_stats()` aggregates
// the caller's OWN customers in Postgres (SECURITY INVOKER + explicit
// user_id = auth.uid()), immune to the 1,000-row cap and to the admin RLS
// scope, and costs one small JSON instead of the whole table. ZERO POLL —
// one RPC per app open + manual reload.
export interface MinersTopBuyer { name: string; handle: string; orders: number; spent: number; platform: string }
export interface MinersStats { buyers: number; orders: number; spent: number; avg: number; tiktokPct: number; fbPct: number }
export const ZERO_MINERS_STATS: MinersStats = { buyers: 0, orders: 0, spent: 0, avg: 0, tiktokPct: 0, fbPct: 0 };

// miners_stats RPC jsonb → screen shapes (pure — unit-tested). Mirrors the old
// client-side derivation exactly: pct rounded off buyers, avg = spent/orders.
export function minersRpcToStats(raw: unknown): { stats: MinersStats; top: MinersTopBuyer[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const buyers = Number(r.buyers) || 0;
  const orders = Number(r.orders) || 0;
  const spent = Number(r.spent) || 0;
  const tiktok = Number(r.tiktok) || 0;
  const tiktokPct = buyers ? Math.round((tiktok / buyers) * 100) : 0;
  const top = Array.isArray(r.top)
    ? (r.top as Record<string, unknown>[]).map((t) => ({
        name: (t.name as string) || (t.handle as string) || "",
        handle: atHandle((t.handle as string) || ""),
        orders: Number(t.orders) || 0,
        spent: Number(t.spent) || 0,
        platform: (t.platform as string) || "",
      }))
    : [];
  return {
    stats: { buyers, orders, spent, avg: orders ? Math.round(spent / orders) : 0, tiktokPct, fbPct: buyers ? 100 - tiktokPct : 0 },
    top,
  };
}

export function useMinerStats(enabled: boolean): { stats: MinersStats; top: MinersTopBuyer[]; state: ReadState; reload: () => void } {
  const [data, setData] = useState<{ stats: MinersStats; top: MinersTopBuyer[] }>({ stats: ZERO_MINERS_STATS, top: [] });
  // "loading" until the RPC resolves; the guard below derives "sample" when
  // disabled/unconfigured (no sync setState inside the effect).
  const [state, setState] = useState<ReadState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !supabase) return;
    let active = true;
    supabase.rpc("miners_stats").then(
      ({ data: raw, error }) => {
        if (!active) return;
        if (error) { setState("sample"); return; } // RPC missing/failed → screen shows clean 0s
        const mapped = minersRpcToStats(raw);
        setData(mapped);
        setState(mapped.stats.buyers > 0 ? "live" : "empty");
      },
      () => { if (active) setState("sample"); },
    );
    return () => { active = false; };
  }, [enabled, reloadKey]);
  return { ...data, state: enabled && isSupabaseConfigured ? state : "sample", reload: () => setReloadKey((k) => k + 1) };
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
