// Customer Details phonebook adapter (sql/35). Behavioral tests over a chainable
// supabase mock: search / recent (select→or→order→limit), edit (update→eq→eq),
// delete (delete→eq→eq), and the pending-parcel COUNT (head:true). Own-scoping
// (.eq user_id) is asserted, plus the OR-filter shape and phone-digit normalize.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { result, getSession, ops } = vi.hoisted(() => ({
  // Each terminal resolves to this; shape covers both { data, error } (reads/
  // writes) and { count, error } (head count) — the adapter reads whichever.
  result: { current: { data: [] as unknown[], count: 0 as number | null, error: null as null | { message: string } } },
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  ops: [] as { table: string; kind: string; args: unknown[]; filters: [string, unknown][]; or?: string; selectOpts?: unknown }[],
}));

vi.mock("../../../supabase", () => {
  const makeChain = (table: string, kind: string) => {
    const op = { table, kind, args: [] as unknown[], filters: [] as [string, unknown][], or: undefined as string | undefined, selectOpts: undefined as unknown };
    ops.push(op);
    const builder: Record<string, unknown> = {
      select: (_c: string, o?: unknown) => { op.selectOpts = o; return builder; },
      eq: (c: string, v: unknown) => { op.filters.push([c, v]); return builder; },
      neq: (c: string, v: unknown) => { op.filters.push([`neq:${c}`, v]); return builder; },
      or: (s: string) => { op.or = s; return builder; },
      order: (...a: unknown[]) => { op.args.push({ order: a }); return builder; },
      limit: (n: number) => { op.args.push({ limit: n }); return builder; },
      update: (patch: unknown) => { op.args.push({ update: patch }); return builder; },
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result.current).then(res, rej),
    };
    return builder;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: () => getSession() },
      from: (table: string) => ({
        select: (c: string, o?: unknown) => { const b = makeChain(table, "select") as { select: (c: string, o?: unknown) => unknown }; return b.select(c, o); },
        update: (patch: unknown) => { const b = makeChain(table, "update") as { update: (p: unknown) => unknown }; return b.update(patch); },
        delete: () => makeChain(table, "delete"),
      }),
    },
  };
});

import {
  searchParcelCustomers, loadRecentParcelCustomers, updateParcelCustomer,
  deleteParcelCustomer, countPendingParcels, countParcelCustomers, sanitizeSearchTerm, phoneDigits,
  CUSTOMER_SEARCH_LIMIT, CUSTOMER_RECENT_LIMIT,
} from "../parcelCustomers";

beforeEach(() => {
  result.current = { data: [], count: 0, error: null };
  ops.length = 0;
  getSession.mockClear();
});

describe("sanitizeSearchTerm / phoneDigits (pure)", () => {
  it("strips PostgREST-breaking chars, keeps letters/digits/CJK", () => {
    expect(sanitizeSearchTerm("a,b(c)%d\\e")).toBe("a b c  d e");
    expect(sanitizeSearchTerm("  陳小美 ")).toBe("陳小美");
  });
  it("phoneDigits keeps only digits", () => {
    expect(phoneDigits("0912-345 678")).toBe("0912345678");
    expect(phoneDigits("maria")).toBe("");
  });
});

describe("searchParcelCustomers", () => {
  it("text query → name+notes OR clauses, own-scoped, desc, limited to 30", async () => {
    result.current = { data: [{ id: "c1", phone: "0912345678", name: "Maria", store_id: "111111", notes: "@maria", created_at: "t0", updated_at: "t1" }], count: 0, error: null };
    const r = await searchParcelCustomers("maria");
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([{ id: "c1", phone: "0912345678", name: "Maria", storeId: "111111", notes: "@maria", createdAt: "t0", updatedAt: "t1" }]);
    const op = ops[0];
    expect(op.table).toBe("parcel_customers");
    expect(op.filters).toContainEqual(["user_id", "u1"]);
    expect(op.or).toBe("name.ilike.%maria%,notes.ilike.%maria%");
    expect(op.args).toContainEqual({ limit: CUSTOMER_SEARCH_LIMIT });
    expect(op.args).toContainEqual({ order: ["updated_at", { ascending: false }] });
  });

  it("numeric query → adds a phone.ilike clause on digits only", async () => {
    await searchParcelCustomers("0912-345");
    expect(ops[0].or).toBe("name.ilike.%0912-345%,notes.ilike.%0912-345%,phone.ilike.%0912345%");
  });

  it("pure-digits query → phone clause plus name/notes on the digits", async () => {
    await searchParcelCustomers("0912345678");
    expect(ops[0].or).toBe("name.ilike.%0912345678%,notes.ilike.%0912345678%,phone.ilike.%0912345678%");
  });

  it("blank query → no rows, NO db call (screen shows recent)", async () => {
    const r = await searchParcelCustomers("   ");
    expect(r).toEqual({ ok: true, rows: [] });
    expect(ops).toHaveLength(0);
  });

  it("db error surfaces ok:false + message", async () => {
    result.current = { data: [], count: 0, error: { message: "boom" } };
    const r = await searchParcelCustomers("x");
    expect(r).toEqual({ ok: false, rows: [], error: "boom" });
  });
});

