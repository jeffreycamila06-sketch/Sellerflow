// Products — cross-device sync (Part 1). Persists the SAME Product shape used by
// the local `products.ts` adapter to the new `public.products` table, RLS-scoped to
// the signed-in user (user_id = auth.uid()). Imports ONLY the shared supabase
// singleton — never touches App.tsx / db.ts / supabase.ts / lib/*.
//
// ⚠️ EGRESS-SAFE: READ-ON-LOAD + WRITE-ON-ACTION ONLY. One select on open + one
// write per add/edit/delete. NO polling, NO realtime subscription.
//
// Table: (user_id, local_id) PK · name, sku, price, stock, platform ·
// last_ordered_at (RESERVED for Part-2 auto-delete — untouched here) · created_at,
// updated_at. `status` is NOT stored — it is derived from stock on read
// (statusForStock), so it can never drift.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { statusForStock, PRODUCT_DEFAULTS, type Product } from "./products";

const MIGRATED_KEY = "sf_prods_migrated";

// The list is the untouched 5-item demo seed when it has exactly the default rows
// (matched by id + sku) — used so migration never uploads sample data. PURE.
export function isSeedList(local: Product[]): boolean {
  if (local.length !== PRODUCT_DEFAULTS.length) return false;
  return PRODUCT_DEFAULTS.every((d) => local.some((p) => p.id === d.id && p.sku === d.sku));
}

// ── Pure mappers (no Supabase / React — unit-tested) ──────────────────────────

// DB row → Product. Re-derives `status` from stock (never stored). Coerces numeric
// columns defensively (PostgREST can hand back numeric/bigint as string).
export function rowToProduct(row: Record<string, unknown>): Product {
  const stock = Number(row.stock) || 0;
  return {
    id: Number(row.local_id),
    name: String(row.name ?? ""),
    sku: String(row.sku ?? ""),
    price: Number(row.price) || 0,
    stock,
    platform: String(row.platform ?? ""),
    status: statusForStock(stock),
  };
}

// Product → upsert payload. Omits `status` (derived) and `last_ordered_at`
// (RESERVED — leaving it out of the payload means an upsert UPDATE never overwrites
// it). `now` injectable for deterministic tests.
export function productToRow(p: Product, userId: string, now: number = Date.now()): Record<string, unknown> {
  return {
    user_id: userId,
    local_id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    stock: p.stock,
    platform: p.platform,
    updated_at: new Date(now).toISOString(),
  };
}

// One-time migration decision (PURE): migrate local → DB only when nothing has been
// migrated on this device yet AND the local list is real seller data (non-empty and
// NOT the 5-item demo seed). Keeps the demo seed out of the DB and never re-uploads.
export function shouldMigrate(local: Product[], migrated: boolean): boolean {
  if (migrated) return false;
  if (!local.length) return false;
  if (isSeedList(local)) return false;
  return true;
}

// ── once-per-device migration flag (localStorage) ─────────────────────────────
export function alreadyMigrated(): boolean {
  try { return localStorage.getItem(MIGRATED_KEY) === "1"; } catch { return false; }
}
export function markMigrated(): void {
  try { localStorage.setItem(MIGRATED_KEY, "1"); } catch { /* ignore */ }
}

// getSession() is LOCAL (no network) — keeps these calls egress-free beyond the one
// query. RLS + the explicit user_id filter both scope to the signed-in user.
async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ── Impure DB ops (read-on-load / write-on-action) ────────────────────────────

// Read this user's products. Returns null when we COULDN'T read (unconfigured / no
// session / error) so the caller keeps the local cache; returns [] for a real-but-
// empty table (which is what drives the migration decision).
export async function loadProductsDb(): Promise<Product[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase
    .from("products")
    .select("local_id,name,sku,price,stock,platform")
    .eq("user_id", id)
    .order("created_at", { ascending: true });
  if (error) { console.error("Load products error:", error.message); return null; }
  return (data || []).map((r) => rowToProduct(r as Record<string, unknown>));
}

// Write-through for a single add/edit. Upsert keyed (user_id, local_id).
// Batch D (#11): returns false on a DB error so the screen can say the cloud
// copy didn't sync (before, the result was thrown away — the seller believed
// the product was cross-device when it existed on this phone only). Sample/
// unauthed mode returns true — nothing to sync is not a failure.
export async function saveProductDb(p: Product): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return true;
  const id = await uid();
  if (!id) return true;
  const { error } = await supabase.from("products").upsert(productToRow(p, id), { onConflict: "user_id,local_id" });
  if (error) console.error("Save product error:", error.message);
  return !error;
}

// Write-through for a delete. Same Batch D (#11) contract as saveProductDb —
// false = the DB row survived (it would RESURRECT on the next load, since the
// cross-device reconcile is DB-wins), so the screen must undo the local delete.
export async function deleteProductDb(localId: number): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return true;
  const id = await uid();
  if (!id) return true;
  const { error } = await supabase.from("products").delete().eq("user_id", id).eq("local_id", localId);
  if (error) console.error("Delete product error:", error.message);
  return !error;
}

// Bulk upload of the local list (one-time migration). Marks the device migrated on
// success so it never re-uploads.
export async function migrateLocalProducts(local: Product[]): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const id = await uid();
  if (!id || !local.length) return false;
  const rows = local.map((p) => productToRow(p, id));
  const { error } = await supabase.from("products").upsert(rows, { onConflict: "user_id,local_id" });
  if (error) { console.error("Migrate products error:", error.message); return false; }
  markMigrated();
  return true;
}

// Auto Mode — atomic inventory decrement + Part-2 link in ONE write, via the
// SECURITY DEFINER RPC decrement_product_stock (anti-oversell across devices). The
// RPC enforces ownership internally (user_id = auth.uid()) and only decrements when
// stock > 0, also stamping last_ordered_at (= the product↔order link Part 2 needs).
// Returns the NEW stock on success, -1 when nothing was decremented (sold out / not
// found / not owner), or null when the call couldn't run (unconfigured / no session
// / error) so the caller can leave its live count untouched.
export async function decrementStockAndTouch(localId: number): Promise<number | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase.rpc("decrement_product_stock", { p_local_id: localId });
  if (error) { console.error("Decrement stock error:", error.message); return null; }
  return data == null ? null : Number(data);
}

// Orchestrates the initial load: DB wins when it has rows; an empty DB triggers the
// one-time local→DB migration (when the local list is real, non-seed data); any
// failure / no-session keeps the local cache untouched. The caller mirrors the
// resolved list back to localStorage (offline view + production parity).
export interface ResolveResult { products: Product[]; source: "db" | "local" | "migrated" }
export async function resolveInitialProducts(local: Product[]): Promise<ResolveResult> {
  const rows = await loadProductsDb();
  if (rows === null) return { products: local, source: "local" };  // unconfigured / no session / error
  if (rows.length) return { products: rows, source: "db" };        // DB is source of truth
  if (shouldMigrate(local, alreadyMigrated())) {                   // empty DB + real local → migrate once
    const ok = await migrateLocalProducts(local);
    if (ok) return { products: local, source: "migrated" };
  }
  return { products: local, source: "local" };                     // empty/seed local, nothing to migrate
}
