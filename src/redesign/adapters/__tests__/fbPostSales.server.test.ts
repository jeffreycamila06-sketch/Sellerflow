// FACEBOOK POST SALES — server module (server/fbPostSales.js). Pins: comment matching (exact code,
// case-insensitive, no "A po"; "+1"/"+N" in plus_one mode; fullwidth), the Page's own comments
// ignored, the sale window, the poller's claim path (ordered / dup / sold out → waitlist / ended),
// the stored paging cursor, backoff on a rate limit, the switch gate, and the sql/137 contract
// (atomic row lock, unique comment_id, one per buyer per item, service-role-only claim).
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  matchPostComment, parsePlusOne, isPageComment, saleWindow, commentToClaim, createFbPostSales,
  RATE_LIMIT_BACKOFF_MS, POLL_MS, MAX_ACTIVE_SALES_PER_SELLER,
} from "../../../../server/fbPostSales.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-10-27T10:00:00Z");
const items = [{ id: 11, code: "A", name: "Red dress", price: 350, stock: 2, sold: 0, product_id: 7 }, { id: 12, code: "b2", name: "Blue top", price: 200, stock: null, sold: 0, product_id: null }];
const sale = (o: Record<string, unknown> = {}) => ({
  id: 1, user_id: "u1", page_id: "P1", post_id: "P1_777", mode: "code", status: "selling",
  starts_at: new Date(NOW - 3600_000).toISOString(), ends_at: new Date(NOW + 86400_000).toISOString(),
  last_comment_cursor: null, items, access_token: encryptToken("PAGETOK", CONFIG.tokenKey), ...o,
});
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const comment = (id: string, message: string, from: { id: string; name: string } | null = { id: "B1", name: "Ana" }) => ({ id, message, created_time: "2026-10-27T09:59:00+0000", ...(from ? { from } : {}) });

describe("matching = Auto-mode rules", () => {
  it("code mode: the WHOLE comment is the code, case-insensitive; one piece", () => {
    expect(matchPostComment("a", { mode: "code", items })).toMatchObject({ item: { id: 11 }, qty: 1 });
    expect(matchPostComment(" B2 ", { mode: "code", items })).toMatchObject({ item: { id: 12 }, qty: 1 });
    for (const bad of ["A po", "ok A", "A.", "A 2", "", "   ", "mine"]) expect(matchPostComment(bad, { mode: "code", items })).toBeNull();
  });
  it("plus_one mode: +1 / +N (fullwidth too), capped; only the one item", () => {
    const one = { mode: "plus_one", items: [items[0]] };
    expect(matchPostComment("+1", one)).toMatchObject({ item: { id: 11 }, qty: 1 });
    expect(matchPostComment("＋３", one)).toMatchObject({ qty: 3 });
    expect(matchPostComment("+ 2", one)).toMatchObject({ qty: 2 });
    for (const bad of ["+0", "+11", "1", "+1 please", "A"]) expect(matchPostComment(bad, one)).toBeNull();
    expect(parsePlusOne("+10")).toBe(10);
    expect(matchPostComment("+1", { mode: "code", items })).toBeNull(); // "+1" is not a code in code mode
  });
  it("the Page's own comments are ignored; a comment without `from` is not the Page", () => {
    expect(isPageComment(comment("c1", "A", { id: "P1", name: "My Shop" }), "P1")).toBe(true);
    expect(isPageComment(comment("c1", "A"), "P1")).toBe(false);
    expect(isPageComment(comment("c1", "A", null), "P1")).toBe(false);
  });
  it("sale window", () => {
    expect(saleWindow(sale(), NOW)).toBe("open");
    expect(saleWindow(sale({ ends_at: new Date(NOW - 1000).toISOString() }), NOW)).toBe("expired");
    expect(saleWindow(sale({ starts_at: new Date(NOW + 1000).toISOString() }), NOW)).toBe("not_yet");
    expect(saleWindow(sale({ status: "ended" }), NOW)).toBe("ended");
  });
  it("claim args carry the buyer, comment id/text and time", () => {
    const m = matchPostComment("A", { mode: "code", items })!;
    expect(commentToClaim(sale(), m, comment("P1_777_1", "A"))).toEqual({ saleId: 1, itemId: 11, qty: 1, buyerFbId: "B1", buyerName: "Ana", commentId: "P1_777_1", commentText: "A", createdAt: "2026-10-27T09:59:00.000Z" });
  });
});

