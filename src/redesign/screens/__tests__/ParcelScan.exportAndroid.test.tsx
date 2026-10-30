// Android export (7-11 .xlsm). Android Chrome cannot share .xlsm files (Web Share allows only
// images/video/audio/pdf/text), so: an Android BROWSER takes the desktop blob-download path
// (file to Downloads, rows marked exported, Undo, a "saved to Downloads" line); the Android APP
// shell still tries the share sheet and, when unsupported, shows the "use Chrome" message with
// the rows released. iPhone (app or Safari) is unchanged: share sheet, "use Safari" message.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { deliverXlsm, deliverXlsmMobile, markScansExported, unmarkScansExported } = vi.hoisted(() => ({
  deliverXlsm: vi.fn(async () => ({ ok: true, via: "browser" }) as { ok: boolean; via: string; error?: string }),
  deliverXlsmMobile: vi.fn(async () => ({ ok: false, via: "webshare", unsupported: true }) as { ok: boolean; via: string; cancelled?: boolean; unsupported?: boolean }),
  markScansExported: vi.fn(async (ids: string[]) => ({ ok: true, batchId: "batch-1", claimed: ids }) as { ok: boolean; batchId?: string; claimed: string[] }),
  unmarkScansExported: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })),
  loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
  confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })),
  undoExportBatch: vi.fn(async () => ({ ok: true, result: "undone" })),
  rowAwaitsVerdict: () => false, mergeExtensionVerdicts: (p: unknown) => p,
  storeClear: (s: string | null | undefined) => s === "open" || s === "company",
  wrongStoreCode: (r: { storeCheckStatus?: string | null; storeFullStatus?: string | null }) => r.storeCheckStatus === "not_found" || r.storeFullStatus === "not_found",
  MAX_PENDING_PARCELS: 40,
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: [
    { id: "r1", customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550, notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z" },
  ] as ParcelScanRow[] })),
  checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  splitScansForExport: (rows: ParcelScanRow[]) => ({ ready: rows.filter((r) => r.status !== "exported"), attention: [] }),
  scanToXlsRow: vi.fn(() => ({})),
  markScansExported, unmarkScansExported,
  deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
}));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()),
  buildXlsmFromTemplate: vi.fn(async () => new Uint8Array([1, 2, 3])),
  deliverXlsm, deliverXlsmMobile,
  exportFilename: () => "sellerflow_711.xlsm",
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const win = window as unknown as { Capacitor?: unknown; matchMedia?: unknown };
const realUA = navigator.userAgent;
const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
const setNarrow = (matches: boolean) => {
  win.matchMedia = (q: string) => ({ matches, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
};
const view = () => render(<TProvider lang="en"><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  deliverXlsm.mockClear(); deliverXlsmMobile.mockClear(); markScansExported.mockClear(); unmarkScansExported.mockClear();
  deliverXlsmMobile.mockResolvedValue({ ok: false, via: "webshare", unsupported: true });
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { setUA(realUA); try { delete win.Capacitor; delete win.matchMedia; } catch { /* ignore */ } });

// Switch "Export on this phone" ON via its dialog, then open the export confirm.
const openExportDialog = async (u: ReturnType<typeof view>) => {
  fireEvent.click(await u.findByTestId("ps-export-switch-toggle"));
  fireEvent.click(await u.findByTestId("ps-confirm-enablephone"));
  const b = await u.findByTestId("ps-export-btn");
  await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(b);
};
const confirmExport = async (u: ReturnType<typeof view>) => {
  const btn = await u.findByTestId("ps-confirm-export");
  await waitFor(() => expect(btn).not.toBeDisabled());
  fireEvent.click(btn);
};

describe("Parcel Scan — Android export", () => {
  it("Android BROWSER (Chrome, narrow, no app shell) → blob download, rows marked exported, Undo + 'saved to Downloads' line; no share", async () => {
    setUA(ANDROID_UA); setNarrow(true);
    const u = view();
    await openExportDialog(u);
    expect(markScansExported).not.toHaveBeenCalled(); // desktop path: nothing claimed until confirm
    await confirmExport(u);
    await u.findByTestId("ps-export-summary");
    expect(deliverXlsm).toHaveBeenCalledTimes(1);
    expect(deliverXlsmMobile).not.toHaveBeenCalled();
    expect(markScansExported).toHaveBeenCalledWith(["r1"]);
    expect(unmarkScansExported).not.toHaveBeenCalled();
    expect(u.getByTestId("ps-export-saved").textContent).toBe("File saved to Downloads. Upload it on the 賣貨便 website.");
    expect(u.queryByTestId("ps-export-appfail")).toBeNull();
    await u.findByTestId("ps-undo-btn");
  });

  it("Android APP shell, share unsupported → 'use Chrome' message, rows released, no saved line", async () => {
    setUA(ANDROID_UA);
    win.Capacitor = { getPlatform: () => "android" };
    const u = view();
    await openExportDialog(u);
    await confirmExport(u);
    const msg = await u.findByTestId("ps-export-appfail");
    expect(msg.textContent).toBe("Couldn't export in the app. Open sellerflowlive.com in Chrome and export from there.");
    expect(deliverXlsmMobile).toHaveBeenCalledTimes(1); // share tried first
    expect(deliverXlsm).not.toHaveBeenCalled();
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledWith("batch-1"));
    expect(u.queryByTestId("ps-export-summary")).toBeNull();
    expect(u.queryByTestId("ps-export-saved")).toBeNull();
  });

  it("iPhone APP shell → unchanged: share sheet, 'use Safari' message when unsupported", async () => {
    setUA(IPHONE_UA);
    win.Capacitor = { getPlatform: () => "ios" };
    const u = view();
    await openExportDialog(u);
    await confirmExport(u);
    const msg = await u.findByTestId("ps-export-appfail");
    expect(msg.textContent).toBe("Couldn't export in the app. Open sellerflowlive.com in Safari and export from there.");
    expect(deliverXlsmMobile).toHaveBeenCalledTimes(1);
    expect(deliverXlsm).not.toHaveBeenCalled();
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledWith("batch-1"));
  });

  it("iPhone Safari (narrow browser) → unchanged: the share sheet path, success marks exported, no Downloads line", async () => {
    setUA(IPHONE_UA); setNarrow(true);
    deliverXlsmMobile.mockResolvedValue({ ok: true, via: "webshare" });
    const u = view();
    await openExportDialog(u);
    await confirmExport(u);
    await u.findByTestId("ps-export-summary");
    expect(deliverXlsmMobile).toHaveBeenCalledTimes(1);
    expect(deliverXlsm).not.toHaveBeenCalled();
    expect(u.queryByTestId("ps-export-saved")).toBeNull();
  });
});
