// LIVE print pattern — the exact raster payload for the admin sticker preview: the same
// native payload + bitmap-only flags the phone bitmap path builds, for a sample buyer.
import { buildNativeStickerPayload, type Settings } from "./printing";
import type { RasterPayload, RasterSettings } from "./stickerRaster";
import type { Buyer } from "../../lib/orderTypes";

// The sample comment v2 users see in the LIVE print pattern preview and on their test
// sticker (Printer settings + LIVE print pattern). Non-v2 sellers keep "PRICE".
export const PREVIEW_COMMENT = "COMMENT / PRICE";
const previewBuyer = (): Buyer => ({
  handle: "maria_live", name: "Maria Santos", platform: "TikTok", num: 12, totalSpent: 350, totalOrders: 1,
  orders: [{ orderNum: 1, item: PREVIEW_COMMENT, qty: 1, price: 350, total: 350, time: "14:05", handle: "maria_live", name: "Maria Santos", bNum: 12, platform: "TikTok", status: "New", date: "2026-09-30" }],
} as Buyer);

// The exact raster payload the phone bitmap path builds (native payload + the bitmap-only
// flags), for the preview buyer. Exported for tests.
export function previewPayload(settings: Settings, cur: string, shopName: string, v2: boolean): { payload: RasterPayload; w: number; h: number } {
  const np = buildNativeStickerPayload(previewBuyer(), cur, shopName, settings);
  const payload: RasterPayload = { ...np, settings: { ...np.settings, printStickerQr: true, ...(v2 ? { printCommentFullWidth: true } : {}) } };
  return { payload, w: np.labelWidthMm, h: np.labelHeightMm };
}


// Sticker spacing preview: the SAME image payload the print builds for this seller — the real
// image-only flags (QR only when it would really print, spacing choice), not a forced QR.
export function exactPreviewPayload(settings: Settings, cur: string, shopName: string, flags: RasterSettings, buyer: Buyer = previewBuyer()): { payload: RasterPayload; w: number; h: number } {
  const np = buildNativeStickerPayload(buyer, cur, shopName, settings);
  return { payload: { ...np, settings: { ...np.settings, ...flags } }, w: np.labelWidthMm, h: np.labelHeightMm };
}
