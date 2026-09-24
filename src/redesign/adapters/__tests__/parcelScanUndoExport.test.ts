// FIX 5 — export-batch adapters. markScansExported stamps a fresh uuid batch id
// alongside status='exported' and returns it — as a CONDITIONAL CLAIM (2a): only
// rows not already exported (neq), returning the ids it won; unmarkScansExported reverts a
// whole batch (status→'confirmed', export_batch_id→NULL), own-scoped. Chainable
// supabase mock mirrors .update().in().eq() / .update().eq().eq() then-ables.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateResult, getSession, updateOps, selectOps, selectResults } = vi.hoisted(() => ({
  selectOps: [] as { cols: string; calls: [string, ...unknown[]][] }[],
  selectResults: [] as { data: unknown[] | null; error: null | { message: string } }[],
  updateResult: { current: { error: null as null | { message: string }, data: null as null | { id: string }[] } },
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  updateOps: [] as { payload: Record<string, unknown>; filters: [string, unknown][]; ins: [string, unknown[]][]; neqs: [string, unknown][]; select: string | null }[],
}));

vi.mock("../../../supabase", () => {
  const makeChain = (payload: Record<string, unknown>) => {
    const op = { payload, filters: [] as [string, unknown][], ins: [] as [string, unknown[]][], neqs: [] as [string, unknown][], select: null as string | null };
    updateOps.push(op);
    const builder: {
      eq: (c: string, v: unknown) => typeof builder;
      in: (c: string, v: unknown[]) => typeof builder;
      neq: (c: string, v: unknown) => typeof builder;
      select: (cols: string) => typeof builder;
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      eq: (c, v) => { op.filters.push([c, v]); return builder; },
      in: (c, v) => { op.ins.push([c, v]); return builder; },
      neq: (c, v) => { op.neqs.push([c, v]); return builder; },
      select: (cols) => { op.select = cols; return builder; },
      then: (res, rej) => Promise.resolve(updateResult.current).then(res, rej),
    };
    return builder;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: () => getSession() },
      from: () => ({
        update: (payload: Record<string, unknown>) => makeChain(payload),
        select: (cols: string) => {
          const op = { cols, calls: [] as [string, ...unknown[]][] };
          selectOps.push(op);
          const res = selectResults.shift() ?? { data: [], error: null };
          const q: Record<string, unknown> = {};
          for (const m of ["eq", "not", "order", "limit"]) q[m] = (...a: unknown[]) => { op.calls.push([m, ...a]); return q; };
          q.then = (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad);
          return q;
        },
      }),
    },
  };
});
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { markScansExported, unmarkScansExported, undoExportBatch, loadLastExportBatch } from "../parcelScan";

beforeEach(() => { updateResult.current = { error: null, data: null }; updateOps.length = 0; selectOps.length = 0; selectResults.length = 0; getSession.mockClear(); });

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

  it("2a CLAIM: only rows NOT already exported (neq), returns exactly the ids this call won", async () => {
    updateResult.current = { error: null, data: [{ id: "b" }] }; // "a" was already exported by another device
    const r = await markScansExported(["a", "b"]);
    expect(updateOps[0].neqs).toContainEqual(["status", "exported"]);
    expect(updateOps[0].select).toBe("id");
    expect(r.claimed).toEqual(["b"]);
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
    updateResult.current = { error: { message: "boom" }, data: null };
    const r = await markScansExported(["a"]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });
});

describe("undoExportBatch (2b latest-only) — back to ready, KEEPS the batch id (tombstone)", () => {
  it("sets ONLY status='confirmed' on the batch's exported rows, own-scoped; batch id untouched", async () => {
    const r = await undoExportBatch("batch-7");
    expect(r).toEqual({ ok: true });
    expect(updateOps[0].payload).toEqual({ status: "confirmed" });   // no export_batch_id → sql/50 keeps exported_at
    expect(updateOps[0].filters).toContainEqual(["export_batch_id", "batch-7"]);
    expect(updateOps[0].filters).toContainEqual(["status", "exported"]);
    expect(updateOps[0].filters).toContainEqual(["user_id", "u1"]);
  });
  it("empty batch id → error, no update issued", async () => {
    expect((await undoExportBatch("")).ok).toBe(false);
    expect(updateOps).toHaveLength(0);
  });
});

describe("unmarkScansExported (RELEASE) — reverts a whole batch AND clears the batch id, own-scoped", () => {
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
    updateResult.current = { error: { message: "nope" }, data: null };
    const r = await unmarkScansExported("batch-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("nope");
  });
});

describe("loadLastExportBatch (2b) — newest batch from ANY device, by the DB-stamped exported_at", () => {
  it("picks the newest stamped row (any status, own-scoped); if still exported, returns that batch's exported ids", async () => {
    selectResults.push({ data: [{ export_batch_id: "b-new", status: "exported" }], error: null }, { data: [{ id: "r1" }, { id: "r2" }], error: null });
    const r = await loadLastExportBatch();
    expect(r).toEqual({ ok: true, batch: { id: "b-new", ids: ["r1", "r2"] } });
    const q = selectOps[0].calls;
    expect(q).toContainEqual(["eq", "user_id", "u1"]);
    expect(q.some((c) => c[0] === "eq" && c[1] === "status")).toBe(false); // newest EVENT, incl. undone tombstones
    expect(q).toContainEqual(["not", "exported_at", "is", null]);        // pre-sql/49 / released batches never offered
    expect(q).toContainEqual(["not", "export_batch_id", "is", null]);
    expect(q).toContainEqual(["order", "exported_at", { ascending: false }]);
    expect(q).toContainEqual(["limit", 1]);
    expect(selectOps[1].calls).toContainEqual(["eq", "export_batch_id", "b-new"]);
    expect(selectOps[1].calls).toContainEqual(["eq", "user_id", "u1"]);
    expect(selectOps[1].calls).toContainEqual(["eq", "status", "exported"]);
  });

  it("LATEST-ONLY: newest event is an UNDONE batch (tombstone, not exported) → batch:null, never the older one", async () => {
    selectResults.push({ data: [{ export_batch_id: "b-undone", status: "confirmed" }], error: null });
    expect(await loadLastExportBatch()).toEqual({ ok: true, batch: null });
    expect(selectOps).toHaveLength(1);                                   // no fallback query to an older batch
  });

  it("no stamped batch → { ok:true, batch:null }, no second query", async () => {
    selectResults.push({ data: [], error: null });
    expect(await loadLastExportBatch()).toEqual({ ok: true, batch: null });
    expect(selectOps).toHaveLength(1);
  });

  it("DB error → ok:false, batch:null", async () => {
    selectResults.push({ data: null, error: { message: "x" } });
    const r = await loadLastExportBatch();
    expect(r.ok).toBe(false);
    expect(r.batch).toBeNull();
  });
});
