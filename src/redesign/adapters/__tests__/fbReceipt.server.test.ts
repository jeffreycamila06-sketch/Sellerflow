// Messenger receipt Send (server/fbReceipt.js) — FAKE data only; Graph, storage and the DB
// are in-memory fakes. Pins: the access gate, DB-only comment/page selection, the 7-day
// window, candidate order, one Graph call under parallel sends, needs_messaging, failed /
// unknown handling (never setActive), the exact verified request shape, safe logs, parser
// order + body limit, and the sql/75 mirror.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createFbReceipt, pickReceiptCandidates, decodeReceiptPng, classifyReceiptAnswer, buildReceiptRequest,
  RECEIPT_WINDOW_MS, RECEIPT_BODY_LIMIT, RECEIPT_SEND_RATE_MAX, RECEIPT_MAX_IMAGE_BYTES,
} from "../../../../server/fbReceipt.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import { GRAPH_VERSION } from "../../../../server/fbConfig.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-10-05T12:00:00Z");
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const OTHER = "bbbbbbbb-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const PAGE_TOKEN = "PAGE-TOKEN-SECRET";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const PNG_B64 = PNG.toString("base64");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000, D = 24 * H;

type Order = { user_id: string; session_id: string; buyer_number: number; platform: string; comment_msg_id: string | null; platform_meta: Record<string, string> | null; handle: string; created_at: string };
type Row = { id: number; user_id: string; comment_id: string; status: string; [k: string]: unknown };

function makeStore(opts: { orders?: Order[]; rows?: Row[]; access?: boolean; page?: Record<string, unknown> | null } = {}) {
  const orders = opts.orders ?? [];
  const rows: Row[] = (opts.rows ?? []).map((r) => ({ ...r }));
  const page = opts.page === undefined
    ? { user_id: U, page_id: "P1", active: true, can_message: true, access_token: encryptToken(PAGE_TOKEN, CONFIG.tokenKey) }
    : opts.page;
  let nextId = 100;
  const store = {
    rows, uploads: [] as { path: string; size: number }[],
    hasReceiptAccess: vi.fn(async (uid: string) => (opts.access ?? true) && uid === U),
    listReceiptOrders: vi.fn(async (uid: string, sid: string, bn: number, since: string) =>
      orders.filter((o) => o.user_id === uid && o.session_id === sid && o.buyer_number === bn && o.platform === "Facebook" && o.comment_msg_id != null && o.created_at >= since)),
    listReceiptRows: vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.comment_id))),
    insertReceipt: vi.fn(async (row: Record<string, unknown>) => {
      if (rows.some((r) => r.comment_id === row.comment_id && r.status !== "failed")) return { conflict: true }; // the partial unique index
      const r = { ...row, id: nextId++ } as Row;
      rows.push(r);
      return { id: r.id };
    }),
    updateReceipt: vi.fn(async (id: number, patch: Record<string, unknown>) => { Object.assign(rows.find((r) => r.id === id)!, patch); }),
    deleteReceipt: vi.fn(async (id: number, uid: string) => {
      const i = rows.findIndex((r) => r.id === id && r.user_id === uid && r.status === "pending");
      if (i >= 0) rows.splice(i, 1);
      return true;
    }),
    uploadReceiptImage: vi.fn(async (path: string, buf: Buffer) => { store.uploads.push({ path, size: buf.length }); return `https://cdn.test/storage/v1/object/public/fb-receipts/${path}`; }),
    getPage: vi.fn(async (uid: string, pid: string) => (page && uid === page.user_id && pid === page.page_id ? { ...page } : null)),
    setActive: vi.fn(),
  };
  return store;
}
const order = (over: Partial<Order> = {}): Order => ({
  user_id: U, session_id: S, buyer_number: 3, platform: "Facebook", comment_msg_id: "c1",
  platform_meta: { page_id: "P1", live_video_id: "LV1" }, handle: "Maria Santos", created_at: ago(2 * H), ...over,
});
const graphOk = (id = "m.ABC") => vi.fn(async () => ({ status: 200, json: async () => ({ recipient_id: "R1", message_id: id }) }));
function rt(store: ReturnType<typeof makeStore>, fetchImpl: unknown = graphOk(), extra: Record<string, unknown> = {}) {
  const logs: string[] = [];
  let n = 0;
  const r = createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => NOW, log: (l: string) => logs.push(l), randomHex: () => `${"f".repeat(63)}${n++ % 10}`, ...extra });
  return { r, logs };
}
const body = (over: Record<string, unknown> = {}) => ({ sessionId: S, buyerNumber: 3, imagePngBase64: PNG_B64, ...over });

