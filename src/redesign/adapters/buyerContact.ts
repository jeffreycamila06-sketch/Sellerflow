// Buyer contact (docs/plans/buyer-contact.md) — the platform a parcel buyer can be reached on
// (TikTok / LINE / WhatsApp / Facebook / Instagram / Other) and the one-tap contact links on
// Pickup Status. PURE: no imports from screens, no Supabase. The stored contact value stays in
// the SAME column as today's buyer @username (parcel_scans.notes = 賣貨便 col J, FM
// buyer_username); the platform is a NEW nullable column (contact_platform, sql/140).
// NULL platform = TikTok / legacy — every existing row keeps today's behaviour.
import { isAdminRole } from "../../lib/roles";
import { PARCEL_TRACKING_TIERS } from "./parcelTracking";

export const BUYER_CONTACT_PLATFORMS = ["tiktok", "line", "whatsapp", "facebook", "instagram", "other"] as const;
export type BuyerContactPlatform = (typeof BUYER_CONTACT_PLATFORMS)[number];
export const DEFAULT_CONTACT_PLATFORM: BuyerContactPlatform = "tiktok";
export const CONTACT_MAX_LEN = 50; // 賣貨便 col J limit — the stored value is never longer
// What the picker input accepts before normalising (a pasted Facebook link can be ~80 chars and
// must reach facebookStoredValue whole — the 50 limit is on the SAVED value only).
export const RAW_INPUT_MAX = 300;

export const isContactPlatform = (v: unknown): v is BuyerContactPlatform =>
  typeof v === "string" && (BUYER_CONTACT_PLATFORMS as readonly string[]).includes(v);
// A stored platform → the picker's platform (NULL / unknown = TikTok, the legacy meaning).
export const platformOf = (v: unknown): BuyerContactPlatform => (isContactPlatform(v) ? v : DEFAULT_CONTACT_PLATFORM);

// ── Gate (v2 item 8) — who gets the picker: an admin, a preview-key account, or (switch on)
// a Plus/Pro/Master seller — the same tiers as Pickup Status. marketHidden wins. A basic/free
// seller on the parcel_check list does NOT get the picker.
export function buyerContactVisible(a: {
  role?: string | null; plan?: string | null; switchOn?: boolean; previewKey?: boolean; marketHidden?: boolean;
} | null | undefined): boolean {
  if (!a) return false;
  if (a.marketHidden) return false;
  if (isAdminRole(a.role)) return true;
  if (a.previewKey === true) return true;
  if (a.switchOn !== true) return false;
  const tier = String(a.plan ?? "").trim().toLowerCase();
  return (PARCEL_TRACKING_TIERS as readonly string[]).includes(tier);
}

// ── WhatsApp numbers ──────────────────────────────────────────────────────────
// Digits only, "00" international prefix dropped; a Taiwan mobile (09xxxxxxxx, 10 digits) →
// 886 + 9…, a Philippine mobile (09xxxxxxxxx, 11 digits) → 63 + 9…; anything else is taken
// as already carrying its country code. Valid = 8–15 digits (E.164); else null.
export function whatsappDigits(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^09\d{8}$/.test(d)) d = `886${d.slice(1)}`;
  else if (/^09\d{9}$/.test(d)) d = `63${d.slice(1)}`;
  return /^\d{8,15}$/.test(d) ? d : null;
}

