// Pickup Status search — display/filter only over the rows already loaded (no new fetch).
// Matches buyer name, @username (with/without @), 7-11 store, parcel no. (spaces/dashes
// ignored); works inside the selected tab / card; empty line; ✕ clears.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelTrackingRow } from "../../adapters/parcelTracking";

const M = vi.hoisted(() => ({ narrow: false }));
const { loadParcelTracking, loadBuyerNamesByHandle } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(),
  loadBuyerNamesByHandle: vi.fn(async () => new Map([["maria_shop", "Maria Santos"]])),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadBuyerNamesByHandle, loadMoreLive: vi.fn(async () => ({ ok: true, rows: [] })),
    loadTrackingStatus: vi.fn(async () => null), requestAutoCheck: vi.fn(async () => "skipped") };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../components/inviteShare", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => M.narrow }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({ ...(await importOriginal<object>()), taipeiDayId: () => "2026-09-24" }));

import ParcelTracking from "../ParcelTracking";

let n = 0;
const mk = (over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `s${++n}`, trackingNo: `F0000${n}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: null,
  storeId: "Store A", recStore: null, status: "at_store", statusMessage: null, pickupDeadline: "2026-09-28",
  arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, ...over,
});
const ROWS = [
  mk({ buyerUsername: "maria_shop", trackingNo: "F12345678", recStore: "7-11 Songshan" }),
  mk({ buyerUsername: "@juan.dc", trackingNo: "F99887766", recStore: "7-11 Daan" }),
  mk({ buyerUsername: "lina", trackingNo: "F55555555", recStore: "7-11 Banqiao" }),
  mk({ status: "in_transit", buyerUsername: "maria_two", trackingNo: "F44444444", recStore: "7-11 Songshan" }),
];
const view = () => render(<TProvider lang="en"><ParcelTracking /></TProvider>);
const rowsText = (r: ReturnType<typeof view>) => r.queryAllByTestId("pt-row").map((x) => x.textContent || "");
async function type(r: ReturnType<typeof view>, v: string) {
  fireEvent.change(await r.findByTestId("pt-search"), { target: { value: v } });
}
beforeEach(() => {
  M.narrow = false;
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS });
});

describe("Pickup Status search", () => {
  it("placeholder in seller words; starts with the full tab list", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(3)); // Waiting tab
    expect((r.getByTestId("pt-search") as HTMLInputElement).placeholder).toBe("Search name, @username, store or parcel no.");
  });
  it("matches the buyer display name (case-insensitive, partial)", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(3));
    await waitFor(() => expect(r.getAllByTestId("pt-buyer-name")[0]?.textContent).toBe("Maria Santos"));
    await type(r, "SANTOS");
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    expect(rowsText(r)[0]).toContain("Maria Santos");
  });
  it("matches @username with or without the @", async () => {
    const r = view();
    await type(r, "@juan");
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    expect(rowsText(r)[0]).toContain("@juan.dc");
    await type(r, "");
    await waitFor(() => expect(rowsText(r)).toHaveLength(3));
    await type(r, "juan.D");
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    expect(rowsText(r)[0]).toContain("@juan.dc");
  });
  it("matches the 7-11 store name", async () => {
    const r = view();
    await type(r, "banqiao");
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    expect(rowsText(r)[0]).toContain("@lina");
  });
  it("matches the parcel number ignoring spaces and dashes", async () => {
    const r = view();
    await type(r, "f99 887-766");
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    expect(rowsText(r)[0]).toContain("@juan.dc");
    await type(r, "5555-55");
    await waitFor(() => expect(rowsText(r)[0]).toContain("@lina"));
    expect(rowsText(r)).toHaveLength(1);
  });
  it("searches only inside the selected card (mobile) — counts stay the same", async () => {
    M.narrow = true;
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(3));
    const transitCount = r.getByTestId("pt-card-transit").textContent;
    await type(r, "songshan");
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    expect(rowsText(r)[0]).toContain("@maria_shop");            // waiting card: not the in-transit one
    fireEvent.click(r.getByTestId("pt-card-transit"));
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    expect(rowsText(r)[0]).toContain("@maria_two");
    expect(r.getByTestId("pt-card-transit").textContent).toBe(transitCount); // counts unchanged
    expect((r.getByTestId("pt-search") as HTMLInputElement).value).toBe("songshan"); // text kept
  });
  it("no match → one short line 'No parcel found'", async () => {
    const r = view();
    await type(r, "zzz-nothing");
    await waitFor(() => expect(r.getByTestId("pt-search-empty").textContent).toBe("No parcel found"));
    expect(r.queryAllByTestId("pt-row")).toHaveLength(0);
    expect(r.queryByTestId("pt-tab-empty")).toBeNull();
  });
  it("✕ clears the text and restores the full list", async () => {
    const r = view();
    await type(r, "banqiao");
    await waitFor(() => expect(rowsText(r)).toHaveLength(1));
    fireEvent.click(r.getByTestId("pt-search-clear"));
    expect((r.getByTestId("pt-search") as HTMLInputElement).value).toBe("");
    expect(r.getAllByTestId("pt-row")).toHaveLength(3);
    expect(r.queryByTestId("pt-search-clear")).toBeNull();
  });
  it("debounced (~150 ms) and never fetches again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const r = view();
      await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(3));
      fireEvent.change(r.getByTestId("pt-search"), { target: { value: "banqiao" } });
      expect(r.getAllByTestId("pt-row")).toHaveLength(3);        // not yet
      await vi.advanceTimersByTimeAsync(160);
      await waitFor(() => expect(rowsText(r)).toHaveLength(1));
      expect(loadParcelTracking).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("Tagalog strings", async () => {
    const r = render(<TProvider lang="fil"><ParcelTracking /></TProvider>);
    expect((await r.findByTestId("pt-search") as HTMLInputElement).placeholder).toBe("Hanapin ang pangalan, @username, store o parcel no.");
    fireEvent.change(r.getByTestId("pt-search"), { target: { value: "zzz" } });
    await waitFor(() => expect(r.getByTestId("pt-search-empty").textContent).toBe("Walang nakitang parcel"));
  });
});
