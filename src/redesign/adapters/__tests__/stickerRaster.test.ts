// Bitmap sticker path — the four guarantees, in test form:
//  1. LAYOUT PARITY: stickerDrawOps → emitTextTspl reproduces the FROZEN
//     tsplReference byte stream for EVERY existing golden fixture (ascii + CJK +
//     scales + all sizes). Any drift in the ported layout/helpers goes red.
//  2. BITMAP GOLDENS: the full BITMAP TSPL stream is byte-pinned (sha256) per
//     fixture in stickerRasterGoldens.json. Regenerate deliberately with
//     UPDATE_BITMAP_GOLDENS=1 npx vitest run stickerRaster.
//  3. BAND-CROP LOSSLESS: recomposing the emitted BITMAP blocks reproduces the
//     full uncropped raster exactly (nothing dropped, polarity correct).
//  4. CJK path: glyphs blit at the CJK op position/scale; the empty placeholder
//     atlas renders ascii-only (documented Phase-1 state until the Mac gen).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  stickerDrawOps, emitTextTspl, rasterizeToBitmapTspl, renderStickerBitmap,
  bytesToBase64, INK_IS_ZERO, STICKER_LAYOUTS,
  type RasterPayload, type GlyphAtlas, type RasterAtlases,
} from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { buildTsplStickerReference, type RefPayload } from "../../../lib/__tests__/tsplReference";
import { buildGbkEncoder } from "../../../lib/__tests__/gbk";

const PARITY_DIR = join(process.cwd(), "mobile/ios/tspl-parity") + "/";
const GOLDENS_PATH = join(process.cwd(), "src/redesign/adapters/__tests__/stickerRasterGoldens.json");

interface Fixture { name: string; labelWidthMm: number; labelHeightMm: number }
const manifest: { fixtures: Fixture[] } = JSON.parse(readFileSync(`${PARITY_DIR}manifest.json`, "utf8"));
const readPayload = (name: string): RefPayload => JSON.parse(readFileSync(`${PARITY_DIR}payloads/${name}.json`, "utf8"));
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

// Distinctive 24x24 test glyph (all-ink) for 陳 U+9673 + 美 U+7F8E — proves the CJK
// blit path without the real Noto atlas (generated on the Mac; container has no CJK font).
const FULL_CELL = Buffer.alloc(72, 0xff).toString("base64");
const TEST_CJK: GlyphAtlas = { cjk: { w: 24, h: 24, glyphs: { 0x9673: FULL_CELL, 0x7f8e: FULL_CELL } } };
const ATLASES: RasterAtlases = { latin: LATIN_ATLAS, cjk: TEST_CJK };

let gbk: (s: string) => number[];
beforeAll(() => { gbk = buildGbkEncoder(); });

// ── 1. LAYOUT PARITY vs the frozen reference, whole fixture matrix ──────────
describe("stickerDrawOps layout parity (emitTextTspl == frozen tsplReference)", () => {
  it("covers the full existing fixture matrix", () => {
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(8);
  });
  for (const fx of manifest.fixtures) {
    it(`byte-identical for "${fx.name}" (${fx.labelWidthMm}x${fx.labelHeightMm})`, () => {
      const payload = readPayload(fx.name);
      const ref = buildTsplStickerReference(payload, fx.labelWidthMm, fx.labelHeightMm, gbk);
      const mine = emitTextTspl(payload as RasterPayload, fx.labelWidthMm, fx.labelHeightMm, gbk);
      expect(toHex(mine)).toBe(toHex(ref));
    });
  }
});

