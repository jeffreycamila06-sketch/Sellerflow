// FACEBOOK POST SALES — lives first (server/fbPostSales.js, fix round 1, 2026-11-20).
//   1. while the live comment reader runs for a Page (a poller in fbLive's running-pollers Map),
//      the post reader makes NO Facebook call for that Page's posts and does not move their cursor;
//      another Page is read as usual
//   2. after the live ends, the comments written during it are read in the order they were written
//      and each becomes ONE order (no duplicates)
//   3. a sale whose end date passes during the live waits too; after the live, comments written
//      before the end date become orders, later ones do not, then the sale is ended
//   4. End now (end date = now): the next pass reads what was written before it, then ends it
//   5. a sale that cannot be read 24 h after its end date is ended without reading
//   6. pageLiveIn only READS the pollers Map (stopped poller = not live; no Map = not live)
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFbPostSales, pageLiveIn, POLL_MS, CLOSE_GRACE_MS } from "../../../../server/fbPostSales.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app", appSecret: "sekret", tokenKey: "tk" };
const T0 = Date.parse("2026-11-20T10:00:00Z");
type C = { id: string; at: number; from: string };

// A small Facebook + database. posts: post id → comments (in the order written). Cursor = how many
// comments of that post were handed out. The claim answers like sql/188 (end date by comment time).
function world(o: { sales: { id: number; page: string; post: string; endsAt?: number }[] }) {
  let now = T0;
  const posts = new Map<string, C[]>();
  const sales = o.sales.map((s) => ({
    id: s.id, user_id: "u1", page_id: s.page, post_id: s.post, mode: "code", status: "selling",
    starts_at: new Date(T0 - 3600_000).toISOString(), ends_at: new Date(s.endsAt ?? T0 + 7 * 86400_000).toISOString(),
    last_comment_cursor: null as string | null,
    items: [{ id: s.id * 10, code: "A", name: "Dress", price: 100, stock: null, sold: 0, product_id: null }],
    access_token: encryptToken("TOK", CONFIG.tokenKey),
  }));
  for (const s of sales) posts.set(s.post_id, []);
  const calls: string[] = [];              // post id of every Facebook request
  const claims: { sale: number; comment: string; v: string }[] = [];
  const ordered = new Set<string>();
  const ended: number[] = [];
  const logs: string[] = [];
  const pollers = new Map<string, { pageId: string; stopped: boolean }>(); // the live reader's running pollers
  const claimFail = new Set<string>();
  const fetchImpl = async (url: string) => {
    const u = new URL(url);
    const post = decodeURIComponent(u.pathname.split("/")[2]);
    calls.push(post);
    const list = posts.get(post) ?? [];
    const from = Number(u.searchParams.get("after") || 0);
    const to = Math.min(list.length, from + Number(u.searchParams.get("limit") || 100));
    const data = list.slice(from, to).map((c) => ({ id: c.id, message: "A", created_time: new Date(c.at).toISOString(), from: { id: c.from, name: c.from } }));
    return { status: 200, json: async () => ({ data, paging: data.length ? { cursors: { after: String(to) }, ...(to < list.length ? { next: "n" } : {}) } : {} }) };
  };
  const store = {
    async listActiveSales() { return sales.filter((s) => s.status === "selling").map((s) => ({ ...s })); },
    async markEnded(id: number) { ended.push(id); const s = sales.find((x) => x.id === id)!; s.status = "ended"; },
    async saveCursor(id: number, c: string | null) { sales.find((x) => x.id === id)!.last_comment_cursor = c; },
    async claimOrder(a: { saleId: number; commentId: string; createdAt: string | null }) {
      const s = sales.find((x) => x.id === a.saleId)!;
      let v: string;
      if (claimFail.has(a.commentId)) v = "error";
      else if (Math.min(Date.parse(a.createdAt ?? "") || now, now) > Date.parse(s.ends_at)) v = "ended"; // by the COMMENT's time
      else if (ordered.has(a.commentId)) v = "dup";
      else { ordered.add(a.commentId); v = "ordered"; }
      claims.push({ sale: a.saleId, comment: a.commentId, v });
      return v;
    },
    async joinWaitlist() { /* not used */ },
    async getPage() { return null; },
    async allowedSellers(ids: string[]) { return ids; },
  };
  const rt = createFbPostSales({ config: CONFIG, store, enabled: async () => true, fetchImpl, now: () => now, log: (l: string) => logs.push(l),
    isPageLive: (pageId: string) => pageLiveIn(pollers, pageId) });
  let n = 0;
  return {
    rt, calls, claims, ordered, ended, logs, pollers, sales, claimFail,
    get now() { return now; },
    write(post: string, k = 1) { for (let i = 0; i < k; i++) posts.get(post)!.push({ id: `${post}#${++n}`, at: now, from: `b${n}` }); },
    goLive(page: string) { pollers.set(`s1:Facebook:${page}`, { pageId: page, stopped: false }); },
    endLive(page: string) { pollers.delete(`s1:Facebook:${page}`); },
    async minute(k = 1) { for (let i = 0; i < k; i++) { await rt.tick(); now += POLL_MS; } },
    endNow(saleId: number) { sales.find((x) => x.id === saleId)!.ends_at = new Date(now).toISOString(); },
  };
}

