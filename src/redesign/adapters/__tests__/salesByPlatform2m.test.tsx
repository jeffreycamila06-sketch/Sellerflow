// A2 — the 2-months per-platform view (sql/96 orders.platform + sql/97 sales_by_platform_orders),
// under the existing sales_platform_enabled. Pins: no platform options = Sales tab as before;
// the 2-months pill only in the per-platform view; it loads sql/97 with 1st-of-last-month →
// today; its own "new orders only" note; leaving the platform from 2 months goes back to
// "This session"; no range ever silently becomes "session"; product best sellers; the hook
// calls the right RPC; the sql/97 contract.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: { platform: "TikTok", orders: 1, revenue: 100, buyers: 1, days: [], best: [{ kind: "product", label: "Red dress", qty: 1, orders: 1, rev: 100 }] }, error: null })));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));
import { platformRange, platformRangeFor, platformRpcFor, mapPlatformSales, usePlatformSales, type UsePlatformSales } from "../salesByPlatform";
import { TProvider } from "../../i18n";
import SalesTab from "../../screens/SalesTab";
import type { UseSalesTab } from "../salesTab";

beforeEach(() => vi.clearAllMocks());
const sales = (): UseSalesTab => ({ data: null, state: "empty", range: "today", load: vi.fn(), reload: vi.fn() } as unknown as UseSalesTab);
const pSales = (over: Partial<UsePlatformSales> = {}): UsePlatformSales => ({
  data: { platform: "TikTok", from: "2026-09-01", to: "2026-10-08", orders: 2, revenue: 300, buyers: 2, days: [{ d: "2026-10-08", orders: 2, rev: 300 }],
    best: [{ kind: "product", label: "Red dress", qty: 2, orders: 2, rev: 300 }] },
  state: "live", load: vi.fn(), ...over,
});
const tab = (extra: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><SalesTab cur="NT$" sessionStart="2026-10-06" today="2026-10-08" sales={sales()} {...extra} /></TProvider>);

