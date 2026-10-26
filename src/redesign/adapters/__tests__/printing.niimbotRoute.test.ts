// Printer setup v2 Part 8 — Niimbot (vendor-SDK driver). A saved printer with transport
// "niimbot" prints the sticker IMAGE through the native driver (printStickerImage), ALWAYS
// the 50×30 layout; every other saved printer keeps its route (generic language paths,
// D520BT image stream). Saved-printer round-trip: the native answer carrying transport
// "niimbot" is remembered, survives a cold open, and is cleared with the printer.
import { describe, it, expect, vi, afterEach } from "vitest";
import { printSlip, printsStickerViaImage, buildNiimbotImage, buildNativeStickerPayload, getLastStickerRouteNotice, niimbotErrorKey, DEF_SETTINGS, type Settings } from "../printing";
import { buildTestBuyer, btCall, hasNiimbotBridge, type BluetoothScanResult } from "../printerBridge";
import { rememberSavedPrinter, savedBtPrinter, savedIsNiimbot, savedGenericLang, __resetSavedPrinter } from "../savedPrinter";

vi.mock("../cjkAtlasLoader", () => ({ loadCjkAtlas: vi.fn(async () => ({})), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
// The font-C atlases are real dynamic imports (slow); a failed load = the fixed-cell layout, which is what these ROUTE tests look at.
vi.mock("../propAtlasLoader", () => ({ loadPropAtlas: vi.fn(async () => { throw new Error("no font C in this test"); }), loadCjkRegAtlas: vi.fn(async () => { throw new Error("no font C in this test"); }) }));

const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "60x40" };
const buyer = buildTestBuyer();
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
type W = { SellerFlowPrinter?: unknown };
type Img = { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number };
const NIIMBOT = { address: "NN:NN", name: "B1-I603042141", model: "generic", transport: "niimbot" };

function bridge(withDriver = true) {
  const b: Record<string, ReturnType<typeof vi.fn>> = {
    printStickerNative: vi.fn().mockResolvedValue({ ok: true, confirmed: false }),
    printStickerBitmap: vi.fn().mockResolvedValue({ ok: true }),
    printRawTspl: vi.fn().mockResolvedValue({ ok: true, confirmed: false }),
  };
  if (withDriver) b.printStickerImage = vi.fn().mockResolvedValue({ ok: true, confirmed: true });
  (window as W).SellerFlowPrinter = b;
  return b;
}
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetSavedPrinter(); });

