// Peak Hours — behavioral tests: (1) tapping a heatmap cell calls the drill RPC
// with the CORRECT dow/hour + a device tz; (2) the drill renders the handle
// (anti-fraud focus); (3) an empty occurrence shows the friendly empty state
// (no crash). Supabase is mocked so we assert the exact rpc args.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import PeakHours from "../PeakHours";
import PeakHourDrill from "../PeakHourDrill";
import { TProvider } from "../../i18n";
import type { UsePeakHours, UsePeakHourOrders, PeakHoursData } from "../../adapters/peakHours";

const wrap = (ui: React.ReactNode) => render(<TProvider lang="en">{ui}</TProvider>);

// A live grid with a single hot cell at dow=3 (Wednesday), hour=21 (9 PM).
const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
grid[3][21] = 8;
const peakData: PeakHoursData = { tz: "Asia/Taipei", total: 8, cells: [{ dow: 3, hour: 21, c: 8 }], grid, max: 8 };
const livePeak: UsePeakHours = { data: peakData, state: "live", load: vi.fn(), reload: vi.fn() };

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { dow: 3, hour: 21, date: "2026-08-05", rows: [] }, error: null }); });

describe("cell tap → drill RPC with correct dow/hour", () => {
  it("tapping Wednesday 9 PM calls peak_hour_orders with p_dow:3, p_hour:21 and a tz", async () => {
    wrap(<PeakHours cur="NT$" enabled peak={livePeak} />);
    // The cell's aria-label contains "Wed 9 PM"; click it.
    const cell = screen.getByLabelText(/Wed 9 PM/);
    fireEvent.click(cell);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("peak_hour_orders");
    expect(args).toMatchObject({ p_dow: 3, p_hour: 21 });
    expect(typeof (args as { p_tz: string }).p_tz).toBe("string");
    expect((args as { p_tz: string }).p_tz.length).toBeGreaterThan(0);
  });

  it("TEETH — a DIFFERENT cell sends its own dow/hour (Sunday 12 AM = 0,0)", async () => {
    const g2 = Array.from({ length: 7 }, () => new Array(24).fill(0));
    g2[0][0] = 3;
    const p2: UsePeakHours = { data: { tz: "Asia/Taipei", total: 3, cells: [{ dow: 0, hour: 0, c: 3 }], grid: g2, max: 3 }, state: "live", load: vi.fn(), reload: vi.fn() };
    wrap(<PeakHours cur="NT$" enabled peak={p2} />);
    fireEvent.click(screen.getByLabelText(/Sun 12 AM/));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_dow: 0, p_hour: 0 });
  });
});

describe("drill-down render states", () => {
  const base = { dow: 3, hour: 21, date: "2026-08-05" };
  const drillWith = (over: Partial<UsePeakHourOrders>): UsePeakHourOrders => ({
    data: null, state: "idle", open: true, openCell: vi.fn(), close: vi.fn(), ...over,
  });

  it("shows the buyer handle (anti-fraud) + buyer number + item", () => {
    const drill = drillWith({ state: "live", data: { ...base, rows: [
      { buyerNumber: 12, name: "Maria", handle: "@maria_shops", platform: "TikTok", product: "Lipstick", price: 250, createdAt: "2026-08-05T13:05:00Z" },
    ] } });
    wrap(<PeakHourDrill cur="NT$" drill={drill} />);
    expect(screen.getByText("@maria_shops")).toBeTruthy();     // handle shown
    expect(screen.getByText("#12")).toBeTruthy();               // buyer number
    expect(screen.getByText(/Lipstick/)).toBeTruthy();          // item
  });

  it("empty occurrence → friendly empty state, no crash, no rows", () => {
    const drill = drillWith({ state: "empty", data: { ...base, date: null, rows: [] } });
    wrap(<PeakHourDrill cur="NT$" drill={drill} />);
    expect(screen.getByText(/No orders in this hour in the last 7 days/)).toBeTruthy();
  });

  it("closed drill renders nothing", () => {
    const drill = drillWith({ open: false });
    const { container } = wrap(<PeakHourDrill cur="NT$" drill={drill} />);
    expect(container.querySelector('[data-testid="peak-drill"]')).toBeNull();
  });
});
