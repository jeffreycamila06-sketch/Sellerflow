// Pickup Status — the buyer's NAME from Customer Details next to the @handle.
// Matched → name on top, @handle under it. Unmatched / lookup failed → the row renders
// byte-identical to the @handle-only version. Chase / Copy still use buyerUsername.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelTrackingRow } from "../../adapters/parcelTracking";

const M = vi.hoisted(() => ({ narrow: false }));
const { loadParcelTracking, loadBuyerNamesByHandle } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(async () => ({ ok: true, rows: [] as unknown[] })),
  loadBuyerNamesByHandle: vi.fn(async (_h: string[]) => new Map<string, string>()),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadMoreLive: vi.fn(async () => ({ ok: true, rows: [] })), loadBuyerNamesByHandle };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../components/inviteShare", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => M.narrow }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  taipeiDayId: () => "2026-09-24",
}));

import ParcelTracking from "../ParcelTracking";

let n = 0;
const mk = (over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `F0000${n}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: null,
  storeId: "Store A", recStore: null, status: "at_store", statusMessage: null, pickupDeadline: "2026-09-28",
  arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, ...over,
});
const ROWS = [
  mk({ buyerUsername: "@Maria_Shop" }), // matched (case + @ differ from the customer notes)
  mk({ buyerUsername: "unmatched_buyer" }),
  mk({ buyerUsername: null }),           // no username
];
const view = () => render(<TProvider lang="en"><ParcelTracking /></TProvider>);
const buyerCell = (r: ReturnType<typeof view>, i: number) => r.getAllByTestId("pt-row")[i].querySelector("td")!;
const mobileBuyer = (r: ReturnType<typeof view>, i: number) => r.getAllByTestId("pt-row")[i].firstElementChild!.firstElementChild!;

beforeEach(() => {
  M.narrow = false;
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS });
  loadBuyerNamesByHandle.mockReset(); loadBuyerNamesByHandle.mockResolvedValue(new Map([["maria_shop", "Maria Santos"]]));
});

// the reference: today's rendering = the same screen with NO names at all
async function baseline(narrow: boolean) {
  M.narrow = narrow;
  loadBuyerNamesByHandle.mockResolvedValueOnce(new Map());
  const r = view();
  await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(3));
  await waitFor(() => expect(loadBuyerNamesByHandle).toHaveBeenCalled());
  const html = [0, 1, 2].map((i) => (narrow ? mobileBuyer(r, i) : buyerCell(r, i)).outerHTML);
  r.unmount(); loadBuyerNamesByHandle.mockClear();
  return html;
}

describe("Buyer cell — name from Customer Details", () => {
  it("asks for the page's handles, normalized (no blanks)", async () => {
    view();
    await waitFor(() => expect(loadBuyerNamesByHandle).toHaveBeenCalled());
    expect(loadBuyerNamesByHandle.mock.calls[0][0].sort()).toEqual(["maria_shop", "unmatched_buyer"]);
  });

  for (const narrow of [false, true]) {
    it(`${narrow ? "MOBILE" : "WEB"}: matched → name (13/700) on top + @handle (11.5/600 muted) under it; unmatched + no-username rows byte-identical to today`, async () => {
      const before = await baseline(narrow);
      M.narrow = narrow;
      const r = view();
      await waitFor(() => expect(r.getByTestId("pt-buyer-name").textContent).toBe("Maria Santos"));
      const cell = narrow ? mobileBuyer(r, 0) : buyerCell(r, 0);
      const name = r.getByTestId("pt-buyer-name") as HTMLElement;
      expect(name.style.fontSize).toBe("13px");
      expect(name.style.fontWeight).toBe("700");
      const handle = name.nextElementSibling as HTMLElement;
      expect(handle.textContent).toBe("@Maria_Shop");
      expect(handle.style.fontSize).toBe("11.5px");
      expect(handle.style.fontWeight).toBe("600");
      expect(handle.style.color).toBe("var(--text-muted)");
      expect(cell.outerHTML).not.toBe(before[0]);
      expect((narrow ? mobileBuyer(r, 1) : buyerCell(r, 1)).outerHTML).toBe(before[1]); // unmatched — unchanged
      expect((narrow ? mobileBuyer(r, 2) : buyerCell(r, 2)).outerHTML).toBe(before[2]); // no username — unchanged
    });
  }

  it("lookup fails (empty Map OR a rejected promise) → every row renders exactly as today", async () => {
    const before = await baseline(false);
    loadBuyerNamesByHandle.mockRejectedValueOnce(new Error("db down"));
    const r = view();
    await waitFor(() => expect(loadBuyerNamesByHandle).toHaveBeenCalled());
    await new Promise((res) => setTimeout(res, 0));
    expect(r.queryByTestId("pt-buyer-name")).toBeNull();
    expect([0, 1, 2].map((i) => buyerCell(r, i).outerHTML)).toEqual(before);
  });

  it("rows render FIRST — names never block them", async () => {
    loadBuyerNamesByHandle.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(3));
    expect(r.queryByTestId("pt-buyer-name")).toBeNull();
  });

  it("Chase still targets buyerUsername (the handle), never the name", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-buyer-name")).toBeTruthy());
    const link = r.getAllByTestId("pt-open-profile")[0] as HTMLAnchorElement;
    expect(link.href).toBe("https://www.tiktok.com/@Maria_Shop");
    expect(link.href).not.toContain("Maria%20Santos");
  });

  it("Refresh re-reads the names", async () => {
    const r = view();
    await waitFor(() => expect(loadBuyerNamesByHandle).toHaveBeenCalledTimes(1));
    r.getByTestId("pt-refresh").click();
    await waitFor(() => expect(loadBuyerNamesByHandle).toHaveBeenCalledTimes(2));
  });
});