describe("access gate", () => {
  it("no fb_receipt_access → 403 no_access; nothing read, claimed or sent; info says no_access", async () => {
    const store = makeStore({ orders: [order()], access: false });
    const f = graphOk();
    const { r } = rt(store, f);
    expect(await r.send(U, body())).toEqual({ status: 403, json: { ok: false, error: "no_access" } });
    expect(store.listReceiptOrders).not.toHaveBeenCalled();
    expect(store.insertReceipt).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
    expect((await r.info(U, body())).json).toMatchObject({ ok: true, canSend: false, reason: "no_access" });
  });
});

describe("comment + page come only from the database", () => {
  it("client-supplied comment id / page id / handle are ignored", async () => {
    const store = makeStore({ orders: [order({ comment_msg_id: "c-db" })] });
    const f = graphOk();
    const { r } = rt(store, f);
    const out = await r.send(U, body({ commentId: "evil", comment_id: "evil", pageId: "P-evil", page_id: "P-evil", handle: "x", recipient: { comment_id: "evil" } }));
    expect(out.status).toBe(200);
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string }];
    expect(url.startsWith(`https://graph.facebook.com/${GRAPH_VERSION}/P1/messages?`)).toBe(true);
    expect(JSON.parse(init.body).recipient).toEqual({ comment_id: "c-db" });
    expect(store.getPage).toHaveBeenCalledWith(U, "P1");
    expect(store.insertReceipt.mock.calls[0][0]).toMatchObject({ user_id: U, page_id: "P1", comment_id: "c-db", live_video_id: "LV1", handle: "Maria Santos", buyer_number: 3, session_id: S, status: "pending" });
  });
  it("other users, sessions, buyers and platforms are never candidates", async () => {
    const store = makeStore({ orders: [
      order({ user_id: OTHER, comment_msg_id: "x1" }), order({ session_id: "99999999-2222-3333-4444-555555555555", comment_msg_id: "x2" }),
      order({ buyer_number: 4, comment_msg_id: "x3" }), order({ platform: "TikTok", comment_msg_id: "x4" }), order({ comment_msg_id: null }),
    ] });
    const { r } = rt(store);
    expect(await r.send(U, body())).toEqual({ status: 409, json: { ok: false, error: "none_left" } });
    expect((await r.info(U, body())).json).toMatchObject({ canSend: false, reason: "no_orders" });
  });
  it("7-day window: the query starts at now − (7 days − 1 hour)", async () => {
    const store = makeStore({ orders: [order({ comment_msg_id: "old", created_at: ago(7 * D - H + 60_000) }), order({ comment_msg_id: "ok", created_at: ago(6 * D) })] });
    const f = graphOk();
    const { r } = rt(store, f);
    await r.send(U, body());
    expect(store.listReceiptOrders.mock.calls[0][3]).toBe(new Date(NOW - RECEIPT_WINDOW_MS).toISOString());
    expect(RECEIPT_WINDOW_MS).toBe(7 * D - H);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body).recipient.comment_id).toBe("ok");
  });
});

