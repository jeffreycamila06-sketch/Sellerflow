// FACEBOOK POST SALES — never lose a comment + the plan rule in the poller (server/fbPostSales.js,
// 2026-11-20). A small "database" (ordered comment ids, stock, waitlist, cursor) answers like
// fb_post_order_claim, so a pass that fails half-way and the pass after it can be followed:
//   1. a claim that throws / answers something unknown / 'not_allowed' / 'ended' stops the pass for
//      that sale and keeps the cursor BEFORE that page; the next minute the same page is read again
//      and the comment becomes an order (once — the ones already ordered answer 'dup')
//   2. the same for a waitlist write that fails; the waitlist row carries the sale id
//   3. a failure on page 2 keeps page 1's cursor
//   4. a seller who does not pass the plan rule: no Facebook call, no claim, no cursor move, one log
//      line; an expired sale of that seller is still ended; renewed → the comments left meanwhile
//      become orders; the rule unreadable → nobody this pass; no rule in the DB yet → everybody
//   5. the "Sell on a post" picker refuses a seller without the plan
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFbPostSales, MAX_PAGES_PER_SALE } from "../../../../server/fbPostSales.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-11-20T10:00:00Z");
const item = { id: 11, code: "A", name: "Dress", price: 350, stock: 5, sold: 0, product_id: 7 };
const sale = (o: Record<string, unknown> = {}) => ({
  id: 1, user_id: "u1", page_id: "P1", post_id: "P1_777", mode: "code", status: "selling",
  starts_at: new Date(NOW - 3600_000).toISOString(), ends_at: new Date(NOW + 86400_000).toISOString(),
  last_comment_cursor: null as string | null, items: [item], access_token: encryptToken("PAGETOK", CONFIG.tokenKey), ...o,
});
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const comment = (id: string, from = `B_${id}`) => ({ id, message: "A", created_time: "2026-11-20T09:59:00+0000", from: { id: from, name: `Buyer ${id}` } });

type Fail = (commentId: string) => "throw" | string | null;
// The fake Graph answers per stored cursor: pages = { [cursor or ""]: { data, after, next } }.
function world(pages: Record<string, { data: unknown[]; after: string | null; next: boolean }>, o: { stock?: number; allowed?: () => string[] | null | "throw" } = {}) {
  const db = { ordered: new Set<string>(), stock: o.stock ?? 99, waitlist: [] as Record<string, unknown>[], cursor: null as string | null, claims: [] as string[], saves: [] as (string | null)[] };
  let claimFail: Fail = () => null, waitFail: Fail = () => null;
  const graph = vi.fn(async (url: string) => {
    const after = new URL(url).searchParams.get("after") || "";
    const p = pages[after] ?? { data: [], after: null, next: false };
    return mkRes(200, { data: p.data, paging: p.after ? { cursors: { after: p.after }, ...(p.next ? { next: "https://graph/next" } : {}) } : {} });
  });
  const logs: string[] = [];
  const store = {
    async listActiveSales() { return [sale({ last_comment_cursor: db.cursor })]; },
    async markEnded() { /* not used */ },
    async saveCursor(_id: number, c: string | null) { db.cursor = c; db.saves.push(c); },
    async claimOrder(a: { commentId: string }) {
      db.claims.push(a.commentId);
      const f = claimFail(a.commentId);
      if (f === "throw") throw new Error("db down");
      if (f !== null) return f;
      if (db.ordered.has(a.commentId)) return "dup";
      if (db.stock < 1) return "sold_out";
      db.stock--; db.ordered.add(a.commentId); return "ordered";
    },
    async joinWaitlist(r: Record<string, unknown>) {
      if (waitFail(String(r.comment_id)) === "throw") throw new Error("waitlist down");
      if (!db.waitlist.some((w) => w.comment_id === r.comment_id)) db.waitlist.push(r);
    },
    async getPage() { return { access_token: encryptToken("PAGETOK", CONFIG.tokenKey) }; },
    ...(o.allowed ? { async allowedSellers() { const a = o.allowed!(); if (a === "throw") throw new Error("rpc down"); return a; } } : {}),
  };
  const rt = createFbPostSales({ config: CONFIG, store, enabled: async () => true, fetchImpl: graph, now: () => NOW, log: (l: string) => logs.push(l) });
  return { rt, db, graph, logs, failClaim: (f: Fail) => { claimFail = f; }, failWait: (f: Fail) => { waitFail = f; } };
}
const onePage = (ids: string[]) => ({ "": { data: ids.map((i) => comment(i)), after: "CUR1", next: false } });

