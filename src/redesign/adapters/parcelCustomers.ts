// CUSTOMER DETAILS — a phonebook of parcel buyers, auto-populated from every
// Parcel Scan encode (the DB trigger trg_upsert_parcel_customer does the writing
// — see sql/35). This adapter is READ-heavy: a search select + a recent select
// per screen open, plus own-scoped edit / delete of a phonebook row and a small
// COUNT for the pending-parcel batch gate on Import. ZERO poll.
//
// SEPARATE from the live-selling CRM `customers` table (adapters over db.ts) —
// that one is keyed by handle for the comment feed; THIS one is the parcel
// phonebook keyed per (user_id, phone, name). Do not conflate them.
import { isSupabaseConfigured, supabase } from "../../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ParcelCustomer {
  id: string;
  phone: string;
  name: string;   // "" when the row has no name
  storeId: string;
  notes: string;  // holds the buyer's TikTok handle when present
  createdAt: string;
  updatedAt: string;
}

export interface ParcelCustomerEdit {
  name: string | null;
  phone: string | null;
  store_id: string | null;
  notes: string | null;
}

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

function rowToCustomer(row: Record<string, unknown>): ParcelCustomer {
  return {
    id: String(row.id),
    phone: String(row.phone ?? ""),
    name: String(row.name ?? ""),
    storeId: String(row.store_id ?? ""),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const SELECT_COLS = "id, phone, name, store_id, notes, created_at, updated_at";

export const CUSTOMER_SEARCH_LIMIT = 30;
export const CUSTOMER_RECENT_LIMIT = 50;

// The OR filter is a single PostgREST string where commas separate conditions and
// parentheses group them — so a comma / paren / percent / backslash in the raw
// term would break the filter (or inject an extra condition). Strip those to a
// space before wrapping in %…% for the ilike. Leaves letters/digits/CJK intact.
export function sanitizeSearchTerm(q: string): string {
  return String(q ?? "").replace(/[,()%\\]/g, " ").trim();
}

// Phone search normalizes the query to digits only, so "0912-345 678" matches a
// stored "0912345678". Empty when the query has no digits (pure-text search).
export function phoneDigits(q: string): string {
  return String(q ?? "").replace(/\D/g, "");
}

// Search the phonebook by name / phone / notes(handle). Server-side ilike over
// the pg_trgm index (own-scoped by RLS + the explicit user_id filter). Blank
// query → no rows (the screen shows recent instead). Sorted newest-touched first.
export async function searchParcelCustomers(q: string): Promise<{ ok: boolean; rows: ParcelCustomer[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const term = sanitizeSearchTerm(q);
  const digits = phoneDigits(q);
  if (term === "" && digits === "") return { ok: true, rows: [] };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const clauses: string[] = [];
  if (term !== "") { clauses.push(`name.ilike.%${term}%`); clauses.push(`notes.ilike.%${term}%`); }
  if (digits !== "") clauses.push(`phone.ilike.%${digits}%`);
  const { data, error } = await supabase
    .from("parcel_customers")
    .select(SELECT_COLS)
    .eq("user_id", me)
    .or(clauses.join(","))
    .order("updated_at", { ascending: false })
    .limit(CUSTOMER_SEARCH_LIMIT);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => rowToCustomer(r as Record<string, unknown>)) };
}

// The empty-search / screen-open list: most-recently-touched phonebook rows.
export async function loadRecentParcelCustomers(): Promise<{ ok: boolean; rows: ParcelCustomer[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const { data, error } = await supabase
    .from("parcel_customers")
    .select(SELECT_COLS)
    .eq("user_id", me)
    .order("updated_at", { ascending: false })
    .limit(CUSTOMER_RECENT_LIMIT);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => rowToCustomer(r as Record<string, unknown>)) };
}

// Edit a phonebook row directly (own-scoped UPDATE). This edits the PHONEBOOK
// only — it does NOT touch any parcel_scans row (the trigger is one-way:
// parcel_scans → parcel_customers). Awaited; a DB error surfaces inline.
export async function updateParcelCustomer(id: string, fields: ParcelCustomerEdit): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (!id) return { ok: false, error: "no id" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase
    .from("parcel_customers")
    .update({
      name: fields.name,
      phone: fields.phone,
      store_id: fields.store_id,
      notes: fields.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Hard-delete a phonebook row (own-scoped). Deleting a phonebook entry does NOT
// delete any parcel; it only removes the buyer from the re-import list. A future
// encode with the same phone+name will simply re-create it (trigger).
export async function deleteParcelCustomer(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (!id) return { ok: false, error: "no id" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("parcel_customers").delete().eq("id", id).eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// COUNT of the owner's PENDING (not-yet-exported) parcels — the batch gate on
// Import (MAX_PENDING_PARCELS). Head-only exact count (no rows fetched),
// own-scoped by RLS + explicit user_id. On error → { ok:false }; the screen
// blocks the import with a generic error rather than importing past the cap.
export async function countPendingParcels(): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, count: 0, error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, count: 0, error: "not signed in" };
  const { count, error } = await supabase
    .from("parcel_scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", me)
    .neq("status", "exported");
  if (error) return { ok: false, count: 0, error: error.message };
  return { ok: true, count: count ?? 0 };
}
