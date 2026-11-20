// FACEBOOK POST SALES (sql/188) — the app's database calls with a fake Supabase: the two new end-date
// answers, Give's 'not_allowed', and the waitlist count per post (the waiting comment's own sale;
// read with select("*") so the read still works before sql/188 adds sale_id).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), rows: [] as Record<string, unknown>[], select: vi.fn() }));
vi.mock("../../../supabase", () => {
  const chain = (rows: () => Record<string, unknown>[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["eq", "is", "order"]) q[m] = () => q;
    q.limit = async () => ({ data: rows(), error: null });
    return q;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "t" } } }) },
      rpc: h.rpc,
      from: () => ({ select: (cols: string) => { h.select(cols); return chain(() => h.rows); } }),
    },
  };
});
import { createPostSale, givePostWaitlist, loadPostWaitlistCounts, type PostSale } from "../fbPostSales";

const sale = (id: number, code: string): PostSale => ({ id, pageId: "P", postId: `P_${id}`, postMessage: "", postPicture: null, mode: code === "+1" ? "plus_one" : "code", startsAt: "", endsAt: "2099-01-01T00:00:00Z", status: "selling", createdAt: "", items: [{ id: id * 10, saleId: id, productId: null, name: "x", code, price: 1, stock: null, sold: 0 }] });
const args = { pageId: "P", postId: "P_1", postMessage: "", postPicture: "", mode: "code" as const, endsAt: "2026-11-27T00:00:00Z", items: [{ name: "a", code: "A", price: 1, stock: null }] };
beforeEach(() => { h.rpc.mockReset(); h.select.mockReset(); h.rows = []; });

describe("createPostSale — the database's end-date answers", () => {
  it.each([["ends_too_late", "ends_too_late"], ["ends_in_past", "ends_in_past"], ["code_in_use:+1", "code_in_use"], ["not_allowed", "not_allowed"], ["too_many_sales", "too_many"], ["boom", "failed"]])("%s → %s", async (msg, error) => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: msg } });
    expect((await createPostSale(args)).ok).toBe(false);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: msg } });
    expect(await createPostSale(args)).toMatchObject({ error });
  });
  it("sends the end date it was given", async () => {
    h.rpc.mockResolvedValueOnce({ data: 5, error: null });
    expect(await createPostSale(args)).toEqual({ ok: true, id: 5 });
    expect(h.rpc).toHaveBeenCalledWith("fb_post_sale_create", expect.objectContaining({ p_ends_at: "2026-11-27T00:00:00Z" }));
  });
});

describe("givePostWaitlist", () => {
  it("'not_allowed' comes through (the plan); unknown answers → null", async () => {
    h.rpc.mockResolvedValueOnce({ data: "not_allowed", error: null });
    expect(await givePostWaitlist(1)).toBe("not_allowed");
    h.rpc.mockResolvedValueOnce({ data: "weird", error: null });
    expect(await givePostWaitlist(1)).toBeNull();
  });
});

describe("loadPostWaitlistCounts — per post", () => {
  it("counts each waiting comment on ITS sale (two \"+1\" posts); select(\"*\")", async () => {
    h.rows = [{ code: "+1", sale_id: 2 }, { code: "+1", sale_id: 2 }, { code: "+1", sale_id: 1 }, { code: "A", sale_id: null }];
    const m = await loadPostWaitlistCounts([sale(1, "+1"), sale(2, "+1"), sale(3, "A")]);
    expect(h.select).toHaveBeenCalledWith("*");
    expect([...m.entries()].sort()).toEqual([[1, 1], [2, 2], [3, 1]]);
  });
  it("a row of a sale that is no longer listed counts nowhere; a row without sale_id → first selling sale with the code (as before)", async () => {
    h.rows = [{ code: "+1", sale_id: 99 }, { code: "+1" }];
    const m = await loadPostWaitlistCounts([sale(1, "+1"), sale(2, "+1")]);
    expect([...m.entries()]).toEqual([[1, 1]]);
  });
});
