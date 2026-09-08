// getCreditBalance() — the read-only wallet balance the Part-2 UI will show.
// Own-scoped SELECT on parcel_credit_wallet (RLS: user_id = auth.uid() OR admin);
// no wallet row → balance 0; never writes.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectResult, getSession, calls } = vi.hoisted(() => ({
  selectResult: { current: { data: null as null | { balance: number }, error: null as null | { message: string } } },
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  calls: { table: "" as string, filters: [] as [string, unknown][] },
}));

vi.mock("../../../supabase", () => {
  const chain = () => {
    const b: {
      select: (c: string) => typeof b;
      eq: (c: string, v: unknown) => typeof b;
      maybeSingle: () => Promise<unknown>;
    } = {
      select: () => b,
      eq: (c, v) => { calls.filters.push([c, v]); return b; },
      maybeSingle: () => Promise.resolve(selectResult.current),
    };
    return b;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: () => getSession() },
      from: (t: string) => { calls.table = t; return chain(); },
    },
  };
});
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { getCreditBalance } from "../parcelScan";

beforeEach(() => {
  selectResult.current = { data: null, error: null };
  calls.table = ""; calls.filters = [];
  getSession.mockClear();
});

describe("getCreditBalance (own-scoped read)", () => {
  it("reads parcel_credit_wallet scoped to the caller's user_id", async () => {
    selectResult.current = { data: { balance: 42 }, error: null };
    const r = await getCreditBalance();
    expect(r).toEqual({ ok: true, balance: 42 });
    expect(calls.table).toBe("parcel_credit_wallet");
    expect(calls.filters).toContainEqual(["user_id", "u1"]);
  });

  it("no wallet row → balance 0 (ok:true)", async () => {
    selectResult.current = { data: null, error: null };
    expect(await getCreditBalance()).toEqual({ ok: true, balance: 0 });
  });

  it("a DB error surfaces ok:false, balance 0 (never throws)", async () => {
    selectResult.current = { data: null, error: { message: "rls" } };
    const r = await getCreditBalance();
    expect(r.ok).toBe(false);
    expect(r.balance).toBe(0);
    expect(r.error).toBe("rls");
  });
});
