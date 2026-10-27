// FACEBOOK POST SALES (sql/137) — client side. Buyers comment a code on a Page post; the SERVER
// (server/fbPostSales.js) creates fb_post_orders. The app only: creates / ends / edits a post sale
// (RPCs, own rows), reads its sales + orders (RLS select), lists the Page's recent posts through
// the server (the Page token never reaches the app), groups orders per buyer for the Posts tab,
// and prints a buyer's post orders MANUALLY through the existing sticker path (printSlip) with the
// buyer-number line OFF and a "Post" marker on each item line. Post orders never touch
// live_session_orders or buyer numbering. Read-on-open; zero poll.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";
import type { Buyer, LiveOrder } from "../../lib/orderTypes";
import type { Settings } from "./printing";

export type PostSaleMode = "code" | "plus_one";
export interface PostSaleItem { id: number; saleId: number; productId: number | null; name: string; code: string; price: number; stock: number | null; sold: number }
export interface PostSale {
  id: number; pageId: string; postId: string; postMessage: string; postPicture: string | null; mode: PostSaleMode;
  startsAt: string; endsAt: string; status: "selling" | "ended"; createdAt: string; items: PostSaleItem[];
}
export interface PostOrder { id: number; saleId: number; itemId: number; buyerFbId: string; buyerName: string; qty: number; price: number; commentId: string; commentText: string; createdAt: string; printedAt: string | null }
export interface PagePost { id: string; message: string; createdTime: string; picture: string; url: string }
export interface NewPostItem { name: string; code: string; price: number; stock: number | null; productId?: number | null }

export const POST_SALE_DEFAULT_DAYS = 7;
export const MAX_ACTIVE_POST_SALES = 20; // mirrors the create RPC
export const LS_POSTS_SEEN = "sfl_rd_posts_seen"; // the red dot on "Posts" until first opened (per device)

// ── gate (ONE place to change when plan gating is decided) ─────────────────────────────────
// The Posts tab exists ONLY when: the switch is on, the seller is admin or on the 'fb_post_sales'
// list, and they have a connected Facebook Page. Without a Page, Orders is exactly as before.
export function postSalesGate(a: { switchOn: boolean; isAdmin: boolean; hasKey: boolean; pageCount: number }): boolean {
  return a.switchOn && (a.isAdmin || a.hasKey) && a.pageCount > 0;
}

export function postsSeen(): boolean { try { return window.localStorage.getItem(LS_POSTS_SEEN) === "1"; } catch { return true; } }
export function markPostsSeen(): void { try { window.localStorage.setItem(LS_POSTS_SEEN, "1"); } catch { /* per-device dot only */ } }

// ── pure mappers / helpers ─────────────────────────────────────────────────────────────────
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export function mapItem(r: Record<string, unknown>): PostSaleItem {
  return { id: num(r.id), saleId: num(r.sale_id), productId: r.product_id == null ? null : num(r.product_id), name: String(r.name ?? ""), code: String(r.code ?? ""), price: num(r.price), stock: r.stock == null ? null : num(r.stock), sold: num(r.sold) };
}
export function mapSale(r: Record<string, unknown>): PostSale {
  const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]).map(mapItem) : [];
  return {
    id: num(r.id), pageId: String(r.page_id ?? ""), postId: String(r.post_id ?? ""), postMessage: String(r.post_message ?? ""),
    postPicture: r.post_picture == null ? null : String(r.post_picture), mode: r.mode === "plus_one" ? "plus_one" : "code",
    startsAt: String(r.starts_at ?? ""), endsAt: String(r.ends_at ?? ""), status: r.status === "ended" ? "ended" : "selling",
    createdAt: String(r.created_at ?? ""), items: items.sort((a, b) => a.id - b.id),
  };
}
export function mapOrder(r: Record<string, unknown>): PostOrder {
  return { id: num(r.id), saleId: num(r.sale_id), itemId: num(r.item_id), buyerFbId: String(r.buyer_fb_id ?? ""), buyerName: String(r.buyer_name ?? ""), qty: num(r.qty, 1), price: num(r.price), commentId: String(r.comment_id ?? ""), commentText: String(r.comment_text ?? ""), createdAt: String(r.created_at ?? ""), printedAt: r.printed_at == null ? null : String(r.printed_at) };
}

// Display status of a sale: selling / sold out (every item with a stock is used up) / ended.
export function saleStatus(s: PostSale, nowMs = Date.now()): "selling" | "sold_out" | "ended" {
  if (s.status === "ended" || (Date.parse(s.endsAt) || Infinity) < nowMs) return "ended";
  const limited = s.items.filter((i) => i.stock != null);
  if (limited.length && limited.length === s.items.length && limited.every((i) => i.sold >= (i.stock ?? 0))) return "sold_out";
  return "selling";
}

