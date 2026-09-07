// SDK-format image stream (the manufacturer protocol) — byte contracts.
// Framing decompiled from vendor/QY_Android_SDK.zip mprinter-release.aar, class
// jf/jf/jf/ei/vno/jf/vno/ei.java (pao() == "AM-243Z-BT" = the D520BT-Z's OEM
// identity) + io/jf.java ei() (raster packer) + XBitmapUtil.jf (LZO chunker) +
// io/ei.java `case` (terminator):
//   SIZE {w} mm,{h} mm / DIRECTION 0,0 / CLS /
//   BITMAP 4,0,{rowBytes},{hDots},4, + ([lzoLen LE32][LZO1X])* + 00000000 +
//   \r\nPRINT 1,1\n\r
// The strongest pin: DECOMPRESSING the stream reproduces the exact packed
// printer raster (bit 1 = white), which is the exact inverse of the rendered
// ink raster.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { lzo1xDecompress } from "lzo1x";
import {
  rasterizeToSdkBitmapTspl, buildSdkBitmapStream, packPrinterRaster, renderStickerBitmap,
  type RasterPayload, type RasterAtlases,
} from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { extraBitmapFixtures } from "./bitmapFixtures";
import type { RefPayload } from "../../../lib/__tests__/tsplReference";

const PARITY_DIR = join(process.cwd(), "mobile/ios/tspl-parity/") ;
const SDK_GOLDENS_PATH = join(process.cwd(), "src/redesign/adapters/__tests__/stickerRasterSdkGoldens.json");
interface Fixture { name: string; labelWidthMm: number; labelHeightMm: number }
const manifest: { fixtures: Fixture[] } = JSON.parse(readFileSync(`${PARITY_DIR}manifest.json`, "utf8"));
const readPayload = (name: string): RefPayload => JSON.parse(readFileSync(`${PARITY_DIR}payloads/${name}.json`, "utf8"));
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const ATLASES: RasterAtlases = { latin: LATIN_ATLAS, cjk: {} };
const FLAGSHIP = { name: "ascii_full", w: 100, h: 60 };
const flagship = (): RasterPayload => readPayload(FLAGSHIP.name) as RasterPayload;

// Parse the SDK stream: header text, chunk list, terminator, tail.
function parseSdkStream(bytes: Uint8Array) {
  const ascii = (a: number, b: number) => String.fromCharCode(...Array.from(bytes.subarray(a, b)));
  const headerEndMarker = ",4,";
  // find the BITMAP command end (",4," right after the height field)
  const text = ascii(0, Math.min(200, bytes.length));
  const bmpIdx = text.indexOf("BITMAP ");
  const cmdEnd = text.indexOf(headerEndMarker, bmpIdx) + headerEndMarker.length;
  const header = text.slice(0, cmdEnd);
  let i = cmdEnd;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const len = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    i += 4;
    if (len === 0) break; // terminator
    chunks.push(bytes.subarray(i, i + len));
    i += len;
  }
  const tail = String.fromCharCode(...Array.from(bytes.subarray(i)));
  return { header, chunks, tail };
}

