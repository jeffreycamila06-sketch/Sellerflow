// FIX 5 — export-batch adapters. markScansExported stamps a fresh uuid batch id
// alongside status='exported' and returns it — as a CONDITIONAL CLAIM (2a): only
// rows not already exported (neq), returning the ids it won; unmarkScansExported reverts a
// whole batch (status→'confirmed', export_batch_id→NULL), own-scoped. Chainable
// supabase mock mirrors .update().in().eq() / .update().eq().eq() then-ables.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateResult, getSession, updateOps, selectOps, selectResults, rpcCalls, rpcResult, deleteOps } = vi.hoisted(() => ({
  rpcCalls: [] as [string, Record<string, unknown>][],
  rpcResult: { current: { data: "undone" as unknown, error: null as null | { message: string } } },
  deleteOps: [] as [string, unknown][][],
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
      rpc: (fn: string, args: Record<string, unknown>) => { rpcCalls.push([fn, args]); return Promise.resolve(rpcResult.current); },
      from: () => ({
        update: (payload: Record<string, unknown>) => makeChain(payload),
        delete: () => {
          const op: [string, unknown][] = []; deleteOps.push(op);
          const q: Record<string, unknown> = {};
          q.eq = (c: string, v: unknown) => { op.push([c, v]); return q; };
          q.then = (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(ok, bad);
          return q;
        },
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

import { markScansExported, unmarkScansExported, undoExportBatch, loadLastExportBatch, confirmExportDelivered, loadUndeliveredExports, deleteExportedParcels } from "../parcelScan";

beforeEach(() => { updateResult.current = { error: null, data: null }; updateOps.length = 0; selectOps.length = 0; selectResults.length = 0; rpcCalls.length = 0; deleteOps.length = 0; rpcResult.current = { data: "undone", error: null }; getSession.mockClear(); });

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

describe("undoExportBatch (sql/51) — the DB decides at tap time via undo_export_batch", () => {
  it("Undo calls the RPC with the batch and p_orphan_only=false; returns the DB's verdict", async () => {
    rpcResult.current = { data: "not_latest", error: null };
    expect(await undoExportBatch("batch-7")).toEqual({ ok: true, result: "not_latest" });
    expect(rpcCalls).toEqual([["undo_export_batch", { p_batch: "batch-7", p_orphan_only: false }]]);
    expect(updateOps).toHaveLength(0);                                   // never a client-side revert
  });
  it("Put back passes p_orphan_only=true (can never undo a batch confirmed sent meanwhile)", async () => {
    rpcResult.current = { data: "delivered", error: null };
    expect(await undoExportBatch("b", true)).toEqual({ ok: true, result: "delivered" });
    expect(rpcCalls[0][1]).toEqual({ p_batch: "b", p_orphan_only: true });
  });
  it("every DB verdict is recognised; anything else / an error → ok:false", async () => {
    for (const v of ["undone", "released", "not_latest", "in_progress", "delivered", "nothing"]) {
      rpcResult.current = { data: v, error: null };
      expect((await undoExportBatch("b")).result).toBe(v);
    }
    rpcResult.current = { data: "weird", error: null };
    expect((await undoExportBatch("b")).ok).toBe(false);
    rpcResult.current = { data: null, error: { message: "boom" } };
    expect(await undoExportBatch("b")).toEqual({ ok: false, error: "boom" });
  });
  it("empty batch id → error, no RPC", async () => {
    expect((await undoExportBatch("")).ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("confirmExportDelivered (sql/51) — CLAIMED → DELIVERED, own-scoped", () => {
  it("sets export_delivered on the batch's exported rows and returns how many flipped", async () => {
    updateResult.current = { error: null, data: [{ id: "r1" }, { id: "r2" }] };
    expect(await confirmExportDelivered("b1")).toEqual({ ok: true, n: 2 });
    expect(updateOps[0].payload).toEqual({ export_delivered: true });
    expect(updateOps[0].filters).toEqual(expect.arrayContaining([["export_batch_id", "b1"], ["status", "exported"], ["user_id", "u1"]]));
    expect(updateOps[0].select).toBe("id");
  });
  it("0 rows flipped (put back elsewhere) → n:0 so the screen can warn", async () => {
    updateResult.current = { error: null, data: [] };
    expect(await confirmExportDelivered("b1")).toEqual({ ok: true, n: 0 });
  });
});

describe("loadUndeliveredExports (sql/51) — claimed-but-not-sent batches, grouped", () => {
  it("own exported rows with export_delivered=false, grouped by batch, oldest first", async () => {
    selectResults.push({ data: [
      { id: "a", export_batch_id: "b1", exported_at: "t1" }, { id: "b", export_batch_id: "b1", exported_at: "t1" },
      { id: "c", export_batch_id: "b2", exported_at: "t2" },
    ], error: null });
    expect(await loadUndeliveredExports()).toEqual({ ok: true, batches: [
      { batchId: "b1", ids: ["a", "b"], claimedAt: "t1" }, { batchId: "b2", ids: ["c"], claimedAt: "t2" },
    ] });
    const q = selectOps[0].calls;
    expect(q).toEqual(expect.arrayContaining([["eq", "user_id", "u1"], ["eq", "status", "exported"], ["eq", "export_delivered", false], ["not", "export_batch_id", "is", null]]));
  });
});

describe("deleteExportedParcels (sql/51) — never deletes an undelivered/orphan row", () => {
  it("filters status=exported AND export_delivered=true, own-scoped", async () => {
    expect(await deleteExportedParcels()).toEqual({ ok: true });
    expect(deleteOps[0]).toEqual(expect.arrayContaining([["status", "exported"], ["export_delivered", true], ["user_id", "u1"]]));
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

  it("newest event is still CLAIMED (not confirmed sent) → no Undo offered (the orphan card covers it)", async () => {
    selectResults.push({ data: [{ export_batch_id: "b-claimed", status: "exported", export_delivered: false }], error: null });
    expect(await loadLastExportBatch()).toEqual({ ok: true, batch: null });
    expect(selectOps).toHaveLength(1);
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
