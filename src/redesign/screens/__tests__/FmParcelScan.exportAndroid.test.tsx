// FamilyMart export on Android. deliverFmFiles already downloads (blob) outside the app shell and
// shares only inside it, so an Android BROWSER downloads (plus the "saved to Downloads — 好賣+ →
// 大量匯單" line) and the Android APP shell shows the "use Chrome" message when the share is
// unsupported, nothing marked. iPhone keeps the "use Safari" message.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const m = vi.hoisted(() => ({
  saveFmScan: vi.fn(), loadFmScans: vi.fn(), deliverFmFiles: vi.fn(), markFmExported: vi.fn(),
  undoFmExport: vi.fn(), deleteFmScan: vi.fn(), deleteFmExported: vi.fn(), loadFmGlobalFee: vi.fn(),
  decodeQrFromFile: vi.fn(), loadRecentFmCustomers: vi.fn(),
}));
vi.mock("../../adapters/fmScan", async (orig) => {
  const actual = await orig<typeof import("../../adapters/fmScan")>();
  return {
    ...actual, saveFmScan: m.saveFmScan, loadFmScans: m.loadFmScans, deliverFmFiles: m.deliverFmFiles, markFmExported: m.markFmExported,
    undoFmExport: m.undoFmExport, deleteFmScan: m.deleteFmScan, deleteFmExported: m.deleteFmExported, loadFmGlobalFee: m.loadFmGlobalFee,
  };
});
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile: m.decodeQrFromFile }));
vi.mock("../../adapters/fmCustomers", () => ({
  loadRecentFmCustomers: m.loadRecentFmCustomers,
  searchFmCustomers: async () => ({ ok: true, rows: [] }),
  countFmCustomers: async () => ({ ok: true, count: 1 }),
  updateFmCustomer: async () => ({ ok: true }),
  deleteFmCustomer: async () => ({ ok: true }),
}));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-11" }));

import FmParcelScan from "../FmParcelScan";

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const win = window as unknown as { Capacitor?: unknown; matchMedia?: unknown };
const realUA = navigator.userAgent;
const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
const setNarrow = (matches: boolean) => {
  win.matchMedia = (q: string) => ({ matches, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
};
const row = (id: string) => ({ id, recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-10-11", buyerUsername: "@x", createdAt: "2026-10-11T03:00:00Z", exportedAt: null, exportBatchId: null });
const view = () => render(<TProvider lang="en"><FmParcelScan /></TProvider>);
// Switch "Export on this phone" ON, then Export → confirm.
const exportNow = async (r: ReturnType<typeof view>) => {
  await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
  fireEvent.click(r.getByTestId("fms-export-switch-toggle"));
  fireEvent.click(r.getByTestId("fms-confirm-enablephone"));
  fireEvent.click(r.getByTestId("fms-export-btn"));
  fireEvent.click(r.getByTestId("fms-confirm-export"));
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a")] });
  m.loadFmGlobalFee.mockResolvedValue(39);
  m.loadRecentFmCustomers.mockResolvedValue({ ok: true, rows: [] });
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { setUA(realUA); try { delete win.Capacitor; delete win.matchMedia; } catch { /* ignore */ } });

describe("FamilyMart export — Android", () => {
  it("Android BROWSER → download path (appShell=false), marked exported, Undo, 'saved to Downloads — 好賣+' line", async () => {
    setUA(ANDROID_UA); setNarrow(true);
    m.deliverFmFiles.mockResolvedValue({ ok: true }); m.markFmExported.mockResolvedValue(true);
    const r = view();
    await exportNow(r);
    expect(m.deliverFmFiles).toHaveBeenCalledTimes(1);
    expect(m.deliverFmFiles.mock.calls[0][1]).toBe(false); // browser → blob download, not the share sheet
    await waitFor(() => expect(r.getByTestId("fms-undo-btn")).toBeTruthy());
    expect(m.markFmExported.mock.calls[0][0]).toEqual(["a"]);
    expect(r.getByTestId("fms-export-saved").textContent).toBe("File saved to Downloads. Upload it on 好賣+ → 大量匯單.");
    expect(r.queryByTestId("fms-export-appfail")).toBeNull();
  });

  it("Android APP shell, share unsupported → 'use Chrome' message, nothing marked, no saved line", async () => {
    setUA(ANDROID_UA);
    win.Capacitor = { getPlatform: () => "android" };
    m.deliverFmFiles.mockResolvedValue({ ok: false });
    const r = view();
    await exportNow(r);
    expect(m.deliverFmFiles.mock.calls[0][1]).toBe(true); // share tried first
    const msg = await r.findByTestId("fms-export-appfail");
    expect(msg.textContent).toBe("Couldn't export in the app. Open sellerflowlive.com in Chrome and export from there.");
    expect(m.markFmExported).not.toHaveBeenCalled();
    expect(r.queryByTestId("fms-export-saved")).toBeNull();
    expect(r.queryByTestId("fms-undo-btn")).toBeNull();
  });

  it("iPhone APP shell → unchanged 'use Safari' message", async () => {
    setUA(IPHONE_UA);
    win.Capacitor = { getPlatform: () => "ios" };
    m.deliverFmFiles.mockResolvedValue({ ok: false });
    const r = view();
    await exportNow(r);
    const msg = await r.findByTestId("fms-export-appfail");
    expect(msg.textContent).toBe("Couldn't export in the app. Open sellerflowlive.com in Safari and export from there.");
    expect(m.markFmExported).not.toHaveBeenCalled();
  });
});
