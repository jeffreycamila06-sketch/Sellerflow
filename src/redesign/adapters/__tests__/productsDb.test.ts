// Products cross-device sync — Part 1. Pure mappers + migration-decision tests, and
// the unconfigured-env no-op behavior (no Supabase in vitest → reads return null,
// writes are no-ops, so the local cache is always preserved).
import { describe, it, expect, beforeEach } from "vitest";
import {
  rowToProduct, productToRow, isSeedList, shouldMigrate,
  alreadyMigrated, markMigrated,
  loadProductsDb, saveProductDb, deleteProductDb, migrateLocalProducts, resolveInitialProducts,
  decrementStockAndTouch,
} from "../productsDb";
import { PRODUCT_DEFAULTS, type Product } from "../products";

const real: Product[] = [
  { id: 1750000000001, name: "Red dress", sku: "RD-1", price: 350, stock: 24, platform: "TikTok", status: "Active" },
  { id: 1750000000002, name: "Blue top", sku: "BT-2", price: 250, stock: 3, platform: "FB Live", status: "Low stock" },
];

describe("rowToProduct — DB row → Product, status re-derived from stock", () => {
  it("maps columns and derives status (never stored)", () => {
    expect(rowToProduct({ local_id: 42, name: "Tee", sku: "T-1", price: 199, stock: 0, platform: "TikTok" }))
      .toEqual({ id: 42, name: "Tee", sku: "T-1", price: 199, stock: 0, platform: "TikTok", status: "Out of stock" });
  });
  it("coerces string numerics (PostgREST numeric/bigint) and tolerates nulls", () => {
    const p = rowToProduct({ local_id: "1750000000001", name: null, sku: null, price: "12.5", stock: "8", platform: null });
    expect(p).toEqual({ id: 1750000000001, name: "", sku: "", price: 12.5, stock: 8, platform: "", status: "Active" });
  });
});

describe("productToRow — Product → upsert payload", () => {
  it("includes scope + columns, derives updated_at, OMITS status and last_ordered_at", () => {
    const row = productToRow(real[0], "user-123", 1750000000000);
    expect(row).toEqual({
      user_id: "user-123", local_id: 1750000000001, name: "Red dress", sku: "RD-1",
      price: 350, stock: 24, platform: "TikTok", updated_at: new Date(1750000000000).toISOString(),
    });
    expect(row).not.toHaveProperty("status");
    expect(row).not.toHaveProperty("last_ordered_at");
  });
});

describe("isSeedList — detect the untouched 5-item demo seed", () => {
  it("true only for the exact default seed", () => {
    expect(isSeedList(PRODUCT_DEFAULTS)).toBe(true);
  });
  it("false once a product is added, edited-id, or removed", () => {
    expect(isSeedList([...PRODUCT_DEFAULTS, real[0]])).toBe(false);          // added
    expect(isSeedList(PRODUCT_DEFAULTS.slice(0, 4))).toBe(false);            // removed one
    expect(isSeedList(real)).toBe(false);                                    // real data
    expect(isSeedList([])).toBe(false);                                      // empty
  });
});

describe("shouldMigrate — one-time local→DB decision (PURE)", () => {
  it("migrates only real, non-seed local data when not yet migrated", () => {
    expect(shouldMigrate(real, false)).toBe(true);
  });
  it("never migrates when already migrated, empty, or still the seed", () => {
    expect(shouldMigrate(real, true)).toBe(false);            // device already migrated
    expect(shouldMigrate([], false)).toBe(false);             // nothing to migrate
    expect(shouldMigrate(PRODUCT_DEFAULTS, false)).toBe(false); // demo seed only
  });
});

describe("migration flag — once-per-device (localStorage)", () => {
  beforeEach(() => localStorage.clear());
  it("alreadyMigrated flips after markMigrated under sf_prods_migrated", () => {
    expect(alreadyMigrated()).toBe(false);
    markMigrated();
    expect(localStorage.getItem("sf_prods_migrated")).toBe("1");
    expect(alreadyMigrated()).toBe(true);
  });
});

// In vitest there is no configured Supabase → every DB call short-circuits and the
// local cache is never disturbed (egress-safe + safe fallback on preview/unauth).
describe("DB ops are safe no-ops when Supabase is unconfigured", () => {
  beforeEach(() => localStorage.clear());
  it("loadProductsDb returns null (caller keeps local)", async () => {
    expect(await loadProductsDb()).toBeNull();
  });
  it("save/delete/migrate resolve without throwing and don't mark migrated", async () => {
    // Batch D #11: unconfigured = nothing to sync = true (NOT a failure note)
    await expect(saveProductDb(real[0])).resolves.toBe(true);
    await expect(deleteProductDb(real[0].id)).resolves.toBe(true);
    expect(await migrateLocalProducts(real)).toBe(false);
    expect(alreadyMigrated()).toBe(false); // failed migration must NOT set the flag
  });
  it("resolveInitialProducts falls back to the local list unchanged", async () => {
    expect(await resolveInitialProducts(real)).toEqual({ products: real, source: "local" });
  });
  it("decrementStockAndTouch returns null (RPC not callable)", async () => {
    expect(await decrementStockAndTouch(real[0].id)).toBeNull();
  });
});
