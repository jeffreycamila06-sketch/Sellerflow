// CPCL golden (printer setup v2, generic printers, third language): header / PAGE-WIDTH /
// EG hex rows / FORM + PRINT, rows copied as hex from the sticker Bitmap (bit 1 = black).
import { describe, it, expect } from "vitest";
import { cpclRasterBytes } from "../cpclRaster";
import { renderStickerBitmap } from "../stickerRaster";
import { buildNativeStickerPayload, DEF_SETTINGS } from "../printing";
import { buildTestBuyer } from "../printerBridge";
import { LATIN_ATLAS } from "../glyphAtlas.latin";

const ascii = (b: Uint8Array) => String.fromCharCode(...b);

describe("cpclRasterBytes", () => {
  it("golden: 16×2 bitmap → exact text", () => {
    const full = { buf: Uint8Array.from([0xaa, 0xf0, 0x01, 0x80]), w: 16, h: 2, rowBytes: 2 };
    expect(ascii(cpclRasterBytes(full))).toBe("! 0 200 200 2 1\r\nPAGE-WIDTH 16\r\nEG 2 2 0 0 AAF00180\r\nFORM\r\nPRINT\r\n");
  });
  it("dimensions: EG width is bytes per row, height in dots; data is exactly 2 hex chars per byte", () => {
    const full = { buf: new Uint8Array(48 * 240), w: 384, h: 240, rowBytes: 48 };
    const s = ascii(cpclRasterBytes(full));
    expect(s.startsWith("! 0 200 200 240 1\r\nPAGE-WIDTH 384\r\nEG 48 240 0 0 ")).toBe(true);
    expect(s.endsWith("\r\nFORM\r\nPRINT\r\n")).toBe(true);
    const hex = s.slice("! 0 200 200 240 1\r\nPAGE-WIDTH 384\r\nEG 48 240 0 0 ".length, -"\r\nFORM\r\nPRINT\r\n".length);
    expect(hex).toHaveLength(48 * 240 * 2);
    expect(/^0+$/.test(hex)).toBe(true); // blank label = all zero (0 = white)
  });
  it("polarity: an ink bit becomes a 1 bit in the hex (black)", () => {
    const full = { buf: Uint8Array.from([0x80]), w: 8, h: 1, rowBytes: 1 };
    expect(ascii(cpclRasterBytes(full))).toContain("EG 1 1 0 0 80\r\n");
  });
  it("the real test sticker wraps without touching the image", () => {
    const p = buildNativeStickerPayload(buildTestBuyer(), "NT$", "Store", { ...DEF_SETTINGS, stickerSize: "60x40" });
    const full = renderStickerBitmap(p, 60, 40, { latin: LATIN_ATLAS });
    const s = ascii(cpclRasterBytes(full));
    const hex = s.slice(s.indexOf("EG 60 320 0 0 ") + "EG 60 320 0 0 ".length, s.indexOf("\r\nFORM"));
    expect(hex).toHaveLength(full.buf.length * 2);
    expect(hex).toBe(Array.from(full.buf, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(""));
    expect(full.buf.some((x) => x !== 0)).toBe(true);
  });
});