describe("candidate order", () => {
  it("no pending/sent; < 2 failed; never-failed first, then newest", () => {
    const orders = [
      order({ comment_msg_id: "old", created_at: ago(5 * H) }), order({ comment_msg_id: "new", created_at: ago(1 * H) }),
      order({ comment_msg_id: "failed1", created_at: ago(0.5 * H) }), order({ comment_msg_id: "failed2", created_at: ago(0.2 * H) }),
      order({ comment_msg_id: "sent", created_at: ago(0.1 * H) }), order({ comment_msg_id: "pending", created_at: ago(0.1 * H) }),
    ];
    const rows = [
      { comment_id: "failed1", status: "failed" }, { comment_id: "failed2", status: "failed" }, { comment_id: "failed2", status: "failed" },
      { comment_id: "sent", status: "sent" }, { comment_id: "pending", status: "pending" },
    ];
    expect(pickReceiptCandidates(orders, rows).map((c: { commentId: string }) => c.commentId)).toEqual(["new", "old", "failed1"]);
  });
});

describe("one live message per comment", () => {
  it("two parallel sends for a buyer with ONE comment → exactly one Graph call", async () => {
    const store = makeStore({ orders: [order()] });
    const f = graphOk();
    const { r } = rt(store, f);
    const [a, b] = await Promise.all([r.send(U, body()), r.send(U, body())]);
    expect(f).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(store.rows.filter((x) => x.status !== "failed")).toHaveLength(1);
  });
  it("a sent comment is never used again; the next send takes the next comment", async () => {
    const store = makeStore({ orders: [order({ comment_msg_id: "c1", created_at: ago(1 * H) }), order({ comment_msg_id: "c2", created_at: ago(2 * H) })] });
    const f = graphOk();
    const { r } = rt(store, f);
    expect((await r.send(U, body())).json).toMatchObject({ ok: true, sentCount: 1, remaining: 1 });
    expect((await r.send(U, body())).json).toMatchObject({ ok: true, sentCount: 2, remaining: 0 });
    expect((await r.send(U, body())).json).toEqual({ ok: false, error: "none_left" });
    expect(f.mock.calls.map((c) => JSON.parse((c as unknown as [string, { body: string }])[1].body).recipient.comment_id)).toEqual(["c1", "c2"]);
    expect(store.rows.map((x) => x.status)).toEqual(["sent", "sent"]);
  });
});

describe("needs_messaging", () => {
  for (const [label, page] of [
    ["can_message false", { user_id: U, page_id: "P1", active: true, can_message: false, access_token: encryptToken(PAGE_TOKEN, "tk") }],
    ["inactive page", { user_id: U, page_id: "P1", active: false, can_message: true, access_token: encryptToken(PAGE_TOKEN, "tk") }],
    ["token does not decrypt", { user_id: U, page_id: "P1", active: true, can_message: true, access_token: encryptToken(PAGE_TOKEN, "other-key") }],
    ["page missing", null],
  ] as const) {
    it(`${label} → 409 needs_messaging; nothing claimed or sent`, async () => {
      const store = makeStore({ orders: [order()], page: page as Record<string, unknown> | null });
      const f = graphOk();
      const { r } = rt(store, f);
      expect(await r.send(U, body())).toEqual({ status: 409, json: { ok: false, error: "needs_messaging" } });
      expect(store.insertReceipt).not.toHaveBeenCalled();
      expect(f).not.toHaveBeenCalled();
      expect((await r.info(U, body())).json).toMatchObject({ canSend: false, reason: "needs_messaging" });
    });
  }
});

