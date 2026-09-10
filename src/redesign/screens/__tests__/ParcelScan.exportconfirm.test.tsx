// FIX 4 — Export confirmation. Tapping Export must NOT export immediately (an
// accidental tap marks rows 'exported' and drops them from the next file, with
// no undo). It opens the SAME portal confirm dialog as delete/clear-exported;
// only the dialog's Export button actually runs the export.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { deliverXlsm, markScansExported, unmarkScansExported, loadParcelScans } = vi.hoisted(() => ({
  deliverXlsm: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  markScansExported: vi.fn(async () => ({ ok: true, batchId: "batch-1" }) as { ok: boolean; batchId?: string }),
  unmarkScansExported: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: [
    { id: "r1", customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550, notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z" },
  ] as ParcelScanRow[] })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans,
  checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  // One READY row → the Export button is enabled (readyCount === 1).
  splitScansForExport: (rows: ParcelScanRow[]) => ({ ready: rows.filter((r) => r.status !== "exported"), attention: [] }),
  scanToXlsRow: vi.fn(() => ({})),
  markScansExported,
  unmarkScansExported,
  deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
}));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()),
  buildXlsmFromTemplate: vi.fn(async () => new Uint8Array()),
  deliverXlsm,
  exportFilename: () => "sellerflow_711.xlsm",
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  deliverXlsm.mockClear(); markScansExported.mockClear(); unmarkScansExported.mockClear();
  deliverXlsm.mockResolvedValue({ ok: true });
  markScansExported.mockResolvedValue({ ok: true, batchId: "batch-1" });
  unmarkScansExported.mockResolvedValue({ ok: true });
});

describe("Parcel Scan — export confirmation (FIX 4)", () => {
  it("tapping Export opens the confirm dialog and does NOT export yet", async () => {
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    expect(getByTestId("ps-confirm-overlay")).toBeTruthy();
    expect(getByTestId("ps-confirm-msg").textContent).toContain("1"); // count shown
    expect(deliverXlsm).not.toHaveBeenCalled();                        // no export until confirmed
  });

  it("confirming runs the export (deliverXlsm + markScansExported) and closes", async () => {
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    fireEvent.click(getByTestId("ps-confirm-export"));
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(markScansExported).toHaveBeenCalledTimes(1));
    expect(queryByTestId("ps-confirm-overlay")).toBeNull();            // dialog closed
  });

  it("cancelling closes the dialog and never exports", async () => {
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    fireEvent.click(getByTestId("ps-confirm-cancel"));
    expect(queryByTestId("ps-confirm-overlay")).toBeNull();
    expect(deliverXlsm).not.toHaveBeenCalled();
  });

  // FIX 5 — Undo last export.
  it("after exporting, an Undo button appears; confirming reverts the batch (unmarkScansExported) and clears", async () => {
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    fireEvent.click(getByTestId("ps-confirm-export"));
    // Undo affordance shows once the export run is stamped with a batch id.
    await findByTestId("ps-undo-btn");
    fireEvent.click(getByTestId("ps-undo-btn"));
    expect(getByTestId("ps-confirm-msg").textContent).toContain("1"); // count in the confirm
    expect(unmarkScansExported).not.toHaveBeenCalled();               // not until confirmed
    fireEvent.click(getByTestId("ps-confirm-undo"));
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledWith("batch-1"));
    await waitFor(() => expect(queryByTestId("ps-undo-btn")).toBeNull()); // undo consumed
  });

  it("no Undo button when the batch wasn't stamped (markScansExported returned no batchId)", async () => {
    markScansExported.mockResolvedValue({ ok: false });
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-btn"));
    fireEvent.click(getByTestId("ps-confirm-export"));
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalled());
    expect(queryByTestId("ps-undo-btn")).toBeNull();
  });
});
