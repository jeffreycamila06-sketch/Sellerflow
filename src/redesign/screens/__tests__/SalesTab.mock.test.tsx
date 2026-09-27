// Smoke test for the Sales-tab MOCKUP (static data, no adapters). Confirms the
// screen renders its pieces and the tap-throughs work, so the Vercel preview is
// meaningful. Pure UI — no DB, no queries.
import { describe, it, expect } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import SalesTab from "../SalesTab";

const view = () => render(<TProvider><SalesTab cur="NT$" /></TProvider>);

describe("Sales tab mockup", () => {
  it("renders 4 summary tiles, the trend chart, period pills and the top-buyers list", () => {
    const { getByTestId } = view();
    expect(within(getByTestId("sales-summary")).getAllByText(/NT\$|^\d+$/).length).toBeGreaterThanOrEqual(4);
    expect(getByTestId("sales-trend").children.length).toBeGreaterThan(3);      // CSS bars
    for (const r of ["today", "session", "7days", "custom"]) expect(getByTestId(`sales-range-${r}`)).toBeTruthy();
    expect(getByTestId("sales-buyer-0")).toBeTruthy();
  });

  it("switching the period pill changes the summary numbers (static-but-reactive)", () => {
    const { getByTestId } = view();
    const before = getByTestId("sales-summary").textContent;
    fireEvent.click(getByTestId("sales-range-7days"));
    expect(getByTestId("sales-summary").textContent).not.toBe(before);
  });

  it("buyer search filters the list", () => {
    const { getByTestId, queryByTestId } = view();
    fireEvent.change(getByTestId("sales-search"), { target: { value: "zzzznomatch" } });
    expect(queryByTestId("sales-buyer-0")).toBeNull();
  });

  it("tapping a buyer opens their order-history detail with a back button", () => {
    const { getByTestId, queryByTestId } = view();
    fireEvent.click(getByTestId("sales-buyer-0"));
    expect(getByTestId("sales-buyer-detail")).toBeTruthy();
    fireEvent.click(getByTestId("sales-buyer-back"));
    expect(queryByTestId("sales-buyer-detail")).toBeNull();
  });

  it("Export ▾ opens Excel / PDF and shows a mock note (no real export)", () => {
    const { getByTestId } = view();
    fireEvent.click(getByTestId("sales-export"));
    fireEvent.click(getByTestId("sales-export-xlsx"));
    expect(getByTestId("sales-export-note").textContent).toMatch(/mock/i);
  });
});
