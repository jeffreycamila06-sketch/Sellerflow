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

export interface AccountSupportMsg {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  hasProof: boolean;
  proofImage?: string;
  timestamp: string;
  status: "pending" | "approved" | "rejected" | "resolved";
  adminReply?: string;
  repliedAt?: string;
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
    },
    plan: ["free", "trial", "basic", "pro", "master"].includes(textValue(row.plan)) ? textValue(row.plan) as Plan : "free",
    planStatus: ["active", "expired", "pending"].includes(textValue(row.plan_status)) ? textValue(row.plan_status) as PlanStatus : "active",
    planExpiry: textValue(row.plan_expiry, new Date().toISOString()),
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

const PROOF_MARKER = "[[SELLERFLOW_PROOF_IMAGE:";
const PROOF_END = "]]";

function decodeSupportMessage(rawMessage: string) {
  const markerIndex = rawMessage.indexOf(PROOF_MARKER);
  if (markerIndex === -1) return { message: rawMessage, proofImage: "" };

  const imageStart = markerIndex + PROOF_MARKER.length;
  const endIndex = rawMessage.indexOf(PROOF_END, imageStart);
  if (endIndex === -1) return { message: rawMessage, proofImage: "" };

  return {
    message: rawMessage.slice(0, markerIndex).trimEnd(),
    proofImage: rawMessage.slice(imageStart, endIndex),
  };
}

function encodeSupportMessage(message: AccountSupportMsg) {
  if (!message.proofImage) return message.message;
  return `${message.message}\n\n${PROOF_MARKER}${message.proofImage}${PROOF_END}`;
}

function rowToSupport(row: SupabaseRow): AccountSupportMsg {
  const decoded = decodeSupportMessage(textValue(row.message));
  const status = textValue(row.status);
  return {
    id: String(row.id),
    name: textValue(row.name),
    email: textValue(row.email),
    subject: textValue(row.subject),
    message: decoded.message,
    hasProof: Boolean(row.has_proof || decoded.proofImage),
    proofImage: decoded.proofImage,
    timestamp: textValue(row.created_at, new Date().toISOString()),
    status: ["pending", "approved", "rejected", "resolved"].includes(status) ? status as AccountSupportMsg["status"] : "pending",
    adminReply: textValue(row.admin_reply),
    repliedAt: textValue(row.replied_at),
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
export async function listUsers(): Promise<AccountUser[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from("seller_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Load users error:", error.message);
    return [];
  }
  return (data || []).map(rowToUser);
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

export async function deleteSupportMessagesForEmail(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  const localMessages = localGet<AccountSupportMsg[]>("sf_support", []);
  localSet(
    "sf_support",
    localMessages.filter((m) => m.email.toLowerCase() !== cleanEmail)
  );

  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from("support_messages")
    .delete()
    .eq("email", cleanEmail);

  if (error) {
    console.error("Delete support messages error:", error.message);
  }
}

export async function listSupportMessages(): Promise<AccountSupportMsg[]> {
  const localMessages = localGet<AccountSupportMsg[]>("sf_support", []);
  if (!isSupabaseConfigured || !supabase) return localMessages;

  const { data, error } = await supabase
    .from("support_messages")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Load support messages error:", error.message);
    return localMessages;
  }

  if ((!data || data.length === 0) && localMessages.length > 0) {
    await Promise.all(localMessages.map((message) => saveSupportMessage(message)));
    return localMessages;
  }

  const messages = (data || []).map(rowToSupport);
  localSet("sf_support", messages);
  return messages;
}

export async function saveSupportMessage(message: AccountSupportMsg): Promise<AccountSupportMsg> {
  const localMessages = localGet<AccountSupportMsg[]>("sf_support", []);
  localSet("sf_support", [
    ...localMessages.filter((m) => m.id !== message.id),
    message,
  ]);

  if (!isSupabaseConfigured || !supabase) return message;

  const { data, error } = await supabase
    .from("support_messages")
    .insert({
      name: message.name,
      email: message.email.toLowerCase(),
      subject: message.subject,
      message: encodeSupportMessage(message),
      has_proof: message.hasProof || Boolean(message.proofImage),
      status: message.status,
      admin_reply: message.adminReply || "", // column is NOT NULL DEFAULT '' — send "" (no reply yet), never null
      replied_at: message.repliedAt || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Save support message error:", error.message);
    throw new Error(`${error.message} (${supabaseConfigHint})`);
  }

  return rowToSupport(data);
}

export async function updateSupportStatus(id: string, status: AccountSupportMsg["status"]) {
  const localMessages = localGet<AccountSupportMsg[]>("sf_support", []).map((m) =>
    m.id === id ? { ...m, status } : m
  );
  localSet("sf_support", localMessages);

  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from("support_messages")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("Update support message error:", error.message);
  }
}

export async function updateSupportReply(id: string, adminReply: string): Promise<void> {
  const repliedAt = new Date().toISOString();
  const localMessages = localGet<AccountSupportMsg[]>("sf_support", []).map((m) =>
    m.id === id ? { ...m, adminReply, repliedAt } : m
  );
  localSet("sf_support", localMessages);

  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from("support_messages")
    .update({ admin_reply: adminReply, replied_at: repliedAt })
    .eq("id", id);

  if (error) {
    console.error("Update support reply error:", error.message);
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
