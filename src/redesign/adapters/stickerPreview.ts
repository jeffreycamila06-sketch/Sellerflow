// LIVE print pattern — the exact raster payload for the admin sticker preview: the same
// native payload + bitmap-only flags the phone bitmap path builds, for a sample buyer.
import { buildNativeStickerPayload, type Settings } from "./printing";
import type { RasterPayload } from "./stickerRaster";
import type { Buyer } from "../../lib/orderTypes";

export const PREVIEW_COMMENT = "+1 我要這件黑色 size M 2件 pls reserve 老闆娘 thank you so much";
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

