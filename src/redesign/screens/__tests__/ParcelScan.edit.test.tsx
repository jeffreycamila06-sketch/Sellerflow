// Feature 3 — per-row EDIT: reuses the confirm form pre-filled, updates the
// existing row via an own-scoped UPDATE (no new scan, NO credit charged), and
// re-runs the E-Map check ONLY when the store code changed. Adapter mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";

const { loadRows, updateParcelScan, scanParcel, checkEmapStore, saveStoreCheck, loadParcelScans } = vi.hoisted(() => ({
  loadRows: { current: [] as ParcelScanRow[] },
  updateParcelScan: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  scanParcel: vi.fn(),
  checkEmapStore: vi.fn(async () => ({ status: "valid" as const })),
  saveStoreCheck: vi.fn(async () => ({ ok: true })),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  fileToScanBase64: vi.fn(),
  scanParcel,
  saveParcelScan: vi.fn(),
  loadParcelScans,
  checkEmapStore,
  saveStoreCheck,
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  splitScansForExport: () => ({ ready: [], attention: [] }),
  scanToXlsRow: vi.fn(),
  markScansExported: vi.fn(),
  deleteParcelScan: vi.fn(),
  deleteExportedParcels: vi.fn(),
  updateParcelScan,
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const mk = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "Wrong Name", phone: "0912345678", storeId: "982063", amount: 550,
  notes: "", status: "confirmed", storeCheckStatus: "not_found", createdAt: "2026-09-08T00:00:00Z", ...over,
});

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  updateParcelScan.mockClear(); scanParcel.mockClear(); checkEmapStore.mockClear();
  updateParcelScan.mockResolvedValue({ ok: true });
  loadRows.current = [];
});

describe("Feature 3 — per-row edit (free, own-scoped, no credit)", () => {
  it("edit pre-fills the form with the row's values", async () => {
    loadRows.current = [mk({ id: "r1", customerName: "Old", phone: "0911111111", storeId: "982063", amount: 300 })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    const form = getByTestId("ps-confirm");
    expect(form.getAttribute("data-editing")).toBe("1");                 // edit mode
    expect((getByTestId("ps-name") as HTMLInputElement).value).toBe("Old");
    expect((getByTestId("ps-phone") as HTMLInputElement).value).toBe("0911111111");
    expect((getByTestId("ps-store") as HTMLInputElement).value).toBe("982063");
    expect((getByTestId("ps-amount") as HTMLInputElement).value).toBe("300");
  });

  it("saving an edit UPDATES the row (updateParcelScan) and NEVER scans/charges a credit", async () => {
    loadRows.current = [mk({ id: "r1", customerName: "Old" })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Fixed Name" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    const [id, fields] = updateParcelScan.mock.calls[0] as [string, { name: string }];
    expect(id).toBe("r1");                                  // the SAME row, not a new insert
    expect(fields.name).toBe("Fixed Name");
    expect(scanParcel).not.toHaveBeenCalled();              // FREE — no /admin/parcel-scan, no debit
  });

  it("changing the store code re-runs the E-Map check with the NEW store", async () => {
    loadRows.current = [mk({ id: "r1", storeId: "982063", storeCheckStatus: "not_found" })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.change(getByTestId("ps-store"), { target: { value: "266402" } }); // corrected code
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(checkEmapStore).toHaveBeenCalledWith("266402"));
  });

  it("editing WITHOUT changing the store code does NOT re-run the E-Map check", async () => {
    loadRows.current = [mk({ id: "r1", storeId: "982063", customerName: "Old" })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "New Name" } }); // store untouched
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalled());
    expect(checkEmapStore).not.toHaveBeenCalled();
  });

  it("Cancel discards the edit (no update)", async () => {
    loadRows.current = [mk({ id: "r1" })];
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.click(getByTestId("ps-edit-cancel"));
    expect(queryByTestId("ps-confirm")).toBeNull();
    expect(updateParcelScan).not.toHaveBeenCalled();
  });

  it("a failed update surfaces an inline error and keeps the form open (no optimistic write)", async () => {
    loadRows.current = [mk({ id: "r1", customerName: "Old" })];
    updateParcelScan.mockResolvedValue({ ok: false, error: "rls denied" });
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "X" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(getByTestId("ps-save-err")).toBeTruthy());
    expect(getByTestId("ps-confirm").getAttribute("data-editing")).toBe("1"); // still open
  });

  it("editing an old parcel preserves its notes even though the notes field is hidden", async () => {
    loadRows.current = [mk({ id: "r1", customerName: "Old", notes: "fragile — handle care" })];
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    expect(queryByTestId("ps-notes")).toBeNull();                 // field is hidden
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Fixed" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    const [, fields] = updateParcelScan.mock.calls[0] as [string, { name: string; notes: string | null }];
    expect(fields.name).toBe("Fixed");
    expect(fields.notes).toBe("fragile — handle care");           // original notes round-tripped, not wiped
  });

  it("exported rows are not editable (no edit affordance)", async () => {
    loadRows.current = [mk({ id: "r1", status: "exported" })];
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-row");
    expect(queryByTestId("ps-row-edit")).toBeNull();
  });
});
