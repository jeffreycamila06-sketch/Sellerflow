import { isSupabaseConfigured, supabase, supabaseConfigHint } from "./supabase";

type Plan = "free" | "trial" | "basic" | "pro" | "master";
type PlanStatus = "active" | "expired" | "pending";
export type Role = "seller" | "admin";

export interface AccountProfile {
  fullName: string;
  storeName: string;
  phone: string;
  tiktok: string;
  facebook: string;
  adminContactNote: string;
}

export interface AccountUser {
  authUserId?: string;
  email: string;
  profile: AccountProfile;
  plan: Plan;
  planStatus: PlanStatus;
  planExpiry: string;
  trialStartedAt?: string;
  connectedAccounts: string[];
  role?: Role;
}

export interface AccountAuditLog {
  id: string;
  actorEmail: string;
  action: string;
  targetEmail: string;
  details: string;
  timestamp: string;
}

const localGet = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value !== null ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const localSet = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
};

type SupabaseRow = Record<string, unknown>;

const textValue = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const stringArrayValue = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function rowToUser(row: SupabaseRow): AccountUser {
  return {
    authUserId: textValue(row.auth_user_id),
    email: textValue(row.email),
    profile: {
      fullName: textValue(row.full_name),
      storeName: textValue(row.store_name),
      phone: textValue(row.phone),
      tiktok: textValue(row.tiktok),
      facebook: textValue(row.facebook),
      adminContactNote: textValue(row.admin_contact_note),
    },
    plan: ["free", "trial", "basic", "pro", "master"].includes(textValue(row.plan)) ? textValue(row.plan) as Plan : "free",
    planStatus: ["active", "expired", "pending"].includes(textValue(row.plan_status)) ? textValue(row.plan_status) as PlanStatus : "active",
    // NULL plan_expiry = NO expiry (dLeft treats "" as Infinity) — defaulting
    // to now() made every NULL-expiry seller read as "expired today".
    planExpiry: textValue(row.plan_expiry),
    trialStartedAt: textValue(row.trial_started_at),
    connectedAccounts: stringArrayValue(row.connected_accounts),
    role: textValue(row.role) === "admin" ? "admin" : "seller",
  };
}

// Columns a seller is allowed to change on their own profile. Server-side
// triggers additionally protect role/plan/plan_status, but we never send those
// from normal profile saves.
function userToRow(user: AccountUser) {
  return {
    full_name: user.profile.fullName,
    store_name: user.profile.storeName,
    phone: user.profile.phone,
    tiktok: user.profile.tiktok,
    facebook: user.profile.facebook,
    connected_accounts: user.connectedAccounts,
    updated_at: new Date().toISOString(),
  };
}

// Plan/role fields, only applied when an admin updates another account.
function planRow(user: AccountUser) {
  return {
    plan: user.plan,
    plan_status: user.planStatus,
    plan_expiry: user.planExpiry,
    trial_started_at: user.trialStartedAt || null,
    role: user.role || "seller",
  };
}

function rowToAudit(row: SupabaseRow): AccountAuditLog {
  return {
    id: String(row.id),
    actorEmail: textValue(row.actor_email),
    action: textValue(row.action),
    targetEmail: textValue(row.target_email),
    details: textValue(row.details),
    timestamp: textValue(row.created_at, new Date().toISOString()),
  };
}

// Returns the signed-in user's own profile (RLS limits sellers to their row;
// admins can also call listUsers to see everyone).
export async function getMyProfile(authUserId: string): Promise<AccountUser | null> {
  if (!isSupabaseConfigured || !supabase || !authUserId) return null;

  const { data, error } = await supabase
    .from("seller_profiles")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    console.error("Load profile error:", error.message);
    return null;
  }
  return data ? rowToUser(data) : null;
}

// Creates the profile row right after Supabase Auth sign-up. The database
// trigger decides role/plan (first account = admin/master, others = pending
// seller), so the client cannot self-promote.
export async function createMyProfile(
  authUserId: string,
  email: string,
  profile: AccountProfile,
): Promise<AccountUser | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from("seller_profiles")
    .insert({
      auth_user_id: authUserId,
      email: email.trim().toLowerCase(),
      full_name: profile.fullName,
      store_name: profile.storeName,
      phone: profile.phone,
      tiktok: profile.tiktok,
      facebook: profile.facebook,
    })
    .select()
    .single();

  if (error) {
    console.error("Create profile error:", error.message);
    throw new Error(`${error.message} (${supabaseConfigHint})`);
  }
  return rowToUser(data);
}

// Admin-only: lists every seller profile. Sellers calling this only see their
// own row because of RLS.
//
// S2 fix (2026-07-05 audit): the old hard `.limit(100)` was a silent time bomb —
// every admin number (Manage Sellers, Active/Expiring/Expired buckets, User Base,
// search corpus) derived from at most 100 rows, and with `created_at ASC` the
// NEWEST signups would vanish first (~26 signups/30d → breach in ~a quarter).
// Now PAGED to completeness (same pattern as the S1 session paging): .range()
// pages until a short page; ANY page error → [] — complete or empty, never a
// silent partial. Ordering adds an email tiebreaker (unique) so page boundaries
// are stable when created_at ties.
export const USERS_PAGE_SIZE = 1000;