function setup(graph: ReturnType<typeof vi.fn>, o: { sales?: unknown[]; claim?: (a: { commentId: string }) => string; enabled?: boolean } = {}) {
  const calls = { claims: [] as unknown[], waitlist: [] as unknown[], ended: [] as unknown[], cursors: [] as unknown[] };
  const logs: string[] = [];
  const store = {
    async listActiveSales() { return o.sales ?? [sale()]; },
    async markEnded(id: number) { calls.ended.push(id); },
    async saveCursor(id: number, c: string | null) { calls.cursors.push([id, c]); },
    async claimOrder(a: { commentId: string }) { calls.claims.push(a); return o.claim ? o.claim(a) : "ordered"; },
    async joinWaitlist(r: unknown) { calls.waitlist.push(r); },
    async getPage() { return null; },
  };
  const rt = createFbPostSales({ config: CONFIG, store, enabled: async () => o.enabled ?? true, fetchImpl: graph, now: () => NOW, log: (l: string) => logs.push(l) });
  return { rt, calls, logs };
}
const commentsRes = (data: unknown[], after: string | null = null) => mkRes(200, { data, paging: after ? { cursors: { after }, next: "https://graph/next" } : {} });

describe("poller", () => {
  it("creates orders for matching comments, skips the Page's own and non-codes, sold out → waitlist, stores the cursor", async () => {
    const graph = vi.fn(async () => commentsRes([
      comment("c1", "A"), comment("c2", "hello"), comment("c3", "a", { id: "P1", name: "Shop" }), comment("c4", "B2", { id: "B2", name: "Ben" }), comment("c5", "A", { id: "B3", name: "Cy" }),
    ], "CUR1"));
    const { rt, calls } = setup(graph, { claim: (a) => (a.commentId === "c5" ? "sold_out" : "ordered") });
    await rt.tick();
    expect(calls.claims.map((c) => (c as { commentId: string }).commentId)).toEqual(["c1", "c4", "c5"]);
    expect(calls.waitlist).toHaveLength(1);
    expect(calls.waitlist[0]).toMatchObject({ user_id: "u1", code: "A", comment_id: "c5", page_id: "P1", commenter_id: "B3", commenter_name: "Cy", source: "post", session_id: null, product_local_id: 7 });
    expect(calls.cursors).toEqual([[1, "CUR1"]]);
    const url = new URL(String((graph.mock.calls as unknown[][])[0][0]));
    expect(url.pathname).toMatch(/\/P1_777\/comments$/);
    expect(url.searchParams.get("order")).toBe("chronological");
    expect(url.searchParams.get("fields")).toContain("from{id,name}");
    expect(url.searchParams.get("appsecret_proof")).toBeTruthy();
  });
  it("uses the stored cursor so a comment is processed once", async () => {
    const graph = vi.fn(async () => commentsRes([], null));
    const { rt } = setup(graph, { sales: [sale({ last_comment_cursor: "OLD" })] });
    await rt.tick();
    expect(new URL(String((graph.mock.calls as unknown[][])[0][0])).searchParams.get("after")).toBe("OLD");
  });
  it("switch off → no Graph call; expired sale → marked ended, no fetch", async () => {
    const graph = vi.fn(async () => commentsRes([comment("c1", "A")]));
    const off = setup(graph, { enabled: false });
    await off.rt.tick();
    expect(graph).not.toHaveBeenCalled();
    const exp = setup(graph, { sales: [sale({ ends_at: new Date(NOW - 1000).toISOString() })] });
    await exp.rt.tick();
    expect(exp.calls.ended).toEqual([1]);
    expect(graph).not.toHaveBeenCalled();
  });
  it("rate limit → backs off that sale for 5 min; no claim; nothing thrown", async () => {
    const graph = vi.fn(async () => mkRes(429, { error: { code: 4, message: "limit" } }));
    const { rt, calls, logs } = setup(graph);
    await rt.tick();
    await rt.tick();
    expect(graph).toHaveBeenCalledTimes(1);
    expect(calls.claims).toHaveLength(0);
    expect(logs.join("\n")).toContain("rate_limited");
    expect(logs.join("\n")).not.toContain("PAGETOK");
    expect(RATE_LIMIT_BACKOFF_MS).toBe(5 * 60 * 1000);
    expect(POLL_MS).toBe(60 * 1000);
  });
  it("a claim error for one comment does not stop the others", async () => {
    const graph = vi.fn(async () => commentsRes([comment("c1", "A"), comment("c2", "A", { id: "B9", name: "Zed" })]));
    const { rt, calls } = setup(graph, { claim: (a) => { if (a.commentId === "c1") throw new Error("db"); return "ordered"; } });
    await rt.tick();
    expect(calls.claims).toHaveLength(2);
  });
});

