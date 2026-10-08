// sql/96 — db.ts saveOrderToDatabase sends orders.platform only when it is one of the four
// values the column's CHECK allows; absent/unknown → key omitted (old insert shape, → NULL).
// The real db.ts runs against a mocked Supabase client; the insert row is captured.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const captured: { table: string | null; rows: Array<Record<string, unknown>> } = { table: null, rows: [] };
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: vi.fn((table: string) => {
      captured.table = table;
      return { insert: (rows: Array<Record<string, unknown>>) => { captured.rows = rows; return { select: async () => ({ data: rows, error: null }) }; } };
    }),
  },
}));
import { saveOrderToDatabase } from "../../../db";

const base = { customer_name: "Ann", product: "250", total_amount: 250, status: "Pending" };
beforeEach(() => { captured.table = null; captured.rows = []; });

describe("saveOrderToDatabase — orders.platform (sql/96)", () => {
  it("each known platform is sent", async () => {
    for (const p of ["TikTok", "Facebook", "Shopee", "Instagram"]) {
      await saveOrderToDatabase({ ...base, platform: p });
      expect(captured.table).toBe("orders");
      expect(captured.rows[0].platform).toBe(p);
    }
  });
  it("absent platform → the exact pre-sql/96 row (old callers, rollback app)", async () => {
    await saveOrderToDatabase(base);
    expect(captured.rows[0]).toEqual({ ...base, user_id: "user-1" });
  });
  it("unknown / empty platform → omitted (a CHECK failure must never lose a ledger row)", async () => {
    for (const p of ["", "TikTok / FB", "tiktok"]) {
      await saveOrderToDatabase({ ...base, platform: p });
      expect("platform" in captured.rows[0]).toBe(false);
    }
  });
  it("the allowed list matches the sql/96 CHECK", () => {
    const sql = readFileSync("sql/96_orders_platform.sql", "utf8");
    expect(sql).toContain("platform in ('TikTok', 'Facebook', 'Shopee', 'Instagram')");
    expect(readFileSync("src/db.ts", "utf8")).toContain('const ORDER_PLATFORMS = ["TikTok", "Facebook", "Shopee", "Instagram"];');
  });
});
