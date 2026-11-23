// Native "Scan sticker QR": when it is used, and how its answer becomes the outcome the screens know.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readQrFromFile = vi.fn();
vi.mock("../qrDecode", () => ({ readQrFromFile: (f: File) => readQrFromFile(f) }));
const track = vi.fn();
vi.mock("../../analytics", () => ({ track: (e: string, p: unknown) => track(e, p) }));

import { nativeQrScanner, nativeScannerAvailable, photoFile, runStickerScan, scannerTexts, setNativeQrScannerOn, SCANNER_TEXT_KEYS } from "../nativeQrScanner";
import { buildT } from "../../i18n";

type W = { Capacitor?: unknown };
const setPlugin = (fn: unknown) => { (window as unknown as W).Capacitor = { Plugins: { SellerFlowScanner: { scanStickerQr: fn } } }; };
const TEXTS = scannerTexts(buildT("en"));

beforeEach(() => { readQrFromFile.mockReset(); track.mockReset(); });
afterEach(() => { setNativeQrScannerOn(false); delete (window as unknown as W).Capacitor; });

describe("nativeQrScanner — when the live scanner is used", () => {
  it("switch off → null, even in a new app build", () => {
    setPlugin(vi.fn());
    expect(nativeQrScanner()).toBeNull();
  });
  it("laptop / web (no Capacitor) → null", () => {
    setNativeQrScannerOn(true);
    expect(nativeQrScanner()).toBeNull();
  });
  it("older app build (no SellerFlowScanner plugin) → null", () => {
    setNativeQrScannerOn(true);
    (window as unknown as W).Capacitor = { Plugins: { SellerFlowPrinter: {} } };
    expect(nativeQrScanner()).toBeNull();
  });
  it("only the exact true turns it on", () => {
    setPlugin(vi.fn());
    for (const v of [1, "true", "yes", null, undefined]) {
      setNativeQrScannerOn(v as never);
      expect(nativeQrScanner()).toBeNull();
    }
  });
  it("new app build + switch on → calls the plugin with the texts", async () => {
    const fn = vi.fn().mockResolvedValue({ status: "cancelled" });
    setPlugin(fn);
    setNativeQrScannerOn(true);
    const scan = nativeQrScanner();
    expect(scan).not.toBeNull();
    await scan!({ texts: TEXTS });
    expect(fn).toHaveBeenCalledWith({ texts: TEXTS });
  });
});

