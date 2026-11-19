// "Choose price before print" — the saved setting (sql/180) and its list rules. Same supabase
// mock as useSamePrice.test: one read per signed-in user, one upsert per change, revert on a
// failed save. Plus the per-user copy kept on the device (ready at app start).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { maybeSingle, upsert, getSession, fromTable, eqUser } = vi.hoisted(() => ({
  eqUser: vi.fn((_col: string, _v: string) => {}),
  maybeSingle: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  upsert: vi.fn(async (_row: unknown): Promise<{ error: unknown }> => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
  fromTable: vi.fn((_t: string) => {}),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: (...a: unknown[]) => getSession(...(a as [])) },
    from: (tbl: string) => { fromTable(tbl); return {
      select: () => ({ eq: (col: string, v: string) => { eqUser(col, v); return ({ maybeSingle: (...a: unknown[]) => maybeSingle(...(a as [])) }); } }),
      upsert: (row: unknown) => upsert(row),
    }; },
  },
}));

import { useChoosePrice, readChoiceCache, writeChoiceCache, choiceCacheKey, normalizePriceList, addChoicePrice, removeChoicePrice, makeDefaultPrice, canEnableChoosePrice, MAX_CHOICE_PRICES } from "../useChoosePrice";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  maybeSingle.mockResolvedValue({ data: null, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("list rules (pure)", () => {
  it("positive numbers only, no duplicates, max 6", () => {
    expect(normalizePriceList([39, "59", 0, -5, "", null, "abc", 39, 59.5, 79, 99, 129, 149, 199])).toEqual([39, 59, 59.5, 79, 99, 129]);
    expect(normalizePriceList("39")).toEqual([]);
    expect(MAX_CHOICE_PRICES).toBe(6);
  });
  it("add: refuses zero / negative / blank, a duplicate, a 7th price; adds at the end", () => {
    expect(addChoicePrice([39], "0")).toEqual({ ok: false, reason: "bad" });
    expect(addChoicePrice([39], "-3")).toEqual({ ok: false, reason: "bad" });
    expect(addChoicePrice([39], "")).toEqual({ ok: false, reason: "bad" });
    expect(addChoicePrice([39, 59], "59")).toEqual({ ok: false, reason: "dup" });
    expect(addChoicePrice([1, 2, 3, 4, 5, 6], "7")).toEqual({ ok: false, reason: "max" });
    expect(addChoicePrice([39], "59")).toEqual({ ok: true, prices: [39, 59] });
  });
  it("make default = move to first; remove; an empty list cannot be ON", () => {
    expect(makeDefaultPrice([39, 59, 99], 99)).toEqual([99, 39, 59]);
    expect(makeDefaultPrice([39, 59], 7)).toEqual([39, 59]);
    expect(removeChoicePrice([39, 59, 99], 59)).toEqual([39, 99]);
    expect(canEnableChoosePrice([])).toBe(false);
    expect(canEnableChoosePrice([39])).toBe(true);
  });
});

describe("useChoosePrice", () => {
  it("default OFF: no row → off, no prices, not active; reads its own table for THIS user", async () => {
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.prices).toEqual([]);
    expect(result.current.active).toBe(false);
    expect(fromTable).toHaveBeenCalledWith("seller_price_choices");
    expect(fromTable).not.toHaveBeenCalledWith("seller_same_price");
    expect(eqUser).toHaveBeenCalledWith("user_id", "u1");
  });
  it("signed out (no user id) → OFF, nothing read", async () => {
    const { result } = renderHook(() => useChoosePrice(null));
    expect(result.current.enabled).toBe(false);
    expect(result.current.loading).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(maybeSingle).not.toHaveBeenCalled();
  });
  it("reads enabled + prices (cleaned) → active", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: ["39", 59, 59, 0] }, error: null });
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual([39, 59]);
    expect(result.current.active).toBe(true);
  });
  it("a stored ON with an empty list reads as OFF", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [] }, error: null });
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });
  it("ON with an empty list is refused (false, nothing saved); ON with a price saves both and answers true", async () => {
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.setEnabled(true); });
    expect(ok).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    await act(async () => { ok = await result.current.setEnabled(true, [39]); });
    expect(ok).toBe(true);
    expect(result.current.enabled).toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", enabled: true, prices: [39] }));
  });
  it("OFF keeps the saved prices", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [39, 59] }, error: null });
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setEnabled(false); });
    expect(result.current.enabled).toBe(false);
    expect(result.current.prices).toEqual([39, 59]);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, prices: [39, 59] }));
  });
  it("removing the last price while ON is refused", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [39] }, error: null });
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.setPrices([]); });
    expect(ok).toBe(false);
    expect(result.current.prices).toEqual([39]);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("a failed save reverts, counts the error and answers false", async () => {
    upsert.mockResolvedValue({ error: { message: "no table" } });
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.setEnabled(true, [39]); });
    expect(ok).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(result.current.prices).toEqual([]);
    expect(result.current.saveErrors).toBe(1);
    expect(readChoiceCache("u1")).toEqual({ enabled: false, prices: [] }); // a failed save is never remembered (still the read's answer)
  });
});

