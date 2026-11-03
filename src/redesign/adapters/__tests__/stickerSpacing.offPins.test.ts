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
// captured on origin/main 954f599 before any change; SIX re-captured on 2026-11-03 (item 4: the comment
// keeps its chosen 3× size instead of stepping down, so the scale-3 labels of these six digests changed —
// every scale-1 / scale-2 label is still byte-identical; the other nine digests did not move).
// FIVE re-captured on 2026-11-03 (round 3, item 5): the fixed-cell fonts carry no "…" glyph, so a cut comment
// ("size XL…" / "Mine…" on 70×50 / 80×50 / 80×60 beside the QR) painted NOTHING where its "…" belongs — the
// raster now paints three dots there (stickerRaster blitEllipsis). Layout, positions and every other glyph are
// unchanged; the Facebook, 60×40 and 100×60 digests (no "…" on the label) did not move.
const MAIN: Record<string, string> = {
  "TikTok 100x60": "329a215a18d65258976e4e39",
  "TikTok 80x60": "37b760cc470b1931dfd5f079",
  "TikTok 80x50": "75e08947ac4f0c1503a08c3a",
  "TikTok 70x50": "90f9d82f90e879c2983e5bc1",
  "TikTok 60x40": "b8bce2c926cb0db9d2edc56d",
  "Facebook 100x60": "955b2ad835f07bed64940fb7",
  "Facebook 80x60": "263197f1a525c601096c8ec9",
  "Facebook 80x50": "c1ca2f3ca93953c8bc8d76b8",
  "Facebook 70x50": "b91c426f2532a3048a22b656",
  "Facebook 60x40": "198be78134bc2282065334bd",
  "none 100x60": "ee9cf76d7f77584b7d1ff019",
  "none 80x60": "00665400bc6df55e0ac8d849",
  "none 80x50": "135d6e7cff584328470e5eb4",
  "none 70x50": "49d83c7b997e669101fe5b87",
  "none 60x40": "4de2600cf76b5ac5924fd39c",
};

describe("sticker spacing OFF — byte-identical to main (360 labels)", () => {
  for (const p of PIN_PLATFORMS) for (const [w, h] of PIN_SIZES) {
    it(`${p || "no platform"} ${w}x${h}`, () => { expect(pinDigest(p, w, h)).toBe(MAIN[`${p || "none"} ${w}x${h}`]); });
  }
});
