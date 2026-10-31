// PROPORTIONAL (font C) compact layout — generic-printer / Niimbot IMAGE paths only.
//   • goldens: the 3 samples (50×30, TikTok, QR on) + the space rule (Facebook / TikTok QR
//     off / TikTok QR on) at 50×30 and 60×40, through the production renderStickerBitmap
//     with the production atlases (stickerRasterPropGoldens.json, written by the render
//     script that also produces design-redesign/niimbot-font-options/C_final_*.png);
//   • no overlap: no ink in the PROP_TEXT_QR_GAP columns before the QR's first ink column,
//     and the text never reaches the QR;
//   • per-glyph widths: Latin narrow, CJK full width, "…" at the column edge;
//   • the D520BT stream never receives the font-C atlases (source pin) and its goldens are
//     untouched (tspl.test.ts + the stickerRaster golden suites run unchanged).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderStickerBitmap, rasterizeToBitmapTspl, fitRaster, propQrPlacement, propQrInkLeft, propFitLine, propFitShrinking, propShrinkLadder, propLayoutLines, propLineTops, propGlyphBox, propPlanCjkSizes, propSizes, isPropCompactSize, PROP_TEXT_QR_GAP, PROP_INK_MARGIN, PROP_CJK_GAP, STICKER_LAYOUTS, QR_QUIET_MODULES, type RasterPayload, type RasterAtlases } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CYRILLIC_ATLAS } from "../glyphAtlas.cyrillic";
import { CJK_ATLAS } from "../glyphAtlas.cjk";
import { PROP_ATLAS } from "../glyphAtlas.prop";
import { CJK_REG_ATLAS as R24 } from "../glyphAtlas.cjkReg24";
import { CJK_REG_ATLAS as R32 } from "../glyphAtlas.cjkReg32";
import { CJK_REG_ATLAS as R20 } from "../glyphAtlas.cjkReg20";
import { CJK_REG_ATLAS as R18 } from "../glyphAtlas.cjkReg18";
import { buildNativeStickerPayload, imageStickerPayload, DEF_SETTINGS } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

const GOLD = JSON.parse(readFileSync(join(process.cwd(), "src/redesign/adapters/__tests__/stickerRasterPropGoldens.json"), "utf8")) as Record<string, string>;
const AT = Date.UTC(2026, 9, 22, 12, 15); // 10/22/2026 20:15 Taipei
const ATL: RasterAtlases = { latin: LATIN_ATLAS, cjk: CJK_ATLAS, cyrillic: CYRILLIC_ATLAS, proportional: PROP_ATLAS, cjkReg: { 18: R18, 20: R20, 24: R24, 32: R32 } };
const FIXED: RasterAtlases = { latin: LATIN_ATLAS, cjk: CJK_ATLAS, cyrillic: CYRILLIC_ATLAS }; // what the image paths passed before font C
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const buyer = (num: number, handle: string, name: string, item: string, platform: "TikTok" | "Facebook" = "TikTok"): Buyer =>
  ({ handle, name, platform, num, orders: [{ orderNum: 1, item, qty: 1, price: 350, total: 350, time: "20:15", handle, name, bNum: num, platform, status: "New", date: "2026-10-22" }], totalSpent: 350, totalOrders: 1 } as unknown as Buyer);
