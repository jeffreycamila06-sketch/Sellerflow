// F2 — POST /fb/soldout/send (server/fbSoldout.js). Pins: every gate (switch, receipt access,
// the seller's toggle, page sendable, comment OWNED = emitted by this seller's poller on that
// page), one reply per comment (the database conflict), the give-back on retryable Graph
// codes, its own rate-limit bucket, the TEXT body shape, the text rules ({code}, {position},
// the seller's own text vs the built-in default), and the read-only wasEmitted accessor.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbSoldout, soldoutText, parseSoldoutBody, buildSoldoutRequest, SOLDOUT_DEFAULTS, SOLDOUT_RATE_MAX } from "../../../../server/fbSoldout.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import { createFbRuntime } from "../../../../server/fbLive.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const TOKEN = "PAGE-TOKEN-SECRET";
const BODY = { pageId: "111", commentId: "222_333", code: "A1", lang: "en" };

type Row = { id: number; [k: string]: unknown };
function makeStore(o: { access?: boolean; settings?: { enabled: boolean; text: string } | "throw"; page?: Record<string, unknown> | null; conflict?: boolean } = {}) {
  const rows: Row[] = [];
  return {
    rows,
    hasReceiptAccess: async () => o.access !== false,
    getSoldoutSettings: async () => { if (o.settings === "throw") throw new Error("x"); return o.settings ?? { enabled: true, text: "" }; },
    getPage: async () => (o.page === undefined ? { user_id: U, page_id: "111", active: true, can_message: true, access_token: encryptToken(TOKEN, CONFIG.tokenKey) } : o.page),
    insertReceipt: vi.fn(async (row: Record<string, unknown>) => {
      if (o.conflict || rows.some((r) => r.comment_id === row.comment_id && r.status !== "failed")) return { conflict: true };
      const r = { ...row, id: 1 + rows.length }; rows.push(r); return { id: r.id };
    }),
    updateReceipt: vi.fn(async (id: number, patch: Record<string, unknown>) => { Object.assign(rows.find((r) => r.id === id)!, patch); return {}; }),
    deleteReceipt: vi.fn(async (id: number) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true; }),
  };
}
const okFetch = () => vi.fn(async () => ({ status: 200, json: async () => ({ recipient_id: "R", message_id: "M1" }) }));
function rt(store: ReturnType<typeof makeStore>, o: { flag?: boolean; owned?: boolean; fetchImpl?: unknown; now?: () => number } = {}) {
  const logs: string[] = [];
  const fetchImpl = o.fetchImpl ?? okFetch();
  const owned = vi.fn(() => o.owned !== false);
  const r = createFbSoldout({ config: CONFIG, store, soldoutEnabled: async () => o.flag !== false, isOwnedComment: owned, fetchImpl, now: o.now ?? (() => 1_000_000), log: (l: string) => logs.push(l) });
  return { r, logs, fetchImpl: fetchImpl as ReturnType<typeof okFetch>, owned };
}

describe("gates — every one refuses with nothing sent", () => {
  const cases: [string, Parameters<typeof makeStore>[0], Parameters<typeof rt>[1], number, string][] = [
    ["switch off", {}, { flag: false }, 403, "disabled"],
    ["no receipt access", { access: false }, {}, 403, "no_access"],
    ["seller toggle off", { settings: { enabled: false, text: "" } }, {}, 409, "seller_off"],
    ["seller settings unreadable", { settings: "throw" }, {}, 409, "seller_off"],
    ["page not sendable", { page: { user_id: U, page_id: "111", active: true, can_message: false, access_token: "x" } }, {}, 409, "needs_messaging"],
    ["page not the seller's", { page: null }, {}, 409, "needs_messaging"],
    ["comment not emitted by this seller's poller", {}, { owned: false }, 403, "not_owned"],
  ];
  for (const [name, so, ro, status, error] of cases) {
    it(name, async () => {
      const store = makeStore(so);
      const { r, fetchImpl } = rt(store, ro);
      const out = await r.send(U, BODY);
      expect(out.status).toBe(status);
      expect(out.json.error).toBe(error);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(store.insertReceipt).not.toHaveBeenCalled();
    });
  }
  it("ownership is checked for THIS user, comment and page", async () => {
    const { r, owned } = rt(makeStore());
    await r.send(U, BODY);
    expect(owned).toHaveBeenCalledWith(U, "222_333", "111");
  });
  it("bad body → 400", async () => {
    const { r } = rt(makeStore());
    expect((await r.send(U, { ...BODY, commentId: "x;drop" })).status).toBe(400);
    expect((await r.send(U, { ...BODY, code: "" })).status).toBe(400);
    expect((await r.send(U, { ...BODY, pageId: "abc" })).status).toBe(400);
  });
});