describe("1 + 2. a live Page is not read for its posts; after the live every comment becomes one order", () => {
  it("2-hour live on P1: 0 post calls for P1, P2 read every minute; after the live P1's comments are ordered in order, once", async () => {
    const w = world({ sales: [{ id: 1, page: "P1", post: "P1_a" }, { id: 2, page: "P1", post: "P1_b" }, { id: 3, page: "P2", post: "P2_a" }] });
    w.write("P1_a", 2); w.write("P2_a", 1);
    await w.minute();                                   // before the live: everything read
    expect(new Set(w.calls)).toEqual(new Set(["P1_a", "P1_b", "P2_a"]));
    expect(w.ordered.size).toBe(3);
    w.calls.length = 0;
    w.goLive("P1");
    for (let m = 0; m < 120; m++) { w.write("P1_a", 3); w.write("P1_b", 1); w.write("P2_a", 1); await w.minute(); }
    expect(w.calls.filter((p) => p.startsWith("P1_"))).toEqual([]);       // no request for the live Page's posts
    expect(w.calls.filter((p) => p === "P2_a").length).toBe(120);          // the other Page: one read a minute
    expect(w.sales.find((s) => s.id === 1)!.last_comment_cursor).toBe("2"); // cursor stayed where the live found it
    expect(w.claims.filter((c) => c.sale !== 3).length).toBe(2);           // P1: only the 2 claims from before the live
    expect(w.logs.filter((l) => /sale=1 waiting — page=P1 is live/.test(l))).toHaveLength(1); // one line, not one a minute
    w.endLive("P1");
    w.claims.length = 0;
    for (let m = 0; m < 5; m++) await w.minute();      // the catch-up: up to 500 comments a sale a minute
    const p1a = w.claims.filter((c) => c.sale === 1).map((c) => c.comment);
    expect(p1a).toHaveLength(360);                     // 3 × 120 written during the live, each asked once
    expect(new Set(p1a).size).toBe(360);
    const n = (id: string) => Number(id.split("#")[1]);
    expect(p1a.map(n)).toEqual([...p1a.map(n)].sort((a, b) => a - b)); // in the order written
    expect(w.claims.filter((c) => c.sale === 2)).toHaveLength(120);
    expect(w.claims.every((c) => c.v === "ordered")).toBe(true);        // no "dup": nothing asked twice
    expect(w.ordered.size).toBe(3 + 360 + 120 + 120);
    expect(w.logs.some((l) => /sale=1 reading again — page=P1 live ended/.test(l))).toBe(true);
  });
  it("a stopped poller (the live just ended) is not live; another seller's Page live does not block this Page", async () => {
    const w = world({ sales: [{ id: 1, page: "P1", post: "P1_a" }] });
    w.write("P1_a");
    w.pollers.set("x", { pageId: "P1", stopped: true });
    w.goLive("P9");
    await w.minute();
    expect(w.calls).toEqual(["P1_a"]);
    expect(w.ordered.size).toBe(1);
  });
});

