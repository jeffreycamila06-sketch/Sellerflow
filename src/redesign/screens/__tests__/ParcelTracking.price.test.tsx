// Pickup Status price column (display only): formatPrice unit + a row showing "NT$350"
// in BOTH the desktop table and the mobile compact list.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
  return { ...actual, loadParcelTracking, loadMoreLive }; // formatPrice stays real
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../components/inviteShare", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => M.narrow }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  taipeiDayId: () => "2026-09-24",
}));

import ParcelTracking from "../ParcelTracking";
import { formatPrice } from "../../adapters/parcelTracking";

const mk = (over: Partial<ParcelTrackingRow>): ParcelTrackingRow => ({
  id: "r1", trackingNo: "F00001", cmOrderNo: null, buyerUsername: "maria_shop", recipientName: null,
  storeId: "高尚", recStore: null, status: "at_store", statusMessage: null, pickupDeadline: "2026-09-29",
  arrivedAt: null, shipType: "C2C", specialType: null, orderAmount: 350, terminal: false, ...over,
});

const view = () => render(<TProvider lang="en"><ParcelTracking /></TProvider>);
beforeEach(() => {
  M.narrow = false;
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: [mk({})] });
  loadMoreLive.mockReset(); loadMoreLive.mockResolvedValue({ ok: true, rows: [] });
});

describe("formatPrice", () => {
  it("number → NT$ + thousands; 0 → NT$0; null → —", () => {
    expect(formatPrice(1250)).toBe("NT$1,250");
    expect(formatPrice(350)).toBe("NT$350");
    expect(formatPrice(0)).toBe("NT$0");
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(NaN)).toBe("—");
  });
});

describe("price in the list", () => {
  it("desktop table shows NT$350", async () => {
    M.narrow = false;
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-table")).toBeTruthy());
    expect(r.getByTestId("pt-price").textContent).toContain("NT$350");
  });
  it("mobile compact list shows NT$350", async () => {
    M.narrow = true;
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-list")).toBeTruthy());
    expect(r.getByTestId("pt-price").textContent).toContain("NT$350");
  });
});
