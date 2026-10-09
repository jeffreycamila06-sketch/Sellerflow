// @vitest-environment node
// Build 3 — "Comment paging" (switch fb_comment_paging, sql/105), server only. Pins:
//   • switch ON, after the first poll: a full page of unseen comments with a cursor → older pages
//     follow; every comment emitted once, oldest → newest; stops at a known comment, a page that
//     is not full, no cursor, or 3 extra pages (≤ 4 requests, ≤ 400 comments a tick); the rest of
//     a capped drop comes on the next tick;
//   • the first poll after Connect stays one page (initial:true as before);
//   • a failed follow-up page keeps what was read, never stops the poll, one log line;
//   • switch OFF → exactly one request per tick in every case; the switch is not even asked on a
//     normal tick; EMITTED_CAP is 1000.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbRuntime, EMITTED_CAP, MAX_COMMENT_PAGES, COMMENTS_PAGE_LIMIT, nextCommentsCursor } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;

// The live's comments, NEWEST first (Graph reverse_chronological). Pages of 100 by numeric cursor.
function rig(o: { on: boolean; cursor?: "cursors" | "next" | "none"; failAt?: { after: string; res: () => unknown } }) {
  let all: { id: string; message: string; from: { id: string; name: string }; created_time: string }[] = [];
  let seq = 0;
  const add = (n: number) => { const fresh = Array.from({ length: n }, () => { seq++; return { id: `c${seq}`, message: "mine", from: { id: `u${seq}`, name: `B${seq}` }, created_time: "2026-10-09T00:00:00+0000" }; }); all = [...fresh.reverse(), ...all]; };
  const commentCalls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    if (!/\/comments\?/.test(url)) return mkRes(200, { status: "LIVE" });
    const after = new URL(url).searchParams.get("after") || "";
    commentCalls.push(after);
    if (o.failAt && o.failAt.after === after) return o.failAt.res();
    const start = after ? Number(after) : 0;
    const data = all.slice(start, start + COMMENTS_PAGE_LIMIT);
    const more = start + COMMENTS_PAGE_LIMIT < all.length;
    const nextAt = String(start + COMMENTS_PAGE_LIMIT);
    const paging = !more || o.cursor === "none" ? undefined
      : o.cursor === "next" ? { next: `https://graph.facebook.com/v25.0/LV1/comments?access_token=X&after=${nextAt}` }
      : { cursors: { after: nextAt } };
    return mkRes(200, { data, ...(paging ? { paging } : {}) });
  });
  const store = {
    async getPage() { return { user_id: "u1", page_id: "P1", active: true, access_token: encryptToken("TOK", CONFIG.tokenKey), token_expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() }; },
    async listActivePages() { return []; },
  };
  const emitComment = vi.fn();
  const logs: string[] = [];
  const pagingFlag = vi.fn(async () => o.on);
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment, statusEmit: vi.fn(), liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl, now: () => 1_000_000, log: (l: string) => logs.push(l), setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
    commentPagingEnabled: pagingFlag,
  });
  const entry = rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1", sessionId: "S1" });
  const emitted = () => emitComment.mock.calls.map((c) => c[2]);
  const tick = async () => { const before = commentCalls.length; const n0 = emitComment.mock.calls.length; const r = await rt.pollOnce(entry); return { r, requests: commentCalls.length - before, out: emitComment.mock.calls.slice(n0).map((c) => c[2]) }; };
  return { rt, entry, add, tick, emitted, logs, pagingFlag, commentCalls };
}
const ids = (out: { msgId: string }[]) => out.map((p) => p.msgId);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `c${a + i}`);

