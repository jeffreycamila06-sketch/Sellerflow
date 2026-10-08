// F1 — Sales per platform. Pins: the switch reader (fail closed), who gets the selector
// (2+ platforms only), the range bounds (Today / This session / 7 days only), the mapper,
// the Sales tab (no options = exactly as before; with options = selector, Custom hidden,
// note, per-platform view with best sellers) and the sql/89 contract.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const db = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({ select: () => ({ in: (...a: unknown[]) => db.select(...a) }) }),
    rpc: (...a: unknown[]) => db.rpc(...a),
  },
}));

import { parseSwitches, useFeatureSwitches, FEATURE_SWITCH_KEYS, SWITCHES_OFF } from "../featureSwitches";
import { platformOptions, platformRange, mapPlatformSales, type UsePlatformSales } from "../salesByPlatform";
import { TProvider } from "../../i18n";
import SalesTab from "../../screens/SalesTab";
import type { UseSalesTab } from "../salesTab";
import type { SalesHistData } from "../salesReport";

beforeEach(() => { db.select.mockReset(); db.rpc.mockReset(); });

describe("feature switches — fail closed", () => {
  it("only the exact string 'true' turns a switch on", () => {
    expect(parseSwitches([{ key: "sales_platform_enabled", value: "true" }, { key: "fb_soldout_enabled", value: "TRUE" }, { key: "fb_waitlist_enabled", value: "1" }]))
      .toEqual({ ...SWITCHES_OFF, salesPlatform: true });
    expect(parseSwitches(null)).toEqual(SWITCHES_OFF);
    expect(parseSwitches([{ key: "other", value: "true" }])).toEqual(SWITCHES_OFF);
  });
  it("the keys are the sql/93 + sql/95 names", () => {
    expect(Object.values(FEATURE_SWITCH_KEYS).sort()).toEqual(["fb_soldout_enabled", "fb_waitlist_enabled", "inventory_v2_enabled", "product_images_enabled", "sales_platform_enabled"]);
  });
  it("signed out → no read, all off; error → all off", async () => {
    renderHook(() => useFeatureSwitches(""));
    expect(db.select).not.toHaveBeenCalled();
    db.select.mockResolvedValue({ data: null, error: { message: "x" } });
    const { result } = renderHook(() => useFeatureSwitches("u1"));
    await waitFor(() => expect(db.select).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual(SWITCHES_OFF);
  });
  it("signed in → one read; a 'true' row turns its switch on", async () => {
    db.select.mockResolvedValue({ data: [{ key: "inventory_v2_enabled", value: "true" }], error: null });
    const { result } = renderHook(() => useFeatureSwitches("u1"));
    await waitFor(() => expect(result.current.inventoryV2).toBe(true));
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(result.current.salesPlatform).toBe(false);
  });
});

describe("who gets the selector", () => {
  const c = (tiktok: number, facebook: number, shopee = 0, instagram = 0) => ({ tiktok, facebook, shopee, instagram });
  it("2+ platforms with an account only", () => {
    expect(platformOptions(null)).toEqual([]);
    expect(platformOptions(c(3, 0))).toEqual([]);           // TikTok-only
    expect(platformOptions(c(0, 2))).toEqual([]);           // Facebook-only
    expect(platformOptions(c(1, 1))).toEqual(["TikTok", "Facebook"]);
    expect(platformOptions(c(1, 0, 1))).toEqual(["TikTok"]); // TikTok + Shopee: no Facebook choice
  });
});

describe("range bounds", () => {
  it("Today / This session / 7 days", () => {
    expect(platformRange("today", "2026-10-08", "2026-10-06")).toEqual({ from: "2026-10-08", to: "2026-10-08" });
    expect(platformRange("session", "2026-10-08", "2026-10-06")).toEqual({ from: "2026-10-06", to: "2026-10-08" });
    expect(platformRange("session", "2026-10-08", "")).toEqual({ from: "2026-10-08", to: "2026-10-08" });
    expect(platformRange("7d", "2026-10-08", "")).toEqual({ from: "2026-10-02", to: "2026-10-08" });
  });
  it("mapper is garbage-safe", () => {
    expect(mapPlatformSales(null)).toMatchObject({ orders: 0, revenue: 0, days: [], best: [] });
    expect(mapPlatformSales({ best: [{ kind: "code", label: "A1", qty: "3", orders: 3, rev: 450 }, { kind: "x", label: "150" }] }).best)
      .toEqual([{ kind: "code", label: "A1", qty: 3, orders: 3, rev: 450 }, { kind: "price", label: "150", qty: 0, orders: 0, rev: 0 }]);
  });
});

const DATA: SalesHistData = {
  revenue: 1000, orders: 5, buyers: 3, aov: 200, trendUnit: "day",
  dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null,
  days: [{ d: "2026-10-08", rev: 1000, orders: 5 }], bestDay: { d: "2026-10-08", rev: 1000, orders: 5 },
  topProducts: [], topBuyers: [{ name: "Ann", handle: "ann", spent: 1000, orders: 5 }], start: "2026-10-08", end: "2026-10-08",
};
const sales = (): UseSalesTab => ({ data: DATA, state: "live", range: "today", load: vi.fn(), reload: vi.fn() });
const pSales = (over: Partial<UsePlatformSales> = {}): UsePlatformSales => ({
  data: { platform: "TikTok", from: "2026-10-08", to: "2026-10-08", orders: 4, revenue: 600, buyers: 2,
    days: [{ d: "2026-10-08", orders: 4, rev: 600 }],
    best: [{ kind: "code", label: "A1", qty: 3, orders: 3, rev: 450 }, { kind: "price", label: "150", qty: 1, orders: 1, rev: 150 }] },
  state: "live", load: vi.fn(), ...over,
});
const tab = (extra: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><SalesTab cur="NT$" sessionStart="2026-10-06" today="2026-10-08" sales={sales()} {...extra} /></TProvider>);

describe("Sales tab", () => {
  it("no options (switch off / one platform) → identical to no props", () => {
    const a = tab().container.innerHTML;
    const b = tab({ platformOptions: [], platformSales: pSales() }).container.innerHTML;
    expect(b).toBe(a);
    expect(a).not.toContain("sales-platforms");
  });
  it("with options: selector All + TikTok + Facebook, default All = today's view", () => {
    const r = tab({ platformOptions: ["TikTok", "Facebook"], platformSales: pSales() });
    expect(r.getByTestId("sales-plat-all")).toBeTruthy();
    expect(r.getByTestId("sales-plat-TikTok")).toBeTruthy();
    expect(r.getByTestId("sales-summary")).toBeTruthy();
    expect(r.queryByTestId("sales-plat-note")).toBeNull();
  });
  it("picking a platform: Custom hidden, note shown, per-platform view, best sellers by code then price", () => {
    const ps = pSales();
    const r = tab({ platformOptions: ["TikTok", "Facebook"], platformSales: ps });
    fireEvent.click(r.getByTestId("sales-range-custom"));
    fireEvent.click(r.getByTestId("sales-plat-TikTok"));
    expect(r.queryByTestId("sales-range-custom")).toBeNull();
    expect(r.getByTestId("sales-plat-note").textContent).toMatch(/7 days/);
    expect(ps.load).toHaveBeenLastCalledWith("TikTok", "2026-10-06", "2026-10-08"); // custom → This session
    expect(r.getByTestId("sales-plat-best-0").textContent).toContain("A1");
    expect(r.getByTestId("sales-plat-best-1").textContent).toContain("NT$150");
    fireEvent.click(r.getByTestId("sales-range-7d"));
    expect(ps.load).toHaveBeenLastCalledWith("TikTok", "2026-10-02", "2026-10-08");
    fireEvent.click(r.getByTestId("sales-plat-all"));
    expect(r.getByTestId("sales-summary")).toBeTruthy();
  });
  it("per-platform error / empty states are honest", () => {
    const r = tab({ platformOptions: ["Facebook"], platformSales: pSales({ state: "error" }) });
    fireEvent.click(r.getByTestId("sales-plat-Facebook"));
    expect(r.getByTestId("sales-plat-error")).toBeTruthy();
  });
});

describe("sql/89 contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../sql", "89_sales_by_platform.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("invoker, own-row filter, live_session_orders only, never the orders ledger", () => {
    expect(code).toContain("security invoker");
    expect(code).not.toMatch(/security definer/i);
    expect(code).toContain("l.user_id = (select auth.uid())");
    expect(code).toContain("from public.live_session_orders l");
    expect(code).not.toMatch(/public\.orders\b/);
  });
  it("validates platform and range; best = code else price, top 10", () => {
    expect(code).toContain("raise exception 'bad_platform'");
    expect(code).toContain("p_to - p_from > 31");
    expect(code).toMatch(/case when code is not null then 'code' else 'price' end/);
    expect(code).toContain("limit 10");
  });
  it("authenticated only; rollback is a plain drop", () => {
    expect(code).toContain("grant  execute on function public.sales_by_platform(date, date, text) to authenticated");
    expect(code).toContain("revoke execute on function public.sales_by_platform(date, date, text) from public, anon");
    const rb = readFileSync(resolve(__dirname, "../../../../sql", "89_sales_by_platform_rollback.sql"), "utf8");
    expect(rb).toContain("drop function public.sales_by_platform(date, date, text);");
    expect(rb).not.toMatch(/if exists/i);
  });
});