describe("transport selection", () => {
  it("transport niimbot → ONE printStickerImage with the 50×30 image; no language path, no D520 stream", async () => {
    const b = bridge();
    rememberSavedPrinter(NIIMBOT);
    expect(savedIsNiimbot()).toBe(true);
    expect(printsStickerViaImage(cfg)).toBe(true);
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printStickerImage).toHaveBeenCalledTimes(1);
    const { image } = b.printStickerImage.mock.calls[0][0] as { image: Img };
    // 50×30 label, image = the SDK frame's dots (48×28 mm × 8 = 384×224) even though the seller's sticker size is 60×40
    expect([image.w, image.h, image.rowBytes, image.labelWidthMm, image.labelHeightMm]).toEqual([384, 224, 48, 50, 30]);
    expect(Buffer.from(image.data, "base64")).toHaveLength(48 * 224);
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
    expect(getLastStickerRouteNotice()?.reason).toBe("niimbot");
  });

  it("generic BLE / classic / D520BT saves never touch the Niimbot driver", async () => {
    const b = bridge();
    rememberSavedPrinter({ address: "BB:BB", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl", transport: "ble" });
    expect(savedIsNiimbot()).toBe(false);
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printRawTspl).toHaveBeenCalledTimes(1);
    rememberSavedPrinter({ address: "EE:EE", name: "XP-P323B", model: "generic", lang: "escpos", transport: "spp" });
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printRawTspl).toHaveBeenCalledTimes(2);
    rememberSavedPrinter({ address: "AA:AA", name: "D520BT-Z", transport: "ble" });
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printStickerBitmap).toHaveBeenCalledTimes(1);
    expect(b.printStickerImage).not.toHaveBeenCalled();
  });

  it("a Niimbot failure keeps the driver's code, is reported once, and is never retried on another path", async () => {
    const b = bridge();
    b.printStickerImage.mockRejectedValueOnce({ code: "NIIMBOT_NO_PAPER", message: "Printer error 2" });
    rememberSavedPrinter(NIIMBOT);
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printStickerImage).toHaveBeenCalledTimes(1);
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
    const n = getLastStickerRouteNotice();
    expect(n?.ok).toBe(false);
    expect(n?.reason).toBe("niimbot");
    expect(n?.detail).toBe("Printer error 2");
  });

  it("buildNiimbotImage ignores the seller's sticker size — the label is 50×30", async () => {
    const p = buildNativeStickerPayload(buyer, "NT$", "Store", { ...DEF_SETTINGS, stickerSize: "100x60" });
    const img = await buildNiimbotImage(p, "TikTok");
    expect([img.w, img.h, img.rowBytes, img.labelWidthMm, img.labelHeightMm]).toEqual([384, 224, 48, 50, 30]);
    expect(Buffer.from(img.data, "base64").some((v) => v !== 0)).toBe(true); // ink present (the fixed-cell fallback here, centred-cropped to the frame)
  });

  it("seller-level codes map to plain words; everything else is the usual print-failed wording", () => {
    expect(niimbotErrorKey("NIIMBOT_NO_PAPER")).toBe("rd_nb_no_paper");
    expect(niimbotErrorKey("NIIMBOT_COVER_OPEN")).toBe("rd_nb_cover_open");
    expect(niimbotErrorKey("NIIMBOT_PAPER_TYPE")).toBe("rd_nb_paper_type");
    expect(niimbotErrorKey("NIIMBOT_LOW_BATTERY")).toBe("rd_nb_low_battery");
    expect(niimbotErrorKey("NIIMBOT_OS_TOO_OLD")).toBe("rd_nb_os_too_old"); // iOS < 17.2 (the driver framework is never loaded)
    expect(niimbotErrorKey("NIIMBOT_UNAVAILABLE")).toBe("rd_nb_os_too_old"); // the framework could not be loaded
    expect(niimbotErrorKey("BT_NOT_FOUND")).toBeNull();
    expect(niimbotErrorKey("NIIMBOT_ERROR")).toBeNull();
    expect(niimbotErrorKey("")).toBeNull();
  });
});

describe("saved-printer round-trip", () => {
  it("the native answer with transport niimbot is remembered, survives a cold open, and is cleared", async () => {
    const b = bridge();
    b.setBluetoothLabelPrinter = vi.fn().mockResolvedValue({ ok: true, savedPrinter: { ...NIIMBOT, paired: true } });
    b.clearBluetoothLabelPrinter = vi.fn().mockResolvedValue({ ok: true, savedPrinter: null });
    await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", NIIMBOT);
    expect(savedBtPrinter()).toEqual(NIIMBOT);
    expect(savedIsNiimbot()).toBe(true);
    expect(savedGenericLang()).toBe("tspl"); // the model is generic too — the route checks niimbot FIRST
    // cold open: nothing learned yet → the stored native answer routes
    __resetSavedPrinter();
    localStorage.setItem("sfl_rd_bt_printer", JSON.stringify(NIIMBOT));
    expect(savedIsNiimbot()).toBe(true);
    await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter");
    expect(savedIsNiimbot()).toBe(false);
    expect(savedBtPrinter()).toBeNull();
  });

  it("hasNiimbotBridge = the native printStickerImage method", () => {
    bridge(false);
    expect(hasNiimbotBridge()).toBe(false);
    bridge(true);
    expect(hasNiimbotBridge()).toBe(true);
  });
});
