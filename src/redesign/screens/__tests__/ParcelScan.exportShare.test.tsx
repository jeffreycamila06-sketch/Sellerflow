// iPhone/Android app-shell export (Option B). The .xlsm is PRE-BUILT when the confirm
// dialog opens — CLAIM-FIRST (2a): the rows are claimed (markScansExported) before the
// build, so the file only holds rows this device won. Tapping Export shares it via
// deliverXlsmMobile SYNCHRONOUSLY (no await before the call). A genuine share keeps the
// claim; cancel RELEASES it (rows back to ready); an unsupported/failed share releases it
// and shows the "export in Safari" message (no silent blob no-op that consumes rows).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { deliverXlsmMobile, buildXlsmFromTemplate, markScansExported, unmarkScansExported, loadParcelScans } = vi.hoisted(() => ({
  deliverXlsmMobile: vi.fn(async () => ({ ok: true, via: "webshare" }) as { ok: boolean; via: string; cancelled?: boolean; unsupported?: boolean }),
  buildXlsmFromTemplate: vi.fn(async () => new Uint8Array([1, 2, 3])),
  markScansExported: vi.fn(async (ids: string[]) => ({ ok: true, batchId: "batch-1", claimed: ids }) as { ok: boolean; batchId?: string; claimed: string[] }),
  unmarkScansExported: vi.fn(async () => ({ ok: true })),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: [
    { id: "r1", customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550, notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z" },
  ] as ParcelScanRow[] })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  rowAwaitsVerdict: () => false, mergeExtensionVerdicts: (p: unknown) => p,
  MAX_PENDING_PARCELS: 40,
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans,
  checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
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
  buildXlsmFromTemplate,
  deliverXlsm: vi.fn(async () => ({ ok: true, via: "browser" })),
  deliverXlsmMobile,
  exportFilename: () => "sellerflow_711.xlsm",
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const win = window as unknown as { Capacitor?: unknown };
const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  deliverXlsmMobile.mockClear(); markScansExported.mockClear(); unmarkScansExported.mockClear(); buildXlsmFromTemplate.mockClear();
  deliverXlsmMobile.mockResolvedValue({ ok: true, via: "webshare" });
  win.Capacitor = {}; // app shell → onMobile true
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { try { delete win.Capacitor; } catch { /* ignore */ } });

// Turn the per-device "Export on this phone" switch ON via its confirm dialog (React
// state, so it works regardless of localStorage), then open the export confirm.
const openExportDialog = async (u: ReturnType<typeof view>) => {
  fireEvent.click(await u.findByTestId("ps-export-switch-toggle"));
  fireEvent.click(await u.findByTestId("ps-confirm-enablephone"));
  fireEvent.click(await u.findByTestId("ps-export-btn")); // askExport → prebuild + dialog
};

describe("Parcel Scan — mobile export delivery (Option B)", () => {
  it("pre-builds the file on dialog open (before any share) and enables Export when ready", async () => {
    const u = view();
    await openExportDialog(u);
    await waitFor(() => expect(buildXlsmFromTemplate).toHaveBeenCalledTimes(1)); // prebuilt on OPEN
    expect(deliverXlsmMobile).not.toHaveBeenCalled();                            // not shared yet
    await waitFor(() => expect(u.getByTestId("ps-confirm-export")).not.toBeDisabled());
  });

  it("claims on dialog open, tapping Export calls deliverXlsmMobile SYNCHRONOUSLY, success keeps the claim", async () => {
    const u = view();
    await openExportDialog(u);
    const btn = await u.findByTestId("ps-confirm-export");
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(markScansExported).toHaveBeenCalledWith(["r1"]); // claimed BEFORE the share
    fireEvent.click(btn);
    expect(deliverXlsmMobile).toHaveBeenCalledTimes(1); // fired in the tap, no await before it
    await u.findByTestId("ps-export-summary");
    expect(unmarkScansExported).not.toHaveBeenCalled();
  });

  it("unsupported share → 'export in Safari' message, rows NOT marked exported", async () => {
    deliverXlsmMobile.mockResolvedValue({ ok: false, via: "webshare", unsupported: true });
    const u = view();
    await openExportDialog(u);
    const btn = await u.findByTestId("ps-confirm-export");
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await u.findByTestId("ps-export-appfail");                 // honest Safari message
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledWith("batch-1")); // claim released → never consumed
    expect(u.queryByTestId("ps-export-summary")).toBeNull();
  });

  it("cancelled share → no message, claim released (rows back to ready)", async () => {
    deliverXlsmMobile.mockResolvedValue({ ok: false, via: "webshare", cancelled: true });
    const u = view();
    await openExportDialog(u);
    const btn = await u.findByTestId("ps-confirm-export");
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledWith("batch-1"));
    expect(u.queryByTestId("ps-export-appfail")).toBeNull();
  });

  it("closing the dialog without sharing releases the claim", async () => {
    const u = view();
    await openExportDialog(u);
    await waitFor(() => expect(u.getByTestId("ps-confirm-export")).not.toBeDisabled());
    fireEvent.click(u.getByTestId("ps-confirm-cancel"));
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledWith("batch-1"));
    expect(deliverXlsmMobile).not.toHaveBeenCalled();
  });
});