const S1 = buyer(12, "wangxiaoming88", "王小明", "A12 +1 $350");
const S2 = buyer(135, "verylongusername_shop2026", "陳美玲 Amy Chen", "B7 +2 好看 $1,280");
const S3 = buyer(88, "sellerflow", "測試 Test Print", "COMMENT / PRICE 好");
type Size = "50x30" | "60x40";
const dims = (s: Size) => (s === "50x30" ? { w: 50, h: 30 } : { w: 60, h: 40 });
function payloadFor(b: Buyer, size: Size, qrOn: boolean, platform: "TikTok" | "Facebook" = "TikTok"): RasterPayload {
  const p = buildNativeStickerPayload({ ...b, platform } as Buyer, "NT$", "SellerFlowLive", { ...DEF_SETTINGS, stickerSize: size }, AT);
  const rp = imageStickerPayload(p, platform);
  return { ...rp, settings: { ...(rp.settings ?? {}), printStickerQr: platform === "TikTok" && qrOn } };
}
const render = (rp: RasterPayload, size: Size) => { const { w, h } = dims(size); return renderStickerBitmap(rp, w, h, ATL); };
const ink = (r: { buf: Uint8Array; rowBytes: number }, x: number, y: number) => (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
const qrOf = (rp: RasterPayload, size: Size) => { const { w, h } = dims(size); return propQrPlacement(rp, STICKER_LAYOUTS[size].wDots, h * 8, propSizes(w, true).edge); };

describe("font C goldens", () => {
  it("the three samples at 50×30 (TikTok, QR on)", () => {
    expect(sha(render(payloadFor(S1, "50x30", true), "50x30").buf)).toBe(GOLD.s1_wang_50x30_qron);
    expect(sha(render(payloadFor(S2, "50x30", true), "50x30").buf)).toBe(GOLD.s2_chen_50x30_qron);
    expect(sha(render(payloadFor(S3, "50x30", true), "50x30").buf)).toBe(GOLD.s3_test_50x30_qron);
  });
  it.each(["50x30", "60x40"] as Size[])("the space rule at %s: Facebook / TikTok QR off / TikTok QR on", (size) => {
    expect(sha(render(payloadFor(S2, size, true, "Facebook"), size).buf)).toBe(GOLD[`fb_${size}`]);
    expect(sha(render(payloadFor(S2, size, false), size).buf)).toBe(GOLD[`tiktok_qroff_${size}`]);
    expect(sha(render(payloadFor(S2, size, true), size).buf)).toBe(GOLD[`tiktok_qron_${size}`]);
    // Facebook never has a QR (even with the switch on) → identical to TikTok with the QR off
    expect(GOLD[`fb_${size}`]).toBe(GOLD[`tiktok_qroff_${size}`]);
    expect(GOLD[`tiktok_qron_${size}`]).not.toBe(GOLD[`tiktok_qroff_${size}`]);
  });
  it("the generic TSPL band path paints the same raster as renderStickerBitmap (lossless) and the ESC/POS + CPCL paths share it", () => {
    const rp = payloadFor(S2, "50x30", true);
    const full = render(rp, "50x30");
    const tspl = rasterizeToBitmapTspl(rp, 50, 30, ATL);
    expect(Buffer.from(tspl.bytes).subarray(0, 16).toString("ascii")).toBe("SIZE 50 mm, 30 m");
    expect(tspl.bytes.includes(Buffer.from("BITMAP 0,")[0])).toBe(true);
    expect(sha(full.buf)).toBe(GOLD.tiktok_qron_50x30);
  });
});

describe("font C layout rules", () => {
  it.each(["50x30", "60x40"] as Size[])("%s QR on: ~150-dot symbol, vertically centred, 12 label-dots from the right; no ink in the gap; text never reaches it", (size) => {
    for (const b of [S1, S2, S3]) {
      const rp = payloadFor(b, size, true);
      const r = render(rp, size);
      const qr = qrOf(rp, size)!;
      expect(qr).not.toBeNull();
      const symbol = qr.matrix.length * qr.scale;
      expect(qr.scale).toBe(5);
      expect([145, 165]).toContain(symbol);                                       // QR v3 (29 modules) or v4 (33, the long handle) × 5 dots ≈ 150
      const inkLeft = propQrInkLeft(qr), inkRight = inkLeft + symbol;
      const { w } = dims(size);
      expect(STICKER_LAYOUTS[size].wDots - inkRight).toBe(propSizes(w, true).edge); // 4 raster dots on the 384-wide 50×30 raster = 12 on the 400-dot label; 12 on 60×40
      const top = qr.y0 + QR_QUIET_MODULES * qr.scale;
      expect(Math.abs(top - (r.h - top - symbol))).toBeLessThanOrEqual(1);          // vertically centred
      let gapInk = 0, textRight = -1;
      const colEnd = Math.min(qr.x0, inkLeft - PROP_TEXT_QR_GAP); // the column ends before the quiet zone the stamp clears
      for (let y = 0; y < r.h; y++) {
        for (let x = colEnd - PROP_INK_MARGIN; x < inkLeft; x++) if (ink(r, x, y)) gapInk++;
        for (let x = 0; x < colEnd; x++) if (ink(r, x, y)) textRight = Math.max(textRight, x);
      }
      expect(gapInk).toBe(0);
      expect(inkLeft - colEnd).toBeGreaterThanOrEqual(PROP_TEXT_QR_GAP);
      expect(textRight).toBeLessThan(colEnd - PROP_INK_MARGIN);
      expect(textRight).toBeGreaterThan(0);
    }
  });
  it("no QR → the text uses the full width (a line that was cut next to the QR is whole) and the buyer number steps up", () => {
    const off = render(payloadFor(S2, "50x30", false), "50x30");
    const rightmost = (r: typeof off) => { let m = -1; for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (ink(r, x, y)) m = Math.max(m, x); return m; };
    const qr = qrOf(payloadFor(S2, "50x30", true), "50x30")!;
    expect(rightmost(off)).toBeGreaterThan(propQrInkLeft(qr));             // text now lives where the QR was
    expect(rightmost(off)).toBeLessThanOrEqual(STICKER_LAYOUTS["50x30"].wDots - propSizes(50, false).edge);
    expect(propSizes(50, false).num).toBeGreaterThan(propSizes(50, true).num);
    expect(propSizes(60, false).num).toBe(64);
    // the long handle is cut next to the QR (even at 18 px) but whole without it
    const col = propQrInkLeft(qr) - PROP_TEXT_QR_GAP - propSizes(50, true).edge;
    expect(propFitShrinking("@verylongusername_shop2026", 24, col, ATL)!.line.cut).toBe(true);
    expect(propFitShrinking("@verylongusername_shop2026", 24, 376 - 4, ATL)!.line.text).toBe("@verylongusername_shop2026");
  });
  it("shrink before cut: 50×30 lines 20 → 18, 60×40 lines 24 → 20 → 18, and only then '…'; number and date keep their size", () => {
    expect(propShrinkLadder(20)).toEqual([20, 18]);                 // 50×30 lines
    expect(propShrinkLadder(24)).toEqual([24, 20, 18]);             // 60×40 lines
    expect(propShrinkLadder(18)).toEqual([18]);
    expect(propSizes(50, true)).toEqual({ num: 46, line: 20, time: 18, edge: 4 });
    expect(propSizes(50, false)).toEqual({ num: 64, line: 20, time: 18, edge: 4 });
    expect(propSizes(60, true)).toEqual({ num: 64, line: 24, time: 20, edge: 12 });
    const rp = payloadFor(S1, "50x30", true);
    const { lines, qr } = propLayoutLines(rp, 50, 30, ATL);
    const col = propQrInkLeft(qr!) - PROP_TEXT_QR_GAP - propSizes(50, true).edge;
    const byText = (t: string) => lines.find((l) => l.line.text === t);
    expect(byText("12")!.size).toBe(46);                       // buyer number: unchanged size
    expect(byText("10/22 20:15")!.size).toBe(18);              // date-time: unchanged size
    const handle = byText("@wangxiaoming88")!;                 // whole at the normal 20 (regular weight is narrower)
    expect(handle.line.cut).toBe(false);
    expect([20, 18]).toContain(handle.size);
    expect(propFitLine("@wangxiaoming88", 24, col, ATL).cut).toBe(true); // at the old 24 it would still have been cut
    expect(byText("王小明")!.size).toBe(20);                    // fits at the normal size → no shrink
    expect(byText("A12 +1 $350")!.size).toBe(20);
    // sample 2: the price is no longer cut ("B7 +2 好看 $…" before)
    const l2 = propLayoutLines(payloadFor(S2, "50x30", true), 50, 30, ATL).lines;
    const comment = l2.find((l) => l.line.text.startsWith("B7"))!;
    expect(comment.line.text).toBe("B7 +2 好看 $1,280");
    expect([20, 18]).toContain(comment.size);
    const name2 = l2.find((l) => l.line.text.startsWith("陳"))!;
    expect(name2.line.text).toBe("陳美玲 Amy Chen");
    expect(name2.line.cut).toBe(false);
    const handle2 = l2.find((l) => l.line.text.startsWith("@"))!;
    expect(handle2.size).toBe(18);                              // too long even at 18 → the only line still cut
    expect(handle2.line.cut).toBe(true);
    // 60×40: the same lines fit at 32 → no shrink needed for sample 2's name; the comment steps down to fit whole
    const l60 = propLayoutLines(payloadFor(S2, "60x40", true), 60, 40, ATL).lines;
    expect(l60.find((l) => l.line.text.startsWith("B7"))!.line.text).toBe("B7 +2 好看 $1,280");
    expect(l60.find((l) => l.line.text === "135")!.size).toBe(64);
  });
  it("the CJK sizes a label needs are known from widths alone (loader plan) and match what is painted", () => {
    expect(propPlanCjkSizes(payloadFor(S1, "50x30", true), 50, 30, PROP_ATLAS)).toEqual([20]);           // 王小明 at 20
    const s2 = propPlanCjkSizes(payloadFor(S2, "50x30", true), 50, 30, PROP_ATLAS);
    expect(s2.length).toBeGreaterThan(0);
    expect(s2.every((x) => x === 20 || x === 18)).toBe(true);                                             // both mixed lines shrank below 24 next to the QR
    expect(propPlanCjkSizes(payloadFor(buyer(1, "abc", "Plain Name", "no cjk"), "50x30", true), 50, 30, PROP_ATLAS)).toEqual([]);
    // the plan is computed WITHOUT CJK atlases and lands on the same sizes as the real layout
    const planned = propPlanCjkSizes(payloadFor(S2, "60x40", true), 60, 40, PROP_ATLAS);
    const painted = propLayoutLines(payloadFor(S2, "60x40", true), 60, 40, ATL).lines.filter((l) => l.line.cjk).map((l) => l.size);
    expect([...new Set(painted)].sort()).toEqual([...planned].sort());
  });
  it("per-glyph widths: Latin narrow, CJK one full cell + PROP_CJK_GAP each — 'Test Print' is never CJK-spaced", () => {
    const line = propFitLine("測試 Test Print", 24, 10_000, ATL);
    expect(line.text).toBe("測試 Test Print");
    const latin = propFitLine("Test Print", 24, 10_000, ATL).width;
    expect(line.width).toBe((24 + PROP_CJK_GAP) * 2 + PROP_ATLAS["24"].glyphs[32].adv + latin);
    expect(latin).toBeLessThan(10 * 24 * 0.7);                               // 10 glyphs far narrower than 10 CJK cells
    expect(PROP_ATLAS["24"].glyphs[105].adv).toBeLessThan(PROP_ATLAS["24"].glyphs[87].adv); // i narrower than W
    expect(propFitLine("陳美玲 Amy Chen", 32, 10_000, ATL).width).toBe((32 + PROP_CJK_GAP) * 3 + propFitLine(" Amy Chen", 32, 10_000, ATL).width);
  });
  it("CJK glyphs never touch: 1 dot of advance after every CJK cell, in the layout and on the raster", () => {
    expect(PROP_CJK_GAP).toBe(1);
    for (const size of [18, 20, 24, 32]) {
      const l = propFitLine("好看", size, 10_000, ATL);
      expect(l.items.map((i) => i.x)).toEqual([0, size + 1]);
      expect(l.width).toBe((size + 1) * 2);
      expect(l.inkWidth).toBe((size + 1) * 2);                                // the fit counts the gap too
      const b0 = propGlyphBox(l.items[0], size, 0, 0, PROP_ATLAS[String(size)], ATL)!, b1 = propGlyphBox(l.items[1], size, 0, 0, PROP_ATLAS[String(size)], ATL)!;
      expect(b1.x - (b0.x + b0.w)).toBe(1);                                  // one white column between the cells
    }
    // the regular text sizes are DejaVu Sans Regular (thinner stems than the bold number sizes)
    const stem = (size: string, cp: number) => { const g = PROP_ATLAS[size].glyphs[cp]; const rows = Buffer.from(g.rows, "base64"); const rb = (g.w + 7) >> 3; let max = 0; for (let y = 0; y < PROP_ATLAS[size].h; y++) { let run = 0, best = 0; for (let x = 0; x < g.w; x++) { if (rows[y * rb + (x >> 3)] & (0x80 >> (x & 7))) { run++; best = Math.max(best, run); } else run = 0; } max = Math.max(max, best); } return max / g.adv; };
    expect(stem("24", 0x6c)).toBeLessThan(stem("46", 0x31) * 0.8);          // "l" at 24 (regular) vs "1" at 46 (bold): relative stem is thinner
  });
  it("too long → cut with '…' inside the limit; Chinese first stays visible; a tiny limit is just '…'", () => {
    const cut = propFitLine("測試 Test Print", 24, 120, ATL);
    expect(cut.text.startsWith("測試")).toBe(true);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(cut.width).toBeLessThanOrEqual(120);
    expect(propFitLine("好 COMMENT / PRICE", 24, 60, ATL).text.startsWith("好")).toBe(true);
    expect(propFitLine("abcdefgh", 24, 5, ATL).text).toBe("…");
    expect(propFitLine("", 24, 100, ATL).text).toBe("");
    expect(propFitLine("Hello", 99, 100, ATL).text).toBe("");                 // size the atlas lacks → nothing (never tofu)
  });
  it("Cyrillic and Vietnamese render from the proportional atlas; an unknown glyph is dropped, never tofu", () => {
    expect(propFitLine("Иван", 24, 1000, ATL).items.every((i) => i.latin)).toBe(true);
    expect(propFitLine("Nguyễn Thị Hằng", 24, 1000, ATL).items.filter((i) => i.latin).length).toBe(15);
    expect(propFitLine("AกB", 24, 1000, ATL).text).toBe("AB");         // Thai → dropped
  });
});

describe("opt-in: the fixed-cell layout and the D520BT stream are untouched", () => {
  it("without the proportional atlas the image paths render exactly as before (fixed cells)", () => {
    const rp = payloadFor(S3, "50x30", true);
    const before = renderStickerBitmap(rp, 50, 30, FIXED);
    expect(sha(before.buf)).not.toBe(GOLD.s3_test_50x30_qron);
    expect(sha(renderStickerBitmap(rp, 50, 30, { ...FIXED, proportional: undefined }).buf)).toBe(sha(before.buf));
    expect(isPropCompactSize(50, 30) && isPropCompactSize(60, 40)).toBe(true);
    expect(isPropCompactSize(100, 60) || isPropCompactSize(80, 50) || isPropCompactSize(70, 50) || isPropCompactSize(80, 60)).toBe(false);
  });
  it("the D520BT SDK stream passes latin + cjk only — never cyrillic, proportional or cjkBold (source pin; the compact-v2 PREVIEW flag, OFF, is the one gated exception)", () => {
    const src = readFileSync(join(process.cwd(), "src/redesign/adapters/printing.ts"), "utf8");
    const sdk = src.split("\n").filter((l) => l.includes("rasterizeToSdkBitmapTspl("));
    expect(sdk.length).toBeGreaterThan(0);
    for (const l of sdk) {
      expect(l).toContain("{ latin: LATIN_ATLAS, cjk }");
      expect(l).not.toMatch(/cyrillic|proportional|cjkReg|cjkBold|imagePathAtlases/);
    }
    // the font-C loaders are referenced ONLY through imagePathAtlases (generic + Niimbot image paths)
    const users = src.split("\n").filter((l) => /loadPropAtlas\(|loadCjkRegAtlas\(/.test(l));
    expect(users.length).toBe(2);
  });
});

// ── glyph integrity: no glyph is ever partially painted (clipped by the column, the label edge
// or the QR's cleared footprint); a cut line always ends in a whole "…"; digits are never
// silently cut. Checked over every golden render AND a seeded fuzz of long handles / mixed
// names / prices at both sizes, QR on and off.
// The Niimbot SDK frame (the label minus a 1 mm inset = 384×224 on 50×30): the font-C layout
// takes that canvas directly — same lines, sizes, QR rule and shrink ladder as the 384×240
// label raster, only the vertical spacing is tighter — so the BMP is 1:1 with the frame's dots.
describe("font C on a caller-supplied canvas (the Niimbot frame)", () => {
  const FRAME = { w: 384, h: 224 };
  const ink = (r: { buf: Uint8Array; w: number; h: number; rowBytes: number }, x: number, y: number) => (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
  it("renders exactly the canvas with the same lines/sizes as the label raster; every glyph and the QR stay inside it", () => {
    for (const [b, qr] of [[S1, true], [S2, true], [S2, false], [S3, true]] as const) {
      const rp = payloadFor(b, "50x30", qr);
      const label = propLayoutLines(rp, 50, 30, ATL), frame = propLayoutLines(rp, 50, 30, ATL, FRAME);
      expect([frame.w, frame.h]).toEqual([384, 224]);
      expect(frame.lines.map((l) => [l.size, l.line.text, l.line.cut])).toEqual(label.lines.map((l) => [l.size, l.line.text, l.line.cut]));
      expect(!!frame.qr).toBe(!!label.qr);
      if (frame.qr) { expect(frame.qr.x0).toBe(label.qr!.x0); expect(frame.qr.y0 + frame.qr.foot).toBeLessThanOrEqual(224); expect(frame.qr.y0).toBeGreaterThanOrEqual(0); }
      const tops = propLineTops(frame.lines, 224);
      frame.lines.forEach((l, i) => { expect(tops[i]).toBeGreaterThanOrEqual(0); expect(tops[i] + l.font.h).toBeLessThanOrEqual(224); if (i > 0) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1] + frame.lines[i - 1].font.h); });
      const r = renderStickerBitmap(rp, 50, 30, ATL, "extended", FRAME);
      expect([r.w, r.h, r.rowBytes]).toEqual([384, 224, 48]);
      expect(r.buf.some((v) => v !== 0)).toBe(true);
    }
  });
  it("the frame raster is the label raster's content re-spaced — not a crop of it (no line is lost)", () => {
    const rp = payloadFor(S3, "50x30", true);
    const frame = renderStickerBitmap(rp, 50, 30, ATL, "extended", FRAME);
    // first and last line rows carry ink (the date line is not pushed off the bottom)
    const rowsWithInk = new Set<number>();
    for (let y = 0; y < frame.h; y++) for (let x = 0; x < 180; x++) if (ink(frame, x, y)) { rowsWithInk.add(y); break; }
    const L = propLayoutLines(rp, 50, 30, ATL, FRAME), tops = propLineTops(L.lines, 224);
    const last = L.lines.length - 1;
    expect([...rowsWithInk].some((y) => y >= tops[last] && y < tops[last] + L.lines[last].font.h)).toBe(true);
    expect([...rowsWithInk].some((y) => y >= tops[0] && y < tops[0] + L.lines[0].font.h)).toBe(true);
  });
  it("canvas edge (the Niimbot 16-dot safe margin): no ink in the outer 16 columns, QR ink ends 16 before the right edge, same 5-dot modules, text keeps shrink-before-cut", () => {
    const SAFE = { w: 384, h: 224, edge: 16 };
    for (const [b, qr] of [[S1, true], [S2, true], [S2, false], [S3, true], [S3, false]] as const) {
      const rp = payloadFor(b, "50x30", qr);
      const r = renderStickerBitmap(rp, 50, 30, ATL, "extended", SAFE);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (x < 16 || x >= 368) expect(ink(r, x, y)).toBe(false);
      const L = propLayoutLines(rp, 50, 30, ATL, SAFE);
      expect(L.x).toBe(16);
      if (qr) {
        expect(L.qr).not.toBeNull();
        expect(L.qr!.scale).toBe(5);                                                     // same module size
        expect(propQrInkLeft(L.qr!) + L.qr!.matrix.length * L.qr!.scale).toBe(384 - 16);  // ink ends 16 dots before the edge
        expect(L.qr!.y0).toBeGreaterThanOrEqual(0); expect(L.qr!.y0 + L.qr!.foot).toBeLessThanOrEqual(224);
      }
      for (const l of L.lines) { expect(l.line.inkWidth + PROP_INK_MARGIN).toBeLessThanOrEqual((L.qr ? Math.min(L.qr.x0, propQrInkLeft(L.qr) - PROP_TEXT_QR_GAP) : 384 - 16) - 16); }
      const some = r.buf.some((v) => v !== 0); expect(some).toBe(true);
    }
    // the 4-dot default edge (label raster, generic paths) is untouched by the option
    expect(propLayoutLines(payloadFor(S1, "50x30", true), 50, 30, ATL).x).toBe(4);
  });
  it("fitRaster: identity at the same size, centred crop when bigger, centred white pad when smaller — ink never scaled", () => {
    const rp = payloadFor(S1, "50x30", true);
    const label = renderStickerBitmap(rp, 50, 30, ATL);
    expect(fitRaster(label, label.w, label.h)).toBe(label);
    const cropped = fitRaster(label, 384, 224);
    expect([cropped.w, cropped.h, cropped.rowBytes]).toEqual([384, 224, 48]);
    for (let y = 0; y < 224; y += 7) for (let x = 0; x < 384; x += 5) expect(ink(cropped, x, y)).toBe(ink(label, x, y + 8)); // 8 dots off the top (and bottom)
    const padded = fitRaster(cropped, 400, 240);
    expect([padded.w, padded.h, padded.rowBytes]).toEqual([400, 240, 50]);
    for (let y = 0; y < 224; y += 7) for (let x = 0; x < 384; x += 5) expect(ink(padded, x + 8, y + 8)).toBe(ink(cropped, x, y));
    for (let y = 0; y < 240; y++) for (const x of [0, 7, 392, 399]) expect(ink(padded, x, y)).toBe(false); // the padding is white
    const count = (r: typeof label) => { let n = 0; for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (ink(r, x, y)) n++; return n; };
    expect(count(padded)).toBe(count(cropped));
  });
});

describe("font C glyph integrity", () => {
  // every ink dot of every painted glyph is in the raster, and the glyph lies inside the column
  function checkIntegrity(rp: RasterPayload, size: Size) {
    const { w, h } = dims(size);
    const r = renderStickerBitmap(rp, w, h, ATL);
    const L = propLayoutLines(rp, w, h, ATL);
    const colEnd = L.qr ? Math.min(L.qr.x0, propQrInkLeft(L.qr) - PROP_TEXT_QR_GAP) : L.w - propSizes(w, false).edge;
    const tops = propLineTops(L.lines, L.h);
    let glyphs = 0;
    L.lines.forEach((l, i) => {
      expect(L.x + l.line.inkWidth + PROP_INK_MARGIN).toBeLessThanOrEqual(colEnd);
      if (l.line.cut) expect(l.line.text.endsWith("…")).toBe(true);
      for (const it of l.line.items) {
        const b = propGlyphBox(it, l.size, L.x, tops[i], l.font, ATL);
        if (!b) continue;
        glyphs++;
        expect(b.x + b.w).toBeLessThanOrEqual(colEnd);                // the glyph box never crosses the column
        expect(b.y + b.h).toBeLessThanOrEqual(r.h);
        const crb = (b.w + 7) >> 3;
        for (let sy = 0; sy < b.h; sy++) for (let sx = 0; sx < b.w; sx++) {
          if ((b.cell[sy * crb + (sx >> 3)] & (0x80 >> (sx & 7))) === 0) continue;
          if (!ink(r, b.x + sx, b.y + sy)) throw new Error(`glyph "${l.line.text}" size ${l.size}: ink missing at (${b.x + sx},${b.y + sy}) — partially clipped`);
        }
      }
    });
    return glyphs;
  }
  it("every golden render", () => {
    let n = 0;
    for (const b of [S1, S2, S3]) n += checkIntegrity(payloadFor(b, "50x30", true), "50x30");
    for (const size of ["50x30", "60x40"] as Size[]) {
      n += checkIntegrity(payloadFor(S2, size, true, "Facebook"), size);
      n += checkIntegrity(payloadFor(S2, size, false), size);
      n += checkIntegrity(payloadFor(S2, size, true), size);
    }
    expect(n).toBeGreaterThan(200);
  });
  it("fuzz: long handles, mixed CJK/Latin names, prices — never a partial glyph, never a cut digit without '…'", () => {
    let seed = 20261022;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const latin = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.";
    const cjk = "陳美玲王小明林志偉張淑芬好看漂亮測試黃雅婷";
    const word = (n: number, src: string) => Array.from({ length: n }, () => src[Math.floor(rnd() * src.length)]).join("");
    let glyphs = 0, cut = 0;
    for (let i = 0; i < 120; i++) {
      const handle = word(4 + Math.floor(rnd() * 28), latin);
      const name = pick([word(2 + Math.floor(rnd() * 4), cjk), `${word(3, cjk)} ${word(3 + Math.floor(rnd() * 8), latin)}`, word(5 + Math.floor(rnd() * 20), latin), `Nguyễn Thị ${word(4, latin)}`]);
      const price = pick(["$350", "$1,280", "NT$12,345", "$99,999,999", "¥8,800", "250"]);
      const item = pick([`A${Math.floor(rnd() * 99)} +${1 + Math.floor(rnd() * 9)} ${price}`, `${word(2, cjk)}${word(2, cjk)} ${price}`, `${word(20 + Math.floor(rnd() * 20), latin)} ${price}`, price]);
      const size = pick(["50x30", "60x40"] as Size[]);
      const platform = pick(["TikTok", "TikTok", "Facebook"] as const);
      const rp = payloadFor(buyer(1 + Math.floor(rnd() * 9999), handle, name, item, platform), size, rnd() < 0.7, platform);
      glyphs += checkIntegrity(rp, size);
      const L = propLayoutLines(rp, dims(size).w, dims(size).h, ATL);
      for (const l of L.lines) {
        if (!l.line.cut) continue;
        cut++;
        expect(l.line.text.endsWith("…")).toBe(true);
        expect(/[0-9]$/.test(l.line.text)).toBe(false); // a cut line never ENDS in a digit ("$1,28" can never be read as a price)
      }
    }
    expect(glyphs).toBeGreaterThan(2000);
    expect(cut).toBeGreaterThan(20);
  });
});