describe("runStickerScan — the answer", () => {
  it("a read QR is handed on VERBATIM", async () => {
    const out = await runStickerScan(async () => ({ status: "read", text: "  https://tiktok.com/@Pedro.123 " }), TEXTS);
    expect(out).toEqual({ kind: "one", text: "  https://tiktok.com/@Pedro.123 " });
    expect(readQrFromFile).not.toHaveBeenCalled();
  });
  it("an empty read is a failure, not a QR", async () => {
    expect(await runStickerScan(async () => ({ status: "read", text: "" }), TEXTS)).toEqual({ kind: "failed" });
  });
  it("a photo goes through today's readQrFromFile", async () => {
    readQrFromFile.mockResolvedValue({ kind: "many", count: 2, diag: {} });
    const data = btoa("\xff\xd8\xff\xe0fakejpeg");
    const out = await runStickerScan(async () => ({ status: "photo", data, mime: "image/jpeg" }), TEXTS);
    expect(out).toEqual({ kind: "many", count: 2, diag: {} });
    const file = readQrFromFile.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(12);
  });
  it("a photo that can't be opened → today's 'No QR found' (none), never 'failed' or 'cancelled'", async () => {
    // the phone says it (iPhone: an iCloud-only photo while offline; Android: an unreadable file)
    expect(await runStickerScan(async () => ({ status: "error", code: "photo_unreadable" }), TEXTS)).toEqual({ kind: "none", reason: "image_unreadable" });
    // or the picture data itself is broken
    expect(await runStickerScan(async () => ({ status: "photo", data: "!!!not base64", mime: "image/jpeg" }), TEXTS)).toEqual({ kind: "none", reason: "image_unreadable" });
    expect(await runStickerScan(async () => ({ status: "photo", data: "", mime: "image/jpeg" }), TEXTS)).toEqual({ kind: "none", reason: "image_unreadable" });
    expect(readQrFromFile).not.toHaveBeenCalled();
    expect(track.mock.calls.map((c) => (c[1] as { result: string }).result)).toEqual(["photo_unreadable", "photo_unreadable", "photo_unreadable"]);
  });
  it("cancelled / busy → cancelled (nothing happens on the screen)", async () => {
    expect(await runStickerScan(async () => ({ status: "cancelled" }), TEXTS)).toEqual({ kind: "cancelled" });
    expect(await runStickerScan(async () => ({ status: "busy" }), TEXTS)).toEqual({ kind: "cancelled" });
  });
  it("a throw or an odd answer → failed (never throws)", async () => {
    expect(await runStickerScan(async () => { throw new Error("x"); }, TEXTS)).toEqual({ kind: "failed" });
    expect(await runStickerScan(async () => null, TEXTS)).toEqual({ kind: "failed" });
    expect(await runStickerScan(async () => ({ status: "error", code: "no_camera" }), TEXTS)).toEqual({ kind: "failed" });
  });
  it("the scan event never carries the QR text", async () => {
    await runStickerScan(async () => ({ status: "read", text: "secret_buyer" }), TEXTS);
    expect(track).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(track.mock.calls[0])).not.toContain("secret_buyer");
    expect(track.mock.calls[0][0]).toBe("qr_native");
  });
});

describe("nativeScannerAvailable (the Orders Scan button)", () => {
  it("only with the scanner in the app build AND the switch on", () => {
    expect(nativeScannerAvailable(true)).toBe(false); // laptop / older app build
    expect(nativeScannerAvailable(false)).toBe(false);
    (window as unknown as W).Capacitor = { Plugins: { SellerFlowScanner: { scanStickerQr: async () => ({}) } } };
    expect(nativeScannerAvailable(true)).toBe(true);
    expect(nativeScannerAvailable(false)).toBe(false); // switch off
    expect(nativeScannerAvailable("true" as unknown as boolean)).toBe(false);
    (window as unknown as W).Capacitor = { Plugins: { SellerFlowScanner: { scanStickerQr: "x" } } };
    expect(nativeScannerAvailable(true)).toBe(false);
  });
});

describe("photoFile", () => {
  it("png keeps its type, an odd type becomes jpeg, a data: prefix is read", () => {
    expect(photoFile(btoa("png"), "image/png")!.type).toBe("image/png");
    expect(photoFile(btoa("x"), "text/html")!.type).toBe("image/jpeg");
    expect(photoFile(`data:image/jpeg;base64,${btoa("abc")}`, "image/jpeg")!.size).toBe(3);
    expect(photoFile("", "image/jpeg")).toBeNull();
    expect(photoFile(5, "image/jpeg")).toBeNull();
  });
});

describe("scanner texts — every language", () => {
  it("all 14 texts are filled in all 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const t = buildT(lang);
      for (const key of Object.values(SCANNER_TEXT_KEYS)) expect(t[key], `${lang} ${key}`).toBeTruthy();
      expect(t.rd_qrs_failed, lang).toBeTruthy();
      expect(t.rd_ord_scan, lang).toBeTruthy();
      expect(t.rd_ord_scan_none, lang).toContain("{u}");
    }
  });
  it("English is Jeff's wording", () => {
    expect(TEXTS.title).toBe("Scan sticker QR");
    expect(TEXTS.hint).toBe("Point at the QR on the sticker");
    expect(TEXTS.photo).toBe("Take a photo instead");
    expect(TEXTS.one).toBe("Point at one QR");
    expect(TEXTS.camOff).toBe("Camera is off for SellerFlowLive");
    expect(TEXTS.fullScreen).toBe("Use SellerFlowLive full screen to scan");
  });
});