// ── BITMAP stream parser (test-side): header lines + BITMAP blocks w/ binary data ──
interface Band { x: number; y: number; rowBytes: number; h: number; mode: number; data: Uint8Array }
function parseBitmapStream(bytes: Uint8Array): { lines: string[]; bands: Band[] } {
  const lines: string[] = [];
  const bands: Band[] = [];
  let i = 0;
  const readAsciiLineStart = (): string => {
    let s = "";
    while (i < bytes.length && !(bytes[i] === 0x0d && bytes[i + 1] === 0x0a)) {
      s += String.fromCharCode(bytes[i]);
      // A BITMAP header ends at the comma after mode — binary follows, NOT CRLF.
      const m = /^BITMAP (\d+),(\d+),(\d+),(\d+),(\d+),$/.exec(s);
      if (m) {
        i++;
        const [x, y, rowBytes, h, mode] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
        const len = rowBytes * h;
        const data = bytes.slice(i, i + len);
        i += len;
        if (!(bytes[i] === 0x0d && bytes[i + 1] === 0x0a)) throw new Error("BITMAP block not CRLF-terminated");
        i += 2;
        bands.push({ x, y, rowBytes, h, mode, data });
        return "";
      }
      i++;
    }
    i += 2; // CRLF
    return s;
  };
  while (i < bytes.length) {
    const line = readAsciiLineStart();
    if (line) lines.push(line);
  }
  return { lines, bands };
}

const FLAGSHIP = { name: "ascii_full", w: 100, h: 60 };
const flagshipPayload = (): RasterPayload => readPayload(FLAGSHIP.name) as RasterPayload;

