// Printer setup v2 — real orders on a saved GENERIC printer ALWAYS print the sticker IMAGE in
// the saved language, through the raw-bytes passthrough (printRawTspl), ONE call, no resend:
//   tspl   → standard TSPL BITMAP mode-0 bands (never the TEXT builder — the Y41BT "blank
//            Chinese name" bug — and never the D520-only SDK image stream)
//   escpos → ESC @ + GS v 0 raster
//   cpcl   → ! 0 200 200 … EG … FORM PRINT
// A D520BT / nothing learned → the unchanged bitmap default.
import { describe, it, expect, vi, afterEach } from "vitest";
import { printSlip, printsStickerViaImage, getLastStickerRouteNotice, buildGenericStickerBytes, buildNativeStickerPayload, DEF_SETTINGS, type Settings } from "../printing";
import { buildTestBuyer, btCall, type BluetoothScanResult } from "../printerBridge";
import { rememberSavedPrinter, savedGenericLang, __resetSavedPrinter } from "../savedPrinter";
import { loadCjkAtlas } from "../cjkAtlasLoader";

vi.mock("../cjkAtlasLoader", () => ({
  loadCjkAtlas: vi.fn(async () => ({ cjk: { w: 24, h: 24, glyphs: { 0x9673: Buffer.alloc(72, 0xff).toString("base64"), 0x7f8e: Buffer.alloc(72, 0xff).toString("base64") } } })),
  prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null,
}));

const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
const buyer = buildTestBuyer();
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
type W = { SellerFlowPrinter?: unknown };
const sent = (fn: ReturnType<typeof vi.fn>) => Buffer.from((fn.mock.calls[0][0] as { data: string }).data, "base64");

function bridge() {
  const b = {
    printStickerNative: vi.fn().mockResolvedValue({ ok: true, confirmed: false }),
    printStickerBitmap: vi.fn().mockResolvedValue({ ok: true }),
    printRawTspl: vi.fn().mockResolvedValue({ ok: true, confirmed: false }), // generic printers send no PRINTING:DONE
  };
  (window as W).SellerFlowPrinter = b;
  return b;
}
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetSavedPrinter(); vi.mocked(loadCjkAtlas).mockClear(); });

