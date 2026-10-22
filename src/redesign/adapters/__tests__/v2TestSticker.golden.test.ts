// Printer setup v2 TEST sticker (generic + Niimbot image paths) — byte goldens, plus the proof
// that the D520BT test sticker's input is untouched. The v2 test buyer carries Chinese first
// ("測試 Test Print" / "好 COMMENT / PRICE") so a seller sees on paper whether CJK prints; next
// to the QR the 50×30 layout cuts the line to 7 CJK-wide cells and the Chinese stays visible.
// Time is pinned (buildTestBuyer stamps the clock) so the bytes are deterministic.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildNativeStickerPayload, buildGenericStickerBytes, buildNiimbotImage, imageStickerPayload, DEF_SETTINGS } from "../printing";
import { buildTestBuyer, buildTestBuyerV2, TEST_NAME_V2, TEST_COMMENT_V2 } from "../printerBridge";
import { renderStickerBitmap, stickerDrawOps, stickerQrPlacement, W50, H50, type RasterPayload } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CYRILLIC_ATLAS } from "../glyphAtlas.cyrillic";
import { CJK_ATLAS } from "../glyphAtlas.cjk";

const AT = Date.UTC(2026, 9, 22, 12, 15); // 2026-10-22 20:15 Taipei
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fixedBuyer = () => { const b = buildTestBuyerV2(); return { ...b, orders: [{ ...b.orders[0], time: "20:15" }] }; };
const payload = () => buildNativeStickerPayload(fixedBuyer(), "NT$", "SellerFlowLive", { ...DEF_SETTINGS, stickerSize: "50x30" }, AT);
const ATL = { latin: LATIN_ATLAS, cjk: CJK_ATLAS, cyrillic: CYRILLIC_ATLAS };
const withQr = (p: RasterPayload, on: boolean): RasterPayload => ({ ...p, settings: { ...(p.settings ?? {}), printStickerQr: on } });

const GOLDEN = {
  tspl: "e091d680d1f4130283b299209a516aefc0bc3d6b3e0da9f43d131385214ce83b",
  escpos: "3751f89d68de3c6d839b26d99f20f52f0770cf0f248112842fcbf6e87bf5de63",
  cpcl: "54ff1233a0313b73af42e86fbcbba399c69dc71632e8761cbe5dbea22d947b07",
  niimbot: "5607a01b6cbdb9f91f3392ffd3833bef5824484db6221c69ff224b4da8f65d09", // = the raster with the QR off
  rasterQrOn: "48478c8c2695c7f81fa95ff46dec607c2bea0be750371af15ba39a6c1d6a1329",
  rasterQrOff: "5607a01b6cbdb9f91f3392ffd3833bef5824484db6221c69ff224b4da8f65d09",
};

describe("v2 test sticker goldens (generic + Niimbot)", () => {
  it("the three generic language streams", async () => {
    const p = payload();
    expect(sha(await buildGenericStickerBytes("tspl", p, "TikTok"))).toBe(GOLDEN.tspl);
    expect(sha(await buildGenericStickerBytes("escpos", p, "TikTok"))).toBe(GOLDEN.escpos);
    expect(sha(await buildGenericStickerBytes("cpcl", p, "TikTok"))).toBe(GOLDEN.cpcl);
  });
  it("the Niimbot image (always 50×30, 384×240 1-bit)", async () => {
    const img = await buildNiimbotImage(payload(), "TikTok");
    expect([img.w, img.h, img.rowBytes, img.labelWidthMm, img.labelHeightMm]).toEqual([384, 240, 48, 50, 30]);
    expect(sha(Buffer.from(img.data, "base64"))).toBe(GOLDEN.niimbot);
  });
  it("the raster with the QR on and off", () => {
    const rp = imageStickerPayload(payload(), "TikTok");
    expect(sha(renderStickerBitmap(withQr(rp, true), 50, 30, ATL).buf)).toBe(GOLDEN.rasterQrOn);
    expect(sha(renderStickerBitmap(withQr(rp, false), 50, 30, ATL).buf)).toBe(GOLDEN.rasterQrOff);
  });
  it("Chinese stays visible next to the QR (the cut keeps the leading CJK) and whole without it", () => {
    const rp = imageStickerPayload(payload(), "TikTok");
    const on = withQr(rp, true), off = withQr(rp, false);
    const qr = stickerQrPlacement(on, W50, H50, 30);
    expect(qr).not.toBeNull();
    const cjkOps = (p: RasterPayload, q: ReturnType<typeof stickerQrPlacement>) => stickerDrawOps(p, 50, 30, "extended", q, true).ops.filter((o) => o.k === "cjk").map((o) => (o as { s: string }).s);
    const next = cjkOps(on, qr);
    expect(next.some((s) => s.startsWith("測試 Tes"))).toBe(true);
    expect(next.some((s) => s.startsWith("好 COMM"))).toBe(true);
    const whole = cjkOps(off, null);
    expect(whole).toContain(TEST_NAME_V2);                 // 14 cells fit the full column
    expect(whole.some((s) => s.startsWith("好 COMMENT / PR"))).toBe(true); // 17 cells → cut at 15
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
