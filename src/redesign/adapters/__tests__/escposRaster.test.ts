// ESC/POS raster golden (printer setup v2, generic printers): ESC @ + GS v 0 + rows + ESC d 3,
// rows copied as-is from the sticker Bitmap (bit 1 = ink, MSB first).
import { describe, it, expect } from "vitest";
import { escposRasterBytes } from "../escposRaster";
import { renderStickerBitmap } from "../stickerRaster";
import { buildNativeStickerPayload, DEF_SETTINGS } from "../printing";
import { buildTestBuyer } from "../printerBridge";
import { LATIN_ATLAS } from "../glyphAtlas.latin";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

describe("escposRasterBytes", () => {
  it("golden: 16×2 bitmap → exact bytes", () => {
    // two rows of 16 dots: row 0 = 1010 1010 1111 0000, row 1 = 0000 0001 1000 0000
    const full = { buf: Uint8Array.from([0xaa, 0xf0, 0x01, 0x80]), w: 16, h: 2, rowBytes: 2 };
    expect(hex(escposRasterBytes(full))).toBe(
      "1b 40 " +                 // ESC @
      "1d 76 30 00 02 00 02 00 " + // GS v 0, m=0, xL=2 xH=0 (bytes/row), yL=2 yH=0 (rows)
      "aa f0 01 80 " +           // the rows, verbatim
      "1b 64 03",                // ESC d 3
    );
  });
  it("wide label: xL/xH and yL/yH are little-endian", () => {
    const full = { buf: new Uint8Array(100 * 480), w: 800, h: 480, rowBytes: 100 };
    const b = escposRasterBytes(full);
    expect(Array.from(b.subarray(2, 10))).toEqual([0x1d, 0x76, 0x30, 0x00, 100, 0, 480 & 0xff, 480 >> 8]);
    expect(b.length).toBe(10 + 100 * 480 + 3);
  });
  it("the real test sticker raster wraps without touching the image bytes", () => {
    const p = buildNativeStickerPayload(buildTestBuyer(), "NT$", "Store", { ...DEF_SETTINGS, stickerSize: "60x40" });
    const full = renderStickerBitmap(p, 60, 40, { latin: LATIN_ATLAS });
    const b = escposRasterBytes(full);
    expect(Array.from(b.subarray(0, 10))).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 60, 0, 320 & 0xff, 320 >> 8]);
    expect(Array.from(b.subarray(10, 10 + full.buf.length))).toEqual(Array.from(full.buf));
    expect(full.buf.some((x) => x !== 0)).toBe(true); // the sticker actually has ink
  });
});