describe("ready at app start — the copy kept on the device, per user", () => {
  // The database read that has not answered yet.
  const pendingRead = () => { let done!: (v: { data: unknown; error: unknown }) => void; maybeSingle.mockReturnValue(new Promise((r) => { done = r; })); return (v: { data: unknown; error: unknown }) => done(v); };

  it("ON seller: active from the FIRST render, before the database answers", async () => {
    writeChoiceCache("u1", true, [39, 59]);
    const answer = pendingRead();
    const { result } = renderHook(() => useChoosePrice("u1"));
    expect(result.current.active).toBe(true);            // first render, read still on its way
    expect(result.current.prices).toEqual([39, 59]);
    expect(result.current.loading).toBe(true);
    await act(async () => { answer({ data: { enabled: true, prices: [39, 59, 99] }, error: null }); await Promise.resolve(); });
    expect(result.current.prices).toEqual([39, 59, 99]); // the database answer wins and is remembered
    expect(readChoiceCache("u1")).toEqual({ enabled: true, prices: [39, 59, 99] });
  });
  it("OFF seller: zero delay — OFF at the first render with the read still on its way, nothing to wait for", () => {
    pendingRead();
    const { result } = renderHook(() => useChoosePrice("u1"));
    expect(result.current.enabled).toBe(false);
    expect(result.current.active).toBe(false);           // 1-Click goes straight to the order
  });
  it("the database says OFF → the saved copy is corrected", async () => {
    writeChoiceCache("u1", true, [39]);
    maybeSingle.mockResolvedValue({ data: { enabled: false, prices: [39] }, error: null });
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.active).toBe(false);
    expect(readChoiceCache("u1")).toEqual({ enabled: false, prices: [39] });
  });
  it("a failed read keeps the saved copy", async () => {
    writeChoiceCache("u1", true, [39]);
    maybeSingle.mockResolvedValue({ data: null, error: { message: "offline" } });
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.active).toBe(true);
    expect(readChoiceCache("u1")).toEqual({ enabled: true, prices: [39] });
  });
  it("a successful save is remembered", async () => {
    const { result } = renderHook(() => useChoosePrice("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setEnabled(true, [39, 59]); });
    expect(readChoiceCache("u1")).toEqual({ enabled: true, prices: [39, 59] });
    await act(async () => { await result.current.setPrices([59, 39]); });
    expect(readChoiceCache("u1")).toEqual({ enabled: true, prices: [59, 39] });
  });
  it("another user signs in → THAT user's copy in the same render, and a new read for them", async () => {
    writeChoiceCache("u1", true, [39]);
    writeChoiceCache("u2", false, [120]);
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [39] }, error: null });
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useChoosePrice(id), { initialProps: { id: "u1" as string | null } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.active).toBe(true);
    maybeSingle.mockResolvedValue({ data: { enabled: false, prices: [120, 150] }, error: null });
    rerender({ id: "u2" });
    expect(result.current.active).toBe(false);           // never a frame of u1's setting
    expect(result.current.prices).toEqual([120]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(eqUser).toHaveBeenLastCalledWith("user_id", "u2");
    expect(result.current.prices).toEqual([120, 150]);
    rerender({ id: null });                              // signed out
    expect(result.current.enabled).toBe(false);
    expect(result.current.prices).toEqual([]);
  });
  it("a broken or blocked localStorage never throws", () => {
    localStorage.setItem(choiceCacheKey("u1"), "{not json");
    expect(readChoiceCache("u1")).toBeNull();
    localStorage.setItem(choiceCacheKey("u1"), JSON.stringify({ enabled: true, prices: [] }));
    expect(readChoiceCache("u1")).toEqual({ enabled: false, prices: [] }); // never ON with no price
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(() => writeChoiceCache("u1", true, [39])).not.toThrow();
    spy.mockRestore();
    const g = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readChoiceCache("u1")).toBeNull();
    g.mockRestore();
  });
});
