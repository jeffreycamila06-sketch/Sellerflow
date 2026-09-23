// sql/48 — db.ts saveLiveSessionOrder writes platform_meta into the live_session_orders
// insert (the single function both the direct write and the retry outbox call). The real
// db.ts is exercised against a mocked Supabase client; the insert row is captured.
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: { table: string | null; rows: Array<Record<string, unknown>> } = { table: null, rows: [] };

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: vi.fn((table: string) => {
      captured.table = table;
      return {
        insert: (rows: Array<Record<string, unknown>>) => {
          captured.rows = rows;
          return { select: async () => ({ data: rows, error: null }) };
        },
      };
    }),
  },
}));

import { saveLiveSessionOrder } from "../../../db";

const base = { buyer_number: 3, handle: "maria", customer_name: "Maria", platform: "Facebook", product: "mine", price: 100, session_date: "2026-09-23" };

beforeEach(() => { captured.table = null; captured.rows = []; });

describe("saveLiveSessionOrder — platform_meta persisted (sql/48)", () => {
  it("FB order: platform_meta lands in the live_session_orders insert row", async () => {
    await saveLiveSessionOrder({ ...base, comment_msg_id: "1559313962190144_1024353087330398", platform_meta: { page_id: "106797184700669", live_video_id: "1551613923647732" } });
    expect(captured.table).toBe("live_session_orders");
    expect(captured.rows[0].platform_meta).toEqual({ page_id: "106797184700669", live_video_id: "1551613923647732" });
    expect(captured.rows[0].comment_msg_id).toBe("1559313962190144_1024353087330398");
  });
  it("absent platform_meta → explicit NULL (existing callers / other platforms unchanged)", async () => {
    await saveLiveSessionOrder({ ...base, platform: "TikTok" });
    expect(captured.rows[0].platform_meta).toBeNull();
  });
});