describe("1. a failed claim never loses the order", () => {
  for (const bad of ["throw", "error", "not_allowed", "ended", "weird", ""] as const) {
    it(`claim answer ${JSON.stringify(bad)} on c2 → stop at c2, cursor kept; next minute c2 is ordered once`, async () => {
      const w = world(onePage(["c1", "c2", "c3"]));
      w.failClaim((id) => (id === "c2" ? (bad === "" ? "" : bad) : null));
      await w.rt.tick();
      expect(w.db.claims).toEqual(["c1", "c2"]);           // c3 not asked: the pass stopped at c2
      expect(w.db.saves).toEqual([]);                       // the cursor did not move past c2
      expect([...w.db.ordered]).toEqual(["c1"]);
      expect(w.logs.join("\n")).toContain("stopped at comment=c2");
      w.failClaim(() => null);
      w.db.claims.length = 0;
      await w.rt.tick();
      expect(w.db.claims).toEqual(["c1", "c2", "c3"]);     // the same page again
      expect([...w.db.ordered].sort()).toEqual(["c1", "c2", "c3"]);
      expect(w.db.stock).toBe(99 - 3);                      // c1 counted once
      expect(w.db.saves).toEqual(["CUR1"]);
    });
  }
  it("'dup' does not stop the pass", async () => {
    const w = world(onePage(["c1", "c2"]));
    w.db.ordered.add("c1");
    await w.rt.tick();
    expect(w.db.claims).toEqual(["c1", "c2"]);
    expect(w.db.saves).toEqual(["CUR1"]);
  });
});

describe("2. a failed waitlist write never loses the waiting buyer", () => {
  it("sold out + waitlist write throws → stop, cursor kept; next minute the row is written with the sale id", async () => {
    const w = world(onePage(["c1", "c2", "c3"]), { stock: 1 });
    w.failWait((id) => (id === "c2" ? "throw" : null));
    await w.rt.tick();
    expect(w.db.claims).toEqual(["c1", "c2"]);
    expect(w.db.waitlist).toEqual([]);
    expect(w.db.saves).toEqual([]);
    expect(w.logs.join("\n")).toContain("reason=waitlist_failed");
    w.failWait(() => null);
    await w.rt.tick();
    expect(w.db.waitlist.map((r) => r.comment_id)).toEqual(["c2", "c3"]);
    expect(w.db.waitlist[0]).toMatchObject({ source: "post", sale_id: 1, code: "A", commenter_id: "B_c2", session_id: null });
    expect([...w.db.ordered]).toEqual(["c1"]);
    expect(w.db.saves).toEqual(["CUR1"]);
  });
});