describe("3 + 4 + 5. the end date during a live, End now, and the 24-hour limit", () => {
  it("the end date passes during the live: waits; after the live, written before the end → order, after → no order, then ended", async () => {
    const w = world({ sales: [{ id: 1, page: "P1", post: "P1_a", endsAt: T0 + 30 * 60_000 }] });
    w.goLive("P1");
    for (let m = 0; m < 60; m++) { w.write("P1_a"); await w.minute(); }   // 30 written before the end, 30 after
    expect(w.calls).toEqual([]);
    expect(w.ended).toEqual([]);                        // not ended while the comments are unread
    w.endLive("P1");
    await w.minute();
    const v = w.claims.map((c) => c.v);
    expect(v.filter((x) => x === "ordered")).toHaveLength(31); // minute 0 … minute 30 (the end minute counts)
    expect(v.filter((x) => x === "ended")).toHaveLength(29);
    expect(w.ended).toEqual([1]);                       // ended once every comment had its answer
    await w.minute();
    expect(w.calls.length).toBe(1);                     // an ended sale is not read again
  });
  it("a long backlog (1,200 comments) after the end date: not ended until EVERY comment was read (500 a minute)", async () => {
    const w = world({ sales: [{ id: 1, page: "P1", post: "P1_a", endsAt: T0 + 60_000 }] });
    w.goLive("P1");
    w.write("P1_a", 1200);                              // all written before the end date
    await w.minute(3);                                  // the end date passes during the live
    w.endLive("P1");
    await w.minute();
    expect(w.ordered.size).toBe(500);
    expect(w.ended).toEqual([]);                        // 700 still unread → not ended
    await w.minute();
    expect(w.ordered.size).toBe(1000);
    expect(w.ended).toEqual([]);
    await w.minute();
    expect(w.ordered.size).toBe(1200);
    expect(w.ended).toEqual([1]);                       // ended only now
  });
  it("End now: the next pass orders what was written before it and ends the sale", async () => {
    const w = world({ sales: [{ id: 1, page: "P1", post: "P1_a" }] });
    w.goLive("P1");
    w.write("P1_a", 4);
    await w.minute();
    w.endNow(1);                                        // the seller taps End now during the live
    await w.minute();
    w.write("P1_a", 2);                                 // written after End now
    w.endLive("P1");
    await w.minute();
    expect(w.claims.map((c) => c.v)).toEqual(["ordered", "ordered", "ordered", "ordered", "ended", "ended"]);
    expect(w.ended).toEqual([1]);
  });
  it("past its end date with a comment that keeps failing: not ended (retried); 24 h after the end date → ended, not read", async () => {
    const w = world({ sales: [{ id: 1, page: "P1", post: "P1_a", endsAt: T0 + 60_000 }] });
    w.write("P1_a");
    w.claimFail.add("P1_a#1");
    await w.minute(3);
    expect(w.ended).toEqual([]);
    expect(w.logs.filter((l) => l.includes("stopped at comment=P1_a#1")).length).toBe(3);
    await w.minute(Math.ceil(CLOSE_GRACE_MS / POLL_MS));
    expect(w.ended).toEqual([1]);
    expect(w.logs.some((l) => /ended sale=1 — over 24 h past its end date/.test(l))).toBe(true);
  });
});

describe("6. pageLiveIn — a read of the running pollers only", () => {
  it("answers", () => {
    const m = new Map<string, { pageId: string; stopped: boolean }>([["a", { pageId: "P1", stopped: false }], ["b", { pageId: "P2", stopped: true }]]);
    expect(pageLiveIn(m, "P1")).toBe(true);
    expect(pageLiveIn(m, 1 as unknown as string)).toBe(false);
    expect(pageLiveIn(m, "P2")).toBe(false);
    expect(pageLiveIn(m, "P3")).toBe(false);
    expect(pageLiveIn(m, "")).toBe(false);
    expect(pageLiveIn(null, "P1")).toBe(false);
    expect(pageLiveIn(undefined, "P1")).toBe(false);
    const before = JSON.stringify([...m]);
    pageLiveIn(m, "P1");
    expect(JSON.stringify([...m])).toBe(before);         // nothing changed
  });
  it("a live check that throws → read as not live (posts are never stopped by a broken check)", async () => {
    const calls: string[] = [];
    const rt = createFbPostSales({
      config: CONFIG, enabled: async () => true, now: () => T0, log: () => {}, isPageLive: () => { throw new Error("boom"); },
      fetchImpl: async (url: string) => { calls.push(url); return { status: 200, json: async () => ({ data: [] }) }; },
      store: { async listActiveSales() { return [{ id: 1, user_id: "u", page_id: "P1", post_id: "P1_a", mode: "code", status: "selling", starts_at: new Date(T0 - 1000).toISOString(), ends_at: new Date(T0 + 86400_000).toISOString(), items: [], access_token: encryptToken("TOK", CONFIG.tokenKey) }]; },
        async markEnded() {}, async saveCursor() {}, async claimOrder() { return "dup"; }, async joinWaitlist() {}, async getPage() { return null; } },
    });
    await rt.tick();
    expect(calls).toHaveLength(1);
  });
  it("server.js hands the poller a READ of fbLive's pollers; nothing more is taken from fbLive.js", () => {
    const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
    expect(src).toContain('import { createFbPostSales, pageLiveIn } from "./server/fbPostSales.js";');
    expect(src).toContain("isPageLive: (pageId) => pageLiveIn(fbRuntime ? fbRuntime._pollers : null, pageId),");
    const poller = readFileSync(resolve(__dirname, "../../../../server/fbPostSales.js"), "utf8");
    expect(poller.match(/^import .* from "\.\/fbLive\.js";$/gm)).toEqual(['import { graphGet, classifyGraphError, GRAPH_HOST } from "./fbLive.js";']); // the same Graph helpers as main, nothing more
    const a = poller.indexOf("export function pageLiveIn");
    const body = poller.slice(a, poller.indexOf("\n}\n", a));
    expect(body).not.toMatch(/\.(set|delete|clear)\(|stopped\s*=[^=]/); // only reads
  });
});
