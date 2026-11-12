// LIVE PRINT PATTERN — TikTok / Facebook view (seller screen, OneStickerPattern).
// The view only picks WHICH sample buyer the preview shows and Printer Test prints. It changes no
// setting, no layout, no print path, and is never saved.
//   tiktok   = exactly today's sample (oneStickerPrint sampleInput / sampleBuyer) — unchanged.
//   facebook = the SAME buyer (#128 Maria Santos) as a Facebook order: the comment carries the display
//              name in both `name` and `handle` (fbName.ts), and the sticker input is built by the same
//              two functions a real Facebook order goes through (printableBuyer + oneStickerInputFrom).
import type { Buyer } from "../../lib/orderTypes";
import type { OneStickerInput } from "./oneSticker";
import { oneStickerInputFrom, sampleBuyer, sampleInput, ONE_STICKER_SAMPLE } from "./oneStickerPrint";
import { fbNameOnly, printableBuyer } from "./fbName";

export type StickerView = "tiktok" | "facebook";
/** The four buttons, in order. `soon` = shown, disabled, "Soon" label. */
export const STICKER_VIEWS: readonly { key: string; label: string; soon: boolean }[] = [
  { key: "tiktok", label: "TikTok", soon: false },
  { key: "facebook", label: "Facebook", soon: false },
  { key: "instagram", label: "Instagram", soon: true },
  { key: "shopee", label: "Shopee", soon: true },
];

/** The sample as an ORDER for this view — what Printer Test sends through the normal print functions. */
export function viewSampleBuyer(view: StickerView, item: string = ONE_STICKER_SAMPLE.items[0], at: number = Date.now()): Buyer {
  const b = sampleBuyer(item, at);
  if (view !== "facebook") return b;
  const who = { handle: b.name, platform: "Facebook" };
  return { ...b, ...who, orders: b.orders.map((o) => ({ ...o, ...who })) } as Buyer;
}
/** The preview's input for this view. Facebook: built exactly as the print builds it from the order. */
export function viewSampleInput(view: StickerView, shopName: string, at: number = Date.now()): OneStickerInput {
  if (view !== "facebook") return sampleInput(shopName, at);
  const b = viewSampleBuyer("facebook", ONE_STICKER_SAMPLE.items[0], at);
  return oneStickerInputFrom(printableBuyer(b), shopName, at, fbNameOnly(b.platform, b.name));
}