describe("sql/137 contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../sql/137_fb_post_sales.sql"), "utf8");
  it("switch seeded false; feature key added; tables + RLS select-own; no browser writes", () => {
    expect(sql).toContain("('fb_post_sales_enabled', 'false')");
    expect(sql).toContain("('tiktok_send'), ('fb_post_sales')");
    for (const t of ["fb_post_sales", "fb_post_sale_items", "fb_post_orders"]) {
      expect(sql).toContain(`create table if not exists public.${t}`);
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
    expect(sql).toContain("grant select on public.fb_post_sales, public.fb_post_sale_items, public.fb_post_orders to authenticated");
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*fb_post_/);
  });
  it("atomic claim: row lock, unique comment_id, one per buyer per item, service role only", () => {
    expect(sql).toMatch(/from public\.fb_post_sale_items where id = p_item_id and sale_id = p_sale_id for update/);
    expect(sql).toMatch(/comment_id\s+text not null[\s\S]*unique \(comment_id\)/);
    expect(sql).toContain("create unique index if not exists fb_post_orders_buyer_item on public.fb_post_orders (item_id, buyer_fb_id) where buyer_fb_id <> ''");
    expect(sql).toMatch(/revoke all on function public\.fb_post_order_claim[^;]*from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.fb_post_order_claim[^;]*to service_role;/);
    expect(sql).toContain("if v_item.stock is not null and v_item.stock - v_item.sold < v_qty then return 'sold_out'");
  });
  it("seller RPCs are SECURITY DEFINER (the tables have no browser write grants) with explicit auth.uid() checks", () => {
    expect(sql).not.toContain("security invoker");
    for (const fn of ["fb_post_sale_create", "fb_post_sale_end", "fb_post_sale_item_update", "fb_post_orders_mark_printed", "fb_post_waitlist_give"]) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
      const head = body.slice(0, body.indexOf("$$") + 2);
      expect(head, fn).toMatch(/security definer/);
      expect(head, fn).toMatch(/set search_path = public/);
      expect(body.slice(0, body.indexOf("\n$$;")), fn).toMatch(/auth\.uid\(\)/);
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
    }
  });
  it("create RPC is gated: switch 'true' AND (is_admin() OR my_feature_access()->>'fb_post_sales') → else 'not_allowed'", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.fb_post_sale_create("), sql.indexOf("create or replace function public.fb_post_sale_end("));
    expect(body).toContain("a.key = 'fb_post_sales_enabled'), '') <> 'true' then\n    raise exception 'not_allowed'");
    expect(body).toContain("if not (public.is_admin() or coalesce((public.my_feature_access()->>'fb_post_sales')::boolean, false)) then\n    raise exception 'not_allowed'");
    expect(body.indexOf("'not_allowed'")).toBeLessThan(body.indexOf("'page_not_yours'")); // gate before any work
  });
  it("waitlist Give (post rows): own waiting source='post' row → selling item locked FOR UPDATE → stock check → post order + sold+1 + 'given'", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.fb_post_waitlist_give("), sql.indexOf("-- ── server RPC"));
    expect(body).toContain("status = 'waiting' and source = 'post'");
    expect(body).toMatch(/s\.status = 'selling' and lower\(i\.code\) = lower\(w\.code\)[\s\S]*for update of i;/);
    expect(body).toContain("if v_item.stock is not null and v_item.stock - v_item.sold < 1 then return 'sold_out'");
    expect(body).toContain("insert into public.fb_post_orders");
    expect(body).toContain("update public.fb_post_sale_items set sold = sold + 1");
    expect(body).toContain("update public.fb_waitlist set status = 'given'");
    expect(body).not.toContain("live_session_orders");
  });
  it("create RPC: own page, plus_one = one item, code unique among SELLING sales, cap 20; retention 3 months; waitlist source", () => {
    expect(sql).toContain("raise exception 'page_not_yours'");
    expect(sql).toContain("if p_mode = 'plus_one' and jsonb_array_length(p_items) <> 1 then raise exception 'plus_one_one_item'");
    expect(sql).toContain(`>= ${MAX_ACTIVE_SALES_PER_SELLER} then`);
    expect(sql).toMatch(/s\.status = 'selling' and lower\(i\.code\) = lower\(v_code\)/);
    expect(sql).toContain("delete from public.fb_post_orders where created_at < now() - interval '3 months'");
    expect(sql).toContain("alter table public.fb_waitlist add column if not exists source text not null default 'live'");
    expect(sql.replace(/^\s*--.*$/gm, "")).not.toContain("live_session_orders"); // post orders never touch live numbering (comments aside)
  });
  it("server.js wires the module behind the Facebook block + the posts route", () => {
    const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
    expect(server).toContain('import { createFbPostSales } from "./server/fbPostSales.js"');
    expect(server).toContain('.eq("key", "fb_post_sales_enabled")');
    expect(server).toContain('app.get("/fb/post-sales/posts", requireAuth, requireFbAvailable');
    expect(server).toContain('serviceSb.rpc("fb_post_order_claim"');
  });
});
