// BLACKLIST — reads and writes (sql/190) and the hook's reading rule: read when a live STARTS, when the
// screen asks and after an add / undo / remove — never on a timer, never when the gate is closed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const D = vi.hoisted(() => ({
  pages: [] as ({ data: unknown[] | null; error: unknown })[],
  reads: [] as { table: string; cols: string; range: [number, number] }[],
  rpc: vi.fn(async (_n: string, _a: unknown): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  del: vi.fn(async (_id: string): Promise<{ data: unknown; error: unknown }> => ({ data: [{ id: "x" }], error: null })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (n: string, a: unknown) => D.rpc(n, a),
    from: (table: string) => ({
      select: (cols: string) => {
        const q = {
          order: () => q,
          range: async (a: number, b: number) => { D.reads.push({ table, cols, range: [a, b] }); return D.pages.shift() ?? { data: [], error: null }; },
        };
        return q;
      },
      delete: () => ({ eq: (_c: string, id: string) => ({ select: () => D.del(id) }) }),
    }),
  },
}));

import { addToBlacklist, loadBlacklist, removeFromBlacklist, undoBlacklistAdd, useBlacklist, BL_PAGE } from "../blacklist";

const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const dbRow = (i: number) => ({ id: `r${i}`, platform: "tiktok", buyer_label: `b${i}`, reason: "returned", added_day: "2026-11-18", created_at: `2026-11-18T00:00:${String(i % 60).padStart(2, "0")}Z` });

beforeEach(() => {
  D.pages = []; D.reads = [];
  D.rpc.mockReset(); D.rpc.mockResolvedValue({ data: null, error: null });
  D.del.mockReset(); D.del.mockResolvedValue({ data: [{ id: "x" }], error: null });
});
afterEach(() => { vi.useRealTimers(); });

describe("reads and writes", () => {
  it("load: own table, newest first, every page (1,000 a page), never a partial list", async () => {
    D.pages = [{ data: Array.from({ length: BL_PAGE }, (_, i) => dbRow(i)), error: null }, { data: [dbRow(2000)], error: null }];
    const r = await loadBlacklist();
    expect(r).toHaveLength(BL_PAGE + 1);
    expect(D.reads.map((x) => x.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(D.reads[0].table).toBe("buyer_blacklist");
    D.reads = [];
    D.pages = [{ data: Array.from({ length: BL_PAGE }, (_, i) => dbRow(i)), error: null }, { data: null, error: { message: "x" } }];
    expect(await loadBlacklist()).toBeNull();
  });
  it("add: one call to blacklist_add with the cleaned name, the reason and the phone's time zone", async () => {
    D.rpc.mockResolvedValueOnce({ data: { result: "added", id: "id1", day: "2026-11-20" }, error: null });
    expect(await addToBlacklist("tiktok", "  @Maria_Shop ", "returned", "Asia/Manila")).toEqual({ kind: "added", id: "id1", day: "2026-11-20" });
    expect(D.rpc).toHaveBeenCalledWith("blacklist_add", { p_platform: "tiktok", p_label: "Maria_Shop", p_reason: "returned", p_tz: "Asia/Manila" });
    D.rpc.mockResolvedValueOnce({ data: { result: "already_today", day: "2026-11-20" }, error: null });
    expect(await addToBlacklist("facebook", " Ana Reyes ", "not_checked_out", null)).toEqual({ kind: "already", day: "2026-11-20" });
    expect(D.rpc).toHaveBeenLastCalledWith("blacklist_add", { p_platform: "facebook", p_label: "Ana Reyes", p_reason: "not_checked_out", p_tz: null });
    D.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await addToBlacklist("tiktok", "x", "returned", "UTC")).toEqual({ kind: "error" });
    D.rpc.mockRejectedValueOnce(new Error("net"));
    expect(await addToBlacklist("tiktok", "x", "returned", "UTC")).toEqual({ kind: "error" });
    const calls = D.rpc.mock.calls.length;
    expect(await addToBlacklist("tiktok", "maria shop", "returned", "UTC")).toEqual({ kind: "error" }); // a TikTok name with a space never leaves the phone
    expect(D.rpc.mock.calls.length).toBe(calls);
  });
  it("undo deletes exactly that row; remove = blacklist_remove for that buyer", async () => {
    expect(await undoBlacklistAdd("id1")).toBe(true);
    expect(D.del).toHaveBeenCalledWith("id1");
    D.del.mockResolvedValueOnce({ data: [], error: null });
    expect(await undoBlacklistAdd("not-mine")).toBe(false);
    expect(await removeFromBlacklist("tiktok", "maria_shop")).toBe(true);
    expect(D.rpc).toHaveBeenLastCalledWith("blacklist_remove", { p_platform: "tiktok", p_label: "maria_shop" });
    D.rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await removeFromBlacklist("tiktok", "maria_shop")).toBe(false);
  });
});

