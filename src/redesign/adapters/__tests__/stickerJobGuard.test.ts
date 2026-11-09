// The final safety's checks on real job bytes (stickerJobGuard.ts): the jobs the encoders make pass; every
// shape that could feed an extra label (taller than the label, two prints, a feed command, a second image,
// broken data) is caught.
import { describe, expect, it } from "vitest";
import { checkTsplJob, checkSdkJob, checkEscposJob, checkCpclJob, checkNiimbotImage, checkLaptopPicture, tsplCommands } from "../stickerJobGuard";
import { bitmapTsplFromRaster, buildSdkBitmapStream, packPrinterRaster, rotateRaster180, type FullRaster } from "../stickerRaster";
import { escposRasterBytes } from "../escposRaster";
import { cpclRasterBytes } from "../cpclRaster";

const raster = (w: number, h: number, rows: number[]): FullRaster => {
  const rowBytes = w >> 3, buf = new Uint8Array(rowBytes * h);
  for (const y of rows) buf.fill(0xff, y * rowBytes, y * rowBytes + 4);
  return { buf, w, h, rowBytes };
};
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => { const out = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of p) { out.set(x, o); o += x.length; } return out; };

describe("TSPL (XP-420B, Y41BT)", () => {
  const good = bitmapTsplFromRaster(raster(480, 320, [13, 14, 200, 300]), 60, 40, { density: 15, speed: 4 }).bytes;
  it("the encoder's job passes, and its commands read past the binary band data", () => {
    expect(checkTsplJob(good, 60, 40)).toEqual([]);
    expect(tsplCommands(good).cmds.filter((c) => !c.startsWith("BITMAP"))).toEqual(["SIZE 60 mm, 40 mm", "GAP 2 mm, 0", "DIRECTION 1", "REFERENCE 0,0", "SPEED 4", "DENSITY 15", "CLS", "PRINT 1"]);
  });
  it("binary rows that happen to contain \"PRINT 1\" are data, not a command", () => {
    const r = raster(480, 320, []);
    r.buf.set(enc("\r\nPRINT 1\r\nFORMFEED\r\n"), 20 * r.rowBytes);
    const b = bitmapTsplFromRaster(r, 60, 40).bytes;
    expect(checkTsplJob(b, 60, 40)).toEqual([]);
  });
  it("caught: a second PRINT, a FORMFEED / FEED / HOME / GAPDETECT, a band past the label, the wrong SIZE, no PRINT, broken band data", () => {
    expect(checkTsplJob(cat(good, enc("PRINT 1\r\n")), 60, 40).length).toBeGreaterThan(0);
    for (const c of ["FORMFEED", "FEED 40", "HOME", "GAPDETECT", "BACKFEED 10", "SET TEAR ON"]) expect(checkTsplJob(cat(good.slice(0, good.length - 9), enc(`${c}\r\nPRINT 1\r\n`)), 60, 40).length, c).toBeGreaterThan(0);
    expect(checkTsplJob(bitmapTsplFromRaster(raster(480, 400, [390]), 60, 40).bytes, 60, 40).join()).toMatch(/outside/);
    expect(checkTsplJob(bitmapTsplFromRaster(raster(480, 320, [20]), 60, 40).bytes, 60, 30).join()).toMatch(/SIZE|outside/);
    expect(checkTsplJob(good.slice(0, good.length - 9), 60, 40).join()).toMatch(/PRINT/);
    expect(checkTsplJob(good.slice(0, 200), 60, 40).join()).toMatch(/past the end|PRINT/);
  });
});

describe("D520 SDK stream (Android SPP + iPhone BLE)", () => {
  const r = raster(480, 320, [13, 300]);
  const good = buildSdkBitmapStream(packPrinterRaster(rotateRaster180(r)), r.rowBytes, r.h, 60, 40).bytes;
  it("the encoder's stream passes", () => { expect(checkSdkJob(good, 60, 40)).toEqual([]); });
  it("caught: taller than the label, the wrong SIZE, two copies, a second image, a feed after it", () => {
    const tall = raster(480, 400, [13]);
    expect(checkSdkJob(buildSdkBitmapStream(packPrinterRaster(rotateRaster180(tall)), tall.rowBytes, tall.h, 60, 40).bytes, 60, 40).join()).toMatch(/taller/);
    expect(checkSdkJob(good, 60, 30).join()).toMatch(/SIZE|taller/);
    expect(checkSdkJob(buildSdkBitmapStream(packPrinterRaster(rotateRaster180(r)), r.rowBytes, r.h, 60, 40, 2).bytes, 60, 40).join()).toMatch(/PRINT 1,1/);
    expect(checkSdkJob(cat(good, good), 60, 40).length).toBeGreaterThan(0);
    expect(checkSdkJob(cat(good, enc("FORMFEED\r\n")), 60, 40).length).toBeGreaterThan(0);
  });
});

describe("ESC/POS, CPCL, Niimbot, laptop", () => {
  it("ESC/POS: one image + one feed passes; taller / a second image is caught", () => {
    expect(checkEscposJob(escposRasterBytes(raster(480, 320, [5])), 60, 40)).toEqual([]);
    expect(checkEscposJob(escposRasterBytes(raster(480, 400, [5])), 60, 40).join()).toMatch(/taller/);
    expect(checkEscposJob(cat(escposRasterBytes(raster(480, 320, [5])), escposRasterBytes(raster(480, 320, [5]))), 60, 40).length).toBeGreaterThan(0);
  });
  it("CPCL: one page passes; taller / a second page is caught", () => {
    expect(checkCpclJob(cpclRasterBytes(raster(480, 320, [5])), 60, 40)).toEqual([]);
    expect(checkCpclJob(cpclRasterBytes(raster(480, 400, [5])), 60, 40).join()).toMatch(/taller/);
    expect(checkCpclJob(cat(cpclRasterBytes(raster(480, 320, [5])), cpclRasterBytes(raster(480, 320, [5]))), 60, 40).length).toBeGreaterThan(0);
  });
  it("Niimbot: an image larger than the SDK frame is caught; laptop: a picture taller than the page is caught", () => {
    expect(checkNiimbotImage({ w: 384, h: 224, rowBytes: 48, data: "", labelWidthMm: 50, labelHeightMm: 30 }, 384, 224)).toEqual([]);
    expect(checkNiimbotImage({ w: 384, h: 240, rowBytes: 48, data: "", labelWidthMm: 50, labelHeightMm: 30 }, 384, 224).length).toBe(1);
    expect(checkLaptopPicture({ w: 480, h: 320 }, 60, 40)).toEqual([]);
    expect(checkLaptopPicture({ w: 480, h: 321 }, 60, 40).length).toBe(1);
  });
});