describe("Graph error / unknown result", () => {
  it("Graph error → row 'failed' with code/subcode; never setActive; page row untouched", async () => {
    const store = makeStore({ orders: [order()] });
    const f = vi.fn(async () => ({ status: 400, json: async () => ({ error: { code: 10, error_subcode: 2018108, message: "x" } }) }));
    const { r } = rt(store, f);
    expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "send_failed", code: 10 } });
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10/2018108" });
    expect(store.setActive).not.toHaveBeenCalled();
  });
  it("code 190 → needs_reauth (still never setActive)", async () => {
    const store = makeStore({ orders: [order()] });
    const { r } = rt(store, vi.fn(async () => ({ status: 400, json: async () => ({ error: { code: 190 } }) })));
    expect((await r.send(U, body())).json).toEqual({ ok: false, error: "needs_reauth", code: 190 });
    expect(store.setActive).not.toHaveBeenCalled();
  });
  it("failed rows allow a retry until 2 failures, then the comment is used up", async () => {
    const store = makeStore({ orders: [order()] });
    const fail = vi.fn(async () => ({ status: 400, json: async () => ({ error: { code: 10 } }) }));
    const { r } = rt(store, fail);
    await r.send(U, body());
    await r.send(U, body());
    expect(fail).toHaveBeenCalledTimes(2);
    expect((await r.send(U, body())).json).toEqual({ ok: false, error: "none_left" });
  });
  for (const [label, f] of [
    ["network error", vi.fn(async () => { throw new Error("ECONNRESET"); })],
    ["200 without message_id", vi.fn(async () => ({ status: 200, json: async () => ({}) }))],
    ["5xx with no JSON", vi.fn(async () => ({ status: 503, json: async () => { throw new Error("html"); } }))],
  ] as const) {
    it(`${label} → row stays 'pending' (comment never reused), unknown_result`, async () => {
      const store = makeStore({ orders: [order()] });
      const { r } = rt(store, f);
      expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "unknown_result" } });
      expect(store.rows[0].status).toBe("pending");
      expect((await r.send(U, body())).json).toEqual({ ok: false, error: "none_left" });
    });
  }
  it("upload failure → the claim is deleted (own row id); the comment stays a candidate; Graph never called", async () => {
    const store = makeStore({ orders: [order()] });
    store.uploadReceiptImage.mockRejectedValueOnce(new Error("bucket missing"));
    const f = graphOk();
    const { r } = rt(store, f);
    expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "upload_failed" } });
    expect(store.deleteReceipt).toHaveBeenCalledWith(100, U);
    expect(store.rows).toHaveLength(0);
    expect((await r.info(U, body())).json).toMatchObject({ canSend: true, remaining: 1 });
    expect(f).not.toHaveBeenCalled();
  });
  it("three upload failures in a row → still a candidate every time; Graph never called; then a send works", async () => {
    const store = makeStore({ orders: [order()] });
    store.uploadReceiptImage.mockRejectedValueOnce(new Error("x")).mockRejectedValueOnce(new Error("x")).mockRejectedValueOnce(new Error("x"));
    const f = graphOk();
    const { r } = rt(store, f);
    for (let i = 0; i < 3; i++) {
      expect((await r.send(U, body())).json).toEqual({ ok: false, error: "upload_failed" });
      expect(pickReceiptCandidates([order()], store.rows).map((c: { commentId: string }) => c.commentId)).toEqual(["c1"]);
    }
    expect(f).not.toHaveBeenCalled();
    expect((await r.send(U, body())).json).toMatchObject({ ok: true, sentCount: 1 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("delete fails → fall back to marking the claim failed ('upload/0')", async () => {
    for (const del of [vi.fn(async () => false), vi.fn(async () => { throw new Error("db"); })]) {
      const store = makeStore({ orders: [order()] });
      store.uploadReceiptImage.mockRejectedValueOnce(new Error("x"));
      store.deleteReceipt = del as never;
      const { r } = rt(store);
      expect((await r.send(U, body())).json).toEqual({ ok: false, error: "upload_failed" });
      expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "upload/0" });
    }
  });
});

describe("the verified request shape", () => {
  it("POST /{page}/messages with exactly recipient + message (image attachment url); no messaging_type, no tag", async () => {
    const store = makeStore({ orders: [order()] });
    const f = graphOk();
    const { r } = rt(store, f);
    await r.send(U, body());
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/P1/messages`);
    expect([...u.searchParams.keys()]).toEqual(["access_token"]);
    expect(u.searchParams.get("access_token")).toBe(PAGE_TOKEN);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({ recipient: { comment_id: "c1" }, message: { attachment: { type: "image", payload: { url: `https://cdn.test/storage/v1/object/public/fb-receipts/${store.uploads[0].path}` } } } });
    expect(store.uploads[0].path).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(buildReceiptRequest({ pageId: "P1", commentId: "c", imageUrl: "u", pageToken: "t" }).body).toEqual({ recipient: { comment_id: "c" }, message: { attachment: { type: "image", payload: { url: "u" } } } });
  });
  it("success → row 'sent' with message_id and sent_at", async () => {
    const store = makeStore({ orders: [order()] });
    const { r } = rt(store, graphOk("m.XYZ"));
    expect((await r.send(U, body())).json).toEqual({ ok: true, sentCount: 1, remaining: 0, lastSentAt: new Date(NOW).toISOString() });
    expect(store.rows[0]).toMatchObject({ status: "sent", message_id: "m.XYZ", sent_at: new Date(NOW).toISOString() });
    expect(classifyReceiptAnswer(200, { message_id: "m" })).toEqual({ kind: "sent", messageId: "m" });
  });
});

