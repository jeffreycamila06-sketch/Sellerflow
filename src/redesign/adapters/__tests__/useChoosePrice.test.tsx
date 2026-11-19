// "Choose price before print" — the saved setting (sql/180) and its list rules. Same supabase
// mock as useSamePrice.test: read-on-load, one upsert per change, revert on a failed save.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { maybeSingle, upsert, getSession, fromTable } = vi.hoisted(() => ({
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
      select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => maybeSingle(...(a as [])) }) }),
      upsert: (row: unknown) => upsert(row),
    }; },
  },
}));

import { useChoosePrice, normalizePriceList, addChoicePrice, removeChoicePrice, makeDefaultPrice, canEnableChoosePrice, MAX_CHOICE_PRICES } from "../useChoosePrice";

beforeEach(() => {
  vi.clearAllMocks();
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
  it("default OFF: no row → off, no prices, not active; reads its own table", async () => {
    const { result } = renderHook(() => useChoosePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.prices).toEqual([]);
    expect(result.current.active).toBe(false);
    expect(fromTable).toHaveBeenCalledWith("seller_price_choices");
    expect(fromTable).not.toHaveBeenCalledWith("seller_same_price");
  });
  it("reads enabled + prices (cleaned) → active", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: ["39", 59, 59, 0] }, error: null });
    const { result } = renderHook(() => useChoosePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual([39, 59]);
    expect(result.current.active).toBe(true);
  });
  it("a stored ON with an empty list reads as OFF", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [] }, error: null });
    const { result } = renderHook(() => useChoosePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });
  it("ON with an empty list is refused (nothing saved); ON with a price saves both", async () => {
    const { result } = renderHook(() => useChoosePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setEnabled(true); });
    expect(result.current.enabled).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    await act(async () => { await result.current.setEnabled(true, [39]); });
    expect(result.current.enabled).toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", enabled: true, prices: [39] }));
  });
  it("OFF keeps the saved prices", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [39, 59] }, error: null });
    const { result } = renderHook(() => useChoosePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setEnabled(false); });
    expect(result.current.enabled).toBe(false);
    expect(result.current.prices).toEqual([39, 59]);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, prices: [39, 59] }));
  });
  it("removing the last price while ON is refused", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [39] }, error: null });
    const { result } = renderHook(() => useChoosePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices([]); });
    expect(result.current.prices).toEqual([39]);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("a failed save reverts and counts the error", async () => {
    upsert.mockResolvedValue({ error: { message: "no table" } });
    const { result } = renderHook(() => useChoosePrice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setEnabled(true, [39]); });
    expect(result.current.enabled).toBe(false);
    expect(result.current.prices).toEqual([]);
    expect(result.current.saveErrors).toBe(1);
  });
});
