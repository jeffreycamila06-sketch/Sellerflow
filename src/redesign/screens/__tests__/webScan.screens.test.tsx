// The in-page live QR scanner on the four Scan places (7-11 Parcel Scan, FamilyMart Parcel Scan, Blacklist,
// Orders). The REAL scanner runs here against a fake phone (camera + the phone's own QR reader).
//   • Android app WITHOUT the built-in scanner + the switch on → the live camera opens; the QR text goes
//     through the SAME code as a photo read; "Take a photo instead" and a refused camera open today's
//     photo picker (the second with one short line).
//   • Laptop / iPhone / switch off / no camera API → today's photo picker, exactly as before.
//   • An app build WITH the built-in scanner → the built-in scanner, exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen, act, cleanup } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import type { BlAddResult, BlRow } from "../../adapters/blacklist";
import type { Order } from "../../data";
import type { Buyer, LiveOrder } from "../../../lib/orderTypes";
import { setNativeQrScannerOn } from "../../adapters/nativeQrScanner";
import { setWebQrScannerOn } from "../../adapters/webQrScanner";
import { writeParcelDraft } from "../../adapters/parcelDrafts";
import { installApp, removeApp, installFakePhone, setTapCounts, scannerOnScreen, part, type FakePhone } from "../../adapters/__tests__/webScan.harness";

const m = vi.hoisted(() => ({
  decode: vi.fn(async (_f: File): Promise<string | null | string[]> => null),
  warm: vi.fn(),
  loadRows: { current: [] as ParcelScanRow[] },
  loadFmScans: vi.fn(async () => ({ ok: true, rows: [] })),
  loadFmGlobalFee: vi.fn(async () => 39),
}));
vi.mock("../../adapters/qrDecode", async () => (await import("./qrReaderMock")).qrReaderModule((f: File) => m.decode(f), () => m.warm()));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
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
import Orders from "../Orders";

let phone: FakePhone & { resolveCamera: () => void; rejectCamera: (name: string) => void };
let fileClicks: ReturnType<typeof vi.spyOn>;
const nativeScan = vi.fn();
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const fileInputClicked = (testid: string) => fileClicks.mock.contexts.filter((el) => (el as HTMLElement).dataset?.testid === testid).length;
const allStopped = () => phone.tracks.length > 0 && phone.tracks.every((t) => t.stop.mock.calls.length >= 1);
const pickPhoto = (testid: string) => fireEvent.change(screen.getByTestId(testid), { target: { files: [new File(["x"], "s.jpg", { type: "image/jpeg" })] } });
/** The Android app without the built-in scanner, the switch on, a working camera. */
const android19 = (o: Parameters<typeof installFakePhone>[0] = {}) => { installApp("android", { SellerFlowPrinter: {} }); setWebQrScannerOn(true); phone = installFakePhone(o); };

beforeEach(() => {
  m.decode.mockReset(); m.decode.mockResolvedValue(null); m.warm.mockReset();
  m.loadRows.current = [];
  nativeScan.mockReset();
  fileClicks = vi.spyOn(HTMLInputElement.prototype, "click");
  setTapCounts(undefined);
});
afterEach(() => {
  cleanup(); // leaving the screen closes an open scanner
  fileClicks.mockRestore();
  setNativeQrScannerOn(false); setWebQrScannerOn(false);
  removeApp();
  phone?.restore();
  setTapCounts(undefined);
});

// ── 7-11 Parcel Scan ────────────────────────────────────────────────────────────────────────
// manualOnly = the Parcel Scan every seller and admin has today (its old photo-scan camera is hidden),
// so the only thing here that may ask for a camera is the QR scanner.
// Each render starts clean: no half-typed parcel kept from the render before (the screens keep one in memory).
const noDraft = () => { writeParcelDraft("711", null); writeParcelDraft("fm", null); };
const parcel = () => { noDraft(); return render(<TProvider lang="en"><ParcelScan cur="NT$" manualOnly /></TProvider>); };
const openParcelForm = async () => { fireEvent.click(await screen.findByTestId("ps-manual")); };
const notes = () => (screen.getByTestId("ps-notes") as HTMLInputElement).value;

