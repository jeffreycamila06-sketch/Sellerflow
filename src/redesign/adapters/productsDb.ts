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
    liveCode: row.live_code == null ? "" : String(row.live_code), // Auto Mode code (sql/39)
  };
}

// Product → upsert payload. Omits `status` (derived) and `last_ordered_at`
// (RESERVED — leaving it out of the payload means an upsert UPDATE never overwrites
// it). `now` injectable for deterministic tests.
export function productToRow(p: Product, userId: string, now: number = Date.now(), opts?: { skipStock?: boolean }): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: userId,
    local_id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    platform: p.platform,
    live_code: p.liveCode && p.liveCode.trim() ? p.liveCode.trim() : null, // "" → NULL (partial-unique index ignores it)
    updated_at: new Date(now).toISOString(),
  };
  // I1 (stock truth): a "meta" edit (name/price/code) OMITS the stock column so
  // the upsert's ON CONFLICT DO UPDATE never rewrites it — auto-order RPC
  // decrements survive. The Products screen's in-memory stock can be stale (auto
  // orders don't write sf_prods); writing it back would clobber the DB truth and
  // re-inflate on the next reload. Stock is written only when it actually changed
  // (or on a new product).
  if (!opts?.skipStock) row.stock = p.stock;
  return row;
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
    .select("local_id,name,sku,price,stock,platform,live_code")
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
  return (await saveProductDbResult(p)).ok;
}

// Richer result so the Products screen can distinguish a live_code collision
// (another product/device already uses this code → the ux_products_user_live_code
// partial-unique index rejects with 23505) from a generic sync failure.
export async function saveProductDbResult(p: Product, opts?: { skipStock?: boolean }): Promise<{ ok: boolean; duplicateCode?: boolean }> {
  if (!isSupabaseConfigured || !supabase) return { ok: true };
  const id = await uid();
  if (!id) return { ok: true };
  const { error } = await supabase.from("products").upsert(productToRow(p, id, Date.now(), opts), { onConflict: "user_id,local_id" });
  if (!error) return { ok: true };
  console.error("Save product error:", error.message);
  const text = `${error.message || ""} ${(error as { details?: string }).details || ""}`;
  const duplicateCode = error.code === "23505" && text.includes("ux_products_user_live_code");
  return { ok: false, duplicateCode: duplicateCode || undefined };
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

// Quick manual stock edit (Products card − / +) — atomic delta via the sql/41
// adjust_product_stock RPC. Own-scoped (auth.uid() INSIDE the RPC), race-safe: a
// concurrent Auto-mode decrement and this manual adjust are serialized by the
// row lock, each applied exactly once (NEVER read-into-JS-then-write). Clamps at 0
// server-side. Returns the NEW authoritative stock (reflecting any concurrent auto
// decrements), -1 when the row isn't the caller's / doesn't exist, or null when the
// call couldn't run (unconfigured / no session / error) so the caller can revert.
export async function adjustProductStock(localId: number, delta: number): Promise<number | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase.rpc("adjust_product_stock", { p_local_id: localId, p_delta: delta });
  if (error) { console.error("Adjust stock error:", error.message); return null; }
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

// ── Inventory v2 (sql/90; switch inventory_v2_enabled) ────────────────────────────────────
// Every stock change writes one stock_movements row. The logged RPCs do the SAME atomic
// arithmetic as adjust_product_stock (own row, clamp at 0) and log what was really applied.
// Return: the NEW stock, -1 when not the caller's product, null when the call couldn't run.
export type StockReason = "auto_order" | "oneclick" | "restock" | "manual_edit" | "waitlist";
export interface StockMovement { delta: number; reason: StockReason; orderRef: string | null; createdAt: string }

export async function adjustStockLogged(localId: number, delta: number, reason: StockReason, orderRef?: string | null): Promise<number | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase.rpc("adjust_product_stock_logged", { p_local_id: localId, p_delta: delta, p_reason: reason, p_order_ref: orderRef ?? null });
  if (error) { console.error("Adjust stock (logged) error:", error.message); return null; }
  return data == null ? null : Number(data);
}

export async function restockProduct(localId: number, qty: number): Promise<number | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase.rpc("restock_product", { p_local_id: localId, p_qty: qty });
  if (error) { console.error("Restock error:", error.message); return null; }
  return data == null ? null : Number(data);
}

// A log row only (no stock change) — for a stock change that already happened elsewhere:
// the Auto-mode decrement inside the order hub, or a new product's starting stock.
// Fire-and-forget: a failed log never affects the order or the stock.
export async function logStockMovement(localId: number, delta: number, reason: StockReason, orderRef?: string | null): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const id = await uid();
  if (!id || !delta) return false;
  try {
    const { error } = await supabase.from("stock_movements").insert({ user_id: id, product_local_id: localId, delta, reason, order_ref: orderRef ?? null });
    return !error;
  } catch { return false; }
}

// Newest first, one product, last 50. null = could not read.
export async function loadStockMovements(localId: number): Promise<StockMovement[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  const { data, error } = await supabase.from("stock_movements")
    .select("delta,reason,order_ref,created_at")
    .eq("user_id", id).eq("product_local_id", localId)
    .order("created_at", { ascending: false }).limit(50);
  if (error || !Array.isArray(data)) return null;
  return (data as { delta: unknown; reason: unknown; order_ref: unknown; created_at: unknown }[]).map((r) => ({
    delta: Number(r.delta) || 0, reason: String(r.reason) as StockReason,
    orderRef: r.order_ref == null ? null : String(r.order_ref), createdAt: String(r.created_at ?? ""),
  }));
}

// One product's current stock from the database (F2: re-check before telling a buyer "sold
// out"). null = could not read.
export async function loadProductStock(localId: number): Promise<number | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = await uid();
  if (!id) return null;
  try {
    const { data, error } = await supabase.from("products").select("stock").eq("user_id", id).eq("local_id", localId).maybeSingle();
    if (error || !data) return null;
    const n = Number((data as { stock?: unknown }).stock);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
