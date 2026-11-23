// Native "Scan sticker QR" on the three existing Scan buttons (7-11 Parcel Scan, FamilyMart Parcel Scan,
// Blacklist). A new app build with the switch on → the live scanner is opened and its text goes through
// the SAME code as a photo read. A laptop, an older app build or the switch off → today's photo picker,
// exactly as before (the file input is clicked, the scanner is never called).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen, act, cleanup } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import type { BlAddResult, BlRow } from "../../adapters/blacklist";
import { setNativeQrScannerOn } from "../../adapters/nativeQrScanner";

const m = vi.hoisted(() => ({
  decode: vi.fn(async (_f: File): Promise<string | null | string[]> => null),
  warm: vi.fn(),
  loadRows: { current: [] as ParcelScanRow[] },
  loadFmScans: vi.fn(async () => ({ ok: true, rows: [] })),
  loadFmGlobalFee: vi.fn(async () => 39),
}));
vi.mock("../../adapters/qrDecode", async () => (await import("./qrReaderMock")).qrReaderModule((f: File) => m.decode(f), () => m.warm()));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(async () => ({ ok: true, id: "n1" })),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: m.loadRows.current })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(), deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: vi.fn(async () => ({ ok: true })), resetExtensionChecks: vi.fn(async () => ({ ok: true })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/fmScan", async (orig) => {
  const actual = await orig<typeof import("../../adapters/fmScan")>();
  return { ...actual, saveFmScan: vi.fn(async () => ({ ok: true })), loadFmScans: m.loadFmScans, deliverFmFiles: vi.fn(), markFmExported: vi.fn(), undoFmExport: vi.fn(), deleteFmScan: vi.fn(), deleteFmExported: vi.fn(), loadFmGlobalFee: m.loadFmGlobalFee };
});
vi.mock("../../adapters/fmCustomers", () => ({
  loadRecentFmCustomers: async () => ({ ok: true, rows: [] }), searchFmCustomers: async () => ({ ok: true, rows: [] }),
  countFmCustomers: async () => ({ ok: true, count: 0 }), updateFmCustomer: async () => ({ ok: true }), deleteFmCustomer: async () => ({ ok: true }),
}));

import ParcelScan from "../ParcelScan";
import FmParcelScan from "../FmParcelScan";
import Blacklist from "../Blacklist";

type W = { Capacitor?: unknown };
const scanStickerQr = vi.fn();
const installNewAppBuild = () => { (window as unknown as W).Capacitor = { Plugins: { SellerFlowScanner: { scanStickerQr } } }; };
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
let fileClicks: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  m.decode.mockReset(); m.decode.mockResolvedValue(null); m.warm.mockReset();
  m.loadRows.current = [];
  scanStickerQr.mockReset();
  fileClicks = vi.spyOn(HTMLInputElement.prototype, "click");
});
afterEach(() => {
  cleanup();
  fileClicks.mockRestore();
  setNativeQrScannerOn(false);
  delete (window as unknown as W).Capacitor;
});

const fileInputClicked = (testid: string) => fileClicks.mock.contexts.some((el) => (el as HTMLElement).dataset?.testid === testid);

// ── 7-11 Parcel Scan ────────────────────────────────────────────────────────────────────────
const parcel = () => render(<TProvider lang="en"><ParcelScan cur="NT$" /></TProvider>);
const openParcelForm = async () => { fireEvent.click(await screen.findByTestId("ps-manual")); };

describe("7-11 Parcel Scan — Scan QR", () => {
  it("new app build + switch on: the live scanner reads → the @username is filled, no photo picker", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "read", text: "https://tiktok.com/@Buyer.One" });
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await waitFor(() => expect((screen.getByTestId("ps-notes") as HTMLInputElement).value).toBe("Buyer.One"));
    expect(scanStickerQr).toHaveBeenCalledTimes(1);
    expect(scanStickerQr.mock.calls[0][0].texts.title).toBe("Scan sticker QR");
    expect(fileInputClicked("ps-qr-file")).toBe(false);
    expect(m.decode).not.toHaveBeenCalled();
  });
  it("'Take a photo instead' → the picture goes through today's reader (2 stickers message unchanged)", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "photo", data: btoa("jpegbytes"), mime: "image/jpeg" });
    m.decode.mockResolvedValue(["https://tiktok.com/@a", "https://tiktok.com/@b"]);
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await waitFor(() => expect(m.decode).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("2 stickers in the photo — show only one")).toBeTruthy();
    expect((screen.getByTestId("ps-notes") as HTMLInputElement).value).toBe("");
  });
  it("closed with ✕ → nothing changes", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "cancelled" });
    parcel(); await openParcelForm();
    fireEvent.change(screen.getByTestId("ps-notes"), { target: { value: "typed" } });
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await flush();
    expect((screen.getByTestId("ps-notes") as HTMLInputElement).value).toBe("typed");
    expect(screen.queryByText(/No QR found/)).toBeNull();
  });
  it("a photo that can't be opened → today's 'No QR found' message, field left as-is", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "error", code: "photo_unreadable" });
    parcel(); await openParcelForm();
    fireEvent.change(screen.getByTestId("ps-notes"), { target: { value: "typed" } });
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await flush();
    expect(screen.getByText("No QR found — type the username")).toBeTruthy();
    expect(screen.queryByText(/Couldn't open the scanner/)).toBeNull();
    expect((screen.getByTestId("ps-notes") as HTMLInputElement).value).toBe("typed");
  });
  it("laptop (no app) → today's photo picker, the scanner is never asked", async () => {
    setNativeQrScannerOn(true);
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(fileInputClicked("ps-qr-file")).toBe(true);
    expect(m.warm).toHaveBeenCalledTimes(1);
    expect(scanStickerQr).not.toHaveBeenCalled();
  });
  it("switch off → today's photo picker even in a new app build", async () => {
    installNewAppBuild();
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(fileInputClicked("ps-qr-file")).toBe(true);
    expect(scanStickerQr).not.toHaveBeenCalled();
  });
});

