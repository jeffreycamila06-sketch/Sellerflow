// 50×30 mm — the fixed compact layout (printer setup v2, image paths only):
//   left column buyer# / @username / name / one-line comment / date+time, right the QR;
//   everything cut with "…" at the column edge, nothing under the QR or off the label;
//   the QR really decodes at print resolution (jsQR on the rendered dots).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import { stickerDrawOps, renderStickerBitmap, rasterizeToBitmapTspl, stickerQrPlacement, rightmostOpEdge, lowestOpBottom, ellipsize, W50, H50, QR_TEXT_KEEPOUT_GAP, STICKER_LAYOUTS, type RasterPayload } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CYRILLIC_ATLAS } from "../glyphAtlas.cyrillic";
import { tiktokProfileUrl } from "../../../lib/tiktokHandle";

const FIX = join(process.cwd(), "src/redesign/adapters/__tests__/fixtures");
const load = (n: string): RasterPayload => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8"));
const FULL = Buffer.alloc(72, 0xff).toString("base64");
const CJK = { cjk: { w: 24, h: 24, glyphs: { 0x9673: FULL, 0x5c0f: FULL, 0x7f8e: FULL, 0x7d05: FULL, 0x8272: FULL, 0x6d0b: FULL, 0x88dd: FULL } } };
const ATL = { latin: LATIN_ATLAS, cjk: CJK, cyrillic: CYRILLIC_ATLAS }; // what the generic / Niimbot image paths pass
const txt = (ops: ReturnType<typeof stickerDrawOps>["ops"], s: string) => ops.find((o) => o.k === "txt" && o.s === s);

