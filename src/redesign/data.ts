// Redesign (Phase 2) — prototype sample data + helpers.
// Verbatim from design-redesign/SellerFlowLive.dc.html (data L858–952, helpers
// L1029–1033, accents L870–878, langs L860–868, incoming L887–896).
// NOTE: this is the prototype's static SAMPLE data (₱ / "Maria's Live Shop").
// Phase 5 swaps it for the real Taiwan app data (NT$, real sellers) + real APIs.

export type ThemeMode = "light" | "dark";
export type AccentKey = "indigo" | "violet" | "emerald" | "rose" | "sky" | "amber";

export const ACCENT_ORDER: AccentKey[] = ["indigo", "violet", "emerald", "rose", "sky", "amber"];
export const ACCENTS: Record<AccentKey, { name: string; base: string; light: string; dark: string }> = {
  indigo: { name: "Indigo", base: "#4f46e5", light: "#a5b4fc", dark: "#3730a3" },
  violet: { name: "Violet", base: "#7c3aed", light: "#c4b5fd", dark: "#5b21b6" },
  emerald: { name: "Emerald", base: "#059669", light: "#34d399", dark: "#065f46" },
  rose: { name: "Rose", base: "#e11d48", light: "#fda4af", dark: "#9f1239" },
  sky: { name: "Sky", base: "#0284c7", light: "#7dd3fc", dark: "#075985" },
  amber: { name: "Amber", base: "#d97706", light: "#fcd34d", dark: "#b45309" },
};

export const LANGS = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "fil", label: "Filipino", flag: "🇵🇭" },
  { code: "id", label: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
  { code: "zh", label: "中文 (简体)", flag: "🇨🇳" },
  { code: "zh-tw", label: "中文 (繁體)", flag: "🇹🇼" },
  { code: "th", label: "ไทย", flag: "🇹🇭" },
];

// Currency switcher (dc.html v3 L1555). The derived symbol `cur` threads through
// every money display. Sample/visual only — Phase 5 wires the real Taiwan NT$.
export const CURRENCIES: Record<string, string> = { USD: "$", PHP: "₱", IDR: "Rp", VND: "₫", CNY: "¥", TWD: "NT$", THB: "฿" };
export const CURRENCY_ORDER: string[] = ["USD", "PHP", "IDR", "VND", "CNY", "TWD", "THB"];
export const curSymbol = (code: string): string => CURRENCIES[code] || "$";

export interface Comment { id: string; name: string; handle: string; text: string; mine: boolean; time: string; }

// (F-batch sweep: the INCOMING/SEED_COMMENTS sample streams are gone — the live
// feed has been the real socket since 5d; nothing consumed them.)

export interface Order { id: string; buyer: string; handle: string; items: string; qty: number; total: number; status: string; platform: string; time: string; }
export interface Miner { name: string; handle: string; orders: number; spent: number; platform: string; }

export const ORDERS: Order[] = [
  { id: "#10472", buyer: "Maria Santos", handle: "@maria_shops", items: "Matte Lipstick ×2 · Tumbler ×1", qty: 3, total: 897, status: "Unpaid", platform: "TikTok", time: "2m" },
  { id: "#10471", buyer: "Kim Tan", handle: "@kimtanph", items: "Cotton Tee — White M", qty: 1, total: 349, status: "Paid", platform: "TikTok", time: "5m" },
  { id: "#10470", buyer: "Liza Reyes", handle: "@lizareyes", items: "Insulated Tumbler — Black", qty: 1, total: 399, status: "Packed", platform: "Facebook", time: "11m" },
  { id: "#10469", buyer: "Grace Lim", handle: "@gracelim", items: "Rose Gold Watch", qty: 1, total: 1299, status: "Shipped", platform: "TikTok", time: "24m" },
  { id: "#10468", buyer: "Nene Bautista", handle: "@nene.b", items: "Running Sneakers — Size 7 ×2", qty: 2, total: 1798, status: "Paid", platform: "Facebook", time: "33m" },
  { id: "#10467", buyer: "Joy Aquino", handle: "@joyaquino", items: "Skincare Bundle Set", qty: 1, total: 649, status: "Unpaid", platform: "TikTok", time: "40m" },
];

