// @vitest-environment node
// Audit Oct 22 (6) — Facebook / Instagram / Shopee pollers: a reconnect mid-live (startPoller
// again for the SAME live) carries the old poller's emitted set over and treats the next fetch
// as LIVE comments. A comment posted in the gap becomes an order exactly once; comments already
// relayed are not re-emitted; a DIFFERENT live still starts with the initial (display-only) lane.
import { describe, it, expect, vi } from "vitest";
import { createFbRuntime } from "../../../../server/fbLive.js";
import { createIgRuntime } from "../../../../server/igLive.js";
import { createShopeeRuntime } from "../../../../server/shopeeLive.js";
import { encryptToken as fbEncrypt } from "../../../../server/fbTokens.js";
import { encryptToken as shopeeEncrypt } from "../../../../server/shopeeTokens.js";

const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, id: string) => `${seller}:${platform}:${id}`;
const base = { liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test", now: () => 1_000_000, log: () => {}, setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} };
const ids = (emit: ReturnType<typeof vi.fn>, from = 0) => emit.mock.calls.slice(from).map((c) => [c[2].msgId, c[2].initial]);

describe("Facebook", () => {
  const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
  function rig() {
    let page: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string) => (/\/comments\?/.test(url) ? mkRes(200, { data: page }) : mkRes(200, { status: "LIVE" })));
    const store = { async getPage() { return { user_id: "u1", page_id: "P1", active: true, access_token: fbEncrypt("TOK", CONFIG.tokenKey), token_expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() }; }, async listActivePages() { return []; } };
    const emitComment = vi.fn();
    const rt = createFbRuntime({ ...base, config: CONFIG, store, emitComment, statusEmit: vi.fn(), fetchImpl });
    const c = (id: string) => ({ id, message: "mine", from: { id: `u${id}`, name: `B${id}` }, created_time: "2026-10-22T00:00:00+0000" });
    const start = (lv: string) => rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: lv, sessionId: "S1" });
    return { rt, emitComment, start, setPage: (p: string[]) => { page = p.map(c).reverse(); } };
  }
  it("reconnect mid-live: the gap comment is live, once; earlier comments are not re-emitted", async () => {
    const x = rig();
    const e1 = x.start("LV1");
    x.setPage(["c1", "c2"]);
    await x.rt.pollOnce(e1);
    expect(ids(x.emitComment)).toEqual([["c1", true], ["c2", true]]);
    x.setPage(["c1", "c2", "c3"]);              // c3 posted while the device was away
    const e2 = x.start("LV1");                  // reconnect → same live
    expect(e2.firstPollDone).toBe(true);
    await x.rt.pollOnce(e2);
    expect(ids(x.emitComment, 2)).toEqual([["c3", undefined]]); // live (orderable), exactly once
    await x.rt.pollOnce(e2);
    expect(x.emitComment).toHaveBeenCalledTimes(3);
  });
  it("a different live video starts fresh: existing comments are initial (display-only)", async () => {
    const x = rig();
    const e1 = x.start("LV1");
    x.setPage(["c1"]);
    await x.rt.pollOnce(e1);
    const e2 = x.start("LV2");
    expect(e2.firstPollDone).toBe(false);
    x.setPage(["c9"]);
    await x.rt.pollOnce(e2);
    expect(ids(x.emitComment, 1)).toEqual([["c9", true]]);
  });
});

describe("Instagram", () => {
  const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
  function rig() {
    let page: unknown[] = [];
    const fetchImpl = vi.fn(async () => mkRes(200, { data: page }));
    const row = { user_id: "u1", ig_user_id: "178", ig_username: "shop.ig", access_token: fbEncrypt("pagetok", "tk"), active: true };
    const store = { async getPlan() { return "pro"; }, async countAccounts() { return 1; }, async getAccount() { return row; }, async listAccounts() { return [row]; }, async upsertAccount() {}, async setActive() {}, async getAccountLabel() { return { email: "x", storeName: "S" }; } };
    const emitComment = vi.fn();
    const rt = createIgRuntime({ ...base, config: CONFIG, store, emitComment, statusEmit: vi.fn(), fetchImpl });
    const c = (id: string) => ({ id, text: "mine", timestamp: "2026-10-22T09:00:00+0000", username: `b${id}`, from: { id: `f${id}`, username: `b${id}` } });
    const start = (media: string) => rt.startPoller({ sellerId: "s1", userId: "u1", igUserId: "178", igUsername: "shop.ig", liveMediaId: media, sessionId: "sess" });
    return { rt, emitComment, start, setPage: (p: string[]) => { page = p.map(c).reverse(); } };
  }
  it("reconnect mid-live: gap comment live once; different media → initial again", async () => {
    const x = rig();
    const e1 = x.start("m1");
    x.setPage(["1", "2"]);
    await x.rt.pollOnce(e1);
    expect(ids(x.emitComment)).toEqual([["1", true], ["2", true]]);
    x.setPage(["1", "2", "3"]);
    const e2 = x.start("m1");
    await x.rt.pollOnce(e2);
    expect(ids(x.emitComment, 2)).toEqual([["3", undefined]]);
    await x.rt.pollOnce(e2);
    expect(x.emitComment).toHaveBeenCalledTimes(3);
    const e3 = x.start("m2");
    expect(e3.firstPollDone).toBe(false);
  });
});

describe("Shopee", () => {
  const CONFIG = { enabled: true, partnerId: "111", partnerKey: "pk", tokenKey: "tk" };
  function rig() {
    let list: unknown[] = [];
    const fetchImpl = vi.fn(async () => mkRes(200, { response: { list } }));
    const row = { user_id: "u1", shop_id: 7, active: true, access_token: shopeeEncrypt("AT", CONFIG.tokenKey), token_expires_at: new Date(Date.now() + 3600e3).toISOString() };
    const store = { async getPlan() { return "pro"; }, async countShops() { return 1; }, async getShop() { return row; }, async upsertShop() {}, async listActiveShops() { return [row]; }, async updateTokens() {}, async setActive() {} };
    const emitComment = vi.fn();
    const rt = createShopeeRuntime({ ...base, config: CONFIG, store, emitComment, statusEmit: vi.fn(), fetchImpl });
    const c = (id: string) => ({ comment_id: id, username: `u${id}`, nickname: `N${id}`, comment: "mine", create_time: 1700000000 });
    const start = (session: string) => rt.startPoller({ sellerId: "seller1", userId: "u1", shopId: 7, shopUsername: "7", shopSessionId: session, sessionId: "sf-browser-A" });
    return { rt, emitComment, start, setList: (p: string[]) => { list = p.map(c); } };
  }
  it("reconnect mid-live: gap comment live once; different Shopee session → initial again", async () => {
    const x = rig();
    const e1 = x.start("555");
    x.setList(["c1", "c2"]);
    await x.rt.pollOnce(e1);
    expect(ids(x.emitComment)).toEqual([["c1", true], ["c2", true]]);
    x.setList(["c1", "c2", "c3"]);
    const e2 = x.start("555");
    await x.rt.pollOnce(e2);
    expect(ids(x.emitComment, 2)).toEqual([["c3", undefined]]);
    await x.rt.pollOnce(e2);
    expect(x.emitComment).toHaveBeenCalledTimes(3);
    const e3 = x.start("556");
    expect(e3.firstPollDone).toBe(false);
  });
});
