// iPhone/Android app-shell export (Option B). The .xlsm is PRE-BUILT when the confirm
// dialog opens; tapping Export shares it via deliverXlsmMobile SYNCHRONOUSLY (no await
// before the call). A genuine share marks rows exported; cancel keeps them pending; an
// unsupported/failed share shows the "export in Safari" message and NEVER marks exported
// (no silent blob no-op that consumes rows).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { deliverXlsmMobile, buildXlsmFromTemplate, markScansExported, loadParcelScans } = vi.hoisted(() => ({
  deliverXlsmMobile: vi.fn(async () => ({ ok: true, via: "webshare" }) as { ok: boolean; via: string; cancelled?: boolean; unsupported?: boolean }),
  buildXlsmFromTemplate: vi.fn(async () => new Uint8Array([1, 2, 3])),
  markScansExported: vi.fn(async () => ({ ok: true, batchId: "batch-1" }) as { ok: boolean; batchId?: string }),
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
  unmarkScansExported: vi.fn(async () => ({ ok: true })),
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
  deliverXlsmMobile.mockClear(); markScansExported.mockClear(); buildXlsmFromTemplate.mockClear();
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

  it("tapping Export calls deliverXlsmMobile SYNCHRONOUSLY, then marks exported on success", async () => {
    const u = view();
    await openExportDialog(u);
    const btn = await u.findByTestId("ps-confirm-export");
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    expect(deliverXlsmMobile).toHaveBeenCalledTimes(1); // fired in the tap, no await before it
    await waitFor(() => expect(markScansExported).toHaveBeenCalledWith(["r1"]));
    await u.findByTestId("ps-export-summary");
  });

  it("unsupported share → 'export in Safari' message, rows NOT marked exported", async () => {
    deliverXlsmMobile.mockResolvedValue({ ok: false, via: "webshare", unsupported: true });
    const u = view();
    await openExportDialog(u);
    const btn = await u.findByTestId("ps-confirm-export");
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await u.findByTestId("ps-export-appfail");                 // honest Safari message
    expect(markScansExported).not.toHaveBeenCalled();          // never consumed
    expect(u.queryByTestId("ps-export-summary")).toBeNull();
  });

  it("cancelled share → no message, rows stay pending (not marked)", async () => {
    deliverXlsmMobile.mockResolvedValue({ ok: false, via: "webshare", cancelled: true });
    const u = view();
    await openExportDialog(u);
    const btn = await u.findByTestId("ps-confirm-export");
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(deliverXlsmMobile).toHaveBeenCalled());
    expect(markScansExported).not.toHaveBeenCalled();
    expect(u.queryByTestId("ps-export-appfail")).toBeNull();
  });
});
