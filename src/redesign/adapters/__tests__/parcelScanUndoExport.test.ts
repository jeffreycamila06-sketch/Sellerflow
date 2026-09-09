// FIX 5 — export-batch adapters. markScansExported stamps a fresh uuid batch id
// alongside status='exported' and returns it; unmarkScansExported reverts a
// whole batch (status→'confirmed', export_batch_id→NULL), own-scoped. Chainable
// supabase mock mirrors .update().in().eq() / .update().eq().eq() then-ables.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateResult, getSession, updateOps } = vi.hoisted(() => ({
  updateResult: { current: { error: null as null | { message: string } } },
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  updateOps: [] as { payload: Record<string, unknown>; filters: [string, unknown][]; ins: [string, unknown[]][] }[],
}));

vi.mock("../../../supabase", () => {
  const makeChain = (payload: Record<string, unknown>) => {
    const op = { payload, filters: [] as [string, unknown][], ins: [] as [string, unknown[]][] };
    updateOps.push(op);
    const builder: {
      eq: (c: string, v: unknown) => typeof builder;
      in: (c: string, v: unknown[]) => typeof builder;
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      eq: (c, v) => { op.filters.push([c, v]); return builder; },
      in: (c, v) => { op.ins.push([c, v]); return builder; },
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

import { markScansExported, unmarkScansExported } from "../parcelScan";

beforeEach(() => { updateResult.current = { error: null }; updateOps.length = 0; getSession.mockClear(); });

describe("markScansExported — stamps status + a fresh batch id", () => {
  it("sets status='exported' AND a uuid export_batch_id, scoped by id-in + user_id; returns that id", async () => {
    const r = await markScansExported(["a", "b"]);
    expect(r.ok).toBe(true);
    expect(typeof r.batchId).toBe("string");
    expect((r.batchId as string).length).toBeGreaterThan(0);
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0].payload.status).toBe("exported");
    expect(updateOps[0].payload.export_batch_id).toBe(r.batchId); // same id stamped as returned
    expect(updateOps[0].ins).toContainEqual(["id", ["a", "b"]]);
    expect(updateOps[0].filters).toContainEqual(["user_id", "u1"]); // RLS own-scope
  });

  it("distinct batch id per run", async () => {
    const a = await markScansExported(["x"]);
    const b = await markScansExported(["y"]);
    expect(a.batchId).not.toBe(b.batchId);
  });

  it("empty ids → ok, no update issued (nothing to mark)", async () => {
    const r = await markScansExported([]);
    expect(r.ok).toBe(true);
    expect(updateOps).toHaveLength(0);
  });

  it("DB error → { ok:false }", async () => {
    updateResult.current = { error: { message: "boom" } };
    const r = await markScansExported(["a"]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });
});

describe("unmarkScansExported — reverts a whole batch, own-scoped", () => {
  it("sets status='confirmed' + export_batch_id=NULL, filtered by batch id AND user_id", async () => {
    const r = await unmarkScansExported("batch-9");
    expect(r).toEqual({ ok: true });
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0].payload).toEqual({ status: "confirmed", export_batch_id: null });
    expect(updateOps[0].filters).toContainEqual(["export_batch_id", "batch-9"]);
    expect(updateOps[0].filters).toContainEqual(["user_id", "u1"]);
  });

  it("empty batch id → error, no update issued", async () => {
    const r = await unmarkScansExported("");
    expect(r.ok).toBe(false);
    expect(updateOps).toHaveLength(0);
  });

  it("DB error → { ok:false }", async () => {
    updateResult.current = { error: { message: "nope" } };
    const r = await unmarkScansExported("batch-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("nope");
  });
});