describe("SDK image stream — framing", () => {
  const r = rasterizeToSdkBitmapTspl(flagship(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
  const parsed = parseSdkStream(r.bytes);

  it("header is byte-exact to the decompiled SDK builder", () => {
    // NO space after the comma in SIZE; DIRECTION 0,0 (not 1); no GAP/DENSITY/
    // REFERENCE lines; BITMAP x=4 y=0 mode 4 with NO length argument.
    expect(parsed.header).toBe("SIZE 100 mm,60 mm\r\nDIRECTION 0,0\r\nCLS\r\nBITMAP 4,0,100,480,4,");
  });

  it("tail is \\r\\nPRINT 1,1\\n\\r exactly (the SDK's reversed line ending)", () => {
    expect(parsed.tail).toBe("\r\nPRINT 1,1\n\r");
  });

  it("chunks decompress to EXACTLY the packed printer raster (the definitive pin)", () => {
    const full = renderStickerBitmap(flagship(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const packed = packPrinterRaster(full);
    // per-chunk: every chunk decompresses to 4096 bytes except the last
    let recon = new Uint8Array(0);
    parsed.chunks.forEach((c, idx) => {
      const isLast = idx === parsed.chunks.length - 1;
      const expectLen = isLast ? packed.length - idx * 4096 : 4096;
      const d = lzo1xDecompress(c, expectLen);
      expect(d.length).toBe(expectLen);
      const merged = new Uint8Array(recon.length + d.length);
      merged.set(recon, 0); merged.set(d, recon.length);
      recon = merged;
    });
    expect(recon.length).toBe(packed.length); // 100 rowBytes x 480 rows = 48000
    expect(Buffer.from(recon).equals(Buffer.from(packed))).toBe(true);
    expect(parsed.chunks.length).toBe(Math.ceil(packed.length / 4096)); // 12 at 100x60
  });

  it("polarity: packed raster is the bit-inverse of the ink raster (1=white)", () => {
    const full = renderStickerBitmap(flagship(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const packed = packPrinterRaster(full);
    for (let i = 0; i < 200; i++) expect(packed[i]).toBe(~full.buf[i] & 0xff);
    // the full-width header rule (BAR rows) must be solid INK => 0x00 in packed
    const ruleRow = 48 * full.rowBytes;
    for (let b = 0; b < full.rowBytes; b++) expect(packed[ruleRow + b]).toBe(0x00);
  });

  it("compression pays: the whole 100x60 job is a small fraction of the raster", () => {
    // 48KB raster; mostly-white 1-bit compresses hard under LZO. Guard generous
    // (regression trip only): stream under 12KB, typical ~2-5KB.
    expect(r.bytes.length).toBeLessThan(12 * 1024);
    expect(r.bytes.length).toBeGreaterThan(200);
  });

  it("buildSdkBitmapStream honors the copies argument", () => {
    const tiny = new Uint8Array(64).fill(0xff);
    const s = buildSdkBitmapStream(tiny, 8, 8, 8, 8, 3);
    const txt = String.fromCharCode(...Array.from(s.bytes.subarray(s.bytes.length - 14)));
    expect(txt).toContain("PRINT 1,3");
  });
});

// sha256-pinned SDK streams per fixture — regenerate DELIBERATELY with
// UPDATE_BITMAP_GOLDENS=1 (same switch as the mode-0 goldens).
describe("SDK stream goldens (sha256-pinned)", () => {
  it("matches the committed SDK goldens byte-for-byte", () => {
    const built: Record<string, string> = {};
    for (const fx of manifest.fixtures) {
      const r = rasterizeToSdkBitmapTspl(readPayload(fx.name) as RasterPayload, fx.labelWidthMm, fx.labelHeightMm, ATLASES);
      built[`${fx.name}_${fx.labelWidthMm}x${fx.labelHeightMm}`] = `${sha(r.bytes)}:${r.bytes.length}`;
    }
    // Bitmap-only multi-language extras (Vietnamese/Indonesian/mixed CJK+Latin).
    for (const fx of extraBitmapFixtures()) {
      const r = rasterizeToSdkBitmapTspl(fx.payload, fx.w, fx.h, ATLASES);
      built[fx.key] = `${sha(r.bytes)}:${r.bytes.length}`;
    }
    if (process.env.UPDATE_BITMAP_GOLDENS === "1" || !existsSync(SDK_GOLDENS_PATH)) {
      writeFileSync(SDK_GOLDENS_PATH, JSON.stringify(built, null, 2) + "\n");
    }
    const goldens = JSON.parse(readFileSync(SDK_GOLDENS_PATH, "utf8")) as Record<string, string>;
    expect(built).toEqual(goldens);
  });
});