// Pure pager over an injected page fetcher — unit-tested with a >100-user
// scenario. null (page error) → [].
export async function fetchAllProfilePages<T>(
  fetchPage: (page: number) => Promise<T[] | null>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const rows = await fetchPage(page);
    if (rows === null) return [];
    all.push(...rows);
    if (rows.length < USERS_PAGE_SIZE) return all;
  }
}

export async function listUsers(): Promise<AccountUser[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  return fetchAllProfilePages<AccountUser>(async (page) => {
    const from = page * USERS_PAGE_SIZE;
    const { data, error } = await supabase!
      .from("seller_profiles")
      .select("*")
      .order("created_at", { ascending: true })
      .order("email", { ascending: true })
      .range(from, from + USERS_PAGE_SIZE - 1);
    if (error) {
      console.error("Load users error:", error.message);
      return null;
    }
    return (data || []).map(rowToUser);
  });
}

// Saves profile changes. For a seller this only affects their own row (RLS),
// and triggers protect role/plan. When an admin passes a row that includes
// plan/role changes, those are applied too.
export async function upsertUser(user: AccountUser, opts: { includePlan?: boolean } = {}): Promise<AccountUser> {
  const cleanUser: AccountUser = { ...user, email: user.email.trim().toLowerCase() };
  if (!isSupabaseConfigured || !supabase) return cleanUser;

  const row = opts.includePlan ? { ...userToRow(cleanUser), ...planRow(cleanUser) } : userToRow(cleanUser);

  let query = supabase.from("seller_profiles").update(row);
  query = cleanUser.authUserId
    ? query.eq("auth_user_id", cleanUser.authUserId)
    : query.eq("email", cleanUser.email);

  const { error } = await query;
  if (error) {
    console.error("Save user error:", error.message);
    throw new Error(`${error.message} (${supabaseConfigHint})`);
  }
  return cleanUser;
}

// Admin-only: delete a seller's profile (revokes app access). Fully removing
// the underlying Supabase Auth user requires a server-side service_role call
// (handled in the backend step), not the browser anon key.
export async function deleteUser(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from("seller_profiles")
    .delete()
    .eq("email", cleanEmail);

  if (error) {
    console.error("Delete user error:", error.message);
    throw new Error(`${error.message} (${supabaseConfigHint})`);
  }
}

// Admin-only: change plan/role fields on another account by email. The
// server-side trigger only honours these column changes when the caller is an
// admin, so a regular seller calling this is silently ignored by the database.
export async function adminUpdatePlan(
  email: string,
  patch: { plan?: Plan; planStatus?: PlanStatus; planExpiry?: string; trialStartedAt?: string | null; role?: Role },
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.plan !== undefined) row.plan = patch.plan;
  if (patch.planStatus !== undefined) row.plan_status = patch.planStatus;
  if (patch.planExpiry !== undefined) row.plan_expiry = patch.planExpiry;
  if (patch.trialStartedAt !== undefined) row.trial_started_at = patch.trialStartedAt;
  if (patch.role !== undefined) row.role = patch.role;

  const { error } = await supabase
    .from("seller_profiles")
    .update(row)
    .eq("email", email.trim().toLowerCase());

  if (error) {
    console.error("Admin update plan error:", error.message);
    throw new Error(`${error.message} (${supabaseConfigHint})`);
  }
}

// Admin-only: set the freeform contact note (e.g. "FB: Lhey Ukay") on a seller
// row. Mirrors adminUpdatePlan's pattern — the DB trigger keeps regular sellers
// from writing this column even if they construct the same UPDATE. Saving an
// empty string is allowed (clears the note).
export async function adminUpdateContactNote(email: string, note: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from("seller_profiles")
    .update({ admin_contact_note: note, updated_at: new Date().toISOString() })
    .eq("email", email.trim().toLowerCase());

  if (error) {
    console.error("Admin update contact note error:", error.message);
    throw new Error(`${error.message} (${supabaseConfigHint})`);
  }
}

export async function listAuditLogs(): Promise<AccountAuditLog[]> {
  const localLogs = localGet<AccountAuditLog[]>("sf_audit_logs", []);
  if (!isSupabaseConfigured || !supabase) return localLogs;

  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    console.error("Load audit logs error:", error.message);
    return localLogs;
  }

  const logs = (data || []).map(rowToAudit);
  localSet("sf_audit_logs", logs);
  return logs;
}

export async function saveAuditLog(log: Omit<AccountAuditLog, "id" | "timestamp">): Promise<void> {
  const nextLog: AccountAuditLog = {
    ...log,
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
  };
  const localLogs = localGet<AccountAuditLog[]>("sf_audit_logs", []);
  localSet("sf_audit_logs", [nextLog, ...localLogs].slice(0, 80));

  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from("audit_logs")
    .insert({
      actor_email: log.actorEmail.toLowerCase(),
      action: log.action,
      target_email: log.targetEmail.toLowerCase(),
      details: log.details,
    });

  if (error) {
    console.error("Save audit log error:", error.message);
  }
}
