// 7-11 shipping entries — Supabase CRUD (productsDb pattern). Imports ONLY the
// shared supabase singleton — never touches App.tsx / db.ts / supabase.ts / lib/*.
//
// ⚠️ EGRESS-SAFE: READ-ON-LOAD + WRITE-ON-ACTION ONLY. One select per Shipping
// screen open (current session_key) + one upsert per encode save. NO polling.
//
// Table: sql/09_shipping_entries.sql — RLS user_id = auth.uid(); unique
// (user_id, session_key, buyer_number, bag_number) is the upsert target.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { fetchAllPages } from "../../lib/fetchAllPages";
import { SHIP_TEMP_AMBIENT, SHIP_TEMP_FROZEN, type ShippingEntry, type ShipStatus, type TempLayer } from "./shipping";

// ── Pure mappers (no Supabase / React — unit-tested) ──────────────────────────
export function rowToEntry(row: Record<string, unknown>): ShippingEntry {
  const status = String(row.status ?? "draft");
  const temp = String(row.temp_layer ?? SHIP_TEMP_AMBIENT);
  const ids = Array.isArray(row.included_order_ids) ? (row.included_order_ids as unknown[]).map(Number).filter(Number.isFinite) : [];
  return {
    id: String(row.id),
    sessionKey: String(row.session_key ?? ""),
    buyerNumber: Number(row.buyer_number) || 0,
    bagNumber: Number(row.bag_number) || 1,
    includedOrderIds: ids,
    recipientName: String(row.recipient_name ?? ""),
    phone: String(row.phone ?? ""),
    storeId: String(row.store_id ?? ""),
    tempLayer: (temp === SHIP_TEMP_FROZEN ? SHIP_TEMP_FROZEN : SHIP_TEMP_AMBIENT) as TempLayer,
    productDesc: String(row.product_desc ?? ""),
    orderAmount: Number(row.order_amount) || 0,
    shippingFee: Number(row.shipping_fee) || 0,
    buyerUsername: String(row.buyer_username ?? ""),
    status: (status === "encoded" || status === "exported" ? status : "draft") as ShipStatus,
    exportBatchId: row.export_batch_id ? String(row.export_batch_id) : null,
    exportedAt: row.exported_at ? String(row.exported_at) : null,
    shippedAt: row.shipped_at ? String(row.shipped_at) : null,
  };
}

// `now` injectable for deterministic tests. export_batch_id / exported_at /
// shipped_at are OMITTED — they are stamped exclusively by their RPCs (export /
// mark-shipped), so an encode upsert can never clobber them.
export function entryToRow(e: ShippingEntry, userId: string, nowIso: string): Record<string, unknown> {
  return {
    id: e.id,
    user_id: userId,
    session_key: e.sessionKey,
    buyer_number: e.buyerNumber,
    bag_number: e.bagNumber,
    included_order_ids: e.includedOrderIds,
    recipient_name: e.recipientName,
    phone: e.phone,
    store_id: e.storeId,
    temp_layer: e.tempLayer,
    product_desc: e.productDesc,
    order_amount: e.orderAmount,
    shipping_fee: e.shippingFee,
    buyer_username: e.buyerUsername,
    status: e.status,
    updated_at: nowIso,
  };
}

// getSession() is LOCAL (no network) — same uid pattern as useRaffleConfig.
async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ONE read per screen open — ALL of the seller's rows for this session window.
// Audit #12: PAGED to completeness (the old un-ranged select hit the silent
// 1,000-row PostgREST cap — a heavy multi-day seller with split bags would have
// lost the HIGHEST buyer numbers, and re-saves could double-create bags).
// Ordering (buyer_number, bag_number) is UNIQUE per (user, session_key) — the
// upsert conflict target — so page boundaries are stable. ANY page error → []
// (same contract as before; a partial list would mislabel real parcels).
// Regression: shippingDb.paging.test.
export const SHIPPING_PAGE_SIZE = 1000;
// Batch E (#15): the page loop now goes through the shared lib/fetchAllPages
// (one pager for users/shipping). Contract unchanged: complete rows, [] on any
// page error — never partial.
export async function loadShippingEntries(sessionKey: string): Promise<ShippingEntry[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const id = await uid();
  if (!id) return [];
  const rows = await fetchAllPages<ShippingEntry>(async (page) => {
    const from = page * SHIPPING_PAGE_SIZE;
    const { data, error } = await supabase!
      .from("shipping_entries")
      .select("*")
      .eq("user_id", id)
      .eq("session_key", sessionKey)
      .order("buyer_number", { ascending: true })
      .order("bag_number", { ascending: true })
      .range(from, from + SHIPPING_PAGE_SIZE - 1);
    if (error || !data) return null;
    return data.map((r) => rowToEntry(r as Record<string, unknown>));
  }, SHIPPING_PAGE_SIZE);
  return rows === null ? [] : rows;
}

// One upsert per encode save (write-on-action). Conflict target = the group key,
// so re-saving the same buyer/bag updates in place across devices.
export async function upsertShippingEntry(e: ShippingEntry): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const id = await uid();
  if (!id) return { ok: false, error: "not signed in" };
  const { error } = await supabase
    .from("shipping_entries")
    .upsert(entryToRow(e, id, new Date().toISOString()), { onConflict: "user_id,session_key,buyer_number,bag_number" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// One delete per action (split shrink / remove-split). RLS delete policy scopes
// to the caller; exported rows are guarded in the UI (immutable).
export async function deleteShippingEntry(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("shipping_entries").delete().eq("id", id).eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}