describe("loadRecentParcelCustomers", () => {
  it("own-scoped, updated_at desc, limit 50", async () => {
    await loadRecentParcelCustomers();
    const op = ops[0];
    expect(op.filters).toContainEqual(["user_id", "u1"]);
    expect(op.args).toContainEqual({ limit: CUSTOMER_RECENT_LIMIT });
    expect(op.args).toContainEqual({ order: ["updated_at", { ascending: false }] });
    expect(op.or).toBeUndefined();
  });
});

describe("updateParcelCustomer", () => {
  it("updates editable fields, own-scoped by id AND user_id", async () => {
    const r = await updateParcelCustomer("c1", { name: "Pedro", phone: "0900000000", store_id: "222222", notes: "@pedro" });
    expect(r).toEqual({ ok: true });
    const op = ops[0];
    expect(op.kind).toBe("update");
    const patch = (op.args.find((a) => (a as { update?: unknown }).update) as { update: Record<string, unknown> }).update;
    expect(patch.name).toBe("Pedro");
    expect(patch.phone).toBe("0900000000");
    expect(patch.store_id).toBe("222222");
    expect(patch.notes).toBe("@pedro");
    expect(typeof patch.updated_at).toBe("string");
    expect(op.filters).toContainEqual(["id", "c1"]);
    expect(op.filters).toContainEqual(["user_id", "u1"]);
  });
  it("empty id → error, no update", async () => {
    const r = await updateParcelCustomer("", { name: null, phone: null, store_id: null, notes: null });
    expect(r.ok).toBe(false);
    expect(ops).toHaveLength(0);
  });
  it("db error surfaces", async () => {
    result.current = { data: [], count: 0, error: { message: "rls" } };
    const r = await updateParcelCustomer("c1", { name: "x", phone: "0900000000", store_id: null, notes: null });
    expect(r).toEqual({ ok: false, error: "rls" });
  });
});

describe("deleteParcelCustomer", () => {
  it("deletes by id AND user_id (RLS own-scope)", async () => {
    const r = await deleteParcelCustomer("c1");
    expect(r).toEqual({ ok: true });
    expect(ops[0].filters).toContainEqual(["id", "c1"]);
    expect(ops[0].filters).toContainEqual(["user_id", "u1"]);
    expect(ops[0].filters).toHaveLength(2); // never an unfiltered wipe
  });
  it("empty id → error, no delete", async () => {
    const r = await deleteParcelCustomer("");
    expect(r.ok).toBe(false);
    expect(ops).toHaveLength(0);
  });
});

describe("countPendingParcels", () => {
  it("head:true exact count on parcel_scans, own-scoped, status != exported", async () => {
    result.current = { data: [], count: 7, error: null };
    const r = await countPendingParcels();
    expect(r).toEqual({ ok: true, count: 7 });
    const op = ops[0];
    expect(op.table).toBe("parcel_scans");
    expect(op.selectOpts).toEqual({ count: "exact", head: true });
    expect(op.filters).toContainEqual(["user_id", "u1"]);
    expect(op.filters).toContainEqual(["neq:status", "exported"]);
  });
  it("db error → ok:false (import blocks rather than exceed the cap)", async () => {
    result.current = { data: [], count: null, error: { message: "down" } };
    const r = await countPendingParcels();
    expect(r).toEqual({ ok: false, count: 0, error: "down" });
  });
});

describe("countParcelCustomers — full own total", () => {
  it("head:true exact count on parcel_customers, own-scoped (no other filter)", async () => {
    result.current = { data: [], count: 17, error: null };
    const r = await countParcelCustomers();
    expect(r).toEqual({ ok: true, count: 17 });
    const op = ops[0];
    expect(op.table).toBe("parcel_customers");
    expect(op.selectOpts).toEqual({ count: "exact", head: true });
    expect(op.filters).toContainEqual(["user_id", "u1"]);
    expect(op.filters).toHaveLength(1); // ONLY user_id — the full total, never a searched subset
    expect(op.or).toBeUndefined();      // never an ilike-filtered count
  });
  it("zero customers → ok, count 0", async () => {
    result.current = { data: [], count: 0, error: null };
    expect(await countParcelCustomers()).toEqual({ ok: true, count: 0 });
  });
  it("db error → ok:false (screen hides the line, no wrong number)", async () => {
    result.current = { data: [], count: null, error: { message: "down" } };
    expect(await countParcelCustomers()).toEqual({ ok: false, count: 0, error: "down" });
  });
});
