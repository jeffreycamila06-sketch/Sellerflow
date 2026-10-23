// Printer setup v2 TEST sticker (generic + Niimbot image paths) — byte goldens, plus the proof
// that the D520BT test sticker's input is untouched. The v2 test buyer carries Chinese first
// ("測試 Test Print" / "好 COMMENT / PRICE") so a seller sees on paper whether CJK prints.
// The image paths render the compact sizes in font C (proportional DejaVu Sans Bold + Noto
// Sans CJK TC Bold) — see stickerRaster.prop.test.ts; the goldens here go through the
// PRODUCTION functions (buildGenericStickerBytes / buildNiimbotImage, real atlas loaders).
// Time is pinned (buildTestBuyer stamps the clock) so the bytes are deterministic.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildNativeStickerPayload, buildGenericStickerBytes, buildNiimbotImage, imageStickerPayload, DEF_SETTINGS } from "../printing";
import { buildTestBuyer, buildTestBuyerV2, TEST_NAME_V2, TEST_COMMENT_V2 } from "../printerBridge";
import { renderStickerBitmap, propLayoutLines, type RasterPayload, type RasterAtlases } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CYRILLIC_ATLAS } from "../glyphAtlas.cyrillic";
import { CJK_ATLAS } from "../glyphAtlas.cjk";
import { PROP_ATLAS } from "../glyphAtlas.prop";
import { CJK_BOLD_ATLAS as B24 } from "../glyphAtlas.cjkBold24";
import { CJK_BOLD_ATLAS as B20 } from "../glyphAtlas.cjkBold20";
import { CJK_BOLD_ATLAS as B18 } from "../glyphAtlas.cjkBold18";

const AT = Date.UTC(2026, 9, 22, 12, 15); // 2026-10-22 20:15 Taipei
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fixedBuyer = () => { const b = buildTestBuyerV2(); return { ...b, orders: [{ ...b.orders[0], time: "20:15" }] }; };
const payload = () => buildNativeStickerPayload(fixedBuyer(), "NT$", "SellerFlowLive", { ...DEF_SETTINGS, stickerSize: "50x30" }, AT);
const ATL: RasterAtlases = { latin: LATIN_ATLAS, cjk: CJK_ATLAS, cyrillic: CYRILLIC_ATLAS, proportional: PROP_ATLAS, cjkBold: { 18: B18, 20: B20, 24: B24 } };
const withQr = (p: RasterPayload, on: boolean): RasterPayload => ({ ...p, settings: { ...(p.settings ?? {}), printStickerQr: on } });

const GOLDEN = {
  tspl: "bd42507b9dfe1cf085175c42b4bdb10dc2f55e68b856fc1720b5f3833bbe08c7",
  escpos: "67a1d75abf5c6f1e24bcb9eb85ae28f77ef20e53be6f04db5463313f41fdf997",
  cpcl: "0cb27aa2774066d823d7b1b66fe9da8e5899bb1e81da981669c18125591249ad",
  niimbot: "dd8f29f6d3b776d3da39d096dc7a0a2de5e4fc3afacde21d042e268cb506bcd7", // = the raster with the QR off
  rasterQrOn: "ac2276337742654b4e518c9746013343474e51a2d8545621d1c868cd07042d08",
  rasterQrOff: "dd8f29f6d3b776d3da39d096dc7a0a2de5e4fc3afacde21d042e268cb506bcd7", // == niimbot (the production image path)
};

describe("v2 test sticker goldens (generic + Niimbot, production functions)", () => {
  it("the three generic language streams", async () => {
    const p = payload();
    expect(sha(await buildGenericStickerBytes("tspl", p, "TikTok"))).toBe(GOLDEN.tspl);
    expect(sha(await buildGenericStickerBytes("escpos", p, "TikTok"))).toBe(GOLDEN.escpos);
    expect(sha(await buildGenericStickerBytes("cpcl", p, "TikTok"))).toBe(GOLDEN.cpcl);
  });
  it("the Niimbot image (always 50×30, 384×240 1-bit) = the font-C raster with the QR off", async () => {
    const img = await buildNiimbotImage(payload(), "TikTok");
    expect([img.w, img.h, img.rowBytes, img.labelWidthMm, img.labelHeightMm]).toEqual([384, 240, 48, 50, 30]);
    expect(sha(Buffer.from(img.data, "base64"))).toBe(GOLDEN.niimbot);
    const rp = imageStickerPayload(payload(), "TikTok");
    expect(sha(renderStickerBitmap(withQr(rp, false), 50, 30, ATL).buf)).toBe(GOLDEN.niimbot);
  });
  it("the raster with the QR on and off", () => {
    const rp = imageStickerPayload(payload(), "TikTok");
    expect(sha(renderStickerBitmap(withQr(rp, true), 50, 30, ATL).buf)).toBe(GOLDEN.rasterQrOn);
    expect(sha(renderStickerBitmap(withQr(rp, false), 50, 30, ATL).buf)).toBe(GOLDEN.rasterQrOff);
  });
  it("next to the QR every line prints WHOLE in font C (the comment shrinks 24 → 18 instead of being cut); without the QR all at 24", () => {
    const rp = imageStickerPayload(payload(), "TikTok");
    const on = propLayoutLines(withQr(rp, true), 50, 30, ATL);
    expect(on.qr).not.toBeNull();
    const texts = (l: typeof on.lines) => l.map((x) => `${x.size}:${x.line.text}${x.line.cut ? "(cut)" : ""}`);
    expect(texts(on.lines)).toEqual(["46:88", "24:@sellerflow", `24:${TEST_NAME_V2}`, `18:${TEST_COMMENT_V2}`, "18:10/22 20:15"]);
    const off = propLayoutLines(withQr(rp, false), 50, 30, ATL);
    expect(off.qr).toBeNull();
    expect(texts(off.lines)).toEqual(["64:88", "24:@sellerflow", `24:${TEST_NAME_V2}`, `24:${TEST_COMMENT_V2}`, "18:10/22 20:15"]);
  });
});

describe("D520BT test sticker input is untouched", () => {
  it("buildTestBuyer and the native payload built from it are exactly today's", () => {
    const d = buildTestBuyer();
    expect([d.num, d.name, d.handle, d.orders[0].item, d.orders[0].price, d.orders.length]).toEqual([88, "Test Print", "sellerflow", "PRICE", 350, 1]);
    const p = buildNativeStickerPayload(d, "NT$", "SellerFlowLive", DEF_SETTINGS, AT);
    expect([p.buyer.name, p.buyer.orders[0].item, p.labelWidthMm, p.labelHeightMm]).toEqual(["Test Print", "PRICE", 100, 60]);
    expect(p.buyer.name).not.toBe(TEST_NAME_V2);
    expect(p.buyer.orders[0].item).not.toBe(TEST_COMMENT_V2);
  });
});