// ── FamilyMart Parcel Scan ──────────────────────────────────────────────────────────────────
const fm = async () => { render(<TProvider lang="en"><FmParcelScan /></TProvider>); await waitFor(() => expect(m.loadFmGlobalFee).toHaveBeenCalled()); fireEvent.click(await screen.findByTestId("fms-manual")); };

describe("FamilyMart Parcel Scan — Scan QR", () => {
  it("new app build: the live read fills the username", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "read", text: "@buyer.two" });
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    await waitFor(() => expect((screen.getByTestId("fms-username") as HTMLInputElement).value).toBe("buyer.two"));
    expect(fileInputClicked("fms-qr-file")).toBe(false);
  });
  it("a failed scanner → a short message, nothing filled", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockRejectedValue(new Error("boom"));
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    expect(await screen.findByText("Couldn't open the scanner — try again")).toBeTruthy();
    expect((screen.getByTestId("fms-username") as HTMLInputElement).value).toBe("");
  });
  it("a photo that can't be opened → today's 'No QR found' message", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "error", code: "photo_unreadable" });
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    expect(await screen.findByText("No QR found — type the username")).toBeTruthy();
    expect(screen.queryByText(/Couldn't open the scanner/)).toBeNull();
    expect((screen.getByTestId("fms-username") as HTMLInputElement).value).toBe("");
  });
  it("laptop → today's photo picker", async () => {
    setNativeQrScannerOn(true);
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    expect(fileInputClicked("fms-qr-file")).toBe(true);
    expect(scanStickerQr).not.toHaveBeenCalled();
  });
});

// ── Blacklist ───────────────────────────────────────────────────────────────────────────────
const ROWS: BlRow[] = [];
function blacklist() {
  const onAdd = vi.fn(async (): Promise<BlAddResult> => ({ kind: "added", id: "n1", day: "2026-11-22" }));
  render(<TProvider lang="en"><Blacklist onBack={vi.fn()} rows={ROWS} error={false} onReload={vi.fn()} onAdd={onAdd} onUndo={vi.fn(async () => true)} onRemove={vi.fn(async () => true)} /></TProvider>);
  fireEvent.click(screen.getByTestId("bl-reason-notout"));
  return onAdd;
}

describe("Blacklist — Scan sticker QR", () => {
  it("new app build: the live read adds the buyer (strict parser unchanged)", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "read", text: "https://www.tiktok.com/@Maria_Shop?lang=en" });
    const onAdd = blacklist();
    fireEvent.click(screen.getByTestId("bl-scan"));
    await flush();
    expect(onAdd).toHaveBeenCalledWith("tiktok", "Maria_Shop", "not_checked_out");
    expect(fileInputClicked("bl-file")).toBe(false);
  });
  it("a QR that is not a buyer → 'This QR has no buyer', nothing added", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "read", text: "hello world" });
    const onAdd = blacklist();
    fireEvent.click(screen.getByTestId("bl-scan"));
    await flush();
    expect(screen.getByTestId("bl-noqr")).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
  });
  it("a failed scanner → its own message", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "error", code: "x" });
    blacklist();
    fireEvent.click(screen.getByTestId("bl-scan"));
    await flush();
    expect(screen.getByTestId("bl-scan-failed").textContent).toContain("Couldn't open the scanner");
  });
  it("laptop → today's photo picker", async () => {
    setNativeQrScannerOn(true);
    blacklist();
    fireEvent.click(screen.getByTestId("bl-scan"));
    expect(fileInputClicked("bl-file")).toBe(true);
    expect(scanStickerQr).not.toHaveBeenCalled();
  });
  it("the 'Added — Undo' note stays while the scanner is open and when it is closed; a real read replaces it", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    let answer: (v: unknown) => void = () => {};
    scanStickerQr.mockResolvedValueOnce({ status: "read", text: "@first_buyer" });
    blacklist();
    fireEvent.click(screen.getByTestId("bl-scan"));
    await flush();
    expect(screen.getByTestId("bl-added")).toBeTruthy();
    // open the scanner again: the note (with Undo) is still there while it is open …
    scanStickerQr.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    fireEvent.click(screen.getByTestId("bl-scan"));
    await flush();
    expect(screen.getByTestId("bl-added")).toBeTruthy();
    expect(screen.getByTestId("bl-undo")).toBeTruthy();
    // … and after ✕ (cancelled)
    await act(async () => { answer({ status: "cancelled" }); });
    await flush();
    expect(screen.getByTestId("bl-added")).toBeTruthy();
    // a real read that is not a buyer → its message replaces the note
    scanStickerQr.mockResolvedValueOnce({ status: "read", text: "hello world" });
    fireEvent.click(screen.getByTestId("bl-scan"));
    await flush();
    expect(screen.queryByTestId("bl-added")).toBeNull();
    expect(screen.getByTestId("bl-noqr")).toBeTruthy();
  });
  it("a photo that can't be opened → today's 'No QR found' (not a scanner failure)", async () => {
    installNewAppBuild(); setNativeQrScannerOn(true);
    scanStickerQr.mockResolvedValue({ status: "error", code: "photo_unreadable" });
    const onAdd = blacklist();
    fireEvent.click(screen.getByTestId("bl-scan"));
    await flush();
    expect(screen.getByTestId("bl-noqr-found")).toBeTruthy();
    expect(screen.queryByTestId("bl-scan-failed")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
