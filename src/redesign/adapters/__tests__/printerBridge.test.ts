// Printer bridge — parity tests for the normalization + web/preview no-op behavior.
// (App.tsx callMobilePrinterBridge 454-473 + btCall 2051-2057.)
import { describe, it, expect, afterEach, vi } from "vitest";
import { normalizeBridgeResult, callMobilePrinterBridge, btCall, hasNativePrinter, hasBtBridge } from "../printerBridge";

describe("normalizeBridgeResult — verbatim from App.tsx:464-470", () => {
  it("parses JSON strings", () => {
    expect(normalizeBridgeResult('{"ok":true,"host":"1.2.3.4"}')).toEqual({ ok: true, host: "1.2.3.4" });
  });
  it("non-JSON string → ok inferred from keywords", () => {
    expect(normalizeBridgeResult("Printed to LAN")).toEqual({ ok: true, message: "Printed to LAN" });
    expect(normalizeBridgeResult("totally broken")).toEqual({ ok: false, message: "totally broken" });
  });
  it("object passthrough; void → generic ok", () => {
    expect(normalizeBridgeResult({ ok: false, message: "x" })).toEqual({ ok: false, message: "x" });
    expect(normalizeBridgeResult(undefined)).toEqual({ ok: true, message: "Printer command sent" });
  });
});

describe("web/preview — no native bridge", () => {
  afterEach(() => { delete (window as { SellerFlowPrinter?: unknown }).SellerFlowPrinter; });
  it("hasNativePrinter / hasBtBridge are false without the plugin", () => {
    expect(hasNativePrinter()).toBe(false);
    expect(hasBtBridge()).toBe(false);
  });
  it("callMobilePrinterBridge returns the friendly 'open the app' result (no throw)", async () => {
    const r = await callMobilePrinterBridge("getPrinter");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/mobile app/i);
  });
  it("btCall returns null when the bridge method is absent", async () => {
    expect(await btCall("scanBluetoothLabelPrinters")).toBeNull();
  });
});

describe("with a stubbed native bridge", () => {
  afterEach(() => { delete (window as { SellerFlowPrinter?: unknown }).SellerFlowPrinter; vi.restoreAllMocks(); });
  it("routes setPrinter with the config + normalizes the result", async () => {
    const setPrinter = vi.fn().mockResolvedValue({ ok: true, host: "10.0.0.5", port: 9100 });
    (window as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = { setPrinter };
    const r = await callMobilePrinterBridge("setPrinter", { host: "10.0.0.5", port: 9100 });
    expect(setPrinter).toHaveBeenCalledWith({ host: "10.0.0.5", port: 9100 });
    expect(r).toMatchObject({ ok: true, host: "10.0.0.5" });
  });
  it("btCall invokes the bridge method + returns its result", async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true, printers: [{ id: "1", address: "AA", name: "D520" }] });
    (window as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = { scanBluetoothLabelPrinters: scan };
    const r = await btCall<{ printers: unknown[] }>("scanBluetoothLabelPrinters");
    expect(scan).toHaveBeenCalled();
    expect(r?.printers).toHaveLength(1);
  });
  it("catches a throwing bridge call → ok:false", async () => {
    (window as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = { testPrint: vi.fn().mockRejectedValue(new Error("boom")) };
    expect((await callMobilePrinterBridge("testPrint"))).toMatchObject({ ok: false, message: "boom" });
  });
  it("btCall SURFACES a native reject (message + code) instead of null — the 'check pairing' blindfold", async () => {
    // BEHAVIORAL pin of the 2026-07-16 diagnosis gap: a Capacitor call.reject
    // used to become `null`, so every screen showed only the generic failure
    // toast. Now the real message/code reach the caller.
    const reject = vi.fn().mockRejectedValue({ message: "Phase 0 P1 failed: Printer not found.", code: "BT_NOT_FOUND" });
    (window as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = { printStickerNative: reject };
    const r = await btCall<{ ok: boolean; message: string; code?: string }>("printStickerNative", { isTest: true });
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ ok: false, message: "Phase 0 P1 failed: Printer not found.", code: "BT_NOT_FOUND" });
  });
});

describe("buildTestStickerPayload — isTest tag (Phomemo Phase 0 routing)", () => {
  it("tags the test payload isTest:true and keeps the sticker payload fields intact", async () => {
    const { buildTestStickerPayload } = await import("../printerBridge");
    const { DEF_SETTINGS } = await import("../printing");
    const p = buildTestStickerPayload("NT$", "My Shop", DEF_SETTINGS) as Record<string, unknown>;
    expect(p.isTest).toBe(true);                    // the native 241 branch routes on this
    expect(p.storeName).toBe("My Shop");            // underlying payload unchanged (AIMO ignores isTest)
    expect(p.labelWidthMm).toBe(100);
    expect(p.labelHeightMm).toBe(60);
    expect((p.buyer as { num: number }).num).toBe(88);
  });
});
