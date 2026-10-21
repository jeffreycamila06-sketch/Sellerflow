// Printer setup v2 — real orders on a saved GENERIC printer, and the no-resend rule:
//   generic + "tspl"   → the TEXT sticker (printStickerNative), never the D520 SDK image stream
//   generic + "escpos" → ONE ESC/POS raster through the raw-bytes passthrough (printRawTspl)
//   D520BT / nothing learned → the unchanged bitmap default
// A print that resolves {ok:true} with no PRINTING:DONE counts as sent: exactly ONE bridge call.
import { describe, it, expect, vi, afterEach } from "vitest";
import { printSlip, printsStickerViaImage, getLastStickerRouteNotice, DEF_SETTINGS, type Settings } from "../printing";
import { buildTestBuyer, btCall, type BluetoothScanResult } from "../printerBridge";
import { rememberSavedPrinter, savedGenericLang, __resetSavedPrinter } from "../savedPrinter";

const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
const buyer = buildTestBuyer();
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
type W = { SellerFlowPrinter?: unknown };

function bridge() {
  const b = {
    printStickerNative: vi.fn().mockResolvedValue({ ok: true, confirmed: false }), // generic printers send no PRINTING:DONE
    printStickerBitmap: vi.fn().mockResolvedValue({ ok: true }),
    printRawTspl: vi.fn().mockResolvedValue({ ok: true, confirmed: false }),
  };
  (window as W).SellerFlowPrinter = b;
  return b;
}
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetSavedPrinter(); });

describe("saved generic printer routing", () => {
  it("tspl → TEXT sticker once; the D520 image stream never; no resend", async () => {
    const b = bridge();
    rememberSavedPrinter({ address: "BB:BB", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" });
    expect(printsStickerViaImage(cfg)).toBe(false);
    expect(printSlip(buyer, "NT$", "Store", cfg)).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(b.printStickerNative).toHaveBeenCalledTimes(1);
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(getLastStickerRouteNotice()).toMatchObject({ via: "text", ok: true, reason: "generic-tspl" });
  });

  it("escpos → ONE ESC/POS raster through the raw passthrough; text + bitmap never; no resend", async () => {
    const b = bridge();
    rememberSavedPrinter({ address: "DD:DD", name: "LabelThing-9", model: "generic", lang: "escpos" });
    expect(printSlip(buyer, "NT$", "Store", cfg)).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(b.printRawTspl).toHaveBeenCalledTimes(1);
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
    const bytes = Buffer.from((b.printRawTspl.mock.calls[0][0] as { data: string }).data, "base64");
    expect(Array.from(bytes.subarray(0, 6))).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00]); // ESC @ + GS v 0
    expect(Array.from(bytes.subarray(-3))).toEqual([0x1b, 0x64, 0x03]);                   // ESC d 3
    expect(bytes.includes(Buffer.from("SIZE "))).toBe(false); // no TSPL at all
    expect(getLastStickerRouteNotice()).toMatchObject({ via: "bitmap", ok: true, reason: "generic-escpos" });
  });

  it("escpos print failure is reported once and never retried on another path", async () => {
    const b = bridge();
    b.printRawTspl.mockRejectedValue(Object.assign(new Error("Printer disconnected during printing."), { code: "BT_PRINT_FAILED" }));
    rememberSavedPrinter({ address: "DD:DD", name: "LabelThing-9", model: "generic", lang: "escpos" });
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printRawTspl).toHaveBeenCalledTimes(1);
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
    expect(getLastStickerRouteNotice()).toMatchObject({ ok: false, reason: "generic-escpos" });
  });

  it("D520BT saved (or nothing learned) → the unchanged bitmap default", async () => {
    const b = bridge();
    rememberSavedPrinter({ address: "AA:AA", name: "D520BT-Z" });
    expect(savedGenericLang()).toBeNull();
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printStickerBitmap).toHaveBeenCalledTimes(1);
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printRawTspl).not.toHaveBeenCalled();
  });

  it("a Phase-1 generic save with no language = tspl", () => {
    rememberSavedPrinter({ address: "BB:BB", name: "Y41BT-0FC4_LE", model: "generic" });
    expect(savedGenericLang()).toBe("tspl");
  });
});

describe("the native answer is remembered", () => {
  it("every bridge answer carrying savedPrinter updates the router (set / get / clear)", async () => {
    (window as W).SellerFlowPrinter = {
      setBluetoothLabelPrinter: vi.fn(async (p: Record<string, unknown>) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
      getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: { address: "AA:AA", name: "D520BT-Z" } })),
      clearBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    };
    await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", { address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", lang: "escpos" });
    expect(savedGenericLang()).toBe("escpos");
    await btCall<BluetoothScanResult>("getBluetoothLabelPrinter");
    expect(savedGenericLang()).toBeNull();
    await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", { address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", lang: "tspl" });
    expect(savedGenericLang()).toBe("tspl");
    await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter");
    expect(savedGenericLang()).toBeNull();
  });
  it("survives a cold open: nothing learned yet → the last stored native answer routes", () => {
    __resetSavedPrinter(); // memory empty (a fresh app open)
    localStorage.setItem("sfl_rd_bt_printer", JSON.stringify({ address: "DD:DD", name: "LabelThing-9", model: "generic", lang: "escpos" }));
    expect(savedGenericLang()).toBe("escpos");
    rememberSavedPrinter({ address: "AA:AA", name: "D520BT-Z" }); // the native answer arrives → it wins
    expect(savedGenericLang()).toBeNull();
    expect(localStorage.getItem("sfl_rd_bt_printer")).toContain("D520BT-Z");
  });
});
