// shipping_entries CRUD — pure row mappers (round-trip) + load/upsert against a
// mocked supabase boundary (useRaffleConfig mock pattern). Zero-poll contract:
// one select per load, one upsert per save, conflict target = the group key.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectChain, upsert, getSession } = vi.hoisted(() => {
  const selectChain = { rows: [] as unknown[], error: null as unknown };
  return {
    selectChain,
    upsert: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  };
});
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: (...a: unknown[]) => getSession(...(a as [])) },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data: selectChain.rows, error: selectChain.error }) }) }) }) }),
      upsert: (...a: unknown[]) => upsert(...(a as [unknown, unknown])),
    }),
  },
}));

import { rowToEntry, entryToRow, loadShippingEntries, upsertShippingEntry } from "../shippingDb";
import type { ShippingEntry } from "../shipping";

const entry: ShippingEntry = {
  id: "e-1", sessionKey: "2026-07-02~3d", buyerNumber: 4, bagNumber: 1,
  includedOrderIds: [1750000000001, 1750000000002],
  recipientName: "王小明", phone: "0912345678", storeId: "123456",
  tempLayer: "常溫", productDesc: "#4 商品x2", orderAmount: 780, shippingFee: 60,
  buyerUsername: "ana", status: "encoded", exportBatchId: null, exportedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  selectChain.rows = [];
  selectChain.error = null;
});

describe("row mappers", () => {
  it("entryToRow → rowToEntry round-trips every field (snake_case ↔ camelCase)", () => {
    const row = entryToRow(entry, "u1", "2026-07-03T00:00:00.000Z");
    expect(row).toMatchObject({ user_id: "u1", session_key: "2026-07-02~3d", buyer_number: 4, bag_number: 1, status: "encoded", updated_at: "2026-07-03T00:00:00.000Z" });
    // export stamps are OMITTED from the upsert payload — only the P2 RPC writes them
    expect("export_batch_id" in row).toBe(false);
    expect("exported_at" in row).toBe(false);
    const back = rowToEntry({ ...row, id: "e-1" });
    expect(back).toEqual(entry);
  });
  it("rowToEntry is defensive: bad temp/status fall back, numeric strings coerce", () => {
    const e = rowToEntry({ id: "x", session_key: "d", buyer_number: "7", bag_number: null, included_order_ids: ["5", "bad"], temp_layer: "weird", status: "weird", order_amount: "150.5", shipping_fee: "0" });
    expect(e).toMatchObject({ buyerNumber: 7, bagNumber: 1, includedOrderIds: [5], tempLayer: "常溫", status: "draft", orderAmount: 150.5, shippingFee: 0 });
  });
});

describe("loadShippingEntries", () => {
  it("one select for the session key; rows mapped", async () => {
    selectChain.rows = [entryToRow(entry, "u1", "2026-07-03T00:00:00.000Z") as never];
    (selectChain.rows[0] as Record<string, unknown>).id = "e-1";
    const list = await loadShippingEntries("2026-07-02~3d");
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(entry);
  });
  it("signed out → empty, no query results used", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    expect(await loadShippingEntries("2026-07-03")).toEqual([]);
  });
});

describe("upsertShippingEntry", () => {
  it("one upsert with the group-key conflict target", async () => {
    const r = await upsertShippingEntry(entry);
    expect(r.ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "user_id,session_key,buyer_number,bag_number" });
    expect(upsert.mock.calls[0][0]).toMatchObject({ user_id: "u1", buyer_number: 4, recipient_name: "王小明" });
  });
  it("db error surfaces as {ok:false, error}", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "boom" } } as never);
    const r = await upsertShippingEntry(entry);
    expect(r).toEqual({ ok: false, error: "boom" });
  });
});
