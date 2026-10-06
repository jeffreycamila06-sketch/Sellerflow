// LIVE print pattern — "will it fit?" warning for the image (bitmap) sticker. Computed on the
// LAYOUT step only (stickerDrawOps, no image render) against a fixed sample: a 20-letter
// three-word name and a 27-character six-word comment. Display only — nothing printed.
import type { Settings } from "./printing";
import type { Buyer } from "../../lib/orderTypes";
import { exactPreviewPayload } from "./stickerPreview";
import { stickerDrawOps, stickerQrPlacement, lowestOpBottom, rightmostOpEdge, STICKER_LAYOUTS, type DrawOp, type RasterSettings } from "./stickerRaster";

export const FIT_SAMPLE_NAME = "Cristine Ramos Cabanas";        // 20 letters, 3 words
export const FIT_SAMPLE_COMMENT = "Mine black size XL 2pcs 350";   // 27 characters, 6 words
export const FIT_SAMPLE_HANDLE = "cristineramos";

export interface StickerFit {
  overflow: boolean;                 // a) something ends past the bottom or right edge
  commentScale: number | null;       // b) the scale the comment will print at, when stepped down from the chosen one
  cut: boolean;                      // c) fewer comment words / name letters than at all-1× scales
}

const sampleBuyer = (): Buyer => ({
  handle: FIT_SAMPLE_HANDLE, name: FIT_SAMPLE_NAME, platform: "TikTok", num: 12, totalSpent: 350, totalOrders: 1,
  orders: [{ orderNum: 1, item: FIT_SAMPLE_COMMENT, qty: 1, price: 350, total: 350, time: "14:05", handle: FIT_SAMPLE_HANDLE, name: FIT_SAMPLE_NAME, bNum: 12, platform: "TikTok", status: "New", date: "2026-09-30" }],
} as Buyer);

interface Measure { ops: DrawOp[]; hDots: number; wDots: number; commentXm: number | null; words: number; letters: number }
function measure(settings: Settings, cur: string, shopName: string, flags: RasterSettings): Measure {
  const { payload, w, h } = exactPreviewPayload(settings, cur, shopName, flags, sampleBuyer());
  const cfg = STICKER_LAYOUTS[`${w}x${h}`] ?? STICKER_LAYOUTS["100x60"];
  const r = stickerDrawOps(payload, w, h, "extended", stickerQrPlacement(payload, cfg.wDots, h * 8, h));
  const sep = r.ops.find((o) => o.k === "bar" && o.x === 16);
  const sepY = sep ? sep.y : Infinity;
  const buyerOp = r.ops.find((o) => o.k === "txt" && o.s === "Buyer");
  const buyerY = buyerOp ? buyerOp.y : -1;
  const text = r.ops.filter((o): o is Exclude<DrawOp, { k: "bar" }> => o.k !== "bar");
  const comment = text.filter((o) => o.y > sepY && !(o.k === "txt" && o.font === "2"));
  const name = text.filter((o) => o.k === "txt" && o.font === "4" && o.y < sepY && o.y > 48 && o.y !== buyerY);
  return {
    ops: r.ops, hDots: r.hDots, wDots: r.wDots,
    commentXm: comment.length ? comment[0].xm : null,
    words: comment.reduce((n, o) => n + o.s.split(/\s+/).filter(Boolean).length, 0),
    letters: name.reduce((n, o) => n + o.s.replace(/\s/g, "").length, 0),
  };
}

export function stickerFit(settings: Settings, cur: string, shopName: string, flags: RasterSettings): StickerFit {
  const now = measure(settings, cur, shopName, flags);
  const ones: Settings = { ...settings, printStoreScale: 1, printBuyerNumberScale: 1, printBuyerNameScale: 1, printUsernameScale: 1, printOrderScale: 1, printCommentScale: 1, printTotalScale: 1 };
  const base = measure(ones, cur, shopName, flags);
  const chosen = Math.max(1, Math.min(8, Number(settings.printCommentScale) || 1));
  const printed = now.commentXm == null ? null : now.commentXm / 2;
  return {
    overflow: lowestOpBottom(now.ops) > now.hDots || rightmostOpEdge(now.ops) > now.wDots,
    commentScale: flags.printCommentFullWidth && printed != null && printed < chosen ? printed : null,
    cut: now.words < base.words || now.letters < base.letters,
  };
}
export const stickerFitWarns = (f: StickerFit): boolean => f.overflow || f.commentScale != null || f.cut;
