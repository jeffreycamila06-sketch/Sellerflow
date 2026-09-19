// Miners v2 — ledger-backed screen. Renders from a `rep` (UseMinersReport) object
// owned by RedesignApp; drives one RPC via rep.load on mount. Verifies: real
// numbers + @handle + repeat badge, the empty/loading states, and that changing
// the range/N re-loads. NEVER shows the old demo literals.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Miners from "../Miners";
import { TProvider } from "../../i18n";
import type { UseMinersReport, MinersReportData } from "../../adapters/minersReport";

const DATA = (over: Partial<MinersReportData> = {}): MinersReportData => ({
  spent: 24500, orders: 62, buyers: 33, avg: 395, tiktokPct: 70, fbPct: 30,
  top: [
    { name: "Ann Cruz", handle: "@anncruz", platform: "TikTok", spent: 12000, orders: 9, activeDays: 3, repeat: true },
    { name: "Bea Lim", handle: "", platform: "TikTok", spent: 800, orders: 1, activeDays: 1, repeat: false },
  ],
  start: "2026-09-01", end: "2026-09-19", limit: 10,
  ...over,
});

const mkRep = (over: Partial<UseMinersReport> = {}): UseMinersReport => ({
  data: DATA(), state: "live", load: vi.fn(), reload: vi.fn(), ...over,
});

const renderM = (rep: UseMinersReport, extra: Record<string, unknown> = {}) =>
  render(
    <TProvider lang="en">
      <Miners cur="NT$" rep={rep} todayId="2026-09-19" sessionStartId="2026-09-15" {...extra} />
    </TProvider>,
  );

describe("Miners v2 — ledger-backed", () => {
  it("loads one RPC on mount (default range=session, N=10)", () => {
    const load = vi.fn();
    renderM(mkRep({ load }));
    expect(load).toHaveBeenCalledTimes(1);
    // session range → [sessionStartId .. todayId], N=10
    expect(load).toHaveBeenCalledWith("2026-09-15", "2026-09-19", 10);
  });

  it("live data → real totals + top buyer @handle + repeat badge; no demo", () => {
    renderM(mkRep());
    expect(screen.getByText("33")).toBeTruthy();   // buyers
    expect(screen.getByText("62")).toBeTruthy();   // orders
    expect(screen.getByText("Ann Cruz")).toBeTruthy();
    expect(screen.getByText("@anncruz")).toBeTruthy();
    expect(screen.getAllByText(/Repeat/).length).toBeGreaterThan(0); // repeat badge on Ann
    // Bea (no handle) shows name, no blank @handle row crash
    expect(screen.getByText("Bea Lim")).toBeTruthy();
    // NONE of the old demo literals
    expect(screen.queryByText("1,284")).toBeNull();
    expect(screen.queryByText("Maria Santos")).toBeNull();
    expect(screen.queryByText(/\+12%/)).toBeNull();
  });

  it("empty state → guidance, clean zeros, no rows", () => {
    renderM(mkRep({ data: DATA({ spent: 0, orders: 0, buyers: 0, avg: 0, tiktokPct: 0, fbPct: 0, top: [] }), state: "empty" }));
    expect(screen.getByText(/connect an account and start a live session/i)).toBeTruthy();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ann Cruz")).toBeNull();
  });

  it("loading state → loading text, no rows", () => {
    renderM(mkRep({ data: null, state: "loading" }));
    expect(screen.getByText(/loading/i)).toBeTruthy();
    expect(screen.queryByText("Ann Cruz")).toBeNull();
  });

  it("error state → error text", () => {
    renderM(mkRep({ data: null, state: "error" }));
    expect(screen.getByText(/couldn't load/i)).toBeTruthy();
  });

  it("changing range → new load; changing Top-N → new load", () => {
    const load = vi.fn();
    renderM(mkRep({ load }));
    load.mockClear();
    fireEvent.click(screen.getByText("Today"));
    expect(load).toHaveBeenCalledWith("2026-09-19", "2026-09-19", 10);
    load.mockClear();
    fireEvent.click(screen.getByText("50"));
    expect(load).toHaveBeenCalledWith("2026-09-19", "2026-09-19", 50); // range stays Today
  });

  it("Refresh calls rep.reload", () => {
    const reload = vi.fn();
    renderM(mkRep({ reload }));
    fireEvent.click(screen.getByText(/Refresh/));
    expect(reload).toHaveBeenCalled();
  });
});
