// Pickup Status buyer NAME lookup (Customer Details → parcel_customers, matched on the
// handle). Pure normalize + the bounded, own-scoped, fail-open loader.
import { describe, it, expect, vi, beforeEach } from "vitest";

const DB = vi.hoisted(() => ({
  rows: [] as { notes: string | null; name: string | null }[],
  error: null as unknown,
  throwOn: false,
  calls: [] as { eq: [string, unknown][]; range: [number, number]; not: unknown[]; neq: unknown[]; select: string; table: string }[],
}));
vi.mock("../../../supabase", () => {
  const from = (table: string) => {
    const c = { table, select: "", eq: [] as [string, unknown][], range: [0, 0] as [number, number], not: [] as unknown[], neq: [] as unknown[] };
    const q = {
      select: (s: string) => { c.select = s; return q; },
      eq: (k: string, v: unknown) => { c.eq.push([k, v]); return q; },
      not: (...a: unknown[]) => { c.not = a; return q; },
      neq: (...a: unknown[]) => { c.neq = a; return q; },
      order: () => q,
      range: async (a: number, b: number) => {
        c.range = [a, b]; DB.calls.push(c);
        if (DB.throwOn) throw new Error("boom");
        if (DB.error) return { data: null, error: DB.error };
        return { data: DB.rows.slice(a, b + 1), error: null };
      },
    };
    return q;
  };
  return {
    isSupabaseConfigured: true,
    supabase: { from, auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }) } },
  };
});

import { normHandle, loadBuyerNamesByHandle, BUYER_NAMES_MAX } from "../parcelTracking";

beforeEach(() => { DB.rows = []; DB.error = null; DB.throwOn = false; DB.calls = []; });

describe("normHandle", () => {
  it("lower-cases, trims (incl. full-width space / NBSP), drops zero-width chars and leading @s", () => {
    expect(normHandle("@Maria_Shop")).toBe("maria_shop");
    expect(normHandle("  @@maria_shop  ")).toBe("maria_shop");
    expect(normHandle("　maria ")).toBe("maria");
    expect(normHandle("​maria")).toBe("maria");
  });
  it("blank / null → '' (no key); a plain string normalize — IG/LINE tags are NOT stripped", () => {
    expect(normHandle("")).toBe("");
    expect(normHandle("   @ ")).toBe("");
    expect(normHandle(null)).toBe("");
    expect(normHandle(undefined)).toBe("");
    expect(normHandle("Maria(IG)")).toBe("maria(ig)");
  });
});

describe("loadBuyerNamesByHandle", () => {
  it("builds Map<handle, name> for the REQUESTED handles from own parcel_customers rows with notes", async () => {
    DB.rows = [
      { notes: "@Maria_Shop", name: "Maria Santos" },
      { notes: "other_buyer", name: "Someone Else" },   // not requested → not in the map
      { notes: "  @jun ", name: "  Jun Cruz " },
      { notes: "noname", name: "" },                      // blank name → skipped
    ];
    const m = await loadBuyerNamesByHandle(["maria_shop", "@JUN", "noname", "", "missing"]);
    expect(Object.fromEntries(m)).toEqual({ maria_shop: "Maria Santos", jun: "Jun Cruz" });
    const c = DB.calls[0];
    expect(c.table).toBe("parcel_customers");
    expect(c.select).toBe("notes, name");
    expect(c.eq).toContainEqual(["user_id", "me"]);       // own rows only
    expect(c.not).toEqual(["notes", "is", null]);
    expect(c.neq).toEqual(["notes", ""]);
  });
  it("the first non-empty name for a handle wins (duplicates)", async () => {
    DB.rows = [{ notes: "dup", name: "First" }, { notes: "@DUP", name: "Second" }];
    expect((await loadBuyerNamesByHandle(["dup"])).get("dup")).toBe("First");
  });
  it("reads in chunks of 500 and stops at 2,000 rows (bounded, logs once)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    DB.rows = Array.from({ length: 2600 }, (_, i) => ({ notes: `h${i}`, name: `N${i}` }));
    const m = await loadBuyerNamesByHandle(["h0", "h1999", "h2000", "h2500"]);
    expect(DB.calls.map((c) => c.range)).toEqual([[0, 499], [500, 999], [1000, 1499], [1500, 1999]]);
    expect(m.get("h1999")).toBe("N1999");
    expect(m.has("h2000")).toBe(false);
    expect(BUYER_NAMES_MAX).toBe(2000);
    expect(warn).toHaveBeenCalledTimes(1);
    await loadBuyerNamesByHandle(["h0"]);
    expect(warn).toHaveBeenCalledTimes(1); // logged once only
    warn.mockRestore();
  });
  it("a short page ends the read (no extra query)", async () => {
    DB.rows = [{ notes: "a", name: "A" }];
    await loadBuyerNamesByHandle(["a"]);
    expect(DB.calls).toHaveLength(1);
  });
  it("no requested handles → no query at all", async () => {
    expect((await loadBuyerNamesByHandle(["", "  "])).size).toBe(0);
    expect(DB.calls).toHaveLength(0);
  });
  it("FAIL OPEN: a query error or a throw → empty Map", async () => {
    DB.rows = [{ notes: "a", name: "A" }];
    DB.error = { message: "rls" };
    expect((await loadBuyerNamesByHandle(["a"])).size).toBe(0);
    DB.error = null; DB.throwOn = true;
    expect((await loadBuyerNamesByHandle(["a"])).size).toBe(0);
  });
});
