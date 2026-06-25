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

export const INCOMING: Omit<Comment, "id" | "time">[] = [
  { name: "Grace Lim", handle: "@gracelim", text: "Mine! 1pc rose gold ⌚", mine: true },
  { name: "Paolo Reyes", handle: "@paoloreyes", text: "How much shipping po?", mine: false },
  { name: "Nene Bautista", handle: "@nene.b", text: "Mine 2pcs size 7", mine: true },
  { name: "Daisy Ong", handle: "@daisy.ong", text: "Pa-mine din po 🙋", mine: true },
  { name: "Rico Tan", handle: "@ricotan", text: "Still available?", mine: false },
  { name: "Mae Villar", handle: "@mae.villar", text: "Mine the bundle set", mine: true },
  { name: "Joy Aquino", handle: "@joyaquino", text: "Mine! black medium", mine: true },
  { name: "Ben Co", handle: "@benco", text: "Claiming mine — red 1pc", mine: true },
];

export const SEED_COMMENTS: Comment[] = [
  { id: "s1", name: "Maria Santos", handle: "@maria_shops", text: "Mine! Red lipstick 2pcs 💄", mine: true, time: "now" },
  { id: "s2", name: "Jenny Cruz", handle: "@jen.cruz", text: "How much po the bundle?", mine: false, time: "12s" },
  { id: "s3", name: "Liza Reyes", handle: "@lizareyes", text: "Mine black tumbler", mine: true, time: "28s" },
  { id: "s4", name: "Aira Dela Cruz", handle: "@aira.dc", text: "Sold na po ba?", mine: false, time: "45s" },
  { id: "s5", name: "Kim Tan", handle: "@kimtanph", text: "Mine! size M white", mine: true, time: "1m" },
  { id: "s6", name: "Joy Aquino", handle: "@joyaquino", text: "How to pay po? GCash?", mine: false, time: "1m" },
  { id: "s7", name: "Mae Villar", handle: "@mae.villar", text: "Mine the bundle set 🙋", mine: true, time: "2m" },
  { id: "s8", name: "Rico Tan", handle: "@ricotan", text: "Sana available pa 🙏", mine: false, time: "2m" },
  { id: "s9", name: "Grace Lim", handle: "@gracelim", text: "Mine rose gold ✨", mine: true, time: "3m" },
];

export interface Order { id: string; buyer: string; handle: string; items: string; qty: number; total: number; status: string; platform: string; time: string; }
export interface Product { name: string; sku: string; price: number; stock: number; cat: string; }
export interface Miner { name: string; handle: string; orders: number; spent: number; platform: string; }

export const ORDERS: Order[] = [
  { id: "#10472", buyer: "Maria Santos", handle: "@maria_shops", items: "Matte Lipstick ×2 · Tumbler ×1", qty: 3, total: 897, status: "Unpaid", platform: "TikTok", time: "2m" },
  { id: "#10471", buyer: "Kim Tan", handle: "@kimtanph", items: "Cotton Tee — White M", qty: 1, total: 349, status: "Paid", platform: "TikTok", time: "5m" },
  { id: "#10470", buyer: "Liza Reyes", handle: "@lizareyes", items: "Insulated Tumbler — Black", qty: 1, total: 399, status: "Packed", platform: "Facebook", time: "11m" },
  { id: "#10469", buyer: "Grace Lim", handle: "@gracelim", items: "Rose Gold Watch", qty: 1, total: 1299, status: "Shipped", platform: "TikTok", time: "24m" },
  { id: "#10468", buyer: "Nene Bautista", handle: "@nene.b", items: "Running Sneakers — Size 7 ×2", qty: 2, total: 1798, status: "Paid", platform: "Facebook", time: "33m" },
  { id: "#10467", buyer: "Joy Aquino", handle: "@joyaquino", items: "Skincare Bundle Set", qty: 1, total: 649, status: "Unpaid", platform: "TikTok", time: "40m" },
];

export const PRODUCTS: Product[] = [
  { name: "Matte Lipstick", sku: "LIP-RED", price: 249, stock: 42, cat: "Beauty" },
  { name: "Insulated Tumbler", sku: "TUM-BLK", price: 399, stock: 8, cat: "Home" },
  { name: "Cotton Tee — White", sku: "TEE-WHT-M", price: 349, stock: 120, cat: "Apparel" },
  { name: "Rose Gold Watch", sku: "WTCH-RG", price: 1299, stock: 5, cat: "Accessories" },
  { name: "Running Sneakers", sku: "SNK-07", price: 899, stock: 0, cat: "Footwear" },
  { name: "Skincare Bundle", sku: "BND-SKN", price: 649, stock: 31, cat: "Beauty" },
];