describe("7-11 Parcel Scan — Scan QR with the in-page scanner", () => {
  it("Android app without the built-in scanner + switch on: the live camera reads → the @username is filled, no photo picker, camera off", async () => {
    android19();
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(scannerOnScreen()).toBeTruthy();
    expect(part("wqs-title").textContent).toBe("Scan sticker QR");
    expect(fileInputClicked("ps-qr-file")).toBe(0);
    expect(m.warm).not.toHaveBeenCalled();
    phone.seen.current = [{ text: "https://tiktok.com/@Buyer.One" }];
    await waitFor(() => expect(notes()).toBe("Buyer.One"));
    expect(await screen.findByText("Filled @username from QR")).toBeTruthy();
    expect(scannerOnScreen()).toBeNull();
    expect(allStopped()).toBe(true);
    expect(phone.getUserMedia).toHaveBeenCalledTimes(1);
    expect(fileInputClicked("ps-qr-file")).toBe(0);
    expect(m.decode).not.toHaveBeenCalled();
  });
  it("the live read gives the SAME result as a photo of the same QR (the text goes verbatim through today's parser)", async () => {
    const qrs = ["https://www.tiktok.com/@Maria_Shop?lang=en", "@plain.name", "tiktok.com/@x9", "https://example.com/not-a-buyer", "hello"];
    const viaPhoto: string[] = [], viaLive: string[] = [];
    for (const qr of qrs) { // today's photo flow (laptop)
      m.decode.mockResolvedValue(qr);
      parcel(); await openParcelForm();
      fireEvent.change(screen.getByTestId("ps-notes"), { target: { value: "typed" } });
      pickPhoto("ps-qr-file");
      await flush();
      viaPhoto.push(`${notes()}|${document.body.textContent?.includes("No QR found") ? "none" : "filled"}`);
      cleanup();
    }
    android19();
    for (const qr of qrs) {
      parcel(); await openParcelForm();
      fireEvent.change(screen.getByTestId("ps-notes"), { target: { value: "typed" } });
      phone.seen.current = [{ text: qr }];
      fireEvent.click(screen.getByTestId("ps-scan-qr"));
      await waitFor(() => expect(scannerOnScreen()).toBeNull());
      await flush();
      viaLive.push(`${notes()}|${document.body.textContent?.includes("No QR found") ? "none" : "filled"}`);
      cleanup();
    }
    expect(viaLive).toEqual(viaPhoto);
    // today's parser (unchanged): a TikTok link or a bare name is a username; another website is not
    expect(viaPhoto).toEqual(["Maria_Shop|filled", "plain.name|filled", "x9|filled", "typed|none", "hello|filled"]);
  });
  it("'Take a photo instead' → today's photo picker is opened inside that tap; the picture goes through today's reader", async () => {
    android19();
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    act(() => { part("wqs-photo").click(); });
    expect(fileInputClicked("ps-qr-file")).toBe(1); // already opened when the tap returns
    expect(m.warm).toHaveBeenCalledTimes(1);
    expect(scannerOnScreen()).toBeNull();
    expect(allStopped()).toBe(true);
    m.decode.mockResolvedValue(["https://tiktok.com/@a", "https://tiktok.com/@b"]);
    pickPhoto("ps-qr-file");
    expect(await screen.findByText("2 stickers in the photo — show only one")).toBeTruthy();
    expect(notes()).toBe("");
  });
  it("camera refused → one short line + today's photo picker", async () => {
    android19({ camera: { reject: "NotAllowedError" } });
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(await screen.findByText("Camera is off for SellerFlowLive")).toBeTruthy();
    expect(fileInputClicked("ps-qr-file")).toBe(1);
    expect(scannerOnScreen()).toBeNull();
    expect(screen.queryByText(/Couldn't open the scanner/)).toBeNull();
  });
  it("camera not there → 'The camera isn't available right now' + today's photo picker", async () => {
    android19({ camera: { reject: "NotFoundError" } });
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(await screen.findByText("The camera isn't available right now")).toBeTruthy();
    expect(fileInputClicked("ps-qr-file")).toBe(1);
  });
  it("Close → nothing changes, no picker, camera off, the Scan button works again", async () => {
    android19();
    parcel(); await openParcelForm();
    fireEvent.change(screen.getByTestId("ps-notes"), { target: { value: "typed" } });
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    act(() => { part("wqs-close").click(); });
    expect(notes()).toBe("typed");
    expect(fileInputClicked("ps-qr-file")).toBe(0);
    expect(allStopped()).toBe(true);
    expect((screen.getByTestId("ps-scan-qr") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(scannerOnScreen()).toBeTruthy();
  });
  it("the screen is left while the scanner is open → the scanner is gone and the camera is off", async () => {
    android19();
    const r = parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    r.unmount();
    expect(scannerOnScreen()).toBeNull();
    expect(allStopped()).toBe(true);
  });
  it("left while the phone still asks for the camera → the camera that arrives later is switched off", async () => {
    android19({ camera: "pending" });
    const r = parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    r.unmount();
    phone.resolveCamera();
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    await flush();
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });

  // Everyone else: today's photo flow, untouched.
  const todaysFlow = async () => {
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(fileInputClicked("ps-qr-file")).toBe(1); // inside the tap
    expect(m.warm).toHaveBeenCalledTimes(1);
    expect(scannerOnScreen()).toBeNull();
    expect(phone.getUserMedia).not.toHaveBeenCalled();
    expect(nativeScan).not.toHaveBeenCalled();
  };
  it("laptop / desktop browser (no app) → today's photo picker, the camera is never asked", async () => {
    setWebQrScannerOn(true); phone = installFakePhone();
    await todaysFlow();
  });
  it("iPhone app without the built-in scanner → today's photo picker", async () => {
    installApp("ios", { SellerFlowPrinter: {} }); setWebQrScannerOn(true); phone = installFakePhone();
    await todaysFlow();
  });
  it("Android BROWSER (not the app) → today's photo picker", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0 Mobile Safari/537.36");
    setWebQrScannerOn(true); phone = installFakePhone();
    await todaysFlow();
    ua.mockRestore();
  });
  it("Android app, switch OFF → today's photo picker", async () => {
    installApp("android", {}); phone = installFakePhone();
    await todaysFlow();
  });
  it("Android app, switch on, but the page has no camera API → today's photo picker", async () => {
    installApp("android", {}); setWebQrScannerOn(true); phone = installFakePhone();
    const gum = phone.getUserMedia;
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    expect(fileInputClicked("ps-qr-file")).toBe(1);
    expect(scannerOnScreen()).toBeNull();
    expect(gum).not.toHaveBeenCalled();
  });
  it("the DOM of the screen is the same with the switch on or off until Scan is tapped", async () => {
    installApp("android", {}); phone = installFakePhone();
    const off = parcel(); await openParcelForm(); await flush();
    const offHtml = off.container.innerHTML;
    cleanup();
    setWebQrScannerOn(true);
    const on = parcel(); await openParcelForm(); await flush();
    expect(on.container.innerHTML).toBe(offHtml);
  });

  // An app build WITH the built-in scanner: exactly as before.
  it("app build with the built-in scanner, both switches on → the BUILT-IN scanner; the page's camera is never asked", async () => {
    installApp("android", { SellerFlowScanner: { scanStickerQr: nativeScan } }); setNativeQrScannerOn(true); setWebQrScannerOn(true); phone = installFakePhone();
    nativeScan.mockResolvedValue({ status: "read", text: "https://tiktok.com/@Buyer.One" });
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await waitFor(() => expect(notes()).toBe("Buyer.One"));
    expect(nativeScan).toHaveBeenCalledTimes(1);
    expect(phone.getUserMedia).not.toHaveBeenCalled();
    expect(scannerOnScreen()).toBeNull();
    expect(fileInputClicked("ps-qr-file")).toBe(0);
  });
  it("iPhone app with the built-in scanner (1.10), both switches on → the built-in scanner, as today", async () => {
    installApp("ios", { SellerFlowScanner: { scanStickerQr: nativeScan } }); setNativeQrScannerOn(true); setWebQrScannerOn(true); phone = installFakePhone();
    nativeScan.mockResolvedValue({ status: "cancelled" });
    parcel(); await openParcelForm();
    fireEvent.click(screen.getByTestId("ps-scan-qr"));
    await flush();
    expect(nativeScan).toHaveBeenCalledTimes(1);
    expect(nativeScan.mock.calls[0][0].texts.title).toBe("Scan sticker QR");
    expect(phone.getUserMedia).not.toHaveBeenCalled();
    expect(fileInputClicked("ps-qr-file")).toBe(0);
  });
  it("app build with the built-in scanner, ITS switch off, this switch on → today's photo picker (never the page's scanner)", async () => {
    installApp("android", { SellerFlowScanner: { scanStickerQr: nativeScan } }); setWebQrScannerOn(true); phone = installFakePhone();
    await todaysFlow();
  });
});

// ── FamilyMart Parcel Scan ──────────────────────────────────────────────────────────────────
const fm = async () => { noDraft(); const r = render(<TProvider lang="en"><FmParcelScan /></TProvider>); await waitFor(() => expect(m.loadFmGlobalFee).toHaveBeenCalled()); fireEvent.click(await screen.findByTestId("fms-manual")); return r; };
const fmUser = () => (screen.getByTestId("fms-username") as HTMLInputElement).value;

describe("FamilyMart Parcel Scan — Scan QR with the in-page scanner", () => {
  it("the live read fills the username; no photo picker; camera off", async () => {
    android19();
    await fm();
    phone.seen.current = [{ text: "@buyer.two" }];
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    await waitFor(() => expect(fmUser()).toBe("buyer.two"));
    expect(fileInputClicked("fms-qr-file")).toBe(0);
    expect(scannerOnScreen()).toBeNull();
    expect(allStopped()).toBe(true);
  });
  it("a QR that is not a buyer → today's 'No QR found' message, nothing filled", async () => {
    android19();
    await fm();
    phone.seen.current = [{ text: "https://example.com/x" }];
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    expect(await screen.findByText("No QR found — type the username")).toBeTruthy();
    expect(fmUser()).toBe("");
  });
  it("'Take a photo instead' and a refused camera → today's photo picker", async () => {
    android19();
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    act(() => { part("wqs-photo").click(); });
    expect(fileInputClicked("fms-qr-file")).toBe(1);
    expect(m.warm).toHaveBeenCalledTimes(1);
    cleanup(); phone.restore();
    android19({ camera: { reject: "NotAllowedError" } });
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    expect(await screen.findByText("Camera is off for SellerFlowLive")).toBeTruthy();
    expect(fileInputClicked("fms-qr-file")).toBe(2);
  });
  it("leaving the screen switches the camera off", async () => {
    android19();
    const r = await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    r.unmount();
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it.each([["laptop", null], ["iPhone app", "ios"]] as const)("%s → today's photo picker", async (_name, platform) => {
    if (platform) installApp(platform, {});
    setWebQrScannerOn(true); phone = installFakePhone();
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    expect(fileInputClicked("fms-qr-file")).toBe(1);
    expect(phone.getUserMedia).not.toHaveBeenCalled();
    expect(scannerOnScreen()).toBeNull();
  });
  it("Android app, switch off → today's photo picker", async () => {
    installApp("android", {}); phone = installFakePhone();
    await fm();
    fireEvent.click(screen.getByTestId("fms-scan-qr"));
    expect(fileInputClicked("fms-qr-file")).toBe(1);
    expect(phone.getUserMedia).not.toHaveBeenCalled();
  });
});

// ── Blacklist ───────────────────────────────────────────────────────────────────────────────
const ROWS: BlRow[] = [];
const added = async (): Promise<BlAddResult> => ({ kind: "added", id: "n1", day: "2026-11-25" });
function blacklist(props: Record<string, unknown> = {}) {
  const onAdd = vi.fn(added);
  const r = render(<TProvider lang="en"><Blacklist onBack={vi.fn()} rows={ROWS} error={false} onReload={vi.fn()} onAdd={onAdd} onUndo={vi.fn(async () => true)} onRemove={vi.fn(async () => true)} {...props} /></TProvider>);
  return { onAdd, ...r };
}

describe("Blacklist — Scan sticker QR with the in-page scanner", () => {
  it("the live read adds the buyer (strict parser unchanged); no photo picker; camera off", async () => {
    android19();
    const { onAdd } = blacklist();
    fireEvent.click(screen.getByTestId("bl-reason-notout"));
    phone.seen.current = [{ text: "https://www.tiktok.com/@Maria_Shop?lang=en" }];
    fireEvent.click(screen.getByTestId("bl-scan"));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("tiktok", "Maria_Shop", "not_checked_out"));
    expect(fileInputClicked("bl-file")).toBe(0);
    expect(scannerOnScreen()).toBeNull();
    expect(allStopped()).toBe(true);
  });
  it("a QR that is not a TikTok profile → 'This QR has no buyer', nothing added (as with a photo)", async () => {
    android19();
    const { onAdd } = blacklist();
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    phone.seen.current = [{ text: "https://example.com/@x" }];
    fireEvent.click(screen.getByTestId("bl-scan"));
    expect(await screen.findByTestId("bl-noqr")).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
  });
  it("camera refused → the one line + today's photo picker; a photo then works as today", async () => {
    android19({ camera: { reject: "NotAllowedError" } });
    const { onAdd } = blacklist();
    fireEvent.click(screen.getByTestId("bl-reason-notout"));
    fireEvent.click(screen.getByTestId("bl-scan"));
    expect((await screen.findByTestId("bl-scan-camera")).textContent).toContain("Camera is off for SellerFlowLive");
    expect(fileInputClicked("bl-file")).toBe(1);
    expect(m.warm).toHaveBeenCalledTimes(1);
    m.decode.mockResolvedValue("https://tiktok.com/@late.buyer");
    pickPhoto("bl-file");
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("tiktok", "late.buyer", "not_checked_out"));
    expect(screen.queryByTestId("bl-scan-camera")).toBeNull();
  });
  it("'Take a photo instead' → today's photo picker; Close → nothing", async () => {
    android19();
    const { onAdd } = blacklist();
    fireEvent.click(screen.getByTestId("bl-reason-notout"));
    fireEvent.click(screen.getByTestId("bl-scan"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    act(() => { part("wqs-photo").click(); });
    expect(fileInputClicked("bl-file")).toBe(1);
    fireEvent.click(screen.getByTestId("bl-scan"));
    await waitFor(() => expect(phone.tracks.length).toBe(2));
    act(() => { part("wqs-close").click(); });
    expect(fileInputClicked("bl-file")).toBe(1);
    expect(onAdd).not.toHaveBeenCalled();
    expect(allStopped()).toBe(true);
  });
  it("laptop / iPhone / switch off → today's photo picker", async () => {
    for (const setup of [() => setWebQrScannerOn(true), () => { installApp("ios", {}); setWebQrScannerOn(true); }, () => installApp("android", {})]) {
      setup(); phone = installFakePhone();
      blacklist();
      fireEvent.click(screen.getByTestId("bl-reason-notout"));
      fireEvent.click(screen.getByTestId("bl-scan"));
      expect(fileInputClicked("bl-file")).toBe(1);
      expect(phone.getUserMedia).not.toHaveBeenCalled();
      expect(scannerOnScreen()).toBeNull();
      cleanup(); fileClicks.mockClear(); setWebQrScannerOn(false); removeApp(); phone.restore();
    }
  });
  it("a wide screen in the Android app (a tablet) says 'Scan sticker QR'; without the prop the screen is the same as before", () => {
    const realWidth = window.innerWidth;
    const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    try {
      setWidth(1280);
      blacklist({ webScan: true });
      expect(screen.getByTestId("bl-scan").textContent).toBe("Scan sticker QR");
      expect(document.body.textContent).not.toContain("Upload sticker photo");
      expect(document.body.textContent).not.toContain("No camera?");
      cleanup();
      const off = blacklist({ webScan: false }).container.innerHTML;
      expect(screen.getByTestId("bl-scan").textContent).toBe("Upload sticker photo");
      cleanup();
      expect(blacklist().container.innerHTML).toBe(off);
      cleanup();
      setWidth(390);
      const a = blacklist({ webScan: true }).container.innerHTML;
      cleanup();
      expect(blacklist().container.innerHTML).toBe(a); // the phone width: the same screen either way
    } finally { setWidth(realWidth); }
  });
});

// ── Orders ──────────────────────────────────────────────────────────────────────────────────
const order = (over: Partial<Order>): Order => ({
  id: "#23", buyer: "Mei Lin", handle: "@meidolltw", items: "korean dress D", qty: 1,
  total: 899, status: "New", platform: "TikTok", time: "1:24:49 PM", orderNum: 111, date: "2026-11-25", ...over,
});
const lo = (bNum: number, handle: string, item: string, total: number): LiveOrder => ({
  orderNum: 1_700_000_000_000 + bNum * 10 + total, item, qty: 1, price: total, total, time: "1:00 PM", handle, name: handle, bNum, platform: "TikTok", status: "New", date: "2026-11-25",
});
const buyer = (num: number, handle: string, name: string, lines: [string, number][]): Buyer => {
  const orders = lines.map(([item, total]) => lo(num, handle, item, total));
  return { handle, name, platform: "TikTok", num, orders, totalSpent: lines.reduce((s, [, t]) => s + t, 0), totalOrders: orders.length };
};
const BUYERS = [buyer(23, "@meidolltw", "Mei Lin", [["korean dress D", 899], ["150", 150]]), buyer(7, "@yushan_tw", "Yu Shan", [["tumbler B", 350]])];
const ORDERS_ = [order({}), order({ id: "#7", buyer: "Yu Shan", handle: "@yushan_tw", items: "tumbler B", total: 350, orderNum: 222 })];
const orders = (over: Record<string, unknown> = {}) => render(
  <TProvider lang="en">
    <Orders onGoPrint={vi.fn()} cur="NT$" orders={ORDERS_} state="live" todayId="2026-11-25" buyers={BUYERS}
      historyOrders={[]} historyState="live" onEnsureHistory={vi.fn()} onReprintOrder={vi.fn()} {...over} />
  </TProvider>,
);
const searchBox = (c: HTMLElement) => c.querySelector("input.sfl-header-search") as HTMLInputElement;

describe("Orders — the Scan button with the in-page scanner", () => {
  it("webScan → the Scan button is there; the live read puts '@username' in the box and shows that buyer", async () => {
    android19();
    const r = orders({ webScan: true });
    expect(r.getByTestId("ord-scan").textContent).toContain("Scan");
    phone.seen.current = [{ text: "https://www.tiktok.com/@MeiDollTW" }];
    fireEvent.click(r.getByTestId("ord-scan"));
    expect(scannerOnScreen()).toBeTruthy();
    await waitFor(() => expect(searchBox(r.container).value).toBe("@MeiDollTW"));
    expect(r.container.textContent).toContain("Mei Lin");
    expect(scannerOnScreen()).toBeNull();
    expect(allStopped()).toBe(true);
    expect(fileInputClicked("ord-scan-file")).toBe(0);
  });
  it("'Take a photo instead' → the photo picker; the picture goes through the same reader and rule", async () => {
    android19();
    const r = orders({ webScan: true });
    fireEvent.click(r.getByTestId("ord-scan"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    act(() => { part("wqs-photo").click(); });
    expect(fileInputClicked("ord-scan-file")).toBe(1);
    expect(m.warm).toHaveBeenCalledTimes(1);
    m.decode.mockResolvedValue("@yushan_tw");
    pickPhoto("ord-scan-file");
    await waitFor(() => expect(searchBox(r.container).value).toBe("@yushan_tw"));
    expect(r.container.textContent).toContain("Yu Shan");
    m.decode.mockResolvedValue(["@a", "@b"]);
    pickPhoto("ord-scan-file");
    await waitFor(() => expect(r.getByTestId("ord-scan-toast").textContent).toContain("2 stickers in the photo — show only one"));
  });
  it("camera refused → the one line + the photo picker", async () => {
    android19({ camera: { reject: "NotAllowedError" } });
    const r = orders({ webScan: true });
    fireEvent.click(r.getByTestId("ord-scan"));
    await waitFor(() => expect(r.getByTestId("ord-scan-toast").textContent).toContain("Camera is off for SellerFlowLive"));
    expect(fileInputClicked("ord-scan-file")).toBe(1);
  });
  it("Close → nothing changes; leaving Orders switches the camera off", async () => {
    android19();
    const r = orders({ webScan: true });
    fireEvent.click(r.getByTestId("ord-scan"));
    await waitFor(() => expect(phone.tracks.length).toBe(1));
    act(() => { part("wqs-close").click(); });
    expect(searchBox(r.container).value).toBe("");
    expect((r.getByTestId("ord-scan") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(r.getByTestId("ord-scan"));
    await waitFor(() => expect(phone.tracks.length).toBe(2));
    r.unmount();
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("no scanner of either kind → no Scan button and no photo input: today's Orders (same DOM as without the props)", () => {
    const none = orders().container.innerHTML;
    cleanup();
    const off = orders({ webScan: false, liveScan: false });
    expect(off.queryByTestId("ord-scan")).toBeNull();
    expect(off.queryByTestId("ord-scan-file")).toBeNull();
    expect(off.container.innerHTML).toBe(none);
  });
  it("the built-in scanner's Orders (liveScan only) has NO photo input and never asks the page's camera", async () => {
    installApp("ios", { SellerFlowScanner: { scanStickerQr: nativeScan } }); setNativeQrScannerOn(true); setWebQrScannerOn(true); phone = installFakePhone();
    nativeScan.mockResolvedValue({ status: "read", text: "@yushan_tw" });
    const r = orders({ liveScan: true });
    expect(r.queryByTestId("ord-scan-file")).toBeNull();
    fireEvent.click(r.getByTestId("ord-scan"));
    await waitFor(() => expect(searchBox(r.container).value).toBe("@yushan_tw"));
    expect(nativeScan).toHaveBeenCalledTimes(1);
    expect(phone.getUserMedia).not.toHaveBeenCalled();
  });
  it("the button drawn but the switch went off meanwhile → the tap does nothing (no camera, no picker)", () => {
    installApp("android", {}); phone = installFakePhone();
    const r = orders({ webScan: true });
    fireEvent.click(r.getByTestId("ord-scan"));
    expect(phone.getUserMedia).not.toHaveBeenCalled();
    expect(fileInputClicked("ord-scan-file")).toBe(0);
    expect(scannerOnScreen()).toBeNull();
  });
});