describe("useBlacklist — when it reads", () => {
  it("gate closed: never reads, whatever the live does; nothing to show", async () => {
    const { result, rerender } = renderHook(({ live }) => useBlacklist(false, live, "u1"), { initialProps: { live: false } });
    rerender({ live: true }); await flush();
    rerender({ live: false }); await flush();
    rerender({ live: true }); await flush();
    expect(D.reads).toHaveLength(0);
    expect(await act(async () => result.current.reload())).toBe(false);
    expect(D.reads).toHaveLength(0);
    expect(result.current.map).toBeUndefined();
    expect(result.current.rows).toBeNull();
  });
  it("one read when a live starts, none while it runs (no timer), one more at the next start", async () => {
    vi.useFakeTimers();
    D.pages = [{ data: [dbRow(1)], error: null }];
    const { result, rerender } = renderHook(({ live }) => useBlacklist(true, live, "u1"), { initialProps: { live: false } });
    await flush();
    expect(D.reads).toHaveLength(0); // signed in, no live → nothing read
    rerender({ live: true }); await flush();
    expect(D.reads).toHaveLength(1);
    expect(result.current.map?.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0); // no timer left running
    await act(async () => { vi.advanceTimersByTime(3 * 60 * 60 * 1000); });
    rerender({ live: true }); await flush();
    expect(D.reads).toHaveLength(1);
    rerender({ live: false }); await flush();
    rerender({ live: true }); await flush();
    expect(D.reads).toHaveLength(2);
  });
  it("after add (only when added), undo and remove — one read each", async () => {
    const { result } = renderHook(() => useBlacklist(true, false, "u1"));
    await flush();
    expect(D.reads).toHaveLength(0);
    D.rpc.mockResolvedValueOnce({ data: { result: "added", id: "n1", day: "2026-11-20" }, error: null });
    await act(async () => { await result.current.add("tiktok", "@a", "returned"); }); await flush();
    expect(D.reads).toHaveLength(1);
    D.rpc.mockResolvedValueOnce({ data: { result: "already_today", day: "2026-11-20" }, error: null });
    await act(async () => { await result.current.add("tiktok", "@a", "returned"); }); await flush();
    expect(D.reads).toHaveLength(1); // nothing new to read
    await act(async () => { await result.current.undo("n1"); }); await flush();
    expect(D.reads).toHaveLength(2);
    D.rpc.mockResolvedValueOnce({ data: 2, error: null });
    await act(async () => { await result.current.remove({ platform: "tiktok", label: "a" }); }); await flush();
    expect(D.reads).toHaveLength(3);
    expect(D.rpc).toHaveBeenLastCalledWith("blacklist_remove", { p_platform: "tiktok", p_label: "a" });
  });
  it("a failed read keeps the last list and says so; another user starts empty", async () => {
    D.pages = [{ data: [dbRow(1)], error: null }];
    const { result, rerender } = renderHook(({ uid }) => useBlacklist(true, false, uid), { initialProps: { uid: "u1" } });
    await act(async () => { await result.current.reload(); });
    expect(result.current.rows).toHaveLength(1);
    D.pages = [{ data: null, error: { message: "x" } }];
    await act(async () => { await result.current.reload(); });
    expect(result.current.error).toBe(true);
    expect(result.current.rows).toHaveLength(1);
    rerender({ uid: "u2" }); await flush();
    expect(result.current.rows).toBeNull();
    expect(result.current.error).toBe(false);
  });
});
