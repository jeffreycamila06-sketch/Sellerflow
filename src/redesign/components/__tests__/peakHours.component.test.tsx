// Orders-by-hour graph (Today) + drill-down — behavioral tests: (1) tapping a
// bar with orders calls peak_hour_orders with TODAY's weekday + the tapped hour
// + a device tz; (2) an empty hour's bar is disabled (not tappable); (3) the
// drill renders the handle (anti-fraud); (4) empty occurrence → friendly empty.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import OrdersByHour from "../OrdersByHour";
import PeakHourDrill from "../PeakHourDrill";
import { TProvider } from "../../i18n";
import type { UsePeakHourOrders } from "../../adapters/peakHours";

const wrap = (ui: React.ReactNode) => render(<TProvider lang="en">{ui}</TProvider>);

// A by-hour array with orders at 9 PM (hour 21) = 3 and 10 AM (hour 10) = 1.
const byHour = new Array(24).fill(0); byHour[21] = 3; byHour[10] = 1;

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { dow: 3, hour: 21, date: "2026-08-05", rows: [] }, error: null }); });

describe("bar tap → drill RPC with today's weekday + tapped hour", () => {
  it("tapping the 9 PM bar calls peak_hour_orders with p_hour:21, today's p_dow, and a tz", async () => {
    wrap(<OrdersByHour cur="NT$" enabled byHour={byHour} />);
    fireEvent.click(screen.getByLabelText(/9 PM · 3/));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("peak_hour_orders");
    expect((args as { p_hour: number }).p_hour).toBe(21);
    expect((args as { p_dow: number }).p_dow).toBe(new Date().getDay());  // TODAY's weekday
    expect(typeof (args as { p_tz: string }).p_tz).toBe("string");
    expect((args as { p_tz: string }).p_tz.length).toBeGreaterThan(0);
  });

  it("TEETH — a DIFFERENT bar (10 AM) sends p_hour:10", async () => {
    wrap(<OrdersByHour cur="NT$" enabled byHour={byHour} />);
    fireEvent.click(screen.getByLabelText(/10 AM · 1/));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect((rpc.mock.calls[0][1] as { p_hour: number }).p_hour).toBe(10);
  });

  it("an EMPTY hour's bar is disabled → tapping does nothing (no RPC)", () => {
    wrap(<OrdersByHour cur="NT$" enabled byHour={byHour} />);
    const emptyBar = screen.getByLabelText(/^12 AM · 0$/);   // hour 0, count 0
    expect((emptyBar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(emptyBar);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("no orders today at all → friendly empty state, no crash, no bars", () => {
    wrap(<OrdersByHour cur="NT$" enabled byHour={new Array(24).fill(0)} />);
    expect(screen.getByText(/No orders yet today/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("drill-down render states (reused modal)", () => {
  const base = { dow: 3, hour: 21, date: "2026-08-05" };
  const drillWith = (over: Partial<UsePeakHourOrders>): UsePeakHourOrders => ({
    data: null, state: "idle", open: true, openCell: vi.fn(), close: vi.fn(), ...over,
  });

  it("shows the buyer handle (anti-fraud) + buyer number + item", () => {
    const drill = drillWith({ state: "live", data: { ...base, rows: [
      { buyerNumber: 12, name: "Maria", handle: "@maria_shops", platform: "TikTok", product: "Lipstick", price: 250, createdAt: "2026-08-05T13:05:00Z" },
    ] } });
    wrap(<PeakHourDrill cur="NT$" drill={drill} />);
    expect(screen.getByText("@maria_shops")).toBeTruthy();
    expect(screen.getByText("#12")).toBeTruthy();
    expect(screen.getByText(/Lipstick/)).toBeTruthy();
  });

  it("empty occurrence → friendly empty state, no crash", () => {
    const drill = drillWith({ state: "empty", data: { ...base, date: null, rows: [] } });
    wrap(<PeakHourDrill cur="NT$" drill={drill} />);
    expect(screen.getByText(/No orders in this hour in the last 7 days/)).toBeTruthy();
  });

  it("closed drill renders nothing", () => {
    const drill = drillWith({ open: false });
    const { container } = wrap(<PeakHourDrill cur="NT$" drill={drill} />);
    expect(container.querySelector('[data-testid="peak-drill"]')).toBeNull();
  });

  it("is FULL-SCREEN — fixed, inset 0, and stamps data-redesign so tokens resolve", () => {
    const drill = drillWith({ state: "live", data: { ...base, rows: [] } });
    wrap(<PeakHourDrill cur="NT$" drill={drill} />);
    const root = document.querySelector('[data-testid="peak-drill"]') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.position).toBe("fixed");
    expect(root.style.inset).toBe("0px");
    expect(root.hasAttribute("data-redesign")).toBe(true);   // tokens resolve inside the portal
  });
});