export const MINERS: Miner[] = [
  { name: "Maria Santos", handle: "@maria_shops", orders: 24, spent: 18420, platform: "TikTok" },
  { name: "Grace Lim", handle: "@gracelim", orders: 18, spent: 14250, platform: "TikTok" },
  { name: "Liza Reyes", handle: "@lizareyes", orders: 16, spent: 12990, platform: "Facebook" },
  { name: "Kim Tan", handle: "@kimtanph", orders: 15, spent: 9870, platform: "TikTok" },
  { name: "Nene Bautista", handle: "@nene.b", orders: 9, spent: 7640, platform: "Facebook" },
];

// Dashboard header account pickers (dc.html v2 L1182–1191). SAMPLE data only —
// Phase 5 wires real connected TikTok/Facebook accounts + actual switching.
export interface Account { handle: string; name: string; meta: string; }
export const TT_ACCOUNTS: Account[] = [
  { handle: "@maria_shops", name: "Maria's Live Shop", meta: "128K followers" },
  { handle: "@maria_beauty", name: "Maria Beauty Hub", meta: "54K followers" },
  { handle: "@mariadeals", name: "Maria Deals PH", meta: "31K followers" },
];
export const FB_ACCOUNTS: Account[] = [
  { handle: "Maria's Live Shop", name: "Page · 86K likes", meta: "Page" },
  { handle: "Maria Beauty Hub", name: "Page · 22K likes", meta: "Page" },
  { handle: "Reseller Group PH", name: "Group · 12K members", meta: "Group" },
];

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
export interface ArchiveItem { name: string; handle: string; text: string; time: string; }
export const ARCHIVE: ArchiveItem[] = [
  { name: "Maria Santos", handle: "@maria_shops", text: "Mine! Red lipstick 2pcs 💄", time: "9:41 PM" },
  { name: "Kim Tan", handle: "@kimtanph", text: "Mine size M white tee", time: "9:39 PM" },
  { name: "Liza Reyes", handle: "@lizareyes", text: "Mine black tumbler", time: "9:36 PM" },
  { name: "Joy Aquino", handle: "@joyaquino", text: "How much the bundle po?", time: "9:34 PM" },
  { name: "Grace Lim", handle: "@gracelim", text: "Mine rose gold watch ✨", time: "9:31 PM" },
];

// Printer & display picker (dc.html PRINTERS L1176–1179).
export interface Printer { name: string; meta: string; status: string; }
export const PRINTERS: Printer[] = [
  { name: "Receipt printer", meta: "LAN · 192.168.1.42 · 58mm", status: "Ready" },
  { name: "Bluetooth printer", meta: "Portable · not paired", status: "Off" },
  { name: "Label / sticker printer", meta: "USB · Xprinter XP-365B · 40mm", status: "Ready" },
];

// Auto-detect keyword controls (visual only). Lives in General Settings;
// shared from RedesignApp state. (Removed from the Dashboard per Jeff's call.)
// v3: each trigger is a {word, price} pair — a matching comment auto-prints an
// order at that price (dc.html v3 autoWords L1548 / onAutoKey L2063).
export interface AutoWord { word: string; price: string; }
export interface AutoControls {
  detect: boolean;
  setupOpen: boolean;
  action: "slip" | "sticker";
  words: AutoWord[];
  input: string;
  toggle: () => void;
  toggleSetup: () => void;
  setAction: (a: "slip" | "sticker") => void;
  removeWord: (i: number) => void;
  setInput: (v: string) => void;
  addWord: () => void;
}