describe("rasterizeToBitmapTspl — structure, polarity, cropping", () => {
  it("emits the standard preamble, bands, and PRINT 1", () => {
    const r = rasterizeToBitmapTspl(flagshipPayload(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const { lines, bands } = parseBitmapStream(r.bytes);
    expect(lines[0]).toBe("SIZE 100 mm, 60 mm");
    expect(lines).toContain("GAP 2 mm, 0");
    expect(lines).toContain("DIRECTION 1");
    expect(lines).toContain("REFERENCE 0,0");
    expect(lines).toContain("DENSITY 8");
    expect(lines).toContain("CLS");
    expect(lines[lines.length - 1]).toBe("PRINT 1");
    expect(bands.length).toBe(r.bands);
    expect(bands.length).toBeGreaterThan(3); // header/rule, buyer block, orders…
    for (const b of bands) {
      expect(b.mode).toBe(0);
      const cfg = STICKER_LAYOUTS["100x60"];
      // H1 FIX (2026-09-07): DEFAULT bands are FULL-WIDTH at x=0 — the new-board
      // firmware doubles glyphs when BITMAP blocks land at arbitrary x (sub-byte
      // shift bug). x=0 + rowBytes = wDots/8 exactly → nothing to mis-shift.
      expect(b.x).toBe(0);
      expect(b.rowBytes).toBe(cfg.wDots / 8);
      expect(b.y + b.h).toBeLessThanOrEqual(60 * 8);
    }
  });

  it("horizontalCrop flag: old tight-crop bands (arbitrary x) still LOSSLESS + smaller", () => {
    const payload = flagshipPayload();
    const full = renderStickerBitmap(payload, FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const def = rasterizeToBitmapTspl(payload, FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const crop = rasterizeToBitmapTspl(payload, FLAGSHIP.w, FLAGSHIP.h, ATLASES, { horizontalCrop: true });
    expect(crop.bytes.length).toBeLessThan(def.bytes.length); // the crop is the size win…
    const { bands } = parseBitmapStream(crop.bytes);
    expect(bands.some((b) => b.x > 0)).toBe(true); // …and produces the arbitrary-x blocks
    // Lossless recomposition of the FLAGGED path too (same invariant as default).
    const recon = new Uint8Array(full.rowBytes * full.h);
    for (const b of bands) {
      for (let ry = 0; ry < b.h; ry++) for (let bit = 0; bit < b.rowBytes * 8; bit++) {
        const v = (b.data[ry * b.rowBytes + (bit >> 3)] & (0x80 >> (bit & 7))) !== 0;
        const ink = INK_IS_ZERO ? !v : v;
        if (!ink) continue;
        const gx = b.x + bit, gy = b.y + ry;
        if (gx >= full.w || gy >= full.h) throw new Error(`crop band ink outside label at ${gx},${gy}`);
        recon[gy * full.rowBytes + (gx >> 3)] |= 0x80 >> (gx & 7);
      }
    }
    expect(toHex(recon)).toBe(toHex(full.buf));
  });

  it("polarity: the full-width header rule band is solid 0x00 (ink=0)", () => {
    expect(INK_IS_ZERO).toBe(true);
    const r = rasterizeToBitmapTspl(flagshipPayload(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const { bands } = parseBitmapStream(r.bytes);
    // BAR 0,48,800,3 → a band covering rows 48..50 across the full 800-dot width.
    const rule = bands.find((b) => b.y <= 48 && b.y + b.h >= 51 && b.rowBytes === 100);
    expect(rule).toBeTruthy();
    const rowOff = (48 - rule!.y) * rule!.rowBytes;
    for (let i = 0; i < rule!.rowBytes; i++) expect(rule!.data[rowOff + i]).toBe(0x00);
  });

  it("band-crop is LOSSLESS: recomposed bands == full uncropped raster (all fixtures)", () => {
    for (const fx of manifest.fixtures) {
      const payload = readPayload(fx.name) as RasterPayload;
      const full = renderStickerBitmap(payload, fx.labelWidthMm, fx.labelHeightMm, ATLASES);
      const r = rasterizeToBitmapTspl(payload, fx.labelWidthMm, fx.labelHeightMm, ATLASES);
      const { bands } = parseBitmapStream(r.bytes);
      // Recompose: white canvas, stamp each band's ink dots (polarity-aware).
      const recon = new Uint8Array(full.rowBytes * full.h);
      for (const b of bands) {
        for (let ry = 0; ry < b.h; ry++) for (let bit = 0; bit < b.rowBytes * 8; bit++) {
          const v = (b.data[ry * b.rowBytes + (bit >> 3)] & (0x80 >> (bit & 7))) !== 0;
          const ink = INK_IS_ZERO ? !v : v;
          if (!ink) continue;
          const gx = b.x + bit, gy = b.y + ry;
          if (gx >= full.w || gy >= full.h) throw new Error(`band ink outside label at ${gx},${gy} (${fx.name})`);
          recon[gy * full.rowBytes + (gx >> 3)] |= 0x80 >> (gx & 7);
        }
      }
      expect(toHex(recon)).toBe(toHex(full.buf));
    }
  });

  it("cropping pays: 100x60 payload is a fraction of the naive full raster", () => {
    const r = rasterizeToBitmapTspl(flagshipPayload(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const naive = 100 * 480; // full-raster bytes at 800x480
    expect(r.inkBytes).toBeGreaterThan(0);
    // Full-width x=0 bands (H1 fix) transmit blank COLUMNS, so the win is now
    // vertical-only: measured 22.2KB vs 46.9KB naive at 100x60 (~47%). Guard at
    // 55% so a band-emission regression (e.g. losing the blank-row skip) trips.
    expect(r.inkBytes).toBeLessThan(naive * 0.55);
    expect(r.bytes.length).toBeLessThan(naive * 0.55);
  });

  it("blank rows between elements are never transmitted", () => {
    const r = rasterizeToBitmapTspl(flagshipPayload(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const { bands } = parseBitmapStream(r.bytes);
    const full = renderStickerBitmap(flagshipPayload(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const rowHasInk = (y: number) => { for (let b = 0; b < full.rowBytes; b++) if (full.buf[y * full.rowBytes + b]) return true; return false; };
    for (const b of bands) {
      expect(rowHasInk(b.y)).toBe(true);          // bands start on an inked row
      expect(rowHasInk(b.y + b.h - 1)).toBe(true); // and end on one
    }
  });
});

describe("CJK blit path", () => {
  const cjkPayload: RasterPayload = { storeName: "SF", sessionDate: "09/06/2026", currency: "NT$", buyer: { num: 12, name: "陳小美", handle: "chen", totalSpent: 350, orders: [{ time: "12:30", item: "350" }] } };

  it("paints CJK name glyphs at the cjk op position and 2x scale", () => {
    const { ops } = stickerDrawOps(cjkPayload, 100, 60);
    const nameOp = ops.find((o) => o.k === "cjk");
    expect(nameOp).toBeTruthy();
    if (nameOp?.k !== "cjk") return;
    expect(nameOp.s).toBe("陳小美");
    expect(nameOp.xm).toBe(2);
    const full = renderStickerBitmap(cjkPayload, 100, 60, ATLASES);
    const inkAt = (x: number, y: number) => (full.buf[y * full.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
    // 陳 (in the test atlas, full cell) → solid 48x48 at (x, y).
    expect(inkAt(nameOp.x, nameOp.y)).toBe(true);
    expect(inkAt(nameOp.x + 47, nameOp.y + 47)).toBe(true);
    // 小 (U+5C0F, NOT in the test atlas) → its 48-wide slot stays blank…
    expect(inkAt(nameOp.x + 48 + 24, nameOp.y + 24)).toBe(false);
    // …and 美 (in the atlas) paints in the third slot.
    expect(inkAt(nameOp.x + 96, nameOp.y)).toBe(true);
  });

  it("empty placeholder CJK atlas → ascii still renders, CJK slot blank (pre-Mac-gen state)", () => {
    const withCjk = renderStickerBitmap(cjkPayload, 100, 60, ATLASES);
    const without = renderStickerBitmap(cjkPayload, 100, 60, { latin: LATIN_ATLAS, cjk: {} });
    const ink = (r: { buf: Uint8Array }) => r.buf.reduce((n, b) => n + ((b * 0x08040201) >>> 3 & 0x11111111) % 0xf, 0);
    // ascii content identical → the only delta is the CJK name's ink.
    let deltaInside = 0, asciiMismatch = 0;
    const { ops } = stickerDrawOps(cjkPayload, 100, 60);
    const nameOp = ops.find((o) => o.k === "cjk");
    if (nameOp?.k !== "cjk") throw new Error("cjk op missing");
    for (let y = 0; y < withCjk.h; y++) for (let b = 0; b < withCjk.rowBytes; b++) {
      const idx = y * withCjk.rowBytes + b;
      if (withCjk.buf[idx] === without.buf[idx]) continue;
      const inNameRow = y >= nameOp.y && y < nameOp.y + 48;
      if (inNameRow) deltaInside++; else asciiMismatch++;
    }
    expect(asciiMismatch).toBe(0);
    expect(deltaInside).toBeGreaterThan(0);
    expect(ink(withCjk)).toBeGreaterThan(ink(without));
  });
});

// ── 2. BITMAP GOLDENS — sha256-pinned byte-exact stream per fixture ─────────
describe("bitmap TSPL goldens (sha256-pinned)", () => {
  const buildAll = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const fx of manifest.fixtures) {
      const r = rasterizeToBitmapTspl(readPayload(fx.name) as RasterPayload, fx.labelWidthMm, fx.labelHeightMm, ATLASES);
      out[`${fx.name}_${fx.labelWidthMm}x${fx.labelHeightMm}`] = `${sha(r.bytes)}:${r.bytes.length}`;
    }
    return out;
  };
  it("matches the committed goldens byte-for-byte", () => {
    const built = buildAll();
    if (process.env.UPDATE_BITMAP_GOLDENS === "1" || !existsSync(GOLDENS_PATH)) {
      writeFileSync(GOLDENS_PATH, JSON.stringify(built, null, 2) + "\n");
    }
    const goldens = JSON.parse(readFileSync(GOLDENS_PATH, "utf8")) as Record<string, string>;
    expect(built).toEqual(goldens);
  });
});

describe("bytesToBase64 (bridge encoding)", () => {
  it("round-trips a raster stream bigger than one chunk", () => {
    const r = rasterizeToBitmapTspl(flagshipPayload(), FLAGSHIP.w, FLAGSHIP.h, ATLASES);
    const b64 = bytesToBase64(r.bytes);
    const decoded = Buffer.from(b64, "base64");
    expect(toHex(new Uint8Array(decoded))).toBe(toHex(r.bytes));
  });
});