// (F-batch sweep: sample PRODUCTS/MINERS/TT_ACCOUNTS/FB_ACCOUNTS removed — the
// Products screen has real local+DB CRUD, Miners is RPC-only since 2026-07-05,
// and the account pickers show the seller's real registered accounts.)

// Customers + Comment archive (dc.html DATA.customers L922–930, archive L931–937).
export interface Customer { name: string; handle: string; orders: number; spent: number; last: string; platform: string; }
export const CUSTOMERS: Customer[] = [
  { name: "Maria Santos", handle: "@maria_shops", orders: 24, spent: 18420, last: "2m", platform: "TikTok" },
  { name: "Grace Lim", handle: "@gracelim", orders: 18, spent: 14250, last: "24m", platform: "TikTok" },
  { name: "Liza Reyes", handle: "@lizareyes", orders: 16, spent: 12990, last: "11m", platform: "Facebook" },
  { name: "Kim Tan", handle: "@kimtanph", orders: 15, spent: 9870, last: "5m", platform: "TikTok" },
  { name: "Nene Bautista", handle: "@nene.b", orders: 9, spent: 7640, last: "33m", platform: "Facebook" },
  { name: "Joy Aquino", handle: "@joyaquino", orders: 7, spent: 4310, last: "40m", platform: "TikTok" },
  { name: "Rico Tan", handle: "@ricotan", orders: 4, spent: 2180, last: "1h", platform: "Facebook" },
];
// (Batch B: the ARCHIVE comment-demo rows and the fictional PRINTERS hardware
// list were removed — Customers now shows an honest no-archive note, and the
// Settings picker builds honest capability slots from i18n + the real saved
// devices reported by the native bridge.)

// Auto-detect keyword controls (visual only). Lives in General Settings;
// shared from RedesignApp state. (Removed from the Dashboard per Jeff's call.)
// v3: each trigger is a {word, price} pair — a matching comment auto-prints an
// order at that price (dc.html v3 autoWords L1548 / onAutoKey L2063).
// F-batch sweep: AutoControls trimmed to the fields GeneralSettings actually
// renders (toggle + setup accordion). The old word-list editor plumbing
// (words/input/addWord/…) never had a renderer — the REAL Auto Mode matcher is
// useAutoCodes (code→product), configured in the same accordion.
export interface AutoControls {
  detect: boolean;
  setupOpen: boolean;
  toggle: () => void;
  toggleSetup: () => void;
}

// (F-batch sweep: sample SELLERS/SHIPPING/SALES + the Seller/Shipment types
// removed — Admin sellers are real seller_profiles, Shipping is the real 7-11
// export, Sales Report v2 is ledger-RPC-driven.)
// (C2 audit sweep: the sample PLANS/PAYMENTS arrays + Plan/Payment types were
// removed with their Admin panels — permanently-fake data with no backend by
// design; real tier prices live in lib/planPricing.)

// ── Expanded Admin (dc.html v3) ──────────────────────────────────────────────
// Plan price table — drives the "revenue detected from plan changes" calc
// (dc.html v3 PLAN_PRICE L1556 / revAdded L1984). Batch E (#14): the table now
// lives in lib/planPricing (one source with the Admin matchPlan thresholds);
// re-exported here so existing imports keep working.
export { PLAN_PRICE } from "../lib/planPricing";

