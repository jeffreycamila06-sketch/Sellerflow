// Seller Website — the SELLER's side of sql/163: the website row (draft / published / settings),
// Publish (the plan rule is in the database: website_publish → 'upgrade_required' for Free),
// the website orders (own rows, RLS), one action per order (website_order_action), the receipt
// picture (signed URL, 5 min), the new-order badge and website sales.
// Read on open / on tap only — nothing polls (CLAUDE.md egress rule).
import { isSupabaseConfigured, supabase } from "../../supabase";
import type { ShopDesign } from "../../website/shopApi";

export interface WebsiteSettings {
  ship?: { s711?: { enabled?: boolean; fee?: number }; fm?: { enabled?: boolean; fee?: number }; home?: { enabled?: boolean; fee?: number } };
  freeOver?: number | null;
  bank?: { enabled?: boolean; bankName?: string; accountName?: string; accountNumber?: string };
  qr?: { enabled?: boolean; path?: string; label?: string };
  cod?: { enabled?: boolean };
  autoCancelHours?: number;
}
export interface MyWebsite { subdomain: string; draft: ShopDesign; published: ShopDesign | null; publishedAt: string | null; settings: WebsiteSettings; customDomain: string | null }

export const SUB_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set(["www", "app", "admin", "api", "mail", "help", "support", "shop", "s", "static", "assets", "cdn", "m", "mobile", "blog", "status", "docs", "dev", "test", "staging", "preview", "beta", "login", "signup", "account", "dashboard", "seller", "sellers", "buy", "store", "stores", "pay", "payment", "billing", "ftp", "smtp", "imap", "pop", "ns1", "ns2", "mx", "email", "webmail", "root", "owner", "sellerflow", "sellerflowlive", "sfl", "official", "security", "terms", "privacy", "legal", "about", "contact", "news", "id", "auth", "oauth", "callback", "webhook", "webhooks", "graphql", "socket", "ws"]);
/** The website address rule (same as the database's website_subdomain_ok). Pure. */
export function subdomainProblem(s: string): "short" | "chars" | "reserved" | null {
  const v = s.trim();
  if (v.length < 3 || v.length > 30) return "short";
  if (!SUB_RE.test(v)) return "chars";
  if (RESERVED.has(v)) return "reserved";
  return null;
}
/** A shop name → a first address suggestion ("Budget Ukay!" → "budgetukay"). Pure. */
export function suggestSubdomain(name: string): string {
  const s = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "").replace(/^-+|-+$/g, "").slice(0, 30);
  return s.length >= 3 && !subdomainProblem(s) ? s : "";
}
/** Can this plan publish? Mirrors the database's website_plan (the database decides). Pure. */
export function planCanPublish(plan: string | undefined, planStatus: string | undefined, planExpiry: string | null | undefined, nowMs = Date.now()): boolean {
  const p = String(plan || "").toLowerCase();
  if (!["basic", "plus", "pro", "master"].includes(p)) return false;
  if (String(planStatus || "active").toLowerCase() !== "active") return false;
  if (planExpiry) { const t = Date.parse(planExpiry); if (Number.isFinite(t) && t <= nowMs) return false; }
  return true;
}
export const isMasterPlan = (plan: string | undefined) => String(plan || "").toLowerCase() === "master";

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function loadMyWebsite(): Promise<MyWebsite | null | "error"> {
  if (!isSupabaseConfigured || !supabase) return "error";
  const me = await uid();
  if (!me) return "error";
  try {
    const { data, error } = await supabase.from("seller_websites").select("subdomain,draft,published,published_at,settings,custom_domain").eq("user_id", me).maybeSingle();
    if (error) return "error";
    if (!data) return null;
    const d = data as Record<string, unknown>;
    return { subdomain: String(d.subdomain || ""), draft: obj(d.draft) as ShopDesign, published: d.published ? (obj(d.published) as ShopDesign) : null, publishedAt: (d.published_at as string) || null, settings: obj(d.settings) as WebsiteSettings, customDomain: (d.custom_domain as string) || null };
  } catch { return "error"; }
}
export type SaveResult = { ok: true } | { ok: false; reason: "taken" | "bad_address" | "failed" };
/** Save the draft (+ address, + settings). First save inserts the row. */
export async function saveMyWebsite(w: { subdomain: string; draft: ShopDesign; settings?: WebsiteSettings }, exists: boolean): Promise<SaveResult> {
  if (subdomainProblem(w.subdomain)) return { ok: false, reason: "bad_address" };
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: "failed" };
  const me = await uid();
  if (!me) return { ok: false, reason: "failed" };
  try {
    const row: Record<string, unknown> = { subdomain: w.subdomain, draft: w.draft, ...(w.settings ? { settings: w.settings } : {}) };
    const { error } = exists
      ? await supabase.from("seller_websites").update({ ...row, updated_at: new Date().toISOString() }).eq("user_id", me)
      : await supabase.from("seller_websites").insert({ user_id: me, ...row });
    if (!error) return { ok: true };
    return { ok: false, reason: /duplicate|unique|23505/i.test(`${error.message} ${error.code}`) ? "taken" : /check|23514/i.test(`${error.message} ${error.code}`) ? "bad_address" : "failed" };
  } catch { return { ok: false, reason: "failed" }; }
}
export async function saveWebsiteSettings(settings: WebsiteSettings): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const me = await uid();
  if (!me) return false;
  try { const { error } = await supabase.from("seller_websites").update({ settings, updated_at: new Date().toISOString() }).eq("user_id", me); return !error; } catch { return false; }
}
export async function subdomainFree(sub: string): Promise<boolean | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try { const { data, error } = await supabase.rpc("website_subdomain_free", { p_sub: sub }); return error ? null : data === true; } catch { return null; }
}
export type PublishResult = { ok: true; at: string } | { ok: false; reason: "upgrade_required" | "not_available" | "no_website" | "failed" };
export async function publishWebsite(): Promise<PublishResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: "failed" };
  try {
    const { data, error } = await supabase.rpc("website_publish");
    if (error) { const m = String(error.message || ""); return { ok: false, reason: m.includes("upgrade_required") ? "upgrade_required" : m.includes("not_available") ? "not_available" : m.includes("no_website") ? "no_website" : "failed" }; }
    return { ok: true, at: String((data as Record<string, unknown>)?.published_at || new Date().toISOString()) };
  } catch { return { ok: false, reason: "failed" }; }
}

