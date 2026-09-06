// Router branch + "Classic text mode" toggle + method-presence gating for the
// BITMAP sticker path. The three contractual behaviors:
//   1. bitmap DEFAULT: bridge has printStickerBitmap + toggle off → the bitmap
//      passthrough gets the pre-built TSPL (base64), TEXT path NOT called.
//   2. classic toggle ON → the unchanged TEXT path (printStickerNative) fires.
//   3. OLD BINARY (no printStickerBitmap) → TEXT path fires (safe no-op rollout).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printSlip, isClassicTextSticker, setClassicTextSticker, setStickerRouteNoticeHandler, getLastStickerRouteNotice, LS_CLASSIC_TEXT, DEF_SETTINGS, getLastStickerTiming, type Settings, type StickerRouteNotice } from "../printing";
import { buildTestBuyer } from "../printerBridge";

const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
const buyer = buildTestBuyer();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

type W = { SellerFlowPrinter?: unknown; Capacitor?: unknown };

describe("printSlip bitmap routing", () => {
  beforeEach(() => { localStorage.removeItem(LS_CLASSIC_TEXT); });
  afterEach(() => {
    delete (window as W).SellerFlowPrinter;
    delete (window as W).Capacitor;
    localStorage.removeItem(LS_CLASSIC_TEXT);
    setStickerRouteNoticeHandler(null);
  });

  it("default = BITMAP when the native passthrough exists (TEXT not called)", async () => {
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
    // the passthrough receives a base64 TSPL stream that decodes to SIZE…PRINT 1
    const arg = bitmap.mock.calls[0][0] as { data: string };
    const bytes = Buffer.from(arg.data, "base64");
    expect(bytes.slice(0, 15).toString("ascii")).toBe("SIZE 100 mm, 60");
    expect(bytes.slice(-9).toString("ascii")).toBe("PRINT 1\r\n");
    expect(bytes.includes(Buffer.from("BITMAP "))).toBe(true);
    // and NO TEXT commands — the whole point (new-board ROM fonts bypassed)
    expect(bytes.includes(Buffer.from("TEXT "))).toBe(false);
    // timing instrumentation recorded the bitmap send
    expect(getLastStickerTiming()?.via).toBe("bitmap");
    expect(getLastStickerTiming()?.payloadBytes).toBe(bytes.length);
  });

  it("Classic text mode ON → the unchanged TEXT path fires", async () => {
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    setClassicTextSticker(true);
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
    expect(bitmap).not.toHaveBeenCalled();
  });

  it("old binary (no printStickerBitmap) → TEXT path (method-presence gate)", async () => {
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("bitmap reject with BT_NOT_SET routes through the no-printer failure handler", async () => {
    const bitmap = vi.fn().mockRejectedValue({ code: "BT_NOT_SET", message: "No Bluetooth printer saved." });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r.via).toBe("bluetooth");
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("STALE-SHIM HARDENING: shim method absent but Capacitor.Plugins proxy has it → BITMAP still fires", async () => {
    // The MainActivity-injected shim missed a method twice (printRawTspl, then a
    // stale native build). Capacitor's auto-generated Plugins proxy exposes every
    // @PluginMethod with no shim — the gate must find it there as a second probe.
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native }; // stale shim: no printStickerBitmap
    (window as W).Capacitor = { Plugins: { SellerFlowPrinter: { printStickerBitmap: bitmap } } };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });

  it("ROUTE NOTICE: bitmap success reports via/ok/bytes to the registered handler", async () => {
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(notices).toHaveLength(1);
    expect(notices[0].via).toBe("bitmap");
    expect(notices[0].ok).toBe(true);
    expect(notices[0].payloadBytes).toBeGreaterThan(0);
    expect(getLastStickerRouteNotice()).toEqual(notices[0]);
  });

  it("ROUTE NOTICE: method-missing fallback reports TEXT + reason bitmap-method-missing", async () => {
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native }; // no bitmap method anywhere
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ via: "text", ok: true, reason: "bitmap-method-missing" });
  });

  it("ROUTE NOTICE: classic-mode fallback reports TEXT + reason classic-mode-on", async () => {
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: vi.fn() };
    setClassicTextSticker(true);
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
    expect(notices[0]).toMatchObject({ via: "text", ok: true, reason: "classic-mode-on" });
  });

  it("ROUTE NOTICE: a throwing handler never breaks the print", async () => {
    setStickerRouteNoticeHandler(() => { throw new Error("boom"); });
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r.ok).toBe(true);
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(getLastStickerRouteNotice()?.via).toBe("bitmap"); // recorded despite the throw
  });

  it("toggle helpers round-trip via localStorage", () => {
    expect(isClassicTextSticker()).toBe(false);
    setClassicTextSticker(true);
    expect(localStorage.getItem(LS_CLASSIC_TEXT)).toBe("1");
    expect(isClassicTextSticker()).toBe(true);
    setClassicTextSticker(false);
    expect(localStorage.getItem(LS_CLASSIC_TEXT)).toBe(null);
    expect(isClassicTextSticker()).toBe(false);
  });
});
