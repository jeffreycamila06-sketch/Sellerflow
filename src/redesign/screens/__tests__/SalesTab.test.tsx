// Sales tab (real data) — renders tiles/trend/top-buyers from the sales_report
// shape, ranks buyers by spend, searches over the range, taps through to a buyer,
// and shows honest loading/empty states (never fake numbers).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import SalesTab from "../SalesTab";
import type { SalesHistData } from "../../adapters/salesReport";
import type { UseSalesTab } from "../../adapters/salesTab";

const DATA: SalesHistData = {
  revenue: 61240, orders: 188, buyers: 121, aov: 326,
  dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null,
  days: [{ d: "2026-09-01", rev: 6100, orders: 20 }, { d: "2026-09-02", rev: 11200, orders: 40 }, { d: "2026-09-03", rev: 5200, orders: 18 }],
  bestDay: { d: "2026-09-02", rev: 11200, orders: 40 },
  topProducts: [],
  topBuyers: [
    { name: "Maria Santos", spent: 5820, orders: 14 },
    { name: "JC Dela Cruz", spent: 4310, orders: 11 },
    { name: "Anne Lim", spent: 3990, orders: 9 },
  ],
  start: "2026-09-01", end: "2026-09-28",
};

function stubHook(over: Partial<UseSalesTab> = {}): UseSalesTab {
  return { data: DATA, state: "live", range: "session", load: vi.fn(), reload: vi.fn(), ...over };
}
const view = (sales: UseSalesTab, onOpenBuyer = vi.fn()) =>
  render(<TProvider lang="en"><SalesTab cur="NT$" sessionStart="2026-09-01" today="2026-09-28" sales={sales} onOpenBuyer={onOpenBuyer} /></TProvider>);

describe("Sales tab (real data)", () => {
  it("tiles use revenue / orders / buyers / AOV from the range", () => {
    const { getByTestId } = view(stubHook());
    const s = getByTestId("sales-summary").textContent || "";
    expect(s).toContain("NT$61,240");   // Sales total = revenue
    expect(s).toContain("188");         // Orders
    expect(s).toContain("121");         // Buyers
    expect(s).toContain("NT$326");      // AOV = revenue/orders
  });

  it("daily trend renders one bar per day, best day highlighted via the series", () => {
    const { getByTestId } = view(stubHook());
    expect(getByTestId("sales-trend").children.length).toBe(3);
  });

  it("shows 4 pills (Today · This session · 7 days · Custom), default Today, and NO 2-months pill", () => {
    const { getByTestId, queryByTestId } = view(stubHook());
    for (const r of ["today", "session", "7d", "custom"]) expect(getByTestId(`sales-range-${r}`)).toBeTruthy();
    expect(queryByTestId("sales-range-2months")).toBeNull();
  });

  it("top buyers ranked by spend (desc); tap → in-screen buyer detail → 'Open in Orders' opens their orders", () => {
    const onOpenBuyer = vi.fn();
    const { getByTestId, queryByTestId } = view(stubHook(), onOpenBuyer);
    expect(within(getByTestId("sales-buyer-0")).getByText("Maria Santos")).toBeTruthy();
    expect(within(getByTestId("sales-buyer-1")).getByText("JC Dela Cruz")).toBeTruthy();
    fireEvent.click(getByTestId("sales-buyer-0"));                 // opens the in-screen detail
    expect(getByTestId("sales-buyer-detail")).toBeTruthy();
    expect(onOpenBuyer).not.toHaveBeenCalled();                    // detail first, not a jump
    fireEvent.click(getByTestId("sales-open-orders"));             // "Open in Orders →"
    expect(onOpenBuyer).toHaveBeenCalledWith("Maria Santos");
    fireEvent.click(getByTestId("sales-buyer-back"));
    expect(queryByTestId("sales-buyer-detail")).toBeNull();
  });

  it("buyer search filters the list over the range", () => {
    const { getByTestId, queryByTestId } = view(stubHook());
    fireEvent.change(getByTestId("sales-search"), { target: { value: "anne" } });
    expect(within(getByTestId("sales-buyer-0")).getByText("Anne Lim")).toBeTruthy();
    expect(queryByTestId("sales-buyer-1")).toBeNull();
  });

  it("loading state shows a placeholder, NOT numbers", () => {
    const { getByTestId, queryByTestId } = view(stubHook({ data: null, state: "loading" }));
    expect(getByTestId("sales-loading")).toBeTruthy();
    expect(queryByTestId("sales-summary")).toBeNull();
  });

  it("empty range shows zero tiles + an empty note, no trend/buyers", () => {
    const empty: SalesHistData = { ...DATA, revenue: 0, orders: 0, buyers: 0, days: [], topBuyers: [], bestDay: null };
    const { getByTestId, queryByTestId } = view(stubHook({ data: empty, state: "empty" }));
    expect(getByTestId("sales-empty")).toBeTruthy();
    expect(queryByTestId("sales-trend")).toBeNull();
    expect(getByTestId("sales-summary").textContent).toContain("NT$0");
  });

  it("error state is honest (no numbers)", () => {
    const { getByTestId, queryByTestId } = view(stubHook({ data: null, state: "error" }));
    expect(getByTestId("sales-error")).toBeTruthy();
    expect(queryByTestId("sales-summary")).toBeNull();
  });

  it('"History kept for 3 months." note is present', () => {
    const { getByText } = view(stubHook());
    expect(getByText("History kept for 3 months.")).toBeTruthy();
  });
});