export interface SaleCounts { orders: number; buyers: number; waitlist: number }
export function saleCounts(s: PostSale, orders: PostOrder[], waitlistBySale: Map<number, number> = new Map()): SaleCounts {
  const mine = orders.filter((o) => o.saleId === s.id);
  return { orders: mine.length, buyers: new Set(mine.map((o) => o.buyerFbId || `c:${o.commentId}`)).size, waitlist: waitlistBySale.get(s.id) || 0 };
}

export interface BuyerGroup {
  key: string; buyerName: string; buyerFbId: string; orders: PostOrder[]; total: number;
  posts: string[];        // short post texts the buyer ordered from
  printed: boolean;       // every order printed
}
// Orders → one card per buyer (newest activity first); the item lines are the orders themselves.
export function groupPostOrders(orders: PostOrder[], sales: PostSale[]): BuyerGroup[] {
  const saleOf = new Map(sales.map((s) => [s.id, s]));
  const groups = new Map<string, BuyerGroup>();
  for (const o of [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)) {
    const key = o.buyerFbId || `c:${o.commentId}`;
    const g = groups.get(key) ?? { key, buyerName: o.buyerName, buyerFbId: o.buyerFbId, orders: [], total: 0, posts: [], printed: true };
    g.orders.push(o);
    g.total += o.price * o.qty;
    if (!o.printedAt) g.printed = false;
    const label = postLabel(saleOf.get(o.saleId));
    if (label && !g.posts.includes(label)) g.posts.push(label);
    groups.set(key, g);
  }
  return [...groups.values()];
}
export function postLabel(s: PostSale | undefined): string {
  if (!s) return "";
  const m = s.postMessage.trim().replace(/\s+/g, " ");
  return m ? (m.length > 40 ? `${m.slice(0, 40)}…` : m) : `#${s.postId.split("_").pop()}`;
}
// Stock left for a code on the seller's SELLING post sales (waitlist "Give" button): no stock limit → 1.
export function postItemStock(sales: PostSale[], code: string): number {
  const k = code.trim().toLowerCase();
  for (const s of sales) {
    if (s.status !== "selling") continue;
    const it = s.items.find((i) => i.code.trim().toLowerCase() === k);
    if (it) return it.stock == null ? 1 : Math.max(0, it.stock - it.sold);
  }
  return 0;
}
export const itemName = (o: PostOrder, sales: PostSale[]): string => sales.flatMap((s) => s.items).find((i) => i.id === o.itemId)?.name || "";

// ── print (MANUAL only — "Print new") ───────────────────────────────────────────────────────
// A buyer's new post orders → the Buyer shape printSlip expects. No buyer number (num 0 AND the
// buyer-number line turned off in the settings copy); every item line starts with the "Post"
// marker; platform Facebook (name-only print rules apply, like the live path).
export const POST_MARK = "Post";
export function postBuyerForPrint(g: BuyerGroup, sales: PostSale[], onlyNew = true): Buyer | null {
  // oldest first on the sticker (the card shows newest first)
  const rows = (onlyNew ? g.orders.filter((o) => !o.printedAt) : g.orders).slice().sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id - y.id);
  if (!rows.length) return null;
  const orders: LiveOrder[] = rows.map((o) => {
    const at = Date.parse(o.createdAt) || Date.now();
    const name = itemName(o, sales) || o.commentText;
    return { orderNum: at, item: `${POST_MARK} · ${name}${o.qty > 1 ? ` ×${o.qty}` : ""}`, qty: o.qty, price: o.price, total: o.price * o.qty, time: "", handle: g.buyerName, name: g.buyerName, bNum: 0, platform: "Facebook", status: "New", date: new Date(at).toISOString().slice(0, 10) };
  });
  return { handle: g.buyerName, name: g.buyerName, platform: "Facebook", num: 0, orders, totalSpent: orders.reduce((a, o) => a + o.total, 0), totalOrders: orders.length };
}
export const postPrintSettings = (s: Settings): Settings => ({ ...s, printBuyerNumber: false });

// ── reads / writes ──────────────────────────────────────────────────────────────────────────
const uid = async (): Promise<string> => { try { return (await supabase!.auth.getSession()).data.session?.user?.id || ""; } catch { return ""; } };

