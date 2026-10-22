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
import { renderStickerBitmap, rasterizeToBitmapTspl, propQrPlacement, propQrInkLeft, propFitLine, propFitShrinking, propShrinkLadder, propLayoutLines, propPlanCjkSizes, propSizes, isPropCompactSize, PROP_TEXT_QR_GAP, STICKER_LAYOUTS, QR_QUIET_MODULES, type RasterPayload, type RasterAtlases } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CYRILLIC_ATLAS } from "../glyphAtlas.cyrillic";
import { CJK_ATLAS } from "../glyphAtlas.cjk";
import { PROP_ATLAS } from "../glyphAtlas.prop";
import { CJK_BOLD_ATLAS as B24 } from "../glyphAtlas.cjkBold24";
import { CJK_BOLD_ATLAS as B32 } from "../glyphAtlas.cjkBold32";
import { CJK_BOLD_ATLAS as B20 } from "../glyphAtlas.cjkBold20";
import { CJK_BOLD_ATLAS as B18 } from "../glyphAtlas.cjkBold18";
import { buildNativeStickerPayload, imageStickerPayload, DEF_SETTINGS } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

const GOLD = JSON.parse(readFileSync(join(process.cwd(), "src/redesign/adapters/__tests__/stickerRasterPropGoldens.json"), "utf8")) as Record<string, string>;
const AT = Date.UTC(2026, 9, 22, 12, 15); // 10/22/2026 20:15 Taipei
const ATL: RasterAtlases = { latin: LATIN_ATLAS, cjk: CJK_ATLAS, cyrillic: CYRILLIC_ATLAS, proportional: PROP_ATLAS, cjkBold: { 18: B18, 20: B20, 24: B24, 32: B32 } };
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
      for (let y = 0; y < r.h; y++) {
        for (let x = inkLeft - PROP_TEXT_QR_GAP; x < inkLeft; x++) if (ink(r, x, y)) gapInk++;
        for (let x = 0; x < inkLeft - PROP_TEXT_QR_GAP; x++) if (ink(r, x, y)) textRight = Math.max(textRight, x);
      }
      expect(gapInk).toBe(0);
      expect(textRight).toBeLessThan(inkLeft - PROP_TEXT_QR_GAP);
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
  it("shrink before cut: username / name / comment step 24 → 20 → 18 and only then get '…'; number and date keep their size", () => {
    expect(propShrinkLadder(24)).toEqual([24, 20, 18]);
    expect(propShrinkLadder(32)).toEqual([32, 24, 20, 18]);
    expect(propShrinkLadder(18)).toEqual([18]);
    const rp = payloadFor(S1, "50x30", true);
    const { lines, qr } = propLayoutLines(rp, 50, 30, ATL);
    const col = propQrInkLeft(qr!) - PROP_TEXT_QR_GAP - propSizes(50, true).edge;
    const byText = (t: string) => lines.find((l) => l.line.text === t);
    expect(byText("12")!.size).toBe(46);                       // buyer number: unchanged size
    expect(byText("10/22 20:15")!.size).toBe(18);              // date-time: unchanged size
    const handle = byText("@wangxiaoming88")!;                 // was "@wangxiaomi…" at 24 → now whole, one step down
    expect(handle.line.cut).toBe(false);
    expect(handle.size).toBe(20);
    expect(propFitLine("@wangxiaoming88", 24, col, ATL).cut).toBe(true);
    expect(byText("王小明")!.size).toBe(24);                    // fits at the normal size → no shrink
    expect(byText("A12 +1 $350")!.size).toBe(24);
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
    expect(propPlanCjkSizes(payloadFor(S1, "50x30", true), 50, 30, PROP_ATLAS)).toEqual([24]);           // 王小明 at 24
    const s2 = propPlanCjkSizes(payloadFor(S2, "50x30", true), 50, 30, PROP_ATLAS);
    expect(s2.length).toBeGreaterThan(0);
    expect(s2.every((x) => x === 20 || x === 18)).toBe(true);                                             // both mixed lines shrank below 24 next to the QR
    expect(propPlanCjkSizes(payloadFor(buyer(1, "abc", "Plain Name", "no cjk"), "50x30", true), 50, 30, PROP_ATLAS)).toEqual([]);
    // the plan is computed WITHOUT CJK atlases and lands on the same sizes as the real layout
    const planned = propPlanCjkSizes(payloadFor(S2, "60x40", true), 60, 40, PROP_ATLAS);
    const painted = propLayoutLines(payloadFor(S2, "60x40", true), 60, 40, ATL).lines.filter((l) => l.line.cjk).map((l) => l.size);
    expect([...new Set(painted)].sort()).toEqual([...planned].sort());
  });
  it("per-glyph widths: Latin narrow, CJK one full cell each — 'Test Print' is never CJK-spaced", () => {
    const line = propFitLine("測試 Test Print", 24, 10_000, ATL);
    expect(line.text).toBe("測試 Test Print");
    const latin = propFitLine("Test Print", 24, 10_000, ATL).width;
    expect(line.width).toBe(24 * 2 + PROP_ATLAS["24"].glyphs[32].adv + latin);
    expect(latin).toBeLessThan(10 * 24 * 0.7);                               // 10 glyphs far narrower than 10 CJK cells
    expect(PROP_ATLAS["24"].glyphs[105].adv).toBeLessThan(PROP_ATLAS["24"].glyphs[87].adv); // i narrower than W
    expect(propFitLine("陳美玲 Amy Chen", 32, 10_000, ATL).width).toBe(32 * 3 + propFitLine(" Amy Chen", 32, 10_000, ATL).width);
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
  it("the D520BT SDK stream passes latin + cjk only — never cyrillic, proportional or cjkBold (source pin)", () => {
    const src = readFileSync(join(process.cwd(), "src/redesign/adapters/printing.ts"), "utf8");
    const sdk = src.split("\n").filter((l) => l.includes("rasterizeToSdkBitmapTspl("));
    expect(sdk.length).toBeGreaterThan(0);
    for (const l of sdk) {
      expect(l).toContain("{ latin: LATIN_ATLAS, cjk }");
      expect(l).not.toMatch(/cyrillic|proportional|cjkBold|imagePathAtlases/);
    }
    // the font-C loaders are referenced ONLY through imagePathAtlases (generic + Niimbot image paths)
    const users = src.split("\n").filter((l) => /loadPropAtlas\(|loadCjkBoldAtlas\(/.test(l));
    expect(users.length).toBe(2);
  });
});