describe("logs", () => {
  it("one line per attempt; never the token, the image, the URL or the buyer's name/handle", async () => {
    const store = makeStore({ orders: [order()] });
    const { r, logs } = rt(store);
    await r.send(U, body());
    expect(logs).toEqual([`[FB] receipt user=${U.slice(0, 8)} page=P1 result=sent code=0/0`]);
    const all = logs.join("\n");
    for (const bad of [PAGE_TOKEN, "cdn.test", store.uploads[0].path, "Maria", PNG_B64.slice(0, 20)]) expect(all).not.toContain(bad);
  });
});

describe("image validation", () => {
  it("bad image → 400 bad_image (not PNG, not base64, over 4 MB, empty)", async () => {
    const { r } = rt(makeStore({ orders: [order()] }));
    const big = Buffer.concat([PNG, Buffer.alloc(RECEIPT_MAX_IMAGE_BYTES)]).toString("base64");
    for (const img of ["", "not base64!!", Buffer.from("GIF89a-not-a-png").toString("base64"), big, undefined]) {
      expect((await r.send(U, body({ imagePngBase64: img }))).json).toEqual({ ok: false, error: "bad_image" });
    }
    expect(decodeReceiptPng(`data:image/png;base64,${PNG_B64}`)?.length).toBe(PNG.length);
  });
});