describe("switch ON", () => {
  it("150 new after the first poll → 2 requests, all 150 once, oldest → newest, live (not initial)", async () => {
    const x = rig({ on: true });
    x.add(10);
    const first = await x.tick();
    expect(first.requests).toBe(1);
    expect(first.out.every((p) => p.initial === true)).toBe(true);
    x.add(150);
    const t2 = await x.tick();
    expect(t2.requests).toBe(2);
    expect(ids(t2.out)).toEqual(range(11, 160));               // oldest → newest, no repeats
    expect(t2.out.some((p) => p.initial)).toBe(false);
    expect(t2.r.stop).toBe(false);
  });
  it("stops at a known comment: page 2 holds already-delivered comments → no page 3, nothing twice", async () => {
    const x = rig({ on: true });
    x.add(300); await x.tick();                                // first poll: newest 100 delivered (initial)
    x.add(120);
    const t = await x.tick();
    expect(t.requests).toBe(2);
    expect(ids(t.out)).toEqual(range(301, 420));
    const all = ids(x.emitted());
    expect(new Set(all).size).toBe(all.length);
  });
  it("cap: 500 new → 4 requests and 400 this tick; the other 100 on the next tick; nothing twice", async () => {
    const x = rig({ on: true });
    x.add(10); await x.tick();
    x.add(500);
    const t = await x.tick();
    expect(t.requests).toBe(1 + MAX_COMMENT_PAGES);
    expect(ids(t.out)).toEqual(range(111, 510));               // the newest 400
    const t2 = await x.tick();
    expect(ids(t2.out)).toEqual(range(11, 110));               // the oldest 100 of the drop
    expect(t2.requests).toBe(3);                               // page 1 (known) + the saved cursor + one known page
    const t3 = await x.tick();
    expect(t3.requests).toBe(1);                               // backlog done → back to one page
    const all = ids(x.emitted());
    expect(new Set(all).size).toBe(all.length);
    expect(EMITTED_CAP).toBe(1000);
  });
  it("not full (37) → 1 request; full but no cursor → 1 request; paging.next works like cursors.after", async () => {
    const a = rig({ on: true }); a.add(5); await a.tick(); a.add(37);
    expect((await a.tick()).requests).toBe(1);
    const b = rig({ on: true, cursor: "none" }); b.add(5); await b.tick(); b.add(150);
    expect((await b.tick()).requests).toBe(1);
    const c = rig({ on: true, cursor: "next" }); c.add(5); await c.tick(); c.add(150);
    const t = await c.tick();
    expect(t.requests).toBe(2);
    expect(ids(t.out)).toEqual(range(6, 155));
    expect(nextCommentsCursor({ paging: { next: "https://x.test/a?after=QQ" } })).toBe("QQ");
    expect(nextCommentsCursor({ paging: {} })).toBe("");
    expect(nextCommentsCursor({})).toBe("");
  });
  it("first poll after Connect: one request even when full (initial lane as before)", async () => {
    const x = rig({ on: true });
    x.add(300);
    const t = await x.tick();
    expect(t.requests).toBe(1);
    expect(t.out).toHaveLength(100);
    expect(t.out.every((p) => p.initial === true)).toBe(true);
  });
  it("a failed follow-up page (429 / 500 / timeout) keeps page 1, poll goes on, one log line, next tick normal", async () => {
    for (const fail of [() => mkRes(429, { error: { code: 4, message: "x" } }), () => mkRes(500, { error: { code: 2, message: "x" } }), () => { throw new Error("graph_timeout"); }]) {
      const x = rig({ on: true, failAt: { after: "100", res: fail } });
      x.add(10); await x.tick();
      x.add(150);
      const t = await x.tick();
      expect(t.r.stop).toBe(false);
      expect(t.r.backoff).toBeUndefined();                      // page 1 was clean → a normal tick
      expect(ids(t.out)).toEqual(range(61, 160));               // page 1 kept
      expect(x.logs.filter((l) => /comments page 2 failed/.test(l))).toHaveLength(1);
      expect(x.logs.join("\n")).not.toMatch(/TOK|access_token/);
    }
  });
});

describe("switch OFF", () => {
  it("one request per tick in every case; the switch is asked only when a drop would page", async () => {
    const x = rig({ on: false });
    x.add(10); await x.tick();
    expect(x.pagingFlag).not.toHaveBeenCalled();               // the first poll never asks
    x.add(37);
    expect((await x.tick()).requests).toBe(1);
    expect(x.pagingFlag).not.toHaveBeenCalled();               // a normal tick never asks
    x.add(500);
    const t = await x.tick();
    expect(t.requests).toBe(1);
    expect(ids(t.out)).toEqual(range(448, 547));                // newest 100 only — today's behaviour
    expect(x.pagingFlag).toHaveBeenCalledTimes(1);
    expect((await x.tick()).requests).toBe(1);
  });
  it("server.js passes the cached fb_comment_paging reader (source contract)", () => {
    const src = readFileSync("server.js", "utf8");
    expect(src).toContain('.eq("key", "fb_comment_paging")');
    expect(src).toContain("commentPagingEnabled: fbCommentPagingFlag,");
  });
});