// ── Facebook ──────────────────────────────────────────────────────────────────
// A link (facebook.com / fb.com / m.me / fb.me, any subdomain, with or without a scheme) is
// parsed with an ALLOWLIST — only these shapes give a value, everything else is refused on save
// (contactError "facebook"), so photo/?fbid=, sharer.php, share/…, media/set, gaming/… can never
// be stored as "photo" / "share" (= m.me/photo → a stranger, and every such buyer merged):
//   profile.php?id=<digits> · people/<anything>/<digits> · messages/t/<digits> · p/<Name>-<digits 6+>
//   · a path that is only digits → "fb:<id>"
//   facebook.com/share/<code>[/] → "fbshare:<code>"
//   m.me/<digits> · messenger.com/t/<digits> → "fb:<id>" (ids are 1–20 digits everywhere; fb.me / fb.watch refused)
//   m.me/<username> · facebook.com/<username>[/<about|photos|videos|friends|reels|followers|following|mentions>]
//   → "<username>" (FB_USERNAME, no ".php", not reserved)
// The stored value is never longer than col J's 50 chars; contactLink rebuilds the URL. Plain
// text (a name, a plain id) stays as typed.
const FB_LINK = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(facebook\.com|fb\.com|m\.me|fb\.me|messenger\.com|fb\.watch)(?::\d+)?(?=[/?#]|$)/i;
const FB_ID = /^\d{1,20}$/; // a numeric Facebook id is never longer than 20 digits
export const isFacebookLink = (raw: string): boolean => FB_LINK.test(String(raw ?? "").trim());
// First path segments that are never a username — the second guard behind the allowlist, and
// what keeps an already-stored reserved word (old rows) from ever becoming an m.me link.
export const FB_RESERVED = new Set(["share", "people", "groups", "watch", "messages", "reel", "reels", "stories", "story.php", "photo.php", "permalink.php", "profile.php", "home.php", "login", "marketplace", "events", "pages", "hashtag", "search", "videos", "friends", "sharer", "l.php",
  "photo", "photos", "media", "gaming", "share.php", "sharer.php", "video.php", "login.php", "live", "notes", "help", "settings", "notifications", "bookmarks", "saved", "business", "ads", "pg", "p", "profile", "fundraisers", "dialog", "plugins", "checkpoint", "privacy", "policies",
  "video", "donate", "recover", "memories", "watchparty", "messenger", "instantgames", "places", "offers", "latest", "feeds", "composer",
  "about", "terms", "policy", "careers", "legal", "directory", "mobile", "games", "campaign", "security", "safety", "community", "support", "hacked", "adsmanager", "insights", "commerce", "shops", "weather", "fundraiser", "tools", "developers"]);
// facebook.com/<username>/<sub>: only these profile tabs; any other second segment is refused.
const FB_PROFILE_SUB = new Set(["about", "photos", "videos", "friends", "reels", "followers", "following", "mentions"]);
// facebook.com/share/<code>/ — the FB app's "Share profile" link; stored as "fbshare:<code>" (the
// code is opaque, contactLink reopens the share URL). /share/p|r|v/… and deeper paths are refused.
const FB_SHARE_CODE = /^[A-Za-z0-9]{6,20}$/;
export const FB_SHARE_STORED = /^fbshare:([A-Za-z0-9]{6,20})$/;
export const fbReserved = (stored: string): boolean => FB_RESERVED.has(String(stored ?? "").trim().toLowerCase());
export const FB_USERNAME = /^[A-Za-z0-9][A-Za-z0-9.]{3,48}[A-Za-z0-9]$/; // 5–50, starts and ends with a letter/digit (no "....", "juan.", "..juan")
// A stored value that is really a website (shop.com, page.me, …) is never an m.me username.
export const FB_WEBSITE = /\.(?:com|net|org|co|me|io|tw|ph)$/i;
const fbUsernameOk = (u: string): boolean => FB_USERNAME.test(u) && !/^\d+$/.test(u) && !/\.php$/i.test(u) && !fbReserved(u); // all digits = an id (≤20) or nothing
// null = not a link; "" = a link with no usable profile (refused); else the stored value.
export function parseFacebookLink(raw: string): string | null {
  const v = String(raw ?? "").trim();
  const hm = FB_LINK.exec(v);
  if (!hm) return null;
  const host = hm[1].toLowerCase();
  const after = v.slice(hm[0].length).split("#")[0]; // the #fragment is dropped before the query is read
  const qi = after.indexOf("?");
  const path = (qi < 0 ? after : after.slice(0, qi));
  const query = qi < 0 ? "" : after.slice(qi + 1);
  const seg = path.split("/").filter(Boolean);
  if (host === "fb.me" || host === "fb.watch") return "";
  if (host === "m.me") return seg.length === 1 ? (FB_ID.test(seg[0]) ? `fb:${seg[0]}` : fbUsernameOk(seg[0]) ? seg[0] : "") : "";
  if (host === "messenger.com") return seg.length === 2 && seg[0].toLowerCase() === "t" && FB_ID.test(seg[1]) ? `fb:${seg[1]}` : "";
  const s0 = (seg[0] ?? "").toLowerCase();
  if (s0 === "profile.php" && seg.length === 1) { const m = /(?:^|[?&])id=(\d{1,20})(?:&|$)/.exec(query); return m ? `fb:${m[1]}` : ""; } // id=100abc / 21+ digits → refused
  if (s0 === "share") return host === "facebook.com" && seg.length === 2 && FB_SHARE_CODE.test(seg[1]) ? `fbshare:${seg[1]}` : "";
  if (s0 === "people" && seg.length === 3 && FB_ID.test(seg[2])) return `fb:${seg[2]}`;
  if (s0 === "messages" && seg.length === 3 && seg[1].toLowerCase() === "t" && FB_ID.test(seg[2])) return `fb:${seg[2]}`;
  if (s0 === "p" && seg.length === 2) { const m = /-(\d{6,20})$/.exec(seg[1]); return m ? `fb:${m[1]}` : ""; }
  if (seg.length === 1 && FB_ID.test(seg[0])) return `fb:${seg[0]}`;
  if (seg.length === 1 && fbUsernameOk(seg[0])) return seg[0];
  if (seg.length === 2 && fbUsernameOk(seg[0]) && FB_PROFILE_SUB.has(seg[1].toLowerCase())) return seg[0];
  return "";
}
export function facebookStoredValue(raw: string): string {
  const v = String(raw ?? "").trim();
  const link = parseFacebookLink(v);
  return (link === null || link === "" ? v : link).slice(0, CONTACT_MAX_LEN);
}

// ── Normalise for saving (the col J value) ────────────────────────────────────
function normalizeUncapped(platform: BuyerContactPlatform, raw: string): string {
  const v = String(raw ?? "");
  switch (platform) {
    case "whatsapp": { const d = whatsappDigits(v); return d ? `+${d}` : v.trim(); }
    case "line": return v.trim().replace(/^@+/, "").toLowerCase();
    case "facebook": { const t = v.trim(); const link = parseFacebookLink(t); return link ? link : t; }
    case "instagram": return v.trim().replace(/^@+/, "");
    case "other": return v.trim();
    default: return v; // tiktok: verbatim, exactly today's handle rule
  }
}
export const normalizeContact = (platform: BuyerContactPlatform, raw: string): string => normalizeUncapped(platform, raw).slice(0, CONTACT_MAX_LEN);

// Save-blocking error: WhatsApp (not 8–15 digits) or a Facebook link outside the allowlist
// (share / photo / sharer.php / a bare domain / …). "" = fine. The LINE "looks like a phone number" case is a
// hint, not a block (lineHint).
export function contactError(platform: BuyerContactPlatform, raw: string): "" | "whatsapp" | "facebook" {
  const v = String(raw ?? "").trim();
  if (v === "") return "";
  if (platform === "whatsapp") return whatsappDigits(v) ? "" : "whatsapp";
  if (platform === "facebook") return parseFacebookLink(v) === "" ? "facebook" : ""; // a link that is not a profile
  return "";
}
// The saved value would be cut at 50 → the field shows a "max 50" hint. Compares what WOULD be
// saved before the cap (TikTok / Other keep the "@", so "@" + 50 chars is cut; LINE / Instagram
// drop it; a Facebook LINK becomes the username / fb:<id>; a valid WhatsApp number is short).
export const contactTruncated = (platform: BuyerContactPlatform, raw: string): boolean => normalizeUncapped(platform, raw).length > CONTACT_MAX_LEN;
export const lineHint = (raw: string): boolean => /^\d{4,}$/.test(String(raw ?? "").trim());
export const LINE_ID = /^[a-z0-9._-]{4,20}$/;
export const IG_USERNAME = /^[A-Za-z0-9._]{1,30}$/;

// ── Pickup Status action per platform ─────────────────────────────────────────
// open  = a real link (<a href target=_blank>); `copy` is what the tap also copies first
//         (the ready message) — WhatsApp carries the message in the URL instead.
// copy  = no link for this value (a Facebook name, "Other", an unusable id): copy the message,
//         and `contact` is offered as a second copy.
export type ContactAction =
  | { kind: "open"; url: string; copy: string | null }
  | { kind: "copy"; text: string; contact: string };
export function contactLink(platform: BuyerContactPlatform, value: string, message: string): ContactAction | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  switch (platform) {
    case "whatsapp": {
      const d = whatsappDigits(v);
      if (!d) return { kind: "copy", text: message, contact: v };
      return { kind: "open", url: `https://wa.me/${d}?text=${encodeURIComponent(message)}`, copy: null };
    }
    case "line": {
      const id = v.replace(/^@+/, "").toLowerCase();
      if (/^\d+$/.test(id) || !LINE_ID.test(id)) return { kind: "copy", text: message, contact: v }; // all digits = a phone number, not a LINE id
      return { kind: "open", url: `https://line.me/R/ti/p/~${encodeURIComponent(id)}`, copy: message };
    }
    case "facebook": {
      const stored = facebookStoredValue(v);
      const idm = /^fb:(\d{1,20})$/.exec(stored);
      if (idm) return { kind: "open", url: `https://www.facebook.com/profile.php?id=${idm[1]}`, copy: message };
      if (FB_WEBSITE.test(stored)) return { kind: "copy", text: message, contact: stored }; // a website, not a username
      const sh = FB_SHARE_STORED.exec(stored);
      if (sh) return { kind: "open", url: `https://www.facebook.com/share/${sh[1]}/`, copy: message };
      if (/^fbshare:/i.test(stored)) return { kind: "copy", text: message, contact: stored }; // a malformed share value
      if (fbReserved(stored) || /\.php$/i.test(stored)) return { kind: "copy", text: message, contact: stored }; // "share" / "photo.php" (old rows) is nobody's username — never m.me
      if (/^\d+$/.test(stored)) return { kind: "copy", text: message, contact: stored }; // a phone typed into the FB field never opens m.me
      if (FB_USERNAME.test(stored)) return { kind: "open", url: `https://m.me/${encodeURIComponent(stored)}`, copy: message };
      return { kind: "copy", text: message, contact: stored }; // a name → copy only
    }
    case "instagram": {
      const u = v.replace(/^@+/, "");
      if (!IG_USERNAME.test(u)) return { kind: "copy", text: message, contact: v };
      return { kind: "open", url: `https://ig.me/m/${encodeURIComponent(u)}`, copy: message };
    }
    case "other": return { kind: "copy", text: message, contact: v };
    default: return null; // tiktok: the screen keeps today's chaseTarget + a separate Copy message
  }
}

// ── The ready message (v2 item 4): Customer Details name, else the no-name greeting; a masked
// name (contains "*", like J*f*r*y from parcel_tracking) is treated as no name. Seller UI language.
export interface PickupMessageInput { name?: string | null; carrier: "711" | "fm"; store: string; amount: string; deadline: string }
export function pickupMessage(
  t: { rd_pt_msg_tpl: string; rd_pt_msg_tpl_noname: string; rd_pt_carrier_711: string; rd_pt_carrier_fm: string },
  m: PickupMessageInput,
): string {
  const name = String(m.name ?? "").trim();
  const usable = name !== "" && !name.includes("*");
  const vars: Record<string, string> = {
    name, carrier: m.carrier === "fm" ? t.rd_pt_carrier_fm : t.rd_pt_carrier_711,
    store: m.store || "—", amount: m.amount || "—", deadline: m.deadline || "—",
  };
  const tpl = usable ? t.rd_pt_msg_tpl : t.rd_pt_msg_tpl_noname;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

// ── Pickup Status contact map (v2 items 2 + 3) ────────────────────────────────
// Lookup keys: "<normHandle>|<storeId>" first (precise), then "<normHandle>". Built from the
// seller's own scan tables (newest wins); carrier fm rows read the FM tables first.
export const contactKey = (handle: string, storeId?: string | null): string => (storeId ? `${handle}|${storeId}` : handle);
export function lookupContact(map: Map<string, BuyerContactPlatform>, handle: string, storeId?: string | null): BuyerContactPlatform | null {
  if (!handle) return null;
  if (storeId) { const p = map.get(contactKey(handle, storeId)); if (p) return p; }
  return map.get(handle) ?? null;
}
