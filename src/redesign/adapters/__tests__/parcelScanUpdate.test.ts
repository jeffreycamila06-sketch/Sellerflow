// updateParcelScan (Feature 3): an own-scoped UPDATE of the editable fields —
// FREE (never calls /admin/parcel-scan, never debits a credit; it's a pure DB
// write). Own-scoped like the delete: .update(fields).eq("id", id).eq("user_id",
// me). Awaited; a DB error → { ok:false } surfaced inline, no silent no-op.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateResult, getSession, updateOps } = vi.hoisted(() => ({
  updateResult: { current: { error: null as null | { message: string } } },
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  updateOps: [] as { payload: Record<string, unknown>; filters: [string, unknown][] }[],
}));

vi.mock("../../../supabase", () => {
  const makeChain = (payload: Record<string, unknown>) => {
    const op = { payload, filters: [] as [string, unknown][] };
    updateOps.push(op);
    const builder: {
      eq: (c: string, v: unknown) => typeof builder;
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      eq: (c, v) => { op.filters.push([c, v]); return builder; },
      then: (res, rej) => Promise.resolve(updateResult.current).then(res, rej),
    };
    return builder;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: () => getSession() },
      from: () => ({ update: (payload: Record<string, unknown>) => makeChain(payload) }),
    },
  };
});
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { updateParcelScan } from "../parcelScan";

const fields = { name: "Fixed", phone: "0912345678", store_id: "266402", amount: 550, notes: "n" };

beforeEach(() => { updateResult.current = { error: null }; updateOps.length = 0; getSession.mockClear(); });

describe("updateParcelScan — own-scoped, editable-fields-only UPDATE", () => {
  it("updates the 5 editable columns, scoped to id AND user_id, returns ok", async () => {
    const r = await updateParcelScan("row-9", fields);
    expect(r).toEqual({ ok: true });
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0].payload).toEqual({
      customer_name: "Fixed", phone: "0912345678", store_id: "266402", amount: 550, notes: "n",
    });
    expect(updateOps[0].filters).toContainEqual(["id", "row-9"]);
    expect(updateOps[0].filters).toContainEqual(["user_id", "u1"]);
    // never writes status/created_at (no un-export / re-date)
    expect(Object.keys(updateOps[0].payload)).not.toContain("status");
    expect(Object.keys(updateOps[0].payload)).not.toContain("created_at");
  });

  it("empty id → error, no update issued", async () => {
    const r = await updateParcelScan("", fields);
    expect(r.ok).toBe(false);
    expect(updateOps).toHaveLength(0);
  });

  it("a DB error is surfaced (ok:false + message), never a silent success", async () => {
    updateResult.current = { error: { message: "rls denied" } };
    const r = await updateParcelScan("row-9", fields);
    expect(r).toEqual({ ok: false, error: "rls denied" });
  });
});
