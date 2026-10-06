// STICKER SPACING — switch OFF = byte-identical to main. Every label below is rasterized
// with the printHalfWordGap / printSpacing flags ABSENT (what a non-allowed seller sends);
// the per-(platform,size) digests were captured on origin/main 954f599 BEFORE the change.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { rasterizeToSdkBitmapTspl, type RasterPayload, type RasterSettings } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CJK_ATLAS } from "../glyphAtlas.cjk";

export const PIN_SIZES: [number, number][] = [[100, 60], [80, 60], [80, 50], [70, 50], [60, 40]];
export const PIN_PLATFORMS = ["TikTok", "Facebook", ""] as const;
const BUYERS: Record<string, { name: string; handle: string }> = {
  TikTok: { name: "Cristine Ramos Cabañas", handle: "cristineramos" },
  Facebook: { name: "Caren Kay Ragasa Chao", handle: "Caren Kay Ragasa Chao" },
  "": { name: "陳小美的店", handle: "chen.mei" },
};
// Mirrors printing.ts: Facebook = name once (no @ line) and never a QR; Total is off on stickers.
export function pinPayload(platform: string, scale: number, v2: boolean, qr: boolean, orders: number, extra: RasterSettings = {}): RasterPayload {
  const fb = platform === "Facebook";
  const b = BUYERS[platform];
  return {
    storeName: "My Shop", sessionDate: "10/07/2026", currency: "NT$",
    buyer: { num: 12, name: b.name, handle: b.handle, totalSpent: 640,
      orders: [{ time: "21:41", item: "Mine black size XL 2pcs 350" }, { time: "21:42", item: "藍色外套 2件" }].slice(0, orders) },
    settings: {
      printStoreName: true, printBuyerNumber: true, printBuyerUsername: !fb, printOrderItems: true, printTotal: false,
      printStoreScale: scale, printBuyerNumberScale: scale, printBuyerNameScale: scale, printUsernameScale: scale,
      printOrderScale: 1, printCommentScale: scale, printTotalScale: scale,
      printStickerQr: qr && !fb,
      ...(v2 ? { printCommentFullWidth: true } : {}), ...(fb ? { printFacebookName: true } : {}), ...extra,
    },
  };
}
// one digest per (platform, size) over scales 1–3 × v2 on/off × QR on/off × 1–2 orders (24 labels)
export function pinDigest(platform: string, w: number, h: number, extra: RasterSettings = {}): string {
  const all = createHash("sha256");
  for (const scale of [1, 2, 3]) for (const v2 of [true, false]) for (const qr of [true, false]) for (const n of [1, 2]) {
    const bytes = rasterizeToSdkBitmapTspl(pinPayload(platform, scale, v2, qr, n, extra), w, h, { latin: LATIN_ATLAS, cjk: CJK_ATLAS }).bytes;
    all.update(createHash("sha256").update(bytes).digest());
  }
  return all.digest("hex").slice(0, 24);
}
// captured on origin/main 954f599 before any change
const MAIN: Record<string, string> = {
  "TikTok 100x60": "329a215a18d65258976e4e39",
  "TikTok 80x60": "fbd5d93680aac48424d37ba1",
  "TikTok 80x50": "aea2a8551be4951d1bbdd173",
  "TikTok 70x50": "ba05658f75f9de61d3f5d459",
  "TikTok 60x40": "b8bce2c926cb0db9d2edc56d",
  "Facebook 100x60": "0781d9d2c5f139240c99e63c",
  "Facebook 80x60": "263197f1a525c601096c8ec9",
  "Facebook 80x50": "9cc13a13ff6bc9e0897e1f63",
  "Facebook 70x50": "a2fec4011683841b4b4f2689",
  "Facebook 60x40": "29f6032cbf1ae6a0abfc6d76",
  "none 100x60": "ee9cf76d7f77584b7d1ff019",
  "none 80x60": "57d3a9178a17c75fc4e4f723",
  "none 80x50": "e760bc8d62458f8fa9abb1ca",
  "none 70x50": "4a957a3175bbba4e52b053e4",
  "none 60x40": "4de2600cf76b5ac5924fd39c",
};

describe("sticker spacing OFF — byte-identical to main (360 labels)", () => {
  for (const p of PIN_PLATFORMS) for (const [w, h] of PIN_SIZES) {
    it(`${p || "no platform"} ${w}x${h}`, () => { expect(pinDigest(p, w, h)).toBe(MAIN[`${p || "none"} ${w}x${h}`]); });
  }
});