describe("pure helpers", () => {
  it("2 months = 1st of last month → today (Jan wraps to Dec)", () => {
    expect(platformRange("2months", "2026-10-08", "")).toEqual({ from: "2026-09-01", to: "2026-10-08" });
    expect(platformRange("2months", "2027-01-31", "")).toEqual({ from: "2026-12-01", to: "2027-01-31" });
    expect(platformRange("2months", "bad", "")).toEqual({ from: "bad", to: "bad" });
  });
  it("only known ranges map; custom / unknown → null (never session)", () => {
    for (const r of ["today", "session", "7d", "2months"]) expect(platformRangeFor(r)).toBe(r);
    for (const r of ["custom", "month", "", "30d"]) expect(platformRangeFor(r)).toBeNull();
  });
  it("2 months reads sql/97, the rest sql/89", () => {
    expect(platformRpcFor("2months")).toBe("sales_by_platform_orders");
    expect(platformRpcFor("7d")).toBe("sales_by_platform");
  });
  it("product best sellers keep their kind", () => {
    expect(mapPlatformSales({ best: [{ kind: "product", label: "Hat", qty: 1, orders: 1, rev: 9 }] }).best[0].kind).toBe("product");
  });
  it("the hook calls the given RPC and caches per RPC", async () => {
    const { result } = renderHook(() => usePlatformSales());
    await act(async () => { result.current.load("TikTok", "2026-09-01", "2026-10-08", "sales_by_platform_orders"); });
    expect(rpc).toHaveBeenLastCalledWith("sales_by_platform_orders", { p_from: "2026-09-01", p_to: "2026-10-08", p_platform: "TikTok" });
    await act(async () => { result.current.load("TikTok", "2026-09-01", "2026-10-08"); });
    expect(rpc).toHaveBeenLastCalledWith("sales_by_platform", { p_from: "2026-09-01", p_to: "2026-10-08", p_platform: "TikTok" });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("Sales tab — 2 months per platform", () => {
  it("no platform options → no 2-months pill, identical to no props", () => {
    const a = tab().container.innerHTML;
    expect(tab({ platformOptions: [], platformSales: pSales() }).container.innerHTML).toBe(a);
    expect(a).not.toContain("sales-range-2months");
  });
  it("All view has no 2-months pill; a platform view has it", () => {
    const r = tab({ platformOptions: ["TikTok", "Facebook"], platformSales: pSales() });
    expect(r.queryByTestId("sales-range-2months")).toBeNull();
    fireEvent.click(r.getByTestId("sales-plat-TikTok"));
    expect(r.getByTestId("sales-range-2months").textContent).toBe("2 months");
  });
  it("2 months loads sql/97 with the right bounds, shows the new-orders note and product best sellers", () => {
    const ps = pSales();
    const r = tab({ platformOptions: ["TikTok", "Facebook"], platformSales: ps });
    fireEvent.click(r.getByTestId("sales-plat-TikTok"));
    fireEvent.click(r.getByTestId("sales-range-2months"));
    expect(ps.load).toHaveBeenLastCalledWith("TikTok", "2026-09-01", "2026-10-08", "sales_by_platform_orders");
    expect(r.getByTestId("sales-plat-note-2m").textContent).toBe("Per-platform counts new orders only.");
    expect(r.queryByTestId("sales-plat-note")).toBeNull();
    expect(r.getByTestId("sales-plat-best-0").textContent).toContain("Red dress");
    expect(r.getByTestId("sales-plat-best-0").textContent).not.toContain("NT$Red");
  });
  it("leaving the platform from 2 months returns to This session (the All view has no 2-months pill)", () => {
    const r = tab({ platformOptions: ["TikTok", "Facebook"], platformSales: pSales() });
    fireEvent.click(r.getByTestId("sales-plat-TikTok"));
    fireEvent.click(r.getByTestId("sales-range-2months"));
    fireEvent.click(r.getByTestId("sales-plat-all"));
    expect(r.getByTestId("sales-range-session").getAttribute("style")).toContain("var(--accent)");
  });
  it("source: the range mapping no longer falls back to session", () => {
    const src = readFileSync("src/redesign/screens/SalesTab.tsx", "utf8");
    expect(src).not.toContain('range === "7d" ? "7d" : "session"');
    expect(src).toContain("const pr = platformRangeFor(range);");
  });
});

describe("sql/96 + sql/97 contract", () => {
  const s96 = readFileSync("sql/96_orders_platform.sql", "utf8");
  const s97 = readFileSync("sql/97_sales_by_platform_orders.sql", "utf8");
  const code = s97.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("96: nullable column + check, apply-before-web note", () => {
    expect(s96).toMatch(/add column if not exists platform text;/);
    expect(s96).toMatch(/check \(platform is null or platform in \('TikTok', 'Facebook', 'Shopee', 'Instagram'\)\)/);
    expect(s96).toContain("APPLY BEFORE THE WEB DEPLOY");
  });
  it("97: invoker, own rows, orders with platform, 62-day cap, top 10, authenticated only", () => {
    expect(code).toMatch(/security invoker/);
    expect(code).toContain("o.user_id = (select auth.uid())");
    expect(code).toContain("from public.orders o");
    expect(code).toContain("o.platform = p_platform");
    expect(code).toContain("p_to - p_from > 62");
    expect(code).toContain("limit 10");
    expect(code).toContain("revoke execute on function public.sales_by_platform_orders(date, date, text) from public, anon;");
    expect(code).toContain("grant  execute on function public.sales_by_platform_orders(date, date, text) to authenticated;");
    expect(code).not.toMatch(/sales_report/);
  });
  it("no 'drop … if exists' and no backslash-u in the new SQL", () => {
    for (const f of ["96_orders_platform.sql", "96_orders_platform_rollback.sql", "97_sales_by_platform_orders.sql", "97_sales_by_platform_orders_rollback.sql"]) {
      const s = readFileSync(`sql/${f}`, "utf8");
      expect(s).not.toMatch(/drop\s+\w+\s+if\s+exists/i);
      expect(s).not.toContain("\\u");
    }
  });
});
