import { isSupabaseConfigured, supabase } from "./supabase";

type Plan = "trial" | "basic" | "pro" | "master";
type PlanStatus = "active" | "expired" | "pending";

export interface AccountProfile {
  fullName: string;
  storeName: string;
  phone: string;
  tiktok: string;
  facebook: string;
}

export interface AccountUser {
  email: string;
  password: string;
  profile: AccountProfile;
  plan: Plan;
  planStatus: PlanStatus;
  planExpiry: string;
  connectedAccounts: string[];
}

export interface AccountSupportMsg {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  hasProof: boolean;
  timestamp: string;
  status: "pending" | "approved" | "rejected";
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
  } catch {}
};

function rowToUser(row: Record<string, any>): AccountUser {
  return {
    email: row.email,
    password: row.password,
    profile: {
      fullName: row.full_name || "",
      storeName: row.store_name || "",
      phone: row.phone || "",
      tiktok: row.tiktok || "",
      facebook: row.facebook || "",
    },
    plan: row.plan || "trial",
    planStatus: row.plan_status || "active",
    planExpiry: row.plan_expiry || new Date().toISOString(),
    connectedAccounts: row.connected_accounts || [],
  };
}

function userToRow(user: AccountUser) {
  return {
    email: user.email.toLowerCase(),
    password: user.password,
    full_name: user.profile.fullName,
    store_name: user.profile.storeName,
    phone: user.profile.phone,
    tiktok: user.profile.tiktok,
    facebook: user.profile.facebook,
    plan: user.plan,
    plan_status: user.planStatus,
    plan_expiry: user.planExpiry,
    connected_accounts: user.connectedAccounts,
    updated_at: new Date().toISOString(),
  };
}

function rowToSupport(row: Record<string, any>): AccountSupportMsg {
  return {
    id: String(row.id),
    name: row.name || "",
    email: row.email || "",
    subject: row.subject || "",
    message: row.message || "",
    hasProof: Boolean(row.has_proof),
    timestamp: row.created_at || new Date().toISOString(),
    status: row.status || "pending",
  };
}

export async function listUsers(): Promise<AccountUser[]> {
  const localUsers = localGet<AccountUser[]>("sf_users", []);
  if (!isSupabaseConfigured || !supabase) return localUsers;

  const { data, error } = await supabase
    .from("seller_users")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Load users error:", error.message);
    return localUsers;
  }

  if ((!data || data.length === 0) && localUsers.length > 0) {
    await Promise.all(localUsers.map((user) => upsertUser(user)));
    return localUsers;
  }

  const users = (data || []).map(rowToUser);
  localSet("sf_users", users);
  return users;
}

export async function findUser(email: string): Promise<AccountUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  if (!isSupabaseConfigured || !supabase) {
    return localGet<AccountUser[]>("sf_users", []).find((u) => u.email.toLowerCase() === cleanEmail) || null;
  }

  const { data, error } = await supabase
    .from("seller_users")
    .select("*")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (error) {
    console.error("Find user error:", error.message);
    return localGet<AccountUser[]>("sf_users", []).find((u) => u.email.toLowerCase() === cleanEmail) || null;
  }

  if (data) return rowToUser(data);

  const localUser = localGet<AccountUser[]>("sf_users", []).find((u) => u.email.toLowerCase() === cleanEmail) || null;
  if (localUser) await upsertUser(localUser);
  return localUser;
}

export async function upsertUser(user: AccountUser): Promise<AccountUser> {
  const cleanUser = { ...user, email: user.email.trim().toLowerCase() };
  const localUsers = localGet<AccountUser[]>("sf_users", []);
  localSet("sf_users", [
    ...localUsers.filter((u) => u.email.toLowerCase() !== cleanUser.email),
    cleanUser,
  ]);

  if (!isSupabaseConfigured || !supabase) return cleanUser;

  const { error } = await supabase
    .from("seller_users")
    .upsert(userToRow(cleanUser), { onConflict: "email" });

  if (error) {
    console.error("Save user error:", error.message);
  }

  return cleanUser;
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
      message: message.message,
      has_proof: message.hasProof,
      status: message.status,
    })
    .select()
    .single();

  if (error) {
    console.error("Save support message error:", error.message);
    return message;
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