describe("routes: middleware order, body limit, rate limit", () => {
  it("send = requireAuth → access gate → rate limit → 6mb parser → handler; info = requireAuth → handler", () => {
    const makeJsonParser = vi.fn((limit: string) => Object.assign(() => {}, { limit }));
    const { r } = rt(makeStore(), graphOk(), { makeJsonParser });
    const routes: Record<string, unknown[]> = {};
    const requireAuth = () => {};
    r.registerRoutes({ post: (p: string, ...h: unknown[]) => { routes[p] = h; } }, requireAuth);
    expect(makeJsonParser).toHaveBeenCalledWith(RECEIPT_BODY_LIMIT);
    expect(RECEIPT_BODY_LIMIT).toBe("6mb");
    const send = routes["/fb/receipt/send"];
    expect(send).toHaveLength(5);
    expect(send[0]).toBe(requireAuth);
    expect(send[1]).toBe(r.sendAccessGate);
    expect(send[2]).toBe(r.sendRateLimit);
    expect((send[3] as { limit: string }).limit).toBe("6mb");
    expect(routes["/fb/receipt/info"]).toHaveLength(2);
    expect(routes["/fb/receipt/info"][0]).toBe(requireAuth);
  });
  it("no-access account → 403 at the gate: the parser never runs and no rate-limit entry is made", async () => {
    const parser = vi.fn((_q: unknown, _s: unknown, next: () => void) => next());
    const store = makeStore({ orders: [order()] });
    const f = graphOk();
    const { r } = rt(store, f, { makeJsonParser: () => parser });
    const routes: Record<string, ((req: unknown, res: unknown, next: () => void) => unknown)[]> = {};
    r.registerRoutes({ post: (p: string, ...h: never[]) => { routes[p] = h; } }, (_q: unknown, _s: unknown, next: () => void) => next());
    const run = async (uid: string) => {
      let status = 0; let json: unknown = null;
      const res = { status(c: number) { status = c; return this; }, json(b: unknown) { json = b; return this; } };
      const req = { authUserId: uid, body: body() };
      for (const h of routes["/fb/receipt/send"]) {
        let advanced = false;
        await h(req, res, () => { advanced = true; });
        if (!advanced) break;
      }
      return { status, json };
    };
    expect(await run(OTHER)).toEqual({ status: 403, json: { ok: false, error: "no_access" } });
    expect(parser).not.toHaveBeenCalled();
    expect(r._sendAttempts.has(OTHER)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    // an account WITH access passes the gate, gets a rate-limit entry and is parsed
    expect((await run(U)).status).toBe(200);
    expect(parser).toHaveBeenCalledTimes(1);
    expect(r._sendAttempts.get(U)).toHaveLength(1);
  });
  it("the global JSON parser skips /fb/receipt/send (auth before parser); routes registered in the FB block", () => {
    const src = readFileSync("server.js", "utf8");
    expect(src).toContain('req.path === "/admin/parcel-scan" || req.path === "/admin/parcel-tracking-poll" || req.path === "/fb/receipt/send" ? next() : defaultJsonParser(req, res, next)');
    expect(src).toContain("createFbReceipt({ config: fbCfg, store, log: (line) => console.log(line) }).registerRoutes(app, requireAuth);");
    expect(src.indexOf("createFbReceipt({")).toBeGreaterThan(src.indexOf("fbRuntime.registerRoutes(app"));
  });
  it("a throwing receipt registration can never null fbRuntime or skip the refresh timer", () => {
    const src = readFileSync("server.js", "utf8");
    const at = src.indexOf("createFbReceipt({ config: fbCfg");
    const tryAt = src.lastIndexOf("try {", at);
    const block = src.slice(tryAt, src.indexOf("fbRuntime.startRefreshTimer();", at));
    expect(src.slice(src.indexOf("fbRuntime.registerRoutes(app"), at)).toMatch(/try \{\s*$/);
    expect(block).toMatch(/\} catch \{\s*console\.log\("\[FB\] receipt routes not registered"\);\s*\}/);
    expect(block).not.toContain("fbRuntime = null");
    expect(src.indexOf("fbRuntime.startRefreshTimer();", at)).toBeGreaterThan(at);
    const outer = src.slice(src.indexOf("fbRuntime = createFbRuntime({"), src.indexOf("fbRuntime.startRefreshTimer();"));
    expect((outer.match(/try \{/g) || []).length).toBe((outer.match(/\} catch \{/g) || []).length); // the new try is closed before the timer
  });
  it(`at most ${RECEIPT_SEND_RATE_MAX} sends per minute per user`, () => {
    const { r } = rt(makeStore());
    let code = 0;
    const res = { status(c: number) { code = c; return this; }, json() { return this; } };
    let passed = 0;
    for (let i = 0; i < RECEIPT_SEND_RATE_MAX + 1; i++) r.sendRateLimit({ authUserId: U }, res, () => { passed++; });
    expect(passed).toBe(RECEIPT_SEND_RATE_MAX);
    expect(code).toBe(429);
  });
});

describe("sql/75 mirror", () => {
  const sql = readFileSync("sql/75_fb_receipts.sql", "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").toLowerCase();
  it("table, partial unique index, index, RLS + revoke, public PNG bucket; idempotent; no drop", () => {
    expect(code).toContain("create table if not exists public.fb_receipts");
    for (const col of ["id            bigint generated always as identity primary key", "user_id       uuid not null references auth.users(id) on delete cascade",
      "page_id       text not null", "comment_id    text not null", "status        text not null default 'pending' check (status in ('pending','sent','failed'))"]) expect(code).toContain(col);
    expect(code).toMatch(/create unique index if not exists \w+\s+on public\.fb_receipts \(comment_id\) where status <> 'failed'/);
    expect(code).toMatch(/create index if not exists \w+\s+on public\.fb_receipts \(user_id, session_id, buyer_number\)/);
    expect(code).toContain("alter table public.fb_receipts enable row level security");
    expect(code).toContain("revoke all on public.fb_receipts from anon, authenticated");
    expect(code).toContain("values ('fb-receipts', 'fb-receipts', true, 5242880, array['image/png'])");
    expect(code).toContain("on conflict (id) do nothing");
    expect(code).not.toMatch(/\bdrop\b|create policy/);
  });
});
