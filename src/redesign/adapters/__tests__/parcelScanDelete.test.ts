// Delete adapters (Change 3): deleteParcelScan(id) and deleteExportedParcels().
// Both are own-scoped via RLS (user_id = auth.uid()) — the client also always
// adds .eq("user_id", me); deleteExportedParcels additionally scopes to
// status = 'exported'. Awaited (not fire-and-forget); a DB error → { ok:false }
// so the screen can surface it inline (never a silent no-op).
import { describe, it, expect, vi, beforeEach } from "vitest";

// A chainable delete builder that records the filters and resolves to the
// preset result — mirrors supabase-js's .delete().eq().eq() then-able.
const { deleteResult, getSession, deleteOps } = vi.hoisted(() => ({
  deleteResult: { current: { error: null as null | { message: string } } },
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  deleteOps: [] as { filters: [string, unknown][] }[],
}));

vi.mock("../../../supabase", () => {
  const makeChain = () => {
    const op = { filters: [] as [string, unknown][] };
    deleteOps.push(op);
    const builder: {
      eq: (c: string, v: unknown) => typeof builder;
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      eq: (c, v) => { op.filters.push([c, v]); return builder; },
      then: (res, rej) => Promise.resolve(deleteResult.current).then(res, rej),
    };
    return builder;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: () => getSession() },
      from: () => ({ delete: () => makeChain() }),
    },
  };
});
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { deleteParcelScan, deleteExportedParcels } from "../parcelScan";

beforeEach(() => {
  deleteResult.current = { error: null };
  deleteOps.length = 0;
  getSession.mockClear();
});

describe("deleteParcelScan(id) — own-scoped single delete", () => {
  it("deletes by id AND user_id (RLS own-scope), returns ok", async () => {
    const r = await deleteParcelScan("row-1");
    expect(r).toEqual({ ok: true });
    expect(deleteOps).toHaveLength(1);
    expect(deleteOps[0].filters).toContainEqual(["id", "row-1"]);
    expect(deleteOps[0].filters).toContainEqual(["user_id", "u1"]);
  });

  it("empty id → error, no delete issued", async () => {
    const r = await deleteParcelScan("");
    expect(r.ok).toBe(false);
    expect(deleteOps).toHaveLength(0);
  });

  it("a DB error is surfaced (ok:false + message), never a silent success", async () => {
    deleteResult.current = { error: { message: "rls denied" } };
    const r = await deleteParcelScan("row-1");
    expect(r).toEqual({ ok: false, error: "rls denied" });
  });
});

describe("deleteExportedParcels() — only status='exported', own-scoped", () => {
  it("scopes to status exported AND user_id, returns ok", async () => {
    const r = await deleteExportedParcels();
    expect(r).toEqual({ ok: true });
    expect(deleteOps).toHaveLength(1);
    expect(deleteOps[0].filters).toContainEqual(["status", "exported"]);
    expect(deleteOps[0].filters).toContainEqual(["user_id", "u1"]);
    // never an unfiltered wipe: exactly the two scoping filters
    expect(deleteOps[0].filters).toHaveLength(2);
  });

  it("a DB error is surfaced (ok:false), never a silent no-op", async () => {
    deleteResult.current = { error: { message: "boom" } };
    const r = await deleteExportedParcels();
    expect(r).toEqual({ ok: false, error: "boom" });
  });
});
