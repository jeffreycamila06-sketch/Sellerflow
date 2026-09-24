// Pickup Status redesign — render of both layouts over mocked rows. WEB: boxed tabs with
// counts + aligned table (Buyer · Store · Parcel · Left · action). MOBILE (app shell /
// narrow): status count cards + compact rows with NO parcel code. Chase = the existing
// open-profile / copy behaviour on Waiting rows only. Gating is asserted unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelTrackingRow } from "../../adapters/parcelTracking";

const M = vi.hoisted(() => ({ narrow: false, rows: [] as unknown[] }));
const { loadParcelTracking, copyText } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(async () => ({ ok: true, rows: [] as unknown[] })),
  copyText: vi.fn(async () => true),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../components/inviteShare", () => ({ copyText }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => M.narrow }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  taipeiDayId: () => "2026-09-24",
}));

import ParcelTracking from "../ParcelTracking";
import { PARCEL_TRACKING_EMAILS, parcelTrackingVisible } from "../../adapters/parcelTracking";

let n = 0;
const mk = (over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `F0000${n}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: null,
  storeId: "Store A", recStore: null, status: "at_store", statusMessage: null, pickupDeadline: null,
  arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, ...over,
});
const ROWS = [
  mk({ buyerUsername: "maria_shop", pickupDeadline: "2026-09-29", recStore: "7-11 Songshan" }), // waiting, 5d
  mk({ buyerUsername: "urgent_buyer", pickupDeadline: "2026-09-25" }),                          // waiting, 1d → red
  mk({ buyerUsername: null, pickupDeadline: "2026-09-28" }),                                     // waiting, no username
  mk({ buyerUsername: "陳小美", pickupDeadline: "2026-09-27" }),                                  // waiting, copy (not handle-shaped)
  mk({ status: "in_transit", buyerUsername: "moving" }),
  mk({ status: "picked_up", buyerUsername: "collected" }),
  mk({ status: "returned", buyerUsername: "bounced" }),
  mk({ status: "created", buyerUsername: "fresh" }),                                            // other → All only
];

const view = () => render(<TProvider><ParcelTracking /></TProvider>);
beforeEach(() => {
  M.narrow = false;
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS });
  copyText.mockClear();
});

describe("WEB — boxed status tabs + aligned table", () => {
  it("tabs show counts; Waiting is selected by default; table has the 5 columns", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tabs")).toBeTruthy());
    expect(r.getByTestId("pt-tab-all").textContent).toContain("8");
    expect(r.getByTestId("pt-tab-waiting").textContent).toContain("4");
    expect(r.getByTestId("pt-tab-transit").textContent).toContain("1");
    expect(r.getByTestId("pt-tab-picked").textContent).toContain("1");
    expect(r.getByTestId("pt-tab-returned").textContent).toContain("1");
    expect(r.getByTestId("pt-tab-waiting").getAttribute("aria-selected")).toBe("true");
    const table = r.getByTestId("pt-table");
    expect(table.style.tableLayout).toBe("fixed");
    expect(table.querySelectorAll("thead th")).toHaveLength(5);          // Buyer · Store · Parcel · Left · action
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);  // the action header is aria-hidden (empty)
    expect(r.queryByTestId("pt-cards")).toBeNull();
  });

  it("Waiting rows sorted by days-left (urgent first), urgent Left is red, every row has a F-code cell", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(4));
    const rows = r.getAllByTestId("pt-row");
    expect(rows[0].textContent).toContain("@urgent_buyer");          // 1 day left → first
    expect(within(rows[0]).getByTestId("pt-left").getAttribute("data-urgent")).toBe("1");
    expect(within(rows[3]).getByTestId("pt-left").getAttribute("data-urgent")).toBe("0"); // 5 days → gray
    expect(r.getAllByTestId("pt-code")).toHaveLength(4);
    // the no-username parcel stays visible in its tab
    expect(rows.some((x) => /no username/i.test(x.textContent || ""))).toBe(true);
  });

  it("Chase = the existing behaviour: handle → open the TikTok profile; non-handle → copy; no username → nothing", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(4));
    const open = r.getAllByTestId("pt-open-profile");
    expect(open.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["https://www.tiktok.com/@urgent_buyer", "https://www.tiktok.com/@maria_shop"]));
    open.forEach((a) => expect(a.textContent).toBe("Chase"));
    const copy = r.getByTestId("pt-copy-username");
    expect(copy.textContent).toBe("Chase");
    fireEvent.click(copy);
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("陳小美"));
    expect(r.getAllByTestId("pt-open-profile").length + r.getAllByTestId("pt-copy-username").length).toBe(3); // no-username row: no action
  });

  it("other tabs: In transit '—' + no action; Picked up 'Done'; Returned 'Returned'; All keeps the other bucket", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tabs")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-tab-transit"));
    expect(r.getByTestId("pt-left").textContent).toBe("—");
    expect(r.queryByTestId("pt-open-profile")).toBeNull();
    fireEvent.click(r.getByTestId("pt-tab-picked"));
    expect(r.getByTestId("pt-left").textContent).toBe("Done");
    expect(r.queryByTestId("pt-open-profile")).toBeNull();
    fireEvent.click(r.getByTestId("pt-tab-returned"));
    expect(r.getByTestId("pt-left").textContent).toBe("Returned");
    fireEvent.click(r.getByTestId("pt-tab-all"));
    expect(r.getAllByTestId("pt-row")).toHaveLength(8);
    expect(r.getAllByTestId("pt-row").some((x) => x.textContent?.includes("@fresh"))).toBe(true);
  });

  it("an empty tab shows the empty note, not a blank table", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [mk({ status: "at_store", pickupDeadline: "2026-09-29" })] });
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tabs")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-tab-returned"));
    expect(r.getByTestId("pt-tab-empty")).toBeTruthy();
    expect(r.queryByTestId("pt-table")).toBeNull();
  });

  it("tabs render in parcel-flow order with the OpenPoint wording; Waiting stays the default-open tab", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tabs")).toBeTruthy());
    const ids = Array.from(r.getByTestId("pt-tabs").querySelectorAll("[data-testid^='pt-tab-']")).map((b) => b.getAttribute("data-testid"));
    expect(ids).toEqual(["pt-tab-all", "pt-tab-transit", "pt-tab-waiting", "pt-tab-picked", "pt-tab-returned"]);
    expect(r.getByTestId("pt-tab-waiting").textContent).toContain("Buyer waiting for pickup");
    expect(r.getByTestId("pt-tab-waiting").getAttribute("aria-selected")).toBe("true"); // not first, still default
    expect(r.getByTestId("pt-tab-transit").getAttribute("aria-selected")).toBe("false");
  });

  it("header keeps Sync from 賣貨便 + Refresh", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tabs")).toBeTruthy());
    expect(r.getByTestId("pt-sync")).toBeTruthy();
    expect(r.getByTestId("pt-refresh")).toBeTruthy();
  });
});

describe("MOBILE — status count cards + compact rows (no parcel code)", () => {
  beforeEach(() => { M.narrow = true; });

  it("4 status cards with counts; Waiting selected; compact rows WITHOUT the F-code", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-cards")).toBeTruthy());
    expect(r.getByTestId("pt-card-waiting").textContent).toContain("4");
    expect(r.getByTestId("pt-card-picked").textContent).toContain("1");
    expect(r.getByTestId("pt-card-waiting").getAttribute("aria-pressed")).toBe("true");
    expect(r.getByTestId("pt-card-waiting").style.border).toContain("2px");
    expect(r.getAllByTestId("pt-row")).toHaveLength(4);
    expect(r.queryByTestId("pt-code")).toBeNull();        // no parcel code on mobile
    expect(r.queryByTestId("pt-table")).toBeNull();
    expect(r.queryByTestId("pt-tabs")).toBeNull();
  });

  it("cards follow the parcel-flow order; the Waiting card uses the SHORT label, still selected by default", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-cards")).toBeTruthy());
    const ids = Array.from(r.getByTestId("pt-cards").querySelectorAll("[data-testid^='pt-card-']")).map((b) => b.getAttribute("data-testid"));
    expect(ids).toEqual(["pt-card-transit", "pt-card-waiting", "pt-card-picked", "pt-card-returned"]);
    expect(r.getByTestId("pt-card-waiting").textContent).toContain("Waiting pickup");
    expect(r.getByTestId("pt-card-waiting").textContent).not.toContain("Buyer waiting for pickup");
    expect(r.getByTestId("pt-card-waiting").getAttribute("aria-pressed")).toBe("true");
  });

  it("tapping a card selects that status's list", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-cards")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-card-picked"));
    expect(r.getByTestId("pt-card-picked").getAttribute("aria-pressed")).toBe("true");
    const rows = r.getAllByTestId("pt-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("@collected");
    expect(within(rows[0]).getByTestId("pt-left").textContent).toBe("Done");
  });
});

describe("gating is UNCHANGED by the redesign", () => {
  it("allowlist still googletest only; admins see it; everyone else does not", () => {
    expect(PARCEL_TRACKING_EMAILS).toEqual(["googletest@gmail.com"]);
    expect(parcelTrackingVisible({ email: "googletest@gmail.com", role: "seller" })).toBe(true);
    expect(parcelTrackingVisible({ email: "owner@x.com", role: "admin" })).toBe(true);
    expect(parcelTrackingVisible({ email: "seller@x.com", role: "seller", plan: "master" })).toBe(false);
  });
});
