// Router branch + "Classic text mode" toggle + method-presence gating for the
// BITMAP sticker path. The three contractual behaviors:
//   1. bitmap DEFAULT: bridge has printStickerBitmap + toggle off → the bitmap
//      passthrough gets the pre-built TSPL (base64), TEXT path NOT called.
//   2. classic toggle ON → the unchanged TEXT path (printStickerNative) fires.
//   3. OLD BINARY (no printStickerBitmap) → TEXT path fires (safe no-op rollout).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printSlip, isClassicTextSticker, setClassicTextSticker, LS_CLASSIC_TEXT, DEF_SETTINGS, getLastStickerTiming, type Settings } from "../printing";
import { buildTestBuyer } from "../printerBridge";

const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
const buyer = buildTestBuyer();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

type W = { SellerFlowPrinter?: unknown };

describe("printSlip bitmap routing", () => {
  beforeEach(() => { localStorage.removeItem(LS_CLASSIC_TEXT); });
  afterEach(() => { delete (window as W).SellerFlowPrinter; localStorage.removeItem(LS_CLASSIC_TEXT); });

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