// ── Phase 4 (admin/occasional) sample data ──────────────────────────────────
// Admin sellers (dc.html DATA.sellers L944–950).
export interface Seller { shop: string; owner: string; plan: string; expiry: string; status: string; }
export const SELLERS: Seller[] = [
  { shop: "Maria Beauty Hub", owner: "Maria Santos", plan: "Pro", expiry: "Jul 28, 2026", status: "Active" },
  { shop: "TanwearPH", owner: "Kim Tan", plan: "Starter", expiry: "Jun 30, 2026", status: "Expiring" },
  { shop: "Reyes Finds", owner: "Liza Reyes", plan: "Pro", expiry: "Sep 12, 2026", status: "Active" },
  { shop: "Grace Luxe", owner: "Grace Lim", plan: "Business", expiry: "Dec 01, 2026", status: "Active" },
  { shop: "BudgetBuys", owner: "Rico Tan", plan: "Starter", expiry: "Jun 20, 2026", status: "Expired" },
];
// Shipping (dc.html DATA.shipping L938–943).
export interface Shipment { id: string; buyer: string; courier: string; track: string; status: string; }
export const SHIPPING: Shipment[] = [
  { id: "#10469", buyer: "Grace Lim", courier: "J&T Express", track: "JT882190455", status: "Shipped" },
  { id: "#10470", buyer: "Liza Reyes", courier: "LBC", track: "LBC772019", status: "Packed" },
  { id: "#10468", buyer: "Nene Bautista", courier: "Flash", track: "FL552281", status: "Shipped" },
  { id: "#10465", buyer: "Rico Tan", courier: "J&T Express", track: "JT882110023", status: "Delivered" },
];
// Sales report daily bars (dc.html DATA.sales L951).
export const SALES: { d: string; v: number }[] = [
  { d: "Mon", v: 8200 }, { d: "Tue", v: 11400 }, { d: "Wed", v: 9800 }, { d: "Thu", v: 15200 },
  { d: "Fri", v: 21800 }, { d: "Sat", v: 28400 }, { d: "Sun", v: 19600 },
];
// Admin plans (dc.html v3 PLANS L1550). Prices are bare — the currency symbol
// `cur` is prepended at render. Phase 5b: REAL Taiwan production prices/tiers
// (Basic NT$500 · Pro NT$1,200 · Master NT$1,700). Subscriptions stay manual
// via Wise + Telegram (no Play billing). Seller counts are sample.
export interface Plan { name: string; price: string; per: string; sellers: string; feats: string[]; }
export const PLANS: Plan[] = [
  { name: "Basic", price: "500", per: "/mo", sellers: "sample", feats: ["1 live channel", "Auto-detect \"mine\"", "Order slips"] },
  { name: "Pro", price: "1,200", per: "/mo", sellers: "sample", feats: ["TikTok + Facebook", "1-Click order", "Printer & shipping"] },
  { name: "Master", price: "1,700", per: "/mo", sellers: "sample", feats: ["Everything in Pro", "Auto-print + stickers", "Bulk claim · priority sync"] },
];
// Admin payments (dc.html v3 PAYMENTS L1594). Bare amounts — `cur` prepended at render.
export interface Payment { seller: string; method: string; amount: string; status: string; time: string; }
export const PAYMENTS: Payment[] = [
  { seller: "TanwearPH", method: "GCash", amount: "499", status: "Paid", time: "2m" },
  { seller: "Reyes Finds", method: "Maya", amount: "499", status: "Paid", time: "18m" },
  { seller: "Grace Luxe", method: "Bank transfer", amount: "1,499", status: "Pending", time: "1h" },
  { seller: "BudgetBuys", method: "GCash", amount: "199", status: "Paid", time: "3h" },
];

// ── Expanded Admin (dc.html v3) ──────────────────────────────────────────────
// Plan price table — drives the "revenue detected from plan changes" calc
// (dc.html v3 PLAN_PRICE L1556 / revAdded L1984).
export const PLAN_PRICE: Record<string, number> = { Free: 0, Basic: 500, Pro: 1200, Master: 1700, Business: 1700, Starter: 500 };

// Users management list (dc.html v3 USERS L1557). Sample data only.
export interface User { email: string; note: string; role: string; plan: string; days: number; accounts: string; status?: string; }
export const USERS: User[] = [
  { email: "camilajeffrey1@gmail.com", note: "admin", role: "Admin", plan: "Master", days: 3600, accounts: "5 / 5" },
  { email: "lheyukay@gmail.com", note: "Lheyukay", role: "Seller", plan: "Pro", days: 118, accounts: "3 / 3" },
  { email: "cmosiclar@icloud.com", note: "Kycher taiwan", role: "Seller", plan: "Basic", days: 42, accounts: "1 / 1" },
  { email: "alishariq3660@gmail.com", note: "ALUKAY", role: "Seller", plan: "Basic", days: 43, accounts: "1 / 1" },
  { email: "googletest@sellerflowlive.com", note: "googletest", role: "Seller", plan: "Basic", days: 29, accounts: "1 / 1" },
  { email: "nliboon7@gmail.com", note: "@bby_dolltw.ph", role: "Seller", plan: "Basic", days: 14, accounts: "1 / 1" },
  { email: "danishaqil194@gmail.com", note: "Baba", role: "Seller", plan: "Free", days: 3587, accounts: "0 / 1" },
  { email: "khalidkhadem2023@gmail.com", note: "Atlas", role: "Seller", plan: "Free", days: 3587, accounts: "0 / 1" },
];

// New sign-ups awaiting approval (dc.html v3 SIGNUPS L1567).
export interface Signup { name: string; email: string; shop: string; time: string; }
export const SIGNUPS: Signup[] = [
  { name: "Carla Mendoza", email: "carla.m@gmail.com", shop: "Carla Finds", time: "12m ago" },
  { name: "Ben Uy", email: "benuy@gmail.com", shop: "Uy Gadgets", time: "40m ago" },
  { name: "Tina Flores", email: "tinaflores@icloud.com", shop: "Tina Beauty", time: "1h ago" },
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
    { shop: "Baba Store", owner: "danishaqil194", plan: "Free", info: "0 / 200 orders · 14d cycle" },
    { shop: "Atlas Shop", owner: "khalidkhadem2023", plan: "Free", info: "0 / 200 orders · 14d cycle" },
    { shop: "Zam Picks", owner: "barakatullahkhan12", plan: "Free", info: "12 / 200 orders · 9d left" },
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
