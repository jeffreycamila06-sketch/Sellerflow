// Seller Website — buyer-side links: social profiles and chat apps (only https links are made).
import type { Shop, SocialKey } from "./shopApi";

export const SOCIAL_ORDER: SocialKey[] = ["facebook", "instagram", "tiktok", "youtube", "x", "threads", "shopee"];
/** A social handle / link → a safe https URL on that network. */
export function socialUrl(k: SocialKey, v: string): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return s;
  const h = s.replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!h) return null;
  const base: Record<SocialKey, string> = { facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/", tiktok: "https://www.tiktok.com/@", youtube: "https://www.youtube.com/@", x: "https://x.com/", threads: "https://www.threads.net/@", shopee: "https://shopee.tw/" };
  return base[k] + h;
}
/** The first chat button the seller turned on (Shop "Chat with us" + the bottom nav). */
export function firstChatHref(shop: Shop): string | null {
  const c = shop.shop.chats || {};
  for (const k of ["messenger", "line", "whatsapp", "instagram"] as const) { const u = chatHref(k, c[k] || ""); if (u) return u; }
  return null;
}
/** A chat handle → the app's link (m.me / line.me / wa.me / ig.me). */
export function chatHref(k: "messenger" | "line" | "whatsapp" | "instagram", v: string, text?: string): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return k === "whatsapp" && text ? `${s}${s.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}` : s;
  if (k === "messenger") { const h = s.replace(/^@/, "").replace(/[^A-Za-z0-9.]/g, ""); return h ? `https://m.me/${h}` : null; }
  if (k === "line") { const h = s.replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, ""); return h ? `https://line.me/R/ti/p/@${h}` : null; }
  if (k === "whatsapp") { const n = s.replace(/[^0-9]/g, ""); return n.length >= 8 ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null; }
  const h = s.replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, ""); return h ? `https://ig.me/m/${h}` : null;
}