export async function loadPostSales(): Promise<PostSale[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const u = await uid(); if (!u) return null;
    const { data, error } = await supabase.from("fb_post_sales").select("*, items:fb_post_sale_items(*)").eq("user_id", u).order("created_at", { ascending: false }).limit(200);
    if (error || !Array.isArray(data)) return null;
    return (data as Record<string, unknown>[]).map(mapSale);
  } catch { return null; }
}
export async function loadPostOrders(): Promise<PostOrder[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const u = await uid(); if (!u) return null;
    const { data, error } = await supabase.from("fb_post_orders").select("*").eq("user_id", u).order("created_at", { ascending: false }).limit(1000);
    if (error || !Array.isArray(data)) return null;
    return (data as Record<string, unknown>[]).map(mapOrder);
  } catch { return null; }
}
// waiting waitlist rows that came from posts, counted per sale (by code, this seller's selling sales)
export async function loadPostWaitlistCounts(sales: PostSale[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!isSupabaseConfigured || !supabase || !sales.length) return out;
  try {
    const u = await uid(); if (!u) return out;
    const { data, error } = await supabase.from("fb_waitlist").select("code, comment_id").eq("user_id", u).eq("status", "waiting").eq("source", "post").limit(500);
    if (error || !Array.isArray(data)) return out;
    for (const r of data as { code?: unknown }[]) {
      const code = String(r.code ?? "").trim().toLowerCase();
      const sale = sales.find((s) => s.status === "selling" && s.items.some((i) => i.code.trim().toLowerCase() === code));
      if (sale) out.set(sale.id, (out.get(sale.id) || 0) + 1);
    }
  } catch { /* counts only */ }
  return out;
}

export type CreateResult = { ok: true; id: number } | { ok: false; error: string; code?: string };
export async function createPostSale(a: { pageId: string; postId: string; postMessage: string; postPicture: string; mode: PostSaleMode; endsAt: string; items: NewPostItem[] }): Promise<CreateResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "offline" };
  try {
    const { data, error } = await supabase.rpc("fb_post_sale_create", {
      p_page_id: a.pageId, p_post_id: a.postId, p_post_message: a.postMessage, p_post_picture: a.postPicture, p_mode: a.mode, p_ends_at: a.endsAt,
      p_items: a.items.map((i) => ({ name: i.name, code: i.code, price: i.price, stock: i.stock, product_id: i.productId ?? null })),
    });
    if (error) {
      const msg = String(error.message || "");
      const m = msg.match(/code_in_use:(.+)$/);
      if (m) return { ok: false, error: "code_in_use", code: m[1].trim() };
      if (/too_many_sales/.test(msg)) return { ok: false, error: "too_many" };
      if (/not_allowed/.test(msg)) return { ok: false, error: "not_allowed" };
      if (/duplicate key|fb_post_sales_user_id_post_id/.test(msg)) return { ok: false, error: "post_in_use" };
      return { ok: false, error: "failed" };
    }
    return { ok: true, id: Number(data) };
  } catch { return { ok: false, error: "failed" }; }
}
// Waitlist "Give" for a post row (sql/137 fb_post_waitlist_give): one post order, same item lock as the
// server claim. Returns the RPC verdict, or null on any failure.
export async function givePostWaitlist(waitlistId: number): Promise<"ordered" | "sold_out" | "ended" | "not_found" | "dup" | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("fb_post_waitlist_give", { p_waitlist_id: waitlistId });
    if (error) return null;
    const v = String(data ?? "");
    return v === "ordered" || v === "sold_out" || v === "ended" || v === "not_found" || v === "dup" ? v : null;
  } catch { return null; }
}
export async function endPostSale(id: number): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try { const { error } = await supabase.rpc("fb_post_sale_end", { p_sale_id: id }); return !error; } catch { return false; }
}
export async function updatePostItem(id: number, price: number, stock: number | null): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try { const { error } = await supabase.rpc("fb_post_sale_item_update", { p_item_id: id, p_price: price, p_stock: stock }); return !error; } catch { return false; }
}
export async function markPostOrdersPrinted(ids: number[]): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !ids.length) return false;
  try { const { error } = await supabase.rpc("fb_post_orders_mark_printed", { p_ids: ids }); return !error; } catch { return false; }
}

// The Page's recent posts — through the server (GET /fb/post-sales/posts). null = could not read.
export async function loadPagePosts(pageId: string): Promise<{ ok: true; posts: PagePost[] } | { ok: false; error: string }> {
  try {
    const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token || "" : "";
    const r = await fetch(withCodes(`${SERVER}/fb/post-sales/posts?pageId=${encodeURIComponent(pageId)}`), { headers: { Authorization: `Bearer ${token}` } });
    const j = decodeServerJson(await r.json().catch(() => null)) as { ok?: unknown; posts?: unknown; error?: unknown } | null;
    if (r.status !== 200 || !j || j.ok !== true || !Array.isArray(j.posts)) return { ok: false, error: String(j?.error || "failed") };
    return { ok: true, posts: (j.posts as Record<string, unknown>[]).map((p) => ({ id: String(p.id ?? ""), message: String(p.message ?? ""), createdTime: String(p.createdTime ?? ""), picture: String(p.picture ?? ""), url: String(p.url ?? "") })) };
  } catch { return { ok: false, error: "unreachable" }; }
}