describe("saved generic printer routing", () => {
  it("tspl → ONE raw TSPL BITMAP job; TEXT builder + D520 image stream never; no resend", async () => {
    const b = bridge();
    rememberSavedPrinter({ address: "BB:BB", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" });
    expect(printsStickerViaImage(cfg)).toBe(true);
    expect(printSlip(buyer, "NT$", "Store", cfg)).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(b.printRawTspl).toHaveBeenCalledTimes(1);
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
    const bytes = sent(b.printRawTspl);
    expect(bytes.subarray(0, 18).toString("ascii")).toBe("SIZE 100 mm, 60 mm"); // standard TSPL preamble (mode-0 path)
    expect(bytes.includes(Buffer.from("BITMAP 0,"))).toBe(true);                 // full-width mode-0 bands
    expect(bytes.includes(Buffer.from("TEXT "))).toBe(false);                    // no printer-font text at all
    expect(bytes.includes(Buffer.from("BITMAP 4,0,"))).toBe(false);              // not the D520-only LZO stream
    expect(bytes.subarray(-9).toString("ascii")).toBe("PRINT 1\r\n");
    expect(getLastStickerRouteNotice()).toMatchObject({ via: "bitmap", ok: true, reason: "generic-tspl" });
  });

  it("a saved XP-420B and a saved Y41BT print the BITMAP job with SPEED 2 + DENSITY 15 and bold ink; an unknown generic printer keeps today's header AND today's body bytes", async () => {
    const header = (bytes: Buffer) => bytes.subarray(0, bytes.indexOf(Buffer.from("CLS\r\n"))).toString("ascii");
    const body = (bytes: Buffer) => bytes.subarray(header(bytes).length);
    const print = async (saved: { address: string; name: string }) => {
      delete (window as W).SellerFlowPrinter; __resetSavedPrinter();
      const b = bridge();
      rememberSavedPrinter({ ...saved, model: "generic", lang: "tspl" });
      printSlip(buyer, "NT$", "Store", cfg);
      await flush();
      return sent(b.printRawTspl);
    };
    const xp = await print({ address: "FF:FF", name: "XP-420B" });
    expect(header(xp)).toBe("SIZE 100 mm, 60 mm\r\nGAP 2 mm, 0\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nSPEED 2\r\nDENSITY 15\r\n");
    expect(xp.includes(Buffer.from("BITMAP 0,"))).toBe(true);
    const y41 = await print({ address: "BB:BB", name: "Y41BT-0FC4_LE" });
    expect(header(y41)).toBe(header(xp).replace("100 mm, 60 mm", "100 mm, 60 mm"));
    expect(Buffer.compare(body(xp), body(y41))).toBe(0); // same model settings → same (bold) body
    // a printer with no settings = exactly the bytes buildGenericStickerBytes makes with no job
    const other = await print({ address: "CC:CC", name: "LabelThing-9" });
    expect(header(other)).toBe("SIZE 100 mm, 60 mm\r\nGAP 2 mm, 0\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nDENSITY 8\r\n");
    const plain = Buffer.from(await buildGenericStickerBytes("tspl", buildNativeStickerPayload(buyer, "NT$", "Store", cfg), buyer.platform));
    expect(Buffer.compare(other, plain)).toBe(0);
    // bold changed the body (heavier ink), nothing else
    expect(Buffer.compare(body(xp), body(plain))).not.toBe(0);
    expect(xp.length).toBe(plain.length + "SPEED 2\r\n".length + 1); // same bands, same sizes (DENSITY 15 is one char longer)
  });

  it("a Chinese buyer name on a generic tspl printer loads the CJK atlas (drawn as image, not blank)", async () => {
    const b = bridge();
    rememberSavedPrinter({ address: "BB:BB", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" });
    printSlip({ ...buyer, name: "陳美" }, "NT$", "Store", cfg);
    await flush();
    expect(loadCjkAtlas).toHaveBeenCalledTimes(1);
    expect(b.printRawTspl).toHaveBeenCalledTimes(1);
    expect(sent(b.printRawTspl).includes(Buffer.from("BITMAP 0,"))).toBe(true);
  });

  it("escpos → ONE ESC/POS raster; cpcl → ONE CPCL label; text + bitmap never", async () => {
    for (const [lang, head, tail] of [["escpos", [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00], [0x1b, 0x64, 0x03]], ["cpcl", Array.from(Buffer.from("! 0 200 200 480 1\r\n")), Array.from(Buffer.from("FORM\r\nPRINT\r\n"))]] as const) {
      const b = bridge();
      rememberSavedPrinter({ address: "DD:DD", name: "LabelThing-9", model: "generic", lang });
      expect(printSlip(buyer, "NT$", "Store", cfg)).toEqual({ ok: true, via: "bluetooth" });
      await flush();
      expect(b.printRawTspl).toHaveBeenCalledTimes(1);
      expect(b.printStickerNative).not.toHaveBeenCalled();
      expect(b.printStickerBitmap).not.toHaveBeenCalled();
      const bytes = sent(b.printRawTspl);
      expect(Array.from(bytes.subarray(0, head.length))).toEqual([...head]);
      expect(Array.from(bytes.subarray(-tail.length))).toEqual([...tail]);
      expect(bytes.includes(Buffer.from("SIZE "))).toBe(false);
      expect(getLastStickerRouteNotice()).toMatchObject({ via: "bitmap", ok: true, reason: `generic-${lang}` });
      delete (window as W).SellerFlowPrinter; __resetSavedPrinter();
    }
  });

  it("a generic print failure is reported once and never retried on another path", async () => {
    const b = bridge();
    b.printRawTspl.mockRejectedValue(Object.assign(new Error("Printer disconnected during printing."), { code: "BT_PRINT_FAILED" }));
    rememberSavedPrinter({ address: "DD:DD", name: "LabelThing-9", model: "generic", lang: "tspl" });
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(b.printRawTspl).toHaveBeenCalledTimes(1);
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
    expect(getLastStickerRouteNotice()).toMatchObject({ ok: false, reason: "generic-tspl" });
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
    expect(sent(b.printStickerBitmap).includes(Buffer.from("BITMAP 4,0,"))).toBe(true); // the D520 SDK stream, as before
  });

  it("a Phase-1 generic save with no language = tspl; a classic (spp) generic save routes the same", () => {
    rememberSavedPrinter({ address: "BB:BB", name: "Y41BT-0FC4_LE", model: "generic" });
    expect(savedGenericLang()).toBe("tspl");
    rememberSavedPrinter({ address: "EE:EE", name: "XP-P323B", model: "generic", lang: "escpos", transport: "spp" });
    expect(savedGenericLang()).toBe("escpos");
  });

  it("buildGenericStickerBytes: tspl bytes are the golden mode-0 stream shape for the same payload", async () => {
    const p = buildNativeStickerPayload(buyer, "NT$", "Store", { ...DEF_SETTINGS, stickerSize: "60x40" });
    const tspl = await buildGenericStickerBytes("tspl", p, "TikTok");
    expect(Buffer.from(tspl).subarray(0, 16).toString("ascii")).toBe("SIZE 60 mm, 40 m");
    const cpcl = Buffer.from(await buildGenericStickerBytes("cpcl", p, "TikTok")).toString("ascii");
    expect(cpcl.startsWith("! 0 200 200 320 1\r\nPAGE-WIDTH 480\r\nEG 60 320 0 0 ")).toBe(true);
  });
});

describe("the native answer is remembered", () => {
  it("every bridge answer carrying savedPrinter updates the router (set / get / clear)", async () => {
    (window as W).SellerFlowPrinter = {
      setBluetoothLabelPrinter: vi.fn(async (p: Record<string, unknown>) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
      getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: { address: "AA:AA", name: "D520BT-Z" } })),
      clearBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    };
    await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", { address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", lang: "cpcl" });
    expect(savedGenericLang()).toBe("cpcl");
    await btCall<BluetoothScanResult>("getBluetoothLabelPrinter");
    expect(savedGenericLang()).toBeNull();
    await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter");
    expect(savedGenericLang()).toBeNull();
  });
  it("survives a cold open: nothing learned yet → the last stored native answer routes", () => {
    __resetSavedPrinter();
    localStorage.setItem("sfl_rd_bt_printer", JSON.stringify({ address: "DD:DD", name: "LabelThing-9", model: "generic", lang: "escpos" }));
    expect(savedGenericLang()).toBe("escpos");
    rememberSavedPrinter({ address: "AA:AA", name: "D520BT-Z" }); // the native answer arrives → it wins
    expect(savedGenericLang()).toBeNull();
  });
});
