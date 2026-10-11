// FamilyMart (全家) customers — the phonebook next to Parcel Scan FamilyMart (sql/121).
// Same shape as the 7-11 parcelCustomers adapter, on its own table fm_parcel_customers.
// Filled only by the database trigger on fm_parcel_scans (every add / edit). Here: search,
// recent list, count, own edit / delete. Read on open + per search; zero poll.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { sanitizeSearchTerm, phoneDigits, CUSTOMER_SEARCH_LIMIT, CUSTOMER_RECENT_LIMIT } from "./parcelCustomers";

export interface FmCustomer {
  id: string;
  phone: string;
  name: string;          // "" when the row has no name
  storeId: string;
  buyerUsername: string;
  createdAt: string;
  updatedAt: string;
}

export interface FmCustomerEdit {
  name: string | null;
  phone: string | null;
  store_id: string | null;
  buyer_username: string | null;
}

type Res<T> = { ok: boolean; error?: string } & T;

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

function toCustomer(r: Record<string, unknown>): FmCustomer {
  return {
    id: String(r.id), phone: String(r.phone ?? ""), name: String(r.name ?? ""), storeId: String(r.store_id ?? ""),
    buyerUsername: String(r.buyer_username ?? ""), createdAt: String(r.created_at ?? ""), updatedAt: String(r.updated_at ?? ""),
  };
}

const COLS = "id, phone, name, store_id, buyer_username, created_at, updated_at";
const TABLE = "fm_parcel_customers";

// Search by name / phone / @username. Blank query → no rows (the screen shows recent instead).
export async function searchFmCustomers(q: string): Promise<Res<{ rows: FmCustomer[] }>> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const term = sanitizeSearchTerm(q);
  const digits = phoneDigits(q);
  if (term === "" && digits === "") return { ok: true, rows: [] };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const clauses: string[] = [];
  if (term !== "") { clauses.push(`name.ilike.%${term}%`); clauses.push(`buyer_username.ilike.%${term}%`); }
  if (digits !== "") clauses.push(`phone.ilike.%${digits}%`);
  const { data, error } = await supabase.from(TABLE).select(COLS).eq("user_id", me).or(clauses.join(","))
    .order("updated_at", { ascending: false }).limit(CUSTOMER_SEARCH_LIMIT);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => toCustomer(r as Record<string, unknown>)) };
}

export async function loadRecentFmCustomers(): Promise<Res<{ rows: FmCustomer[] }>> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const { data, error } = await supabase.from(TABLE).select(COLS).eq("user_id", me)
    .order("updated_at", { ascending: false }).limit(CUSTOMER_RECENT_LIMIT);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => toCustomer(r as Record<string, unknown>)) };
}

export async function countFmCustomers(): Promise<Res<{ count: number }>> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, count: 0, error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, count: 0, error: "not signed in" };
  const { count, error } = await supabase.from(TABLE).select("*", { count: "exact", head: true }).eq("user_id", me);
  if (error) return { ok: false, count: 0, error: error.message };
  return { ok: true, count: count ?? 0 };
}

// Edits the phonebook only — never a parcel.
export async function updateFmCustomer(id: string, fields: FmCustomerEdit): Promise<Res<object>> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const me = await uid();
  if (!me || !id) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from(TABLE).update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Removes the buyer from the list only — never a parcel.
export async function deleteFmCustomer(id: string): Promise<Res<object>> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const me = await uid();
  if (!me || !id) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}
