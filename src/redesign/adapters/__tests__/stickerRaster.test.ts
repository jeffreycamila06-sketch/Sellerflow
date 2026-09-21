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
  bytesToBase64, INK_IS_ZERO, STICKER_LAYOUTS, translitCp, stickerQrSupported,
  stickerQrPlacement, wrapWords,
  type RasterPayload, type GlyphAtlas, type RasterAtlases,
} from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { extraBitmapFixtures } from "./bitmapFixtures";
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
    // (No QR here — the flagship payload leaves the "Print QR on sticker" toggle OFF.)
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
    // Bitmap-only multi-language extras (Vietnamese/Indonesian/mixed CJK+Latin).
    for (const fx of extraBitmapFixtures()) {
      const r = rasterizeToBitmapTspl(fx.payload, fx.w, fx.h, ATLASES);
      out[fx.key] = `${sha(r.bytes)}:${r.bytes.length}`;
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

// ── Multi-language (extended script mode) ───────────────────────────────────
describe("extended script mode (Vietnamese / Indonesian / mixed)", () => {
  const vn: RasterPayload = { storeName: "Shop", sessionDate: "09/07/2026", currency: "NT$", buyer: { num: 21, name: "Nguyễn Thị Hằng", handle: "hang.nguyen", totalSpent: 450, orders: [{ time: "20:15", item: "450" }] } };

  it("extended (production default) KEEPS Vietnamese diacritics on the Latin font; legacy transliterates", () => {
    const ext = stickerDrawOps(vn, 100, 60); // default = extended
    const leg = stickerDrawOps(vn, 100, 60, "legacy");
    // (the "Buyer" label is also font-4 x=16 — match the NAME op by content)
    const extName = ext.ops.find((o) => o.k === "txt" && o.font === "4" && o.s.startsWith("Nguy"));
    const legName = leg.ops.find((o) => o.k === "txt" && o.font === "4" && o.s.startsWith("Nguy"));
    if (extName?.k !== "txt" || legName?.k !== "txt") throw new Error("name op missing");
    expect(extName.s).toBe("Nguyễn Thị Hằng"); // real diacritics — the bitmap-path upgrade
    expect(legName.s).toBe("Nguyen Thi Hang"); // the TEXT path's old narrowing (documented delta)
    // SAME geometry: only the glyphs differ, never the layout.
    expect(extName.x).toBe(legName.x);
    expect(extName.y).toBe(legName.y);
    expect(ext.ops.length).toBe(leg.ops.length);
  });

  it("the diacritic glyphs actually paint (atlas hit, non-blank, differs from transliterated)", () => {
    const ext = renderStickerBitmap(vn, 100, 60, ATLASES);
    const leg = renderStickerBitmap(vn, 100, 60, ATLASES, "legacy");
    const ink = (r: { buf: Uint8Array }) => r.buf.reduce((n, b) => n + (b ? 1 : 0), 0);
    expect(ink(ext)).toBeGreaterThan(0);
    expect(ink(leg)).toBeGreaterThan(0);
    expect(toHex(ext.buf)).not.toBe(toHex(leg.buf)); // ễ/ị/ằ marks add ink
  });

  it("mixed CJK+Latin stays on the CJK op with the Latin part retained", () => {
    const mixed: RasterPayload = { ...vn, buyer: { ...vn.buyer, name: "陳小美 Amy" } };
    const { ops } = stickerDrawOps(mixed, 100, 60);
    const nameOp = ops.find((o) => o.k === "cjk");
    if (nameOp?.k !== "cjk") throw new Error("cjk op missing");
    expect(nameOp.s).toBe("陳小美 Amy");
  });

  it("unsupported scripts (no atlas) keep the legacy fallback in extended mode — never tofu", () => {
    const th: RasterPayload = { ...vn, buyer: { ...vn.buyer, name: "สมชาย", handle: "somchai" } };
    const { ops } = stickerDrawOps(th, 100, 60);
    const nameOp = ops.find((o) => o.k === "txt" && o.font === "4" && o.s === "somchai");
    if (nameOp?.k !== "txt") throw new Error("fallback op missing");
    expect(nameOp.s).toBe("somchai"); // Thai → ASCII handle, same as the TEXT path
  });

  it("translitCp: per-char never-tofu fallback (ễ→e, đ→d, ASCII→null)", () => {
    expect(translitCp(0x1ec5)).toBe(0x65); // ễ → e
    expect(translitCp(0x111)).toBe(0x64);  // đ → d (ATOMIC map)
    expect(translitCp(0x1eb1)).toBe(0x61); // ằ → a
    expect(translitCp(0x61)).toBe(null);   // a → no simpler form
  });

  it("paint falls back per-character when a glyph is missing from the atlas (no blank slot)", () => {
    // Mini atlas: font "4" carries ONLY ASCII — every diacritic must fall back
    // to its base letter, so the painted raster equals the transliterated name.
    const asciiOnly = { ...LATIN_ATLAS["4"], glyphs: Object.fromEntries(Object.entries(LATIN_ATLAS["4"].glyphs).filter(([cp]) => Number(cp) <= 0x7e)) };
    const miniAtlases: RasterAtlases = { latin: { ...LATIN_ATLAS, "4": asciiOnly }, cjk: {} };
    // Extended keeps "Nguyễn Thị Hằng"; with no diacritic glyphs every char
    // falls back to its base letter — pixel-identical to the legacy-transliterated
    // "Nguyen Thi Hang" render (same char count → same advances → same glyphs).
    const viaFallback = renderStickerBitmap(vn, 100, 60, miniAtlases);
    const legacyBase = renderStickerBitmap(vn, 100, 60, miniAtlases, "legacy");
    expect(toHex(viaFallback.buf)).toBe(toHex(legacyBase.buf));
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

// ── @username QR (bitmap-only) ───────────────────────────────────────────────
describe("renderStickerBitmap — buyer @username QR (bottom-right)", () => {
  const inkInBox = (rr: { buf: Uint8Array; w: number; h: number; rowBytes: number }, x0: number, y0: number, x1: number, y1: number): number => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (rr.buf[y * rr.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) n++;
    return n;
  };
  // bottom-right corner box (where the QR lands); base content doesn't reach here.
  const corner = (rr: { buf: Uint8Array; w: number; h: number; rowBytes: number }) => inkInBox(rr, rr.w - 100, rr.h - 100, rr.w, rr.h);
  // ascii_full has handle "maria_s"; enable the per-device QR toggle in settings.
  const qrOn = () => { const p = readPayload("ascii_full") as RasterPayload; return { ...p, settings: { ...p.settings, printStickerQr: true } }; };

  it("toggle OFF (default) → NO QR — nothing changes for other sellers", () => {
    const rr = renderStickerBitmap(readPayload("ascii_full") as RasterPayload, 100, 60, ATLASES); // no printStickerQr
    expect(corner(rr)).toBe(0);
  });
  it("toggle ON + a handle → a dense QR block appears bottom-right", () => {
    const rr = renderStickerBitmap(qrOn(), 100, 60, ATLASES);
    expect(corner(rr)).toBeGreaterThan(200); // QR modules (finder patterns alone are dense)
  });
  it("toggle ON but blank handle → NO QR (corner stays clear)", () => {
    const p = qrOn(); p.buyer = { ...p.buyer, handle: "" };
    expect(corner(renderStickerBitmap(p, 100, 60, ATLASES))).toBe(0);
  });
  it("toggle ON but printBuyerUsername:false → NO QR (follows the @username toggle)", () => {
    const p = qrOn(); p.settings = { ...p.settings, printBuyerUsername: false };
    expect(corner(renderStickerBitmap(p, 100, 60, ATLASES))).toBe(0);
  });
  it("toggle ON but 60×40 → NO QR (byte-identical to toggle OFF: QR excluded on the small label)", () => {
    const on = renderStickerBitmap(qrOn(), 60, 40, ATLASES);
    const off = renderStickerBitmap(readPayload("ascii_full") as RasterPayload, 60, 40, ATLASES);
    expect(Array.from(on.buf)).toEqual(Array.from(off.buf)); // the toggle changes nothing at 60×40
  });
  it("toggle ON → QR present at 4 dots/module on all supported sizes (≥50mm tall)", () => {
    for (const [w, h] of [[70, 50], [80, 50], [80, 60], [100, 60]] as const)
      expect(corner(renderStickerBitmap(qrOn(), w, h, ATLASES))).toBeGreaterThan(200);
  });
  it("stickerQrSupported: 60×40 excluded, every larger height allowed", () => {
    expect(stickerQrSupported(40)).toBe(false); // 60×40
    for (const h of [50, 60]) expect(stickerQrSupported(h)).toBe(true);
  });
});

describe("wrapWords (order-comment wrapping)", () => {
  it("short text → one line, unchanged", () => {
    expect(wrapWords("150", 8, 4)).toEqual(["150"]);
    expect(wrapWords("Black", 8, 4)).toEqual(["Black"]);
  });
  it("wraps on word boundaries into multiple lines", () => {
    expect(wrapWords("Black white 350", 8, 4)).toEqual(["Black", "white", "350"]);
    expect(wrapWords("Red small size", 10, 4)).toEqual(["Red small", "size"]);
  });
  it("collapses double/leading/trailing whitespace to a single space", () => {
    expect(wrapWords("Black  white", 20, 4)).toEqual(["Black white"]); // 2 spaces → 1
    expect(wrapWords("  Black white  ", 20, 4)).toEqual(["Black white"]);
  });
  it("hard-splits a word longer than the line width", () => {
    expect(wrapWords("supercalifragilistic", 6, 4)).toEqual(["superc", "alifra", "gilist", "ic"]);
  });
  it("ellipsises when it needs more than maxLines", () => {
    const out = wrapWords("one two three four five", 4, 2);
    expect(out).toHaveLength(2);
    expect(out[out.length - 1].endsWith("…")).toBe(true);
  });
  it("blank / whitespace → no lines", () => {
    expect(wrapWords("", 8, 4)).toEqual([]);
    expect(wrapWords("   ", 8, 4)).toEqual([]);
  });
});

describe("stickerDrawOps — QR keep-out: comment wraps, never crosses the QR", () => {
  const qrPayload = (item: string, time = "12:26"): RasterPayload => ({
    storeName: "budgetukay", sessionDate: "09/21/2026", currency: "NT$",
    buyer: { num: 5, name: "budgetukay2", handle: "budgetukay2", orders: [{ time, item }] },
    settings: { printStickerQr: true, printBuyerUsername: true },
  });
  // The comment ops sit at priceX (font "4") — 1-cell gap after the 5-char time = 88 dots.
  const PRICE_X = 16 + (5 + 1) * 12; // 88
  const commentOps = (ops: ReturnType<typeof stickerDrawOps>["ops"]) =>
    ops.filter((o) => (o.k === "txt" && o.font === "4" && o.x === PRICE_X) || (o.k === "cjk" && o.x === PRICE_X));

  it("long comment 'Black white 350' wraps to ≥2 lines, all left of the QR", () => {
    const p = qrPayload("Black white 350");
    const qr = stickerQrPlacement(p, 640, 480, 60)!;
    expect(qr).not.toBeNull();
    const { ops } = stickerDrawOps(p, 80, 60, "extended", qr);
    const lines = commentOps(ops) as Extract<typeof ops[number], { k: "txt" }>[];
    expect(lines.length).toBeGreaterThanOrEqual(2);                        // wrapped
    for (const l of lines) expect(l.x + l.s.length * 48).toBeLessThanOrEqual(qr.x0); // never under/through the QR
    expect(lines.map((l) => l.s).join(" ")).toBe("Black white 350");       // words preserved, single-spaced
    for (const l of lines) expect(l.s).not.toMatch(/ {2,}/);               // no double space
    // lines flow DOWN (strictly increasing y)
    for (let i = 1; i < lines.length; i++) expect(lines[i].y).toBeGreaterThan(lines[i - 1].y);
  });
  it("short comment '150' stays one line (no needless wrap)", () => {
    const p = qrPayload("150");
    const qr = stickerQrPlacement(p, 640, 480, 60)!;
    const { ops } = stickerDrawOps(p, 80, 60, "extended", qr);
    const lines = commentOps(ops);
    expect(lines).toHaveLength(1);
    expect(lines[0].s).toBe("150");
  });
  it("gap after the time is tightened by one cell when the QR is present", () => {
    const p = qrPayload("150");
    const withQr = stickerDrawOps(p, 80, 60, "extended", stickerQrPlacement(p, 640, 480, 60));
    const withoutQr = stickerDrawOps(p, 80, 60, "extended", null);
    const cx = (r: typeof withQr) => (r.ops.find((o) => o.k === "txt" && o.font === "4" && o.s === "150") as { x: number }).x;
    expect(cx(withQr)).toBe(88);       // 16 + (5+1)*12  — 1-cell gap
    expect(cx(withoutQr)).toBe(100);   // 16 + (5+2)*12  — 2-cell gap (unchanged full width)
  });
  it("no comment op ever overlaps the QR footprint horizontally (80×60 / 80×50 / 70×50)", () => {
    for (const [w, h] of [[80, 60], [80, 50], [70, 50]] as const) {
      const p = qrPayload("Black white extra long comment 350");
      const qr = stickerQrPlacement(p, STICKER_LAYOUTS[`${w}x${h}`].wDots, h * 8, h)!;
      const { ops } = stickerDrawOps(p, w, h, "extended", qr);
      for (const l of commentOps(ops) as Extract<typeof ops[number], { k: "txt" }>[])
        expect(l.x + l.s.length * 48).toBeLessThanOrEqual(qr.x0);
    }
  });
});