// ── website orders (seller) ────────────────────────────────────────────────────
export type WebsiteOrderStatus = "awaiting_payment" | "payment_sent" | "paid" | "confirmed" | "shipped" | "cancelled";
export interface WebsiteOrderItem { pid: number; vid?: number | null; name: string; label?: string; code?: string; price: number; qty: number; photo?: string }
export interface WebsiteOrder {
  id: string; orderNo: number; token: string; status: WebsiteOrderStatus; paymentIssue: boolean; buyerName: string; buyerPhone: string; buyerContact: string | null;
  delivery: "s711" | "fm" | "home"; storeId: string | null; storeName: string | null; address: string | null; payment: "bank" | "qr" | "cod";
  items: WebsiteOrderItem[]; subtotal: number; shipFee: number; total: number; note: string | null; receiptPath: string | null; receiptAt: string | null;
  autoCancelAt: string | null; paidAt: string | null; shippedAt: string | null; cancelledAt: string | null; cancelReason: string | null; seenAt: string | null; createdAt: string;
}
export const wNo = (n: number) => `W-${String(n).padStart(4, "0")}`;
const n0 = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export function rowToWebsiteOrder(r: Record<string, unknown>): WebsiteOrder {
  return {
    id: String(r.id), orderNo: n0(r.order_no), token: String(r.token || ""), status: r.status as WebsiteOrderStatus, paymentIssue: r.payment_issue === true,
    buyerName: String(r.buyer_name || ""), buyerPhone: String(r.buyer_phone || ""), buyerContact: (r.buyer_contact as string) || null,
    delivery: r.delivery as WebsiteOrder["delivery"], storeId: (r.store_id as string) || null, storeName: (r.store_name as string) || null, address: (r.address as string) || null,
    payment: r.payment as WebsiteOrder["payment"], items: Array.isArray(r.items) ? (r.items as WebsiteOrderItem[]).map((i) => ({ ...i, price: n0(i.price), qty: n0(i.qty) })) : [],
    subtotal: n0(r.subtotal), shipFee: n0(r.ship_fee), total: n0(r.total), note: (r.note as string) || null, receiptPath: (r.receipt_path as string) || null, receiptAt: (r.receipt_at as string) || null,
    autoCancelAt: (r.auto_cancel_at as string) || null, paidAt: (r.paid_at as string) || null, shippedAt: (r.shipped_at as string) || null, cancelledAt: (r.cancelled_at as string) || null,
    cancelReason: (r.cancel_reason as string) || null, seenAt: (r.seen_at as string) || null, createdAt: String(r.created_at || ""),
  };
}
export const WEBSITE_ORDERS_PAGE = 200;
export async function loadWebsiteOrders(): Promise<WebsiteOrder[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const me = await uid();
  if (!me) return null;
  try {
    const { data, error } = await supabase.from("website_orders")
      .select("id,order_no,token,status,payment_issue,buyer_name,buyer_phone,buyer_contact,delivery,store_id,store_name,address,payment,items,subtotal,ship_fee,total,note,receipt_path,receipt_at,auto_cancel_at,paid_at,shipped_at,cancelled_at,cancel_reason,seen_at,created_at")
      .eq("user_id", me).order("created_at", { ascending: false }).limit(WEBSITE_ORDERS_PAGE);
    return error ? null : (data as Record<string, unknown>[]).map(rowToWebsiteOrder);
  } catch { return null; }
}
export async function loadBlockedPhones(): Promise<Set<string>> {
  if (!isSupabaseConfigured || !supabase) return new Set();
  try { const { data, error } = await supabase.from("website_blocked_buyers").select("phone"); return error ? new Set() : new Set((data as { phone: string }[]).map((x) => x.phone)); } catch { return new Set(); }
}
export type OrderAction = "paid" | "not_received" | "shipped" | "cancel" | "seen" | "block" | "unblock";
export async function websiteOrderAction(id: string, action: OrderAction): Promise<{ ok: true; status: WebsiteOrderStatus; blocked: boolean } | { ok: false }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const { data, error } = await supabase.rpc("website_order_action", { p_id: id, p_action: action });
    if (error || !data) return { ok: false };
    const d = data as Record<string, unknown>;
    return { ok: true, status: d.status as WebsiteOrderStatus, blocked: d.blocked === true };
  } catch { return { ok: false }; }
}
export async function receiptUrl(path: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !path) return null;
  try { const { data, error } = await supabase.storage.from("website-receipts").createSignedUrl(path, 300); return error ? null : data.signedUrl; } catch { return null; }
}
export async function websiteNewOrdersCount(): Promise<number> {
  if (!isSupabaseConfigured || !supabase) return 0;
  try { const { data, error } = await supabase.rpc("website_new_orders_count"); return error ? 0 : n0(data); } catch { return 0; }
}
export interface WebsiteSales { orders: number; revenue: number; buyers: number; days: { d: string; orders: number; rev: number }[] }
export async function loadWebsiteSales(from: string, to: string): Promise<WebsiteSales | null> {
  if (!isSupabaseConfigured || !supabase || !from || !to) return null;
  try {
    const { data, error } = await supabase.rpc("website_sales", { p_from: from, p_to: to });
    if (error || !data) return null;
    const d = data as Record<string, unknown>;
    return { orders: n0(d.orders), revenue: n0(d.revenue), buyers: n0(d.buyers), days: Array.isArray(d.days) ? (d.days as Record<string, unknown>[]).map((x) => ({ d: String(x.d), orders: n0(x.orders), rev: n0(x.rev) })) : [] };
  } catch { return null; }
}
/** Which actions a seller can take on an order in this status (the database checks again). Pure. */
export function actionsFor(o: Pick<WebsiteOrder, "status" | "payment">): OrderAction[] {
  if (o.status === "awaiting_payment" || o.status === "payment_sent") return ["paid", "not_received", "cancel"];
  if (o.status === "paid" || o.status === "confirmed") return ["shipped", "cancel"];
  return [];
}
/** Status filters of the Website orders tab. Pure. */
export type OrderFilter = "new" | "check" | "unpaid" | "ship" | "done" | "cancelled" | "all";
export function matchesFilter(o: WebsiteOrder, f: OrderFilter): boolean {
  if (f === "all") return true;
  if (f === "new") return !o.seenAt && o.status !== "cancelled";
  if (f === "check") return o.status === "payment_sent";
  if (f === "unpaid") return o.status === "awaiting_payment";
  if (f === "ship") return o.status === "paid" || o.status === "confirmed";
  if (f === "done") return o.status === "shipped";
  return o.status === "cancelled";
}
