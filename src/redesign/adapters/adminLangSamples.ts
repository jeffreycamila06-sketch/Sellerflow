// ADMIN ONLY — language test samples for the new Live print pattern screen (OneStickerPattern).
// A chip swaps the preview to one of these; Printer Test then prints it through the SAME functions
// a real order uses (new sticker: printOneStickerTest; today's sticker: printSlip with noOneSticker,
// where the all-scripts language fix applies). Sellers never see these (gated on isAdmin only).
// The samples follow the one-sticker proof set (docs/design/one-sticker, __tests__/oneSticker.samples.ts).
import type { Buyer } from "../../lib/orderTypes";
import type { OneStickerInput } from "./oneSticker";
import { oneStickerInputFrom, ONE_STICKER_SAMPLE } from "./oneStickerPrint";
import { fbNameOnly, printableBuyer } from "./fbName";

export interface AdminLangSample { key: string; label: string; num: number; name: string; handle: string; platform: string; item: string }
export const ADMIN_LANG_SAMPLES: readonly AdminLangSample[] = [
  { key: "en", label: "English", num: 12, name: "Amy Chen", handle: "amy.shop", platform: "TikTok", item: "A2 x2 350 black dress size M" },
  { key: "zh", label: "中文", num: 23, name: "陳小美", handle: "chen.mei", platform: "TikTok", item: "我要這件黑色洋裝 M 號 兩件" },
  { key: "ja", label: "日本語", num: 7, name: "田中さん", handle: "tanaka", platform: "TikTok", item: "田中さん「ワンピース」１２３" },
  { key: "ko", label: "한국어", num: 31, name: "김민지", handle: "minji", platform: "TikTok", item: "한국어 원피스 주세요" },
  { key: "th", label: "ไทย", num: 45, name: "สมใจ ใจดี", handle: "somjai", platform: "TikTok", item: "ไทย ขอบคุณค่ะ ชุดสีดำ" },
  { key: "ar", label: "العربية", num: 52, name: "مريم", handle: "maryam", platform: "TikTok", item: "العربية مرحبا فستان" },
  { key: "bg", label: "Български", num: 64, name: "Мария Иванова", handle: "maria.iv", platform: "TikTok", item: "Българска рокля М" },
  { key: "vi", label: "Tiếng Việt", num: 77, name: "Nguyễn Thị Hương", handle: "huong.ng", platform: "TikTok", item: "Đầm đen size M 350 cảm ơn shop" },
  { key: "fancy", label: "Fancy/emoji", num: 101, name: "🔥𝓐𝓶𝔂 𝐋𝐢𝐦🔥", handle: "amylim", platform: "TikTok", item: "🔥 A3 350 💖" },
  // Facebook: the handle IS the display name (no @username, no QR on the sticker)
  { key: "fb", label: "Facebook", num: 345, name: "Maria Clara Dela Cruz Santos Reyes", handle: "Maria Clara Dela Cruz Santos Reyes", platform: "Facebook", item: "B7 black dress" },
  { key: "n1234", label: "Buyer #1234", num: 1234, name: "Maria Santos", handle: "maria_live", platform: "TikTok", item: "A12 350" },
];
/** No chip picked: the screen's own sample (#128 Maria Santos "COMMENT / PRICE"). */
export const ADMIN_DEFAULT_SAMPLE: AdminLangSample = { key: "default", label: "Sample", num: ONE_STICKER_SAMPLE.buyerNum, name: ONE_STICKER_SAMPLE.name, handle: ONE_STICKER_SAMPLE.handle, platform: ONE_STICKER_SAMPLE.platform, item: ONE_STICKER_SAMPLE.items[0] };

const TAIPEI_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** The sample as an order — what the test print sends through the normal print path. */
export function adminSampleBuyer(s: AdminLangSample, at: number = Date.now()): Buyer {
  return { num: s.num, name: s.name, handle: s.handle, platform: s.platform, totalSpent: 0, totalOrders: 1,
    orders: [{ orderNum: at, item: s.item, qty: 1, price: 0, total: 0, time: TAIPEI_TIME.format(new Date(at)), handle: s.handle, name: s.name, bNum: s.num, platform: s.platform, status: "New", date: new Date(at).toISOString().slice(0, 10) }] } as unknown as Buyer;
}
/** The preview's input for the sample: built EXACTLY as the print builds it from the order
 *  (printableBuyer + oneStickerInputFrom, Facebook = name only), with the seller's own shop. */
export function adminSampleInput(s: AdminLangSample, shopName: string, at: number = Date.now()): OneStickerInput {
  const b = adminSampleBuyer(s, at);
  return oneStickerInputFrom(printableBuyer(b), shopName, at, fbNameOnly(b.platform, b.name));
}
