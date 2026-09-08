// FIRE-FIX regression: prove saveParcelScan's REAL insert path returns a row id
// that satisfies the caller's exact `if (r.id)` guard — the guard that was
// silently never passing (dead-coded the store check → zero POSTs in prod)
// because the old `.insert(...).select("id").single()` chain returned ok:false
// while the row still committed. The fix uses a client-generated id + a bare
// insert (the codebase's proven pattern), so the id is known without depending
// on the insert's RETURNING.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertMock, getSession } = vi.hoisted(() => ({
  insertMock: vi.fn(async () => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: () => getSession() },
    // BARE insert (no .select()/.single() chained) — matches the fix and the
    // rest of the codebase; the mock resolves like a real bare insert.
    from: () => ({ insert: (row: unknown) => insertMock(row) }),
  },
}));
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { saveParcelScan } from "../parcelScan";

const fields = { name: "陳小美", phone: "0912345678", store_id: "982063", amount: 550, notes: null };

beforeEach(() => { insertMock.mockClear(); insertMock.mockResolvedValue({ error: null }); });

describe("saveParcelScan — real insert path satisfies the `if (r.id)` guard", () => {
  it("returns { ok:true, id } where id is a truthy string (the exact guard the caller checks)", async () => {
    const r = await saveParcelScan(fields, null);
    expect(r.ok).toBe(true);
    expect(typeof r.id).toBe("string");
    expect(r.id).toBeTruthy();
    expect(Boolean(r.id)).toBe(true); // `if (r.id) runStoreCheck(...)` now passes
  });

  it("inserts the SAME id it returns, so saveStoreCheck's .eq('id', rowId) hits the real row", async () => {
    const r = await saveParcelScan(fields, null);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.id).toBe(r.id);
    expect(row.store_id).toBe("982063");
    expect(row.user_id).toBe("u1");
    expect(row.status).toBe("confirmed");
  });

  it("a real insert ERROR → ok:false (row not shown, no check) — unchanged", async () => {
    insertMock.mockResolvedValueOnce({ error: { message: "boom" } });
    const r = await saveParcelScan(fields, null);
    expect(r.ok).toBe(false);
    expect(r.id).toBeUndefined();
    expect(r.error).toBe("boom");
  });
});