describe("50x30 layout", () => {
  it("is registered (384×240 dots = 48 mm printable) and the stream header is the label size", () => {
    expect(STICKER_LAYOUTS["50x30"].wDots).toBe(W50);
    const r = rasterizeToBitmapTspl(load("s50_tiktok"), 50, 30, ATL);
    expect(Buffer.from(r.bytes).subarray(0, 16).toString("ascii")).toBe("SIZE 50 mm, 30 m");
    expect(Buffer.from(r.bytes).includes(Buffer.from("BITMAP 0,"))).toBe(true);
    expect(r.bytes.length).toBeLessThan(14000); // ~1 s over BLE
  });

  it("TikTok: buyer# biggest, @username, name, comment, date+time; no SellerFlowLive line; left of the QR", () => {
    const p = load("s50_tiktok");
    const qr = stickerQrPlacement(p, W50, H50, 30);
    expect(qr).not.toBeNull();
    const { ops, wDots, hDots } = stickerDrawOps(p, 50, 30, "extended", qr);
    expect([wDots, hDots]).toEqual([W50, H50]);
    expect(txt(ops, "88")).toMatchObject({ font: "4", xm: 2, ym: 2, y: 6 });
    expect(txt(ops, "@maria_live")).toMatchObject({ font: "3" });   // 11 chars fit font 3 (187-dot column)
    expect(txt(ops, "Maria Santos")).toMatchObject({ font: "2" });  // 12 chars → whole at font 2 instead of "Maria Sant…"
    expect(txt(ops, "COMMENT / PRICE")).toMatchObject({ font: "2" });
    expect(txt(ops, "10/21 14:05")).toMatchObject({ font: "2" });
    expect(ops.some((o) => o.k === "txt" && /SellerFlow/i.test(o.s))).toBe(false);
    expect(ops.some((o) => o.k === "bar")).toBe(false);
    expect(rightmostOpEdge(ops)).toBeLessThanOrEqual(qr!.x0 - QR_TEXT_KEEPOUT_GAP);
    expect(lowestOpBottom(ops)).toBeLessThanOrEqual(H50);
    // the @username / name / comment / date are stacked top → bottom
    const ys = ["@maria_live", "Maria Santos", "COMMENT / PRICE", "10/21 14:05"].map((s) => txt(ops, s)!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("the QR is label-tall (5 dots/module), on the right, and DECODES to the buyer's TikTok URL", () => {
    const p = load("s50_tiktok");
    const qr = stickerQrPlacement(p, W50, H50, 30)!;
    expect(qr.scale).toBe(5);
    // the SYMBOL (left quiet zone + modules) ends inside the raster; its right quiet zone is the
    // last 8 raster dots + the label's unprinted 2 mm
    expect(qr.x0 + (qr.matrix.length + 4) * qr.scale).toBeLessThanOrEqual(W50 - 8);
    expect(qr.y0 + qr.foot).toBeLessThanOrEqual(H50);
    expect(qr.foot).toBeGreaterThan(H50 * 0.7); // nearly the full height
    const img = renderStickerBitmap(p, 50, 30, ATL);
    const rgba = new Uint8ClampedArray(img.w * img.h * 4);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const ink = (img.buf[y * img.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const i = (y * img.w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = ink ? 0 : 255; rgba[i + 3] = 255;
    }
    const d = jsQR(rgba, img.w, img.h);
    expect(d?.data).toBe(tiktokProfileUrl("maria_live"));
  });

  it("FB name-only: no @ line, no QR, the name on its line", () => {
    const p = load("s50_fb_name_only");
    expect(stickerQrPlacement(p, W50, H50, 30)).toBeNull();
    const { ops } = stickerDrawOps(p, 50, 30, "extended", null);
    expect(ops.some((o) => o.k === "txt" && o.s.startsWith("@"))).toBe(false);
    expect(txt(ops, "Juan Dela Cruz Santos")).toBeTruthy(); // 21 chars fit the full width (no QR)
    expect(txt(ops, "12")).toMatchObject({ font: "4", xm: 2 });
  });

  it("Chinese name → the CJK atlas line; a Chinese comment too", () => {
    const p = load("s50_chinese_name");
    const qr = stickerQrPlacement(p, W50, H50, 30);
    const { ops } = stickerDrawOps(p, 50, 30, "extended", qr);
    expect(ops.find((o) => o.k === "cjk" && o.s === "陳小美")).toBeTruthy();
    // "700 紅色洋裝" = 8 CJK-cells (24 dots each) > the 187-dot column → 6 kept + "…"
    expect(ops.find((o) => o.k === "cjk" && o.s === "700 紅色")).toBeTruthy();
    expect(ops.find((o) => o.k === "txt" && o.s === "…")).toBeTruthy();
    const img = renderStickerBitmap(p, 50, 30, ATL);
    expect(img.buf.some((b) => b !== 0)).toBe(true);
  });

  it("long username / name / comment are cut with … and never cross into the QR; 4-digit buyer# narrows", () => {
    const p = load("s50_long_comment");
    const qr = stickerQrPlacement(p, W50, H50, 30)!;
    const { ops } = stickerDrawOps(p, 50, 30, "extended", qr);
    const cut = ops.filter((o) => o.k === "txt" && o.s.endsWith("…"));
    expect(cut.length).toBeGreaterThanOrEqual(3); // @username, name, comment
    expect(txt(ops, "1234")).toMatchObject({ font: "4", xm: 1, ym: 2 });
    expect(rightmostOpEdge(ops)).toBeLessThanOrEqual(qr.x0 - QR_TEXT_KEEPOUT_GAP);
    expect(lowestOpBottom(ops)).toBeLessThanOrEqual(H50);
    expect(ops.some((o) => o.k === "txt" && o.s.includes("Nguyễn"))).toBe(true); // Vietnamese diacritics kept
  });

  it("ellipsize", () => {
    expect(ellipsize("hello", 5)).toBe("hello");
    expect(ellipsize("hello world", 5)).toBe("hell…");
    expect(ellipsize("陳小美 Amy", 4)).toBe("陳小美…");
    expect(ellipsize("ab", 1)).toBe("…");
  });

  it("the other sizes are untouched by the 50x30 branch", () => {
    const p = load("s50_tiktok");
    const { ops, wDots } = stickerDrawOps(p, 60, 40, "extended", null);
    expect(wDots).toBe(480);
    expect(txt(ops, "SellerFlowLive")).toBeTruthy();
  });
});
