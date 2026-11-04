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
// A facebook.com / m.facebook.com / fb.com link → its username, or "fb:<id>" for
// profile.php?id=… (v2 item 5: the stored value is never longer than col J's 50 chars;
// contactLink rebuilds the full URL). A plain username stays; a name stays as typed.
const FB_HOST = /^(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.com)\//i;
// First path segments that are NEVER a username (facebook.com/share/1AbC…, /people/…, …). A
// link whose first segment is reserved and carries no numeric id is refused on save
// (contactError "facebook"); a reserved value already stored never becomes an m.me link.
export const FB_RESERVED = new Set(["share", "people", "groups", "watch", "messages", "reel", "reels", "stories", "story.php", "photo.php", "permalink.php", "profile.php", "home.php", "login", "marketplace", "events", "pages", "hashtag", "search", "videos", "friends", "sharer", "l.php"]);
export const fbReserved = (stored: string): boolean => FB_RESERVED.has(String(stored ?? "").trim().toLowerCase());
export const isFacebookLink = (raw: string): boolean => FB_HOST.test(String(raw ?? "").trim());
export function facebookStoredValue(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!FB_HOST.test(v)) return v.slice(0, CONTACT_MAX_LEN);
  const rest = v.replace(FB_HOST, "").replace(/^\/+/, "");
  const idm = /^profile\.php\?(?:.*&)?id=(\d+)/i.exec(rest) // profile.php?id=<digits>
    ?? /^people\/[^/?#]+\/(\d+)(?:[/?#]|$)/i.exec(rest)      // people/<name>/<digits>/
    ?? /^messages\/t\/(\d+)(?:[/?#]|$)/i.exec(rest);          // messages/t/<digits>
  if (idm) return `fb:${idm[1]}`;
  const user = rest.split(/[/?#]/)[0] || "";
  return (user || v).slice(0, CONTACT_MAX_LEN);
}
export const FB_USERNAME = /^[A-Za-z0-9.]{5,50}$/;

// ── Normalise for saving (the col J value) ────────────────────────────────────
export function normalizeContact(platform: BuyerContactPlatform, raw: string): string {
  const v = String(raw ?? "");
  switch (platform) {
    case "whatsapp": { const d = whatsappDigits(v); return d ? `+${d}` : v.trim().slice(0, CONTACT_MAX_LEN); }
    case "line": return v.trim().replace(/^@+/, "").toLowerCase().slice(0, CONTACT_MAX_LEN);
    case "facebook": return facebookStoredValue(v);
    case "instagram": return v.trim().replace(/^@+/, "").slice(0, CONTACT_MAX_LEN);
    case "other": return v.trim().slice(0, CONTACT_MAX_LEN);
    default: return v.slice(0, CONTACT_MAX_LEN); // tiktok: verbatim, exactly today's handle rule
  }
}

// Save-blocking error: WhatsApp (not 8–15 digits) or a Facebook link that is not a profile
// (share / people without an id / …). "" = fine. The LINE "looks like a phone number" case is a
// hint, not a block (lineHint).
export function contactError(platform: BuyerContactPlatform, raw: string): "" | "whatsapp" | "facebook" {
  const v = String(raw ?? "").trim();
  if (v === "") return "";
  if (platform === "whatsapp") return whatsappDigits(v) ? "" : "whatsapp";
  if (platform === "facebook") return FB_HOST.test(v) && fbReserved(facebookStoredValue(v)) ? "facebook" : "";
  return "";
}
// The saved value would be cut at 50 (a Facebook LINK is shortened to the username / fb:<id>
// instead, a valid WhatsApp number is always short) → the field shows a "max 50" hint.
export function contactTruncated(platform: BuyerContactPlatform, raw: string): boolean {
  const v = String(raw ?? "").trim();
  if (platform === "facebook" && FB_HOST.test(v)) return false;
  if (platform === "whatsapp" && whatsappDigits(v)) return false;
  return v.replace(/^@+/, "").length > CONTACT_MAX_LEN;
}
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
      const idm = /^fb:(\d+)$/.exec(stored);
      if (idm) return { kind: "open", url: `https://www.facebook.com/profile.php?id=${idm[1]}`, copy: message };
      if (fbReserved(stored)) return { kind: "copy", text: message, contact: stored }; // "share" etc. (old rows) is nobody's username — never m.me
      if (/^\d{15,}$/.test(stored)) return { kind: "copy", text: message, contact: stored };
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