describe("3. a failure on a later page keeps the earlier page's cursor", () => {
  it("page 1 done (cursor saved), page 2 fails → next minute starts at page 2", async () => {
    const pages = { "": { data: [comment("c1"), comment("c2")], after: "P2", next: true }, P2: { data: [comment("c3"), comment("c4")], after: "P3", next: false } };
    const w = world(pages);
    w.failClaim((id) => (id === "c3" ? "throw" : null));
    await w.rt.tick();
    expect(w.db.saves).toEqual(["P2"]);
    w.failClaim(() => null);
    w.db.claims.length = 0;
    await w.rt.tick();
    expect(new URL(String(w.graph.mock.calls.at(-1)![0])).searchParams.get("after")).toBe("P2");
    expect(w.db.claims).toEqual(["c3", "c4"]);
    expect([...w.db.ordered].sort()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(w.db.saves).toEqual(["P2", "P3"]);
    expect(MAX_PAGES_PER_SALE).toBe(5);
  });
});

describe("4. the plan rule in the poller", () => {
  it("seller not allowed → no Facebook call, no claim, cursor untouched, logged once; renewed → the comments left meanwhile become orders", async () => {
    let allowed: string[] = [];
    const w = world(onePage(["c1", "c2"]), { allowed: () => allowed });
    await w.rt.tick();
    await w.rt.tick();
    expect(w.graph).not.toHaveBeenCalled();
    expect(w.db.claims).toEqual([]);
    expect(w.db.saves).toEqual([]);
    expect(w.logs.filter((l) => l.includes("paused")).length).toBe(1);
    allowed = ["u1"];
    await w.rt.tick();
    expect(w.logs.some((l) => l.includes("resumed"))).toBe(true);
    expect([...w.db.ordered].sort()).toEqual(["c1", "c2"]);
    expect(w.db.saves).toEqual(["CUR1"]);
  });
  it("an ended (past end date) sale of a seller without the plan is still marked ended", async () => {
    const ended: number[] = [];
    const graph = vi.fn();
    const rt = createFbPostSales({
      config: CONFIG, enabled: async () => true, fetchImpl: graph, now: () => NOW, log: () => {},
      store: {
        async listActiveSales() { return [sale({ ends_at: new Date(NOW - 1000).toISOString() })]; },
        async markEnded(id: number) { ended.push(id); }, async saveCursor() {}, async claimOrder() { return "ordered"; }, async joinWaitlist() {}, async getPage() { return null; },
        async allowedSellers() { return []; },
      },
    });
    await rt.tick();
    expect(ended).toEqual([1]);
    expect(graph).not.toHaveBeenCalled();
  });
  it("the rule unreadable → nobody this pass (no call, cursor kept), logged", async () => {
    const w = world(onePage(["c1"]), { allowed: () => "throw" });
    await w.rt.tick();
    expect(w.graph).not.toHaveBeenCalled();
    expect(w.db.saves).toEqual([]);
    expect(w.logs.join("\n")).toContain("plan check failed");
  });
  it("no rule in the database yet (null) → every seller, as before", async () => {
    const w = world(onePage(["c1"]), { allowed: () => null });
    await w.rt.tick();
    expect([...w.db.ordered]).toEqual(["c1"]);
  });
  it("only the allowed sellers are read; the store is asked once per pass with each seller once", async () => {
    const seen: string[][] = [];
    const graph = vi.fn(async () => mkRes(200, { data: [] }));
    const rt = createFbPostSales({
      config: CONFIG, enabled: async () => true, fetchImpl: graph, now: () => NOW, log: () => {},
      store: {
        async listActiveSales() { return [sale({ id: 1, user_id: "u1" }), sale({ id: 2, user_id: "u2", post_id: "P1_2" }), sale({ id: 3, user_id: "u1", post_id: "P1_3" })]; },
        async markEnded() {}, async saveCursor() {}, async claimOrder() { return "ordered"; }, async joinWaitlist() {}, async getPage() { return null; },
        async allowedSellers(ids: string[]) { seen.push(ids); return ["u2"]; },
      },
    });
    await rt.tick();
    expect(seen).toEqual([["u1", "u2"]]);
    expect(graph.mock.calls.map((c) => new URL(String((c as unknown[])[0])).pathname)).toEqual([expect.stringMatching(/\/P1_2\/comments$/)]);
  });
});

describe("5. the \"Sell on a post\" picker", () => {
  const rtWith = (allowedSellers: (() => Promise<string[] | null>) | null, graph = vi.fn(async () => mkRes(200, { data: [{ id: "P1_1", message: "hi" }] }))) => {
    const getPage = vi.fn(async () => ({ access_token: encryptToken("PAGETOK", CONFIG.tokenKey) }));
    const store = { async listActiveSales() { return []; }, async markEnded() {}, async saveCursor() {}, async claimOrder() { return "ordered"; }, async joinWaitlist() {}, getPage, ...(allowedSellers ? { allowedSellers } : {}) };
    return { rt: createFbPostSales({ config: CONFIG, store, enabled: async () => true, fetchImpl: graph, now: () => NOW }), getPage, graph };
  };
  it("seller without the plan → plan_not_allowed, no Page read, no Facebook call", async () => {
    const x = rtWith(async () => []);
    expect(await x.rt.recentPosts("u1", "P1")).toEqual({ ok: false, error: "plan_not_allowed" });
    expect(x.getPage).not.toHaveBeenCalled();
    expect(x.graph).not.toHaveBeenCalled();
  });
  it("the rule unreadable → plan_check_failed", async () => {
    const x = rtWith(async () => { throw new Error("down"); });
    expect(await x.rt.recentPosts("u1", "P1")).toEqual({ ok: false, error: "plan_check_failed" });
  });
  it("allowed (or no rule yet) → the posts", async () => {
    expect((await rtWith(async () => ["u1"]).rt.recentPosts("u1", "P1")).ok).toBe(true);
    expect((await rtWith(async () => null).rt.recentPosts("u1", "P1")).ok).toBe(true);
  });
});

describe("server.js wiring (post-sales block only)", () => {
  const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
  it("the plan list comes from fb_post_sellers_allowed; missing function → null (every seller)", () => {
    expect(server).toContain('serviceSb.rpc("fb_post_sellers_allowed", { p_uids: userIds })');
    expect(server).toMatch(/error\.code === "PGRST202" \|\| error\.code === "42883"\) return null;/);
  });
  it("the waitlist row keeps the sale id; before sql/188 it is written without it", () => {
    expect(server).toMatch(/"sale_id" in row && \(error\.code === "PGRST204" \|\| error\.code === "42703"\)/);
  });
  it("the picker route answers 403 for the plan and 503 when the rule cannot be read", () => {
    expect(server).toContain('r.error === "plan_not_allowed" ? 403 : r.error === "plan_check_failed" ? 503 : 502');
  });
});
