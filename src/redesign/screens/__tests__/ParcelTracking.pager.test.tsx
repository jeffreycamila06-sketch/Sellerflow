// Pickup Status: store filter (全家 on only) + pages of 50 over what is shown. Presentation
// only — same loaded rows, same grouping; the 500-row load + load-more are unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelTrackingRow } from "../../adapters/parcelTracking";

const { loadParcelTracking, copyText } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(async () => ({ ok: true, rows: [] as unknown[] })),
  copyText: vi.fn(async (_t: string) => true),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadMoreLive: vi.fn(async () => ({ ok: true, rows: [] })), loadBuyerNamesByHandle: vi.fn(async () => new Map()) };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../components/inviteShare", () => ({ copyText: (t: string) => copyText(t) }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => false }));
vi.mock("../../adapters/platform", () => ({ isIOS: () => false, isAndroid: () => false }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({ ...(await importOriginal<object>()), taipeiDayId: () => "2026-11-03" }));

import ParcelTracking from "../ParcelTracking";

let n = 0;
const mk = (over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => {
  n += 1;
  return {
    id: `r${n}`, trackingNo: `F${String(n).padStart(6, "0")}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: "J*f*r*y",
    storeId: "266402", recStore: "松山門市", status: "at_store", statusMessage: null, pickupDeadline: "2026-11-05",
    arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, orderAmount: 380, ...over,
  };
};
const rowsOf = (k: number, over: Partial<ParcelTrackingRow> = {}) => Array.from({ length: k }, () => mk(over));
const open = async (rows: ParcelTrackingRow[], fm = true) => {
  loadParcelTracking.mockResolvedValue({ ok: true, rows });
  const r = render(<TProvider lang="en"><ParcelTracking fm={fm} /></TProvider>);
  await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBeGreaterThan(0));
  return r;
};

beforeEach(() => { n = 0; loadParcelTracking.mockClear(); copyText.mockClear(); });

describe("pages of 50", () => {
  it("120 rows → 3 pages; page 3 shows 20; ‹ off on page 1, › off on the last", async () => {
    const r = await open(rowsOf(120));
    expect(r.getAllByTestId("pt-row")).toHaveLength(50);
    expect(r.getByTestId("pt-page-of").textContent).toBe("Page 1 of 3");
    expect(r.getByTestId("pt-page-range-top").textContent).toBe("1–50 of 120");
    expect(r.getByTestId("pt-page-range").textContent).toBe("1–50 of 120");
    expect((r.getByTestId("pt-page-prev") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("pt-page-3"));
    expect(r.getAllByTestId("pt-row")).toHaveLength(20);
    expect(r.getByTestId("pt-page-of").textContent).toBe("Page 3 of 3");
    expect(r.getByTestId("pt-page-range").textContent).toBe("101–120 of 120");
    expect((r.getByTestId("pt-page-next") as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByTestId("pt-page-3").getAttribute("aria-current")).toBe("page");
    fireEvent.click(r.getByTestId("pt-page-prev"));
    expect(r.getByTestId("pt-page-of").textContent).toBe("Page 2 of 3");
  });
  it("a page change scrolls so the list top lands just below the sticky header", async () => {
    const r = await open(rowsOf(120));
    const scrollTo = vi.fn();
    const old = window.scrollTo;
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 900 });
    const rect = (top: number, bottom: number) => (() => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} })) as () => DOMRect;
    r.getByTestId("pt-header").getBoundingClientRect = rect(0, 112);                          // iPhone header bottom
    (r.getByTestId("pt-page-top").previousElementSibling as HTMLElement).getBoundingClientRect = rect(-300, -300); // the list top marker
    try {
      fireEvent.click(r.getByTestId("pt-page-2"));
      expect(scrollTo).toHaveBeenCalledWith({ top: 900 + -300 - 112 - 8, behavior: "smooth" });
    } finally {
      window.scrollTo = old;
    }
  });
  it("50 rows → no page bar and no top line (as today)", async () => {
    const r = await open(rowsOf(50));
    expect(r.getAllByTestId("pt-row")).toHaveLength(50);
    expect(r.queryByTestId("pt-pager")).toBeNull();
    expect(r.queryByTestId("pt-page-top")).toBeNull();
  });
  it("typing in search → back to page 1", async () => {
    const r = await open(rowsOf(120));
    fireEvent.click(r.getByTestId("pt-page-3"));
    expect(r.getByTestId("pt-page-of").textContent).toBe("Page 3 of 3");
    fireEvent.change(r.getByTestId("pt-search"), { target: { value: "松山" } }); // matches every row
    await waitFor(() => expect(r.getByTestId("pt-page-of").textContent).toBe("Page 1 of 3"));
    expect(r.getAllByTestId("pt-row")).toHaveLength(50);
  });
  it("Copy on a page-2 row copies that row", async () => {
    // no username → the row's Copy copies its own tracking number (shown in the Parcel column)
    const r = await open(rowsOf(120, { buyerUsername: null }));
    fireEvent.click(r.getByTestId("pt-page-2"));
    const first = r.getAllByTestId("pt-row")[0];
    const code = within(first).getByTestId("pt-code").textContent!;
    fireEvent.click(within(first).getByTestId("pt-copy-code"));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    expect(copyText).toHaveBeenCalledWith(code);
    // …and that row is not on page 1
    fireEvent.click(r.getByTestId("pt-page-1"));
    expect(r.getAllByTestId("pt-code").map((e) => e.textContent)).not.toContain(code);
  });
});

describe("store filter", () => {
  it("only with 全家 on: no fm → no filter button", async () => {
    const r = await open(rowsOf(3), false);
    expect(r.queryByTestId("pt-store-btn")).toBeNull();
    expect(r.queryByTestId("pt-search-row")).toBeNull();
  });
  it("FamilyMart → only fm rows, tab counts follow, back to page 1; counts in the menu; closes on pick / Esc / outside", async () => {
    const r = await open([...rowsOf(60, { carrier: "711" }), ...rowsOf(70, { carrier: "fm" })]);
    expect(r.getByTestId("pt-store-btn").textContent).toBe("All ▾");
    expect(r.getByTestId("pt-tab-waiting").textContent).toContain("130");
    fireEvent.click(r.getByTestId("pt-page-3"));
    expect(r.getByTestId("pt-page-of").textContent).toBe("Page 3 of 3");

    fireEvent.click(r.getByTestId("pt-store-btn"));
    expect(r.getByTestId("pt-store-opt-all").textContent).toContain("130");
    expect(r.getByTestId("pt-store-opt-711").textContent).toContain("60");
    expect(r.getByTestId("pt-store-opt-fm").textContent).toContain("70");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(r.queryByTestId("pt-store-menu")).toBeNull();
    fireEvent.click(r.getByTestId("pt-store-btn"));
    fireEvent.pointerDown(document.body);
    expect(r.queryByTestId("pt-store-menu")).toBeNull();

    fireEvent.click(r.getByTestId("pt-store-btn"));
    fireEvent.click(r.getByTestId("pt-store-opt-fm"));
    expect(r.queryByTestId("pt-store-menu")).toBeNull();
    expect(r.getByTestId("pt-store-btn").textContent).toBe("FamilyMart ▾");
    expect(r.getByTestId("pt-store-btn").style.background).toBe("var(--accent)");
    expect(r.getByTestId("pt-page-of").textContent).toBe("Page 1 of 2");
    expect(r.getByTestId("pt-tab-waiting").textContent).toContain("70");
    const carriers = r.getAllByTestId("pt-carrier").map((e) => e.textContent);
    expect(carriers.length).toBe(50);
    expect(new Set(carriers)).toEqual(new Set(["FamilyMart"]));
  });
});