// Users management list (dc.html v3 USERS L1557). Sample data only.
export interface User { email: string; note: string; role: string; plan: string; days: number; accounts: string; status?: string; planExpiry?: string; planStatus?: string; contactNote?: string; }
// Placeholder sample rows ONLY — never real users. Real seller data is loaded at
// runtime (useAdminUsers → listUsers); this array is the visual fallback for the
// "sample" state and ships in the client bundle, so it must contain NO real PII.
export const USERS: User[] = [
  { email: "owner@example.com", note: "admin", role: "Admin", plan: "Master", days: 3600, accounts: "5 / 5" },
  { email: "seller1@example.com", note: "Sample Seller 1", role: "Seller", plan: "Pro", days: 118, accounts: "3 / 3" },
  { email: "seller2@example.com", note: "Sample Seller 2", role: "Seller", plan: "Basic", days: 42, accounts: "1 / 1" },
  { email: "seller3@example.com", note: "Sample Seller 3", role: "Seller", plan: "Basic", days: 43, accounts: "1 / 1" },
  { email: "seller4@example.com", note: "Sample Seller 4", role: "Seller", plan: "Basic", days: 29, accounts: "1 / 1" },
  { email: "seller5@example.com", note: "Sample Seller 5", role: "Seller", plan: "Basic", days: 14, accounts: "1 / 1" },
  { email: "seller6@example.com", note: "Sample Seller 6", role: "Seller", plan: "Free", days: 3587, accounts: "0 / 1" },
  { email: "seller7@example.com", note: "Sample Seller 7", role: "Seller", plan: "Free", days: 3587, accounts: "0 / 1" },
];

// Subscription buckets (dc.html v3 SUBS L1572).
export interface Sub { shop: string; owner: string; plan: string; info: string; }
export const SUBS: { active: Sub[]; expiring: Sub[]; free: Sub[]; expired: Sub[] } = {
  active: [
    { shop: "Maria Beauty Hub", owner: "Maria Santos", plan: "Pro", info: "Renews Jul 28, 2026" },
    { shop: "Reyes Finds", owner: "Liza Reyes", plan: "Pro", info: "Renews Sep 12, 2026" },
    { shop: "Grace Luxe", owner: "Grace Lim", plan: "Business", info: "Renews Dec 01, 2026" },
    { shop: "KimStyle PH", owner: "Kim Tan", plan: "Pro", info: "Renews Aug 04, 2026" },
  ],
  expiring: [
    { shop: "TanwearPH", owner: "Kim Tan", plan: "Starter", info: "Expires in 5 days · Jun 30" },
    { shop: "NeneFinds", owner: "Nene Bautista", plan: "Pro", info: "Expires in 11 days · Jul 06" },
    { shop: "JoyMart", owner: "Joy Aquino", plan: "Starter", info: "Expires in 14 days · Jul 09" },
  ],
  free: [
    { shop: "Baba Store", owner: "danishaqil194", plan: "Free", info: "0 / 100 orders · 14d cycle" },
    { shop: "Atlas Shop", owner: "khalidkhadem2023", plan: "Free", info: "0 / 100 orders · 14d cycle" },
    { shop: "Zam Picks", owner: "barakatullahkhan12", plan: "Free", info: "12 / 100 orders · 9d left" },
  ],
  expired: [
    { shop: "BudgetBuys", owner: "Rico Tan", plan: "Starter", info: "Expired Jun 20 · not renewed" },
    { shop: "OldStock PH", owner: "Sim Jan", plan: "Basic", info: "Expired May 28 · no payment" },
  ],
};

// ── Helpers (dc.html L1029–1033) ────────────────────────────────────────────
const AV_PALETTE = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1"];
export const avColor = (s: string): string => {
  let h = 0;
  for (const c of s || "x") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
};
export const initials = (s: string): string =>
  (s || "").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const fmt = (n: number): string => n.toLocaleString("en-US");
export const statusColor = (st: string): string =>
  ({ Unpaid: "#e11d48", Paid: "#059669", Packed: "#0284c7", Shipped: "#7c3aed", Delivered: "#059669", Cancelled: "#9ca3af", Active: "#059669", Expiring: "#d97706", Expired: "#e11d48" } as Record<string, string>)[st] || "#9ca3af";
