// 2026-11-19 — Pickup Status with 全家 rows saved as "全家店寄店取" (70 of the 76 live 全家 rows).
// Before: the phone showed 0 in every card and listed none of them, the FamilyMart filter showed 0,
// the web listed them only under All with "—" and no Chase. Now each row is in its status tab,
// counted, with its days left and its Chase / Copy action. 7-11 rows next to them: as before.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelTrackingRow } from "../../adapters/parcelTracking";

const M = vi.hoisted(() => ({ narrow: false }));
type LoadRes = { ok: boolean; rows: unknown[]; totals?: Record<string, number>; error?: string };
const { loadParcelTracking, loadMoreLive } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(async (): Promise<LoadRes> => ({ ok: true, rows: [] })),
  loadMoreLive: vi.fn(async (): Promise<LoadRes> => ({ ok: true, rows: [] })),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadMoreLive };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../adapters/fmPickup", () => ({ uploadFmExport: vi.fn() }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => M.narrow }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({ ...(await importOriginal<object>()), taipeiDayId: () => "2026-11-19" }));

import ParcelTracking from "../ParcelTracking";

let n = 0;
const mk = (o: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `F000${n}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: null, storeId: "S", recStore: "中壢華強",
  status: "at_store", statusMessage: null, pickupDeadline: null, arrivedAt: null, shipType: "C2C", specialType: null, orderAmount: 300, terminal: false, carrier: "711", ...o,
});
const fm = (o: Partial<ParcelTrackingRow> = {}) => mk({ carrier: "fm", shipType: "全家店寄店取", trackingNo: `1635174${6000 + n}`, recStore: "樹林新柑園店", ...o });
// 3 全家 waiting · 2 全家 in transit · 2 全家 picked up · 1 全家 returned · and 2 + 1 7-11 rows
const ROWS = () => [
  mk({ buyerUsername: "seven_wait1", pickupDeadline: "2026-11-24" }),
  mk({ buyerUsername: "seven_wait2", pickupDeadline: "2026-11-22" }),
  mk({ buyerUsername: "seven_moving", status: "in_transit" }),
  fm({ buyerUsername: "fm_wait1", pickupDeadline: "2026-11-21" }),
  fm({ buyerUsername: "fm_wait2", pickupDeadline: "2026-11-25" }),
  fm({ buyerUsername: "fm_wait3", pickupDeadline: "2026-11-26" }),
  fm({ buyerUsername: "fm_moving1", status: "in_transit", statusMessage: "貨件進行配送中" }),
  fm({ buyerUsername: "fm_moving2", status: "in_transit", statusMessage: "貨件進行配送中" }),
  fm({ buyerUsername: "fm_done1", status: "picked_up", terminal: true }),
  fm({ buyerUsername: "fm_done2", status: "picked_up", terminal: true }),
  fm({ buyerUsername: "fm_back", status: "returned", terminal: true }),
];
const view = () => render(<TProvider lang="en"><ParcelTracking fm /></TProvider>);
const num = (el: HTMLElement) => Number((el.textContent ?? "").match(/\d+/)?.[0]);
// the @username exactly as the row shows it (its own element, so a label next to it is never read with it)
const buyers = (r: ReturnType<typeof view>) => r.queryAllByTestId("pt-row").map((e) => e.querySelector('span[title^="@"]')?.getAttribute("title")?.slice(1));

beforeEach(() => {
  M.narrow = false;
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS() });
  loadMoreLive.mockReset(); loadMoreLive.mockResolvedValue({ ok: true, rows: [] });
});

describe("PHONE — the four count cards and the lists", () => {
  beforeEach(() => { M.narrow = true; });
  it("each card counts the 全家店寄店取 rows of its status", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-cards")).toBeTruthy());
    expect(num(r.getByTestId("pt-card-waiting"))).toBe(5);   // 2 (7-11) + 3 (全家)
    expect(num(r.getByTestId("pt-card-transit"))).toBe(3);   // 1 + 2
    expect(num(r.getByTestId("pt-card-picked"))).toBe(2);
    expect(num(r.getByTestId("pt-card-returned"))).toBe(1);
  });
  it("Waiting lists the 全家 rows, most urgent first, each with its FamilyMart label and its days left", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBe(5));
    expect(buyers(r)).toEqual(["fm_wait1", "seven_wait2", "seven_wait1", "fm_wait2", "fm_wait3"]);
    const first = r.getAllByTestId("pt-row")[0];
    expect(within(first).getByTestId("pt-carrier").textContent).toBe("FamilyMart");
    expect(within(first).getByTestId("pt-left").textContent).toBe("2 days left");
    expect(within(first).getByTestId("pt-left").getAttribute("data-urgent")).toBe("1");
  });
  it("a waiting 全家 row has its Chase action (a plain username → Chase)", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBe(5));
    const first = r.getAllByTestId("pt-row")[0];
    const chase = within(first).getByTestId("pt-open-profile");
    expect(chase.textContent).toBe("Chase");
    expect(chase.getAttribute("href")).toBe("https://www.tiktok.com/@fm_wait1");
  });
  it("In transit, Picked up and Returned list them too", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-cards")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-card-transit"));
    await waitFor(() => expect(buyers(r).sort()).toEqual(["fm_moving1", "fm_moving2", "seven_moving"]));
    fireEvent.click(r.getByTestId("pt-card-picked"));
    await waitFor(() => expect(buyers(r).sort()).toEqual(["fm_done1", "fm_done2"]));
    fireEvent.click(r.getByTestId("pt-card-returned"));
    await waitFor(() => expect(buyers(r)).toEqual(["fm_back"]));
  });
  it("the FamilyMart filter: the cards count the 全家 rows (not 0) and the list shows them", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-store-btn")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-store-btn"));
    fireEvent.click(r.getByTestId("pt-store-opt-fm"));
    await waitFor(() => expect(num(r.getByTestId("pt-card-waiting"))).toBe(3));
    expect(num(r.getByTestId("pt-card-transit"))).toBe(2);
    expect(num(r.getByTestId("pt-card-picked"))).toBe(2);
    expect(num(r.getByTestId("pt-card-returned"))).toBe(1);
    expect(buyers(r)).toEqual(["fm_wait1", "fm_wait2", "fm_wait3"]);
  });
  it("the 7-Eleven filter is what it was: only the 7-11 rows", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-store-btn")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-store-btn"));
    fireEvent.click(r.getByTestId("pt-store-opt-711"));
    await waitFor(() => expect(num(r.getByTestId("pt-card-waiting"))).toBe(2));
    expect(num(r.getByTestId("pt-card-transit"))).toBe(1);
    expect(num(r.getByTestId("pt-card-picked"))).toBe(0);
    expect(buyers(r)).toEqual(["seven_wait2", "seven_wait1"]);
  });
});

describe("LAPTOP — the tabs and the table", () => {
  it("every status tab counts the 全家店寄店取 rows; All is the total", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tabs")).toBeTruthy());
    expect(num(r.getByTestId("pt-tab-all"))).toBe(11);
    expect(num(r.getByTestId("pt-tab-waiting"))).toBe(5);
    expect(num(r.getByTestId("pt-tab-transit"))).toBe(3);
    expect(num(r.getByTestId("pt-tab-picked"))).toBe(2);
    expect(num(r.getByTestId("pt-tab-returned"))).toBe(1);
  });
  it("the Waiting tab (opened first) lists the three 全家 rows with days left, not '—'", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBe(5));
    const fmRows = r.getAllByTestId("pt-row").filter((e) => within(e).getByTestId("pt-carrier").textContent === "FamilyMart");
    expect(fmRows.length).toBe(3);
    for (const e of fmRows) expect(within(e).getByTestId("pt-left").textContent).toMatch(/days left$/);
  });
  it("a 全家 home-delivery row (text says 宅配) stays out of the status tabs: under All only, no Chase", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [...ROWS(), fm({ buyerUsername: "fm_home", shipType: "宅配" })] });
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tabs")).toBeTruthy());
    expect(num(r.getByTestId("pt-tab-all"))).toBe(12);
    expect(num(r.getByTestId("pt-tab-waiting"))).toBe(5);
    expect(buyers(r)).not.toContain("fm_home");
    fireEvent.click(r.getByTestId("pt-tab-all"));
    await waitFor(() => expect(buyers(r)).toContain("fm_home"));
    const home = r.getAllByTestId("pt-row").find((e) => (e.textContent ?? "").includes("fm_home"))!;
    expect(within(home).queryByTestId("pt-open-profile")).toBeNull();
    expect(within(home).queryByTestId("pt-copy-username")).toBeNull();
    expect(within(home).getByTestId("pt-left").textContent).toBe("—");
  });
});
