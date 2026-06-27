// Auto Mode — code→product map storage. Persists the seller's AutoCode list to the
// new per-user public.seller_auto_codes table (RLS user_id = auth.uid()), following
// the seller_session_config pattern. READ-ON-LOAD + WRITE-ON-SAVE only — one select
// on open, one replace-write when the seller saves the map. NO polling.
//
// Imports ONLY the shared supabase singleton + the pure AutoCode type — never
// touches App.tsx / db.ts / supabase.ts / lib/*. The product NAME is stored
// denormalized (snapshot) so loadCodes is self-sufficient for the sold-out toast
// without a catalog join; a rename is reconciled on the next save.
import { isSupabaseConfigured, supabase } from "../../supabase";
import type { AutoCode } from "./autoMode";

// ── Pure mappers (no Supabase / React — unit-tested) ──────────────────────────

export function rowToCode(row: Record<string, unknown>): AutoCode {
  return {
    code: String(row.code ?? ""),
    productLocalId: Number(row.product_local_id),
    price: Number(row.price) || 0,
    productName: String(row.product_name ?? ""),
  };
}

export function codeToRow(c: AutoCode, userId: string, now: number = Date.now()): Record<string, unknown> {
  return {
    user_id: userId,
    code: c.code,
    product_local_id: c.productLocalId,
    product_name: c.productName,
    price: c.price,
    updated_at: new Date(now).toISOString(),
  };
}

// getSession() is LOCAL (no network) — keeps these egress-free beyond the one query.
async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ── Impure DB ops (read-on-load / write-on-save) ──────────────────────────────

// Read this user's code map. null = couldn't read (unconfigured / no session /
// error) → caller keeps whatever it had; [] = real-but-empty map.
export async function loadCodes(): Promise<AutoCode[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase
    .from("seller_auto_codes")
    .select("code,product_local_id,product_name,price")
    .eq("user_id", id)
    .order("code", { ascending: true });
  if (error) { console.error("Load auto codes error:", error.message); return null; }
  return (data || []).map((r) => rowToCode(r as Record<string, unknown>));
}

// Replace the whole map (the setup screen edits the full set, then saves): clear the
// user's rows, then insert the new set. Small map (≤ a few dozen codes), write-on-
// save only. Returns true on success.
export async function saveCodes(codes: AutoCode[]): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const id = await uid();
  if (!id) return false;
  const del = await supabase.from("seller_auto_codes").delete().eq("user_id", id);
  if (del.error) { console.error("Save auto codes (clear) error:", del.error.message); return false; }
  if (!codes.length) return true;
  const ins = await supabase.from("seller_auto_codes").insert(codes.map((c) => codeToRow(c, id)));
  if (ins.error) { console.error("Save auto codes (insert) error:", ins.error.message); return false; }
  return true;
}
