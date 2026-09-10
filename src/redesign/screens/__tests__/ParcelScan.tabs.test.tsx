// Change 2 (All/Wrong-code tabs) + Change 3 (per-row + clear-exported delete,
// both confirmed) at the screen level. The adapter is fully mocked; the loaded
// rows are set per test. No browser — Testing Library + the real i18n provider.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";

const { loadRows, deleteParcelScan, deleteExportedParcels, loadParcelScans } = vi.hoisted(() => ({
  loadRows: { current: [] as ParcelScanRow[] },
  deleteParcelScan: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  deleteExportedParcels: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  fileToScanBase64: vi.fn(),
  scanParcel: vi.fn(),
  saveParcelScan: vi.fn(),
  loadParcelScans,
  checkEmapStore: vi.fn(async () => ({ status: "unknown" as const })),
  saveStoreCheck: vi.fn(async () => ({ ok: true })),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  splitScansForExport: () => ({ ready: [], attention: [] }),
  scanToXlsRow: vi.fn(),
  markScansExported: vi.fn(),
  deleteParcelScan,
  deleteExportedParcels,
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const mk = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r", customerName: "A", phone: "0912345678", storeId: "982063", amount: 550,
  notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z", ...over,
});

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  deleteParcelScan.mockClear(); deleteExportedParcels.mockClear();
  deleteParcelScan.mockResolvedValue({ ok: true }); deleteExportedParcels.mockResolvedValue({ ok: true });
  loadRows.current = [];
});

describe("Change 2 — All / Wrong-code tabs", () => {
  it("All tab (default) shows every row; Wrong tab shows only not_found rows", async () => {
    loadRows.current = [
      mk({ id: "ok", storeCheckStatus: "valid" }),
      mk({ id: "bad1", storeCheckStatus: "not_found" }),
      mk({ id: "bad2", storeCheckStatus: "not_found" }),
    ];
    const { findByTestId, getAllByTestId, getByTestId, queryByTestId } = view();
    await findByTestId("ps-tabs");
    expect(getAllByTestId("ps-row")).toHaveLength(3);           // All
    expect(getByTestId("ps-tab-all").textContent).toContain("3");
    expect(getByTestId("ps-tab-wrong").textContent).toContain("2");
    fireEvent.click(getByTestId("ps-tab-wrong"));
    expect(getAllByTestId("ps-row")).toHaveLength(2);           // only not_found
    expect(queryByTestId("ps-wrong-empty")).toBeNull();
  });

  it("Wrong tab at 0 flagged → the 'all good' empty state (rows exist, none wrong)", async () => {
    loadRows.current = [mk({ id: "ok", storeCheckStatus: "valid" })];
    const { findByTestId, getByTestId, queryByTestId } = view();
    await findByTestId("ps-tabs");
    fireEvent.click(getByTestId("ps-tab-wrong"));
    expect(getByTestId("ps-wrong-empty")).toBeTruthy();
    expect(queryByTestId("ps-row")).toBeNull();
  });
});

describe("Change 3 — per-row delete (confirmed)", () => {
  it("trash → confirm → deletes only that id and removes the row", async () => {
    loadRows.current = [mk({ id: "keep" }), mk({ id: "gone" })];
    const { findAllByTestId, getByTestId, getAllByTestId, queryByTestId } = view();
    const trashes = await findAllByTestId("ps-row-delete");
    fireEvent.click(trashes[1]); // the "gone" row (2nd)
    expect(getByTestId("ps-confirm-overlay")).toBeTruthy();
    expect(deleteParcelScan).not.toHaveBeenCalled(); // not until confirmed
    fireEvent.click(getByTestId("ps-confirm-delete"));
    await waitFor(() => expect(deleteParcelScan).toHaveBeenCalledWith("gone"));
    await waitFor(() => expect(getAllByTestId("ps-row")).toHaveLength(1));
    expect(queryByTestId("ps-confirm-overlay")).toBeNull(); // closed on success
  });

  it("Cancel closes the dialog and never deletes", async () => {
    loadRows.current = [mk({ id: "keep" })];
    const { findByTestId, getByTestId, queryByTestId, getAllByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-delete"));
    fireEvent.click(getByTestId("ps-confirm-cancel"));
    expect(queryByTestId("ps-confirm-overlay")).toBeNull();
    expect(deleteParcelScan).not.toHaveBeenCalled();
    expect(getAllByTestId("ps-row")).toHaveLength(1);
  });

  it("delete failure → inline error, row kept, dialog stays open", async () => {
    loadRows.current = [mk({ id: "keep" })];
    deleteParcelScan.mockResolvedValue({ ok: false, error: "rls denied" });
    const { findByTestId, getByTestId, getAllByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-delete"));
    fireEvent.click(getByTestId("ps-confirm-delete"));
    await waitFor(() => expect(getByTestId("ps-delete-err")).toBeTruthy());
    expect(getByTestId("ps-confirm-overlay")).toBeTruthy(); // not closed
    expect(getAllByTestId("ps-row")).toHaveLength(1);       // row NOT pruned
  });
});

describe("Change 3 — clear-exported (confirmed)", () => {
  it("button hidden when nothing exported", async () => {
    loadRows.current = [mk({ id: "a", status: "confirmed" })];
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-tabs");
    expect(queryByTestId("ps-clear-exported")).toBeNull();
  });

  it("button shown with exported rows → confirm → deletes exported, removes them", async () => {
    loadRows.current = [mk({ id: "live", status: "confirmed" }), mk({ id: "exp", status: "exported" })];
    const { findByTestId, getByTestId, getAllByTestId } = view();
    fireEvent.click(await findByTestId("ps-clear-exported"));
    expect(getByTestId("ps-confirm-msg").textContent).toContain("1"); // count interpolated
    expect(deleteExportedParcels).not.toHaveBeenCalled();
    fireEvent.click(getByTestId("ps-confirm-delete"));
    await waitFor(() => expect(deleteExportedParcels).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getAllByTestId("ps-row")).toHaveLength(1)); // only the exported one gone
  });
});
