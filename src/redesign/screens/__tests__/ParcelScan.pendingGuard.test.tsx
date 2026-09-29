// Export-time guard: tapping Export while some parcels are still "⏳ Checking…"
// (phone OR store half unresolved) asks first — "Wait" (default) / "Export anyway".
// Never a hard block; everything resolved → no dialog; "Export anyway" proceeds to
// the unchanged export confirm.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { deliverXlsm, markScansExported, loadParcelScans } = vi.hoisted(() => ({
  deliverXlsm: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  markScansExported: vi.fn(async (ids: string[]) => ({ ok: true, batchId: "batch-1", claimed: ids }) as { ok: boolean; batchId?: string; claimed: string[] }),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: [] as ParcelScanRow[] })),
}));

const row = (id: string, extra: Partial<ParcelScanRow>): ParcelScanRow => ({
  id, customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550, notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z",
  ...extra,
} as ParcelScanRow);

vi.mock("../../adapters/parcelScan", () => ({
  loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })),
  loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
  confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })),
  undoExportBatch: vi.fn(async () => ({ ok: true, result: "undone" })),
  // REAL pending semantics: unresolved phone OR store half on a not-yet-exported row.
  rowAwaitsVerdict: (r: ParcelScanRow) => r.status !== "exported" && (r.storeFullStatus == null || r.phoneCheckStatus == null),
  mergeExtensionVerdicts: (p: unknown) => p,
  MAX_PENDING_PARCELS: 40,
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans,
  checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  splitScansForExport: (rows: ParcelScanRow[]) => ({ ready: rows.filter((r) => r.status !== "exported"), attention: [] }),
  scanToXlsRow: vi.fn(() => ({})),
  markScansExported,
  unmarkScansExported: vi.fn(async () => ({ ok: true })),
  deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
}));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()),
  buildXlsmFromTemplate: vi.fn(async () => new Uint8Array()),
  deliverXlsm,
  deliverXlsmMobile: vi.fn(async () => ({ ok: true, via: "webshare" })),
  exportFilename: () => "sellerflow_711.xlsm",
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const view = (checkOn = true) => render(<TProvider lang="en"><ParcelScan cur="NT$" checkOn={checkOn} /></TProvider>);

beforeEach(() => { deliverXlsm.mockClear(); markScansExported.mockClear(); });

describe("Parcel Scan — export-time guard for parcels still being checked", () => {
  it("2 pending (one phone-null, one store-null) + 1 resolved → dialog with N=2, 'Wait' closes it, nothing exported", async () => {
    loadParcelScans.mockResolvedValue({ ok: true, rows: [
      row("r1", { phoneCheckStatus: null, storeFullStatus: "open" }),
      row("r2", { phoneCheckStatus: "ok", storeFullStatus: null }),
      row("r3", { phoneCheckStatus: "ok", storeFullStatus: "open" }),
    ] });
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    const msg = getByTestId("ps-pending-msg");
    expect(msg.textContent).toContain("2 parcel(s) are still being checked");
    expect(getByTestId("ps-confirm-cancel").textContent).toBe("Wait");
    expect(queryByTestId("ps-confirm-export")).toBeNull();          // the real export confirm is NOT open yet
    fireEvent.click(getByTestId("ps-confirm-cancel"));               // Wait
    expect(queryByTestId("ps-confirm-overlay")).toBeNull();
    expect(markScansExported).not.toHaveBeenCalled();
    expect(deliverXlsm).not.toHaveBeenCalled();
  });

  it("everything resolved → no guard dialog; the normal export confirm opens directly", async () => {
    loadParcelScans.mockResolvedValue({ ok: true, rows: [
      row("r1", { phoneCheckStatus: "ok", storeFullStatus: "open" }),
      row("r2", { phoneCheckStatus: "restricted", storeFullStatus: "full" }),
    ] });
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    expect(queryByTestId("ps-pending-msg")).toBeNull();
    expect(getByTestId("ps-confirm-export")).toBeTruthy();
  });

  it("'Export anyway' proceeds to the unchanged export confirm, which exports all ready rows (pending included)", async () => {
    loadParcelScans.mockResolvedValue({ ok: true, rows: [
      row("r1", { phoneCheckStatus: null, storeFullStatus: null }),
      row("r2", { phoneCheckStatus: "ok", storeFullStatus: "open" }),
    ] });
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    expect(getByTestId("ps-pending-msg").textContent).toContain("1 parcel(s)");
    fireEvent.click(getByTestId("ps-confirm-export-anyway"));
    expect(queryByTestId("ps-pending-msg")).toBeNull();
    fireEvent.click(getByTestId("ps-confirm-export"));               // the normal confirm, as before
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    expect(markScansExported).toHaveBeenCalledTimes(1);
    expect(markScansExported.mock.calls[0][0]).toEqual(["r1", "r2"]); // never a hard block — pending rows export too
  });

  it("checks feature OFF (all-null rows are normal there) → never asks", async () => {
    loadParcelScans.mockResolvedValue({ ok: true, rows: [row("r1", { phoneCheckStatus: null, storeFullStatus: null })] });
    const { findByTestId, getByTestId, queryByTestId } = view(false);
    fireEvent.click(await findByTestId("ps-export-btn"));
    expect(queryByTestId("ps-pending-msg")).toBeNull();
    expect(getByTestId("ps-confirm-export")).toBeTruthy();
  });
});
