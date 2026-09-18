// Orders Batch 1 — top-of-screen controls are ADDITIVE. Pins:
//   (a) default view (This session + All) shows the SAME rows as the passed orders,
//   (b) platform pills filter on the REAL `platform` field,
//   (c) the summary bar reflects the visible set,
//   (d) rows + Reprint still render (rendering untouched).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import Orders from "../Orders";
import type { Order } from "../../data";

const o = (over: Partial<Order>): Order => ({
  id: "#1", buyer: "Alpha", handle: "@alpha", items: "Dress", qty: 1, total: 100, status: "New",
  platform: "TikTok", time: "1:00 PM", orderNum: 1, date: "2026-09-18", ...over,
});

const ORDERS: Order[] = [
  o({ id: "#1", buyer: "Alpha", handle: "@alpha", total: 100, platform: "TikTok", orderNum: 1 }),
  o({ id: "#2", buyer: "Bravo", handle: "@bravo", total: 250, platform: "TikTok", orderNum: 2 }),
  o({ id: "#3", buyer: "Charlie", handle: "@charlie", total: 50, platform: "Facebook", orderNum: 3 }),
];

function mount(extra: Partial<React.ComponentProps<typeof Orders>> = {}) {
  const onReprint = vi.fn();
  const utils = render(
    <TProvider lang="en">
      <Orders onGoPrint={() => {}} cur="NT$" orders={ORDERS} state="live" todayId="2026-09-18"
        buyers={[]} onReprintOrder={onReprint} seller={{ name: "Jeff", email: "j@x.com" }} {...extra} />
    </TProvider>,
  );
  return { ...utils, onReprint };
}

describe("Orders Batch 1 — default view unchanged", () => {
  it("shows ALL passed rows by default (This session + All), untouched", () => {
    const { getByText } = mount();
    expect(getByText("Alpha")).toBeTruthy();
    expect(getByText("Bravo")).toBeTruthy();
    expect(getByText("Charlie")).toBeTruthy();
  });
  it("summary bar reflects the full set (3 orders · NT$400 · 3 buyers · NT$133 AOV)", () => {
    const { getByTestId } = mount();
    const s = getByTestId("orders-summary").textContent || "";
    expect(s).toContain("3");    // orders
    expect(s).toContain("400");  // total
    expect(s).toContain("133");  // AOV = 400/3 → 133
  });
  it("rows still render Reprint (rendering untouched)", () => {
    const { getAllByLabelText } = mount();
    // one Reprint control per row (aria-label = rd_dash_reprint) — rows have orderNum
    expect(getAllByLabelText(/reprint/i).length).toBe(3);
  });
});

describe("Orders Batch 1 — platform pills map to the real platform field", () => {
  it("Facebook pill → only the Facebook order; TikTok → only TikTok; All → everything", () => {
    const { getByTestId, queryByText, getByText } = mount();
    fireEvent.click(getByTestId("ord-pf-Facebook"));
    expect(getByText("Charlie")).toBeTruthy();      // FB order
    expect(queryByText("Alpha")).toBeNull();        // TikTok hidden
    expect(getByTestId("orders-summary").textContent).toContain("1");

    fireEvent.click(getByTestId("ord-pf-TikTok"));
    expect(getByText("Alpha")).toBeTruthy();
    expect(getByText("Bravo")).toBeTruthy();
    expect(queryByText("Charlie")).toBeNull();       // FB hidden

    fireEvent.click(getByTestId("ord-pf-all"));
    expect(getByText("Alpha")).toBeTruthy();
    expect(getByText("Charlie")).toBeTruthy();
  });
});

describe("Orders Batch 1 — date range (calendar-day for Today)", () => {
  it("'Today' keeps today's rows; a row dated earlier drops out", () => {
    const withOld = [...ORDERS, o({ id: "#9", buyer: "Delta", handle: "@delta", date: "2026-09-10", orderNum: 9, platform: "TikTok" })];
    const { getByTestId, getByText, queryByText } = mount({ orders: withOld });
    expect(getByText("Delta")).toBeTruthy();               // shown in "This session" (default)
    fireEvent.click(getByTestId("ord-range"));             // open range menu
    fireEvent.click(getByTestId("ord-range-today"));       // pick Today
    expect(queryByText("Delta")).toBeNull();               // 2026-09-10 ≠ today → dropped
    expect(getByText("Alpha")).toBeTruthy();               // today's rows stay
  });
});

describe("Orders Batch 1 — export menu present", () => {
  it("Export ▾ opens Excel + PDF options", () => {
    const { getByTestId } = mount();
    fireEvent.click(getByTestId("orders-export"));
    expect(getByTestId("orders-export-xlsx")).toBeTruthy();
    expect(getByTestId("orders-export-pdf")).toBeTruthy();
  });
});
