// Audit Batch A — tests for the three fixes.
//  1. S2: listUsers pager — complete past 100 users (the old hard .limit(100))
//  2. S4: free-cap poller gated to the FREE plan only (paid = zero RPC calls)
//  3. Subscription expiry display — shared lib/planWindow, NULL expiry → "—"
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { fetchAllProfilePages, USERS_PAGE_SIZE } from "../../../accountDb";
import { isFreePlan, useFreeCap } from "../useFreeCap";
import { planDaysLeft, daysDisplay } from "../../../lib/planWindow";

// ── 1. S2: profile pager (>100-user scenario) ────────────────────────────────
describe("fetchAllProfilePages (S2 — admin list past the old 100 cap)", () => {
  const mkUsers = (start: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ email: `s${start + i}@x.com` }));
  it("150-user org: complete list (the old .limit(100) dropped the 50 newest signups)", async () => {
    // pager pages are USERS_PAGE_SIZE(1000)-sized, so 150 fits one page — the
    // guarantee under test is NO fixed cap: page sizes only bound round trips.
    const rows = await fetchAllProfilePages(async () => mkUsers(1, 150));
    expect(rows).toHaveLength(150);
    expect(rows[149].email).toBe("s150@x.com"); // newest signup retained
  });
  it("multi-page org (1,200 users): accumulates both pages in order", async () => {
    const pages = [mkUsers(1, USERS_PAGE_SIZE), mkUsers(USERS_PAGE_SIZE + 1, 200)];
    const calls: number[] = [];
    const rows = await fetchAllProfilePages(async (p) => { calls.push(p); return pages[p] ?? []; });
    expect(rows).toHaveLength(1200);
    expect(calls).toEqual([0, 1]);
  });
  it("page error → [] (complete or empty, never a silent partial)", async () => {
    const rows = await fetchAllProfilePages(async (p) => (p === 0 ? mkUsers(1, USERS_PAGE_SIZE) : null));
    expect(rows).toEqual([]);
  });
});

// ── 2. S4: free-cap poller plan gate ─────────────────────────────────────────
describe("isFreePlan", () => {
  it("free (any case/whitespace) → true; paid/unknown → false", () => {
    expect(isFreePlan("free")).toBe(true);
    expect(isFreePlan("Free ")).toBe(true);
    expect(isFreePlan("basic")).toBe(false);
    expect(isFreePlan("pro")).toBe(false);
    expect(isFreePlan("master")).toBe(false);
    expect(isFreePlan(undefined)).toBe(false); // profile still loading → no poll yet
    expect(isFreePlan("")).toBe(false);
  });
});

describe("useFreeCap poller (S4 — free tier only)", () => {
  const setRpc = (impl: (fn: string) => Promise<{ data: unknown }>) => {
    // the adapter reads the shared singleton; stub its rpc for the test
    // (isSupabaseConfigured must be true for the poll path — see vi.mock below)
    mockRpc.mockImplementation(impl as never);
  };
  afterEach(() => { vi.useRealTimers(); mockRpc.mockReset(); });

  it("PAID seller (basic): ZERO status RPC calls, even after 35s visible", () => {
    vi.useFakeTimers();
    setRpc(async () => ({ data: { is_free: false } }));
    renderHook(() => useFreeCap(true, "basic"));
    act(() => { vi.advanceTimersByTime(35000); });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("FREE seller: status RPC fires on mount (warning flow input intact)", async () => {
    setRpc(async () => ({ data: { is_free: true, count: 10, cap: 100 } }));
    const { result } = renderHook(() => useFreeCap(true, "free"));
    await act(async () => { await Promise.resolve(); });
    expect(mockRpc).toHaveBeenCalledWith("free_tier_status_for_user");
    expect(result.current.isFreeUser).toBe(true);
  });
  it("unknown plan (profile loading): no RPC until the plan resolves to free", async () => {
    setRpc(async () => ({ data: { is_free: true } }));
    const { rerender } = renderHook(({ p }: { p: string | undefined }) => useFreeCap(true, p), { initialProps: { p: undefined as string | undefined } });
    expect(mockRpc).not.toHaveBeenCalled();
    rerender({ p: "free" });
    await act(async () => { await Promise.resolve(); });
    expect(mockRpc).toHaveBeenCalled();
  });
});

const mockRpc = vi.fn();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

// ── 3. Subscription expiry display via shared planWindow ────────────────────
// The screen renders daysDisplay(Math.max(0, planDaysLeft(expiry, now))) — pin
// the three behaviors the private 4th copy got wrong / must keep.
describe("Subscription days-left via lib/planWindow", () => {
  const render = (expiry: string, now: number) => daysDisplay(Math.max(0, planDaysLeft(expiry, now)));
  const now = Date.parse("2026-07-05T00:00:00.000Z");
  it("NULL/empty expiry → '—' (was '0 days' from the private copy)", () => {
    expect(render("", now)).toBe("—");
    expect(render("not-a-date", now)).toBe("—");
  });
  it("future expiry → real day count", () => {
    expect(render("2026-07-12T00:00:00.000Z", now)).toBe("7");
  });
  it("past expiry → clamps to 0 (unchanged display for expired plans)", () => {
    expect(render("2026-07-01T00:00:00.000Z", now)).toBe("0");
  });
});
