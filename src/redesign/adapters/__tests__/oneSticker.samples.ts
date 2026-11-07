// Shared samples of the one-sticker pixel test and proof pictures (sizes × samples).
import type { Buyer } from "../../../lib/orderTypes";

export const AT = Date.UTC(2026, 10, 7, 6, 5);
export const SAMPLES: { key: string; shop: string; buyer: Buyer; qr: boolean }[] = (() => {
  const b = (_key: string, name: string, handle: string, item: string, platform = "TikTok", num = 12): Buyer => ({
    num, name, handle, platform, totalSpent: 0, totalOrders: 1,
    orders: [{ orderNum: AT, item, qty: 1, price: 0, total: 0, time: "14:05", handle, name, bNum: num, platform, status: "New", date: "2026-11-07" }],
  } as unknown as Buyer);
  return [
    { key: "tiktok-qr", shop: "Maria Ukay Shop", buyer: b("t", "Amy Chen", "amy.shop", "A2 x2 350"), qr: true },
    { key: "tiktok-noqr", shop: "Maria Ukay Shop", buyer: b("t", "Amy Chen", "amy.shop", "A2 x2 350"), qr: false },
    { key: "facebook-long-name", shop: "Maria Ukay Shop", buyer: b("f", "Maria Clara Dela Cruz Santos Reyes", "Maria Clara Dela Cruz Santos Reyes", "B7 black dress", "Facebook", 345), qr: true },
    { key: "long-comment", shop: "Maria Ukay Shop", buyer: b("l", "Joy M", "joy.m", "ako po yung black dress size M pa reserve po and the red one too thank you so much po", "TikTok", 88), qr: true },
    { key: "chinese", shop: "美美小舖", buyer: b("c", "陳小美", "chen.mei", "我要這件黑色洋裝 M 號 兩件", "TikTok", 23), qr: true },
    { key: "japanese", shop: "Maria Ukay Shop", buyer: b("j", "田中さん", "tanaka", "日本語 田中さん「ワンピース」１２３", "TikTok", 7), qr: true },
    { key: "korean", shop: "Maria Ukay Shop", buyer: b("k", "김민지", "minji", "한국어 원피스 주세요", "TikTok", 31), qr: true },
    { key: "thai", shop: "Maria Ukay Shop", buyer: b("th", "สมใจ", "somjai", "ไทย ขอบคุณค่ะ ชุดสีดำ", "TikTok", 45), qr: true },
    { key: "arabic", shop: "Maria Ukay Shop", buyer: b("a", "مريم", "maryam", "العربية مرحبا فستان", "TikTok", 52), qr: true },
    { key: "bulgarian", shop: "Мария Шоп", buyer: b("bg", "Мария Иванова", "maria.iv", "Български рокля М", "TikTok", 64), qr: true },
    { key: "emoji-fancy", shop: "Maria Ukay Shop", buyer: b("e", "🔥𝓐𝓶𝔂 𝐋𝐢𝐦🔥", "amylim", "🔥 A3 350 💖", "TikTok", 101), qr: true },
    { key: "blank-shop", shop: "", buyer: b("bs", "Amy Chen", "amy.shop", "A2 x2 350"), qr: true },
  ];
})();
export const SIZES: [number, number][] = [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60], [40, 30], [75, 45]];

// Readability guard samples (one per script).
export const READ_SAMPLES: Record<string, { name: string; items: string[] }> = {
  chinese: { name: "陳小美", items: ["我要這件黑色洋裝 M 號 兩件"] },
  japanese: { name: "田中さん", items: ["日本語「ワンピース」１２３"] },
  korean: { name: "김민지", items: ["한국어 원피스 주세요"] },
  thai: { name: "สมใจ", items: ["ไทย ขอบคุณค่ะ ชุดสีดำ"] },
  arabic: { name: "مريم", items: ["العربية مرحبا فستان"] },
  cyrillic: { name: "Мария Иванова", items: ["Българска рокля М"] },
  latin: { name: "Amy Chen", items: ["ako po yung black dress size M"] },
};
