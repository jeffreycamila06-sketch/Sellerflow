// Customer Details as a Parcel Scan OVERLAY. The button opens <CustomerDetails/>
// on top of Parcel Scan; a successful Import there closes the overlay and
// refreshes the parent's Saved list + Batch count. The overlay Import reuses the
// REAL validators + the REAL MAX_PENDING_PARCELS cap (importOriginal) — only the
// DB/network calls are mocked — so the batch cap is genuinely enforced, no bypass.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import type { ParcelCustomer } from "../../adapters/parcelCustomers";

const { loadRows, recent, saveParcelScan, loadParcelScans, countPending } = vi.hoisted(() => ({
  loadRows: { current: [] as ParcelScanRow[] },
  recent: { current: { ok: true, rows: [] as ParcelCustomer[] } as { ok: boolean; rows: ParcelCustomer[]; error?: string } },
  saveParcelScan: vi.fn(),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
  countPending: vi.fn(async () => ({ ok: true, count: 0 }) as { ok: boolean; count: number; error?: string }),
}));

vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual, // REAL validators + MAX_PENDING_PARCELS (40) + splitScansForExport
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(),
    saveParcelScan: (...a: unknown[]) => saveParcelScan(...(a as [])),
    loadParcelScans: () => loadParcelScans(),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: vi.fn(async () => ({ ok: true })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => recent.current,
  searchParcelCustomers: async () => recent.current,
  updateParcelCustomer: vi.fn(async () => ({ ok: true })),
  deleteParcelCustomer: vi.fn(async () => ({ ok: true })),
  countPendingParcels: () => countPending(),
  countParcelCustomers: async () => ({ ok: true, count: 3 }),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(), buildXlsmFromTemplate: vi.fn(), deliverXlsm: vi.fn(), exportFilename: () => "x.xlsm",
}));

import ParcelScan from "../ParcelScan";

const mkRow = (i: number): ParcelScanRow => ({
  id: `r${i}`, customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550,
  notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z",
});
const mkCust = (over: Partial<ParcelCustomer> = {}): ParcelCustomer => ({
  id: "c1", phone: "0912345678", name: "Maria", storeId: "266402", notes: "@maria",
  createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", ...over,
});
const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);
const norm = (s: string | null) => (s || "").replace(/\s/g, "");

beforeEach(() => {
  loadRows.current = [];
  recent.current = { ok: true, rows: [mkCust()] };
  saveParcelScan.mockReset();
  // A successful save appends to the DB-backed list, so the parent's reload sees it.
  saveParcelScan.mockImplementation(async () => { loadRows.current = [...loadRows.current, mkRow(loadRows.current.length + 1)]; return { ok: true, id: `new-${loadRows.current.length}` }; });
  loadParcelScans.mockClear();
  countPending.mockClear(); countPending.mockResolvedValue({ ok: true, count: 0 });
});

// The button lives INSIDE the expanded manual-entry form header (right-aligned),
// not in the collapsed idle view — so open manual first, then the header button.
async function openOverlay(r: ReturnType<typeof view>) {
  fireEvent.click(await r.findByTestId("ps-manual"));        // expand the manual form
  fireEvent.click(await r.findByTestId("ps-open-customers")); // header-row button
  await waitFor(() => expect(r.getByTestId("ps-customers-overlay")).toBeTruthy());
}

describe("Parcel Scan — Customer Details overlay", () => {
  it("the button is only in the expanded manual form, not the collapsed view", async () => {
    const r = view();
    await r.findByTestId("ps-manual");                       // collapsed: manual link present
    expect(r.queryByTestId("ps-open-customers")).toBeNull(); // …but the Customers button is NOT
    fireEvent.click(r.getByTestId("ps-manual"));             // expand the form
    expect(await r.findByTestId("ps-open-customers")).toBeTruthy(); // now it appears (header row)
  });

  it("button opens the overlay; X closes it (no import)", async () => {
    const r = view();
    await openOverlay(r);
    expect(r.getByTestId("cd-search")).toBeTruthy();          // the phonebook renders inside
    fireEvent.click(r.getByTestId("ps-customers-close"));
    await waitFor(() => expect(r.queryByTestId("ps-customers-overlay")).toBeNull());
    expect(saveParcelScan).not.toHaveBeenCalled();
  });

  it("backdrop click also closes without importing", async () => {
    const r = view();
    await openOverlay(r);
    fireEvent.click(r.getByTestId("ps-customers-overlay")); // outside the panel
    await waitFor(() => expect(r.queryByTestId("ps-customers-overlay")).toBeNull());
    expect(saveParcelScan).not.toHaveBeenCalled();
  });

  it("import from the overlay → overlay closes, Saved list refreshes, Batch count climbs", async () => {
    loadRows.current = [mkRow(1), mkRow(2)];                  // start: 2 pending
    const r = view();
    await waitFor(() => expect(norm(r.getByTestId("ps-batch-n").textContent)).toBe("2/40"));
    await openOverlay(r);
    fireEvent.click(await r.findByTestId("cd-row-main"));            // expand the customer
    await waitFor(() => expect(r.getByTestId("cd-price")).toBeTruthy());
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    // real validators pass, cap ok → saveParcelScan called with the buyer's fields
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0][0]).toEqual({ name: "Maria", phone: "0912345678", store_id: "266402", amount: 100, notes: "@maria" });
    // overlay auto-closes
    await waitFor(() => expect(r.queryByTestId("ps-customers-overlay")).toBeNull());
    // parent Saved list re-read + Batch pill climbs 2 → 3
    await waitFor(() => expect(norm(r.getByTestId("ps-batch-n").textContent)).toBe("3/40"));
    expect(loadParcelScans.mock.calls.length).toBeGreaterThanOrEqual(2); // mount + reload
  });

  it("batch cap is enforced INSIDE the overlay (count=40 → blocked, no save, overlay stays)", async () => {
    countPending.mockResolvedValue({ ok: true, count: 40 });  // at MAX_PENDING_PARCELS
    const r = view();
    await openOverlay(r);
    fireEvent.click(await r.findByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-price")).toBeTruthy());
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toContain("Batch full"));
    expect(saveParcelScan).not.toHaveBeenCalled();
    expect(r.getByTestId("ps-customers-overlay")).toBeTruthy(); // stays open
  });

  it("below-minimum price is rejected in the overlay too (no bypass, no save)", async () => {
    const r = view();
    await openOverlay(r);
    fireEvent.click(await r.findByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-price")).toBeTruthy());
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "10" } }); // below MIN 20
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toContain("20"));
    expect(saveParcelScan).not.toHaveBeenCalled();
  });
});