describe("send", () => {
  it("TEXT body shape, page token, claim kind 'soldout', row → sent", async () => {
    const store = makeStore();
    const { r, fetchImpl } = rt(store);
    const out = await r.send(U, { ...BODY, position: 3 });
    expect(out).toEqual({ status: 200, json: { ok: true } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain("/111/messages?access_token=PAGE-TOKEN-SECRET");
    expect(JSON.parse(init.body)).toEqual({ recipient: { comment_id: "222_333" }, message: { text: "Sorry, A1 is already sold out. You are #3 on the waitlist." } });
    expect(store.insertReceipt.mock.calls[0][0]).toMatchObject({ user_id: U, page_id: "111", comment_id: "222_333", status: "pending", kind: "soldout" });
    expect(store.rows[0]).toMatchObject({ status: "sent", message_id: "M1" });
  });
  it("one reply per comment: the second try (or one after a receipt) is refused by the claim", async () => {
    const store = makeStore();
    const { r, fetchImpl } = rt(store);
    expect((await r.send(U, BODY)).status).toBe(200);
    const again = await r.send(U, BODY);
    expect(again).toEqual({ status: 409, json: { ok: false, error: "already_replied" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const store2 = makeStore({ conflict: true });
    const x = rt(store2);
    expect((await x.r.send(U, BODY)).json.error).toBe("already_replied");
    expect(x.fetchImpl).not.toHaveBeenCalled();
  });
  it("retryable Graph code → the claim is given back (deleted); 190 → needs_reauth", async () => {
    const store = makeStore();
    const f = vi.fn(async () => ({ status: 400, json: async () => ({ error: { code: 190, message: "expired" } }) }));
    const { r } = rt(store, { fetchImpl: f });
    expect((await r.send(U, BODY)).json.error).toBe("needs_reauth");
    expect(store.deleteReceipt).toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
  it("other Graph error → failed row; unknown answer → row stays pending (never reused)", async () => {
    const s1 = makeStore();
    const a = rt(s1, { fetchImpl: vi.fn(async () => ({ status: 400, json: async () => ({ error: { code: 100, message: "No matching user" } }) })) });
    expect((await a.r.send(U, BODY)).json.error).toBe("send_failed");
    expect(s1.rows[0].status).toBe("failed");
    const s2 = makeStore();
    const b = rt(s2, { fetchImpl: vi.fn(async () => { throw new Error("net"); }) });
    expect((await b.r.send(U, BODY)).json.error).toBe("unknown_result");
    expect(s2.rows[0].status).toBe("pending");
  });
  it("logs never carry the token or the text", async () => {
    const { r, logs } = rt(makeStore());
    await r.send(U, BODY);
    expect(logs.join("\n")).not.toMatch(/PAGE-TOKEN|sold out/);
  });
});

describe("rate limit — its own bucket", () => {
  it(`${SOLDOUT_RATE_MAX} per minute per seller, then 429`, () => {
    const { r } = rt(makeStore());
    const res = () => { const o = { code: 0, j: null as unknown }; return { status: (c: number) => ({ json: (j: unknown) => { o.code = c; o.j = j; return o; } }), o }; };
    let passed = 0;
    for (let i = 0; i < SOLDOUT_RATE_MAX + 1; i++) {
      const x = res();
      r.rateLimit({ authUserId: U } as never, x as never, () => { passed++; });
      if (i === SOLDOUT_RATE_MAX) expect(x.o.code).toBe(429);
    }
    expect(passed).toBe(SOLDOUT_RATE_MAX);
  });
});

describe("text rules", () => {
  it("default per language, {code}, {position} or none", () => {
    expect(soldoutText({ custom: "", lang: "en", code: "B2", position: null })).toBe("Sorry, B2 is already sold out. Thank you for your interest!");
    expect(soldoutText({ custom: "", lang: "zh-TW", code: "B2", position: 2 })).toBe("抱歉，B2 已經售完了。您是候補名單第 2 位。");
    expect(soldoutText({ custom: "", lang: "th", code: "B2", position: null })).toBe(SOLDOUT_DEFAULTS.en.plain.replace("{code}", "B2"));
  });
  it("the seller's own text wins; {position} removed (with its #) when there is none", () => {
    expect(soldoutText({ custom: "Ubos na ang {code}! Pang-#{position} ka.", lang: "en", code: "C3", position: null })).toBe("Ubos na ang C3! Pang- ka.");
    expect(soldoutText({ custom: "  Ubos na ang {code}  ", lang: "en", code: "C3", position: 4 })).toBe("Ubos na ang C3");
  });
  it("body parse: lang falls back to en, position only 1..9999", () => {
    expect(parseSoldoutBody({ ...BODY, lang: "xx", position: 0 })).toEqual({ pageId: "111", commentId: "222_333", code: "A1", lang: "en", position: null });
    expect(parseSoldoutBody({ ...BODY, position: 5 })?.position).toBe(5);
  });
  it("request shape", () => {
    expect(buildSoldoutRequest({ pageId: "1", commentId: "2_3", text: "hi", pageToken: "T" }).body).toEqual({ recipient: { comment_id: "2_3" }, message: { text: "hi" } });
  });
});

describe("wasEmitted (fbLive, read-only)", () => {
  it("true only for this user's running poller (and page) that emitted the id", () => {
    const rtm = createFbRuntime({ config: CONFIG, store: {}, emitComment: () => {}, statusEmit: () => {}, liveKey: (s: string, p: string, id: string) => `${s}:${p}:${id}`, renderUrl: "https://x", setLoop: () => 0, clearLoop: () => {} });
    const e = rtm.startPoller({ sellerId: "s", userId: U, pageId: "111", pageUsername: "shop", liveVideoId: "LV" });
    e.emitted.add("222_333");
    expect(rtm.wasEmitted(U, "222_333", "111")).toBe(true);
    expect(rtm.wasEmitted(U, "222_333")).toBe(true);
    expect(rtm.wasEmitted(U, "222_333", "999")).toBe(false);
    expect(rtm.wasEmitted("other", "222_333", "111")).toBe(false);
    expect(rtm.wasEmitted(U, "nope", "111")).toBe(false);
    rtm.stopPoller(e.key);
    expect(rtm.wasEmitted(U, "222_333", "111")).toBe(false);
  });
  it("the accessor only reads (no writes in its body)", () => {
    const src = readFileSync("server/fbLive.js", "utf8");
    const b = src.slice(src.indexOf("function wasEmitted("), src.indexOf("function stopAll("));
    expect(b).toContain("e.emitted.has(id)");
    expect(b).not.toMatch(/\.(add|delete|set|clear)\(/);
  });
});

describe("server.js wiring (source contract)", () => {
  const src = readFileSync("server.js", "utf8");
  it("route registered with the switch reader + wasEmitted ownership, isolated", () => {
    expect(src).toContain('.eq("key", "fb_soldout_enabled")');
    expect(src).toContain("isOwnedComment: (userId, commentId, pageId) => fbRuntime ? fbRuntime.wasEmitted(userId, commentId, pageId) : false");
    expect(src).toContain('console.log("[FB] sold-out route not registered")');
  });
});
