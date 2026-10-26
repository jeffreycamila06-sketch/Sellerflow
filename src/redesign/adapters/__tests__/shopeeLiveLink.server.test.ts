// Shopee Live beta — the share-link reader (server/shopeeLiveLink.js): pure helpers + the
// runtime with injected deps (fake fetch, injected clock, no timers). Mirrors fbLive.server.test.
import { describe, it, expect, vi } from "vitest";
import {
  parseShareUrl, regionOfHost, looksLikeShopeeLink, verifyHost, parseChatBatches, commentTextOf, shopeeToPayload, nextDelayMs,
  createShopeeLinkRuntime, POLL_MIN_MS, POLL_BACKOFF_MAX_MS, MAX_CONSECUTIVE_FAILS, IDLE_STOP_MS, STATUS_RECHECK_MS, MAX_SESSION_MS, SHOPEE_UA,
} from "../../../../server/shopeeLiveLink.js";

const TW_LINK = "https://live.shopee.tw/share?from=live&session=8092367&share_user_id=254298659&stm_medium=referral&viewer=2#copy_info";
const PH_LINK = "https://live.shopee.ph/share?from=live&session=777&share_user_id=42";
const hostBody = (over: Record<string, unknown> = {}) => ({ err_code: 0, err_msg: "成功", data: { session: { session_id: 8092367, uid: 254298659, username: "x", room_id: 1, title: "sale", status: 1, member_cnt: 2, start_time: 1793032208498, end_time: 0, chatroom_id: "SPIM-EI7DJUML24O17", ...over } } });
const chatBody = (msgs: unknown[], over: Record<string, unknown> = {}) => ({ code: 0, msg: "success", data: { message: msgs.length ? [{ msgs, timestamp: 1793033485 }] : [], system: {}, timestamp: 1793033485, poll_interval: 3, ...over } });
const msg = (id: number, text: string, nick = "jcamial", ts = 1793033483) => ({ id, uid: 254298659, nickname: nick, display_name: nick, avatar: "", content: JSON.stringify({ type: 101, content: text, content_v2: "" }), ts, privacy_type: 0 });
const mkRes = (status: number, body: unknown, location?: string) => ({ status, json: async () => body, headers: { get: (k: string) => (k === "location" ? location || null : null) } });

describe("link parsing (TW + PH)", () => {
  it("regionOfHost", () => {
    expect(regionOfHost("live.shopee.tw")).toBe("tw"); expect(regionOfHost("live.shopee.ph")).toBe("ph");
    expect(regionOfHost("tw.shp.ee")).toBe("tw"); expect(regionOfHost("ph.shp.ee")).toBe("ph");
    expect(regionOfHost("shopee.co.id")).toBeNull(); expect(regionOfHost("evil-shopee.tw.example.com")).toBeNull(); expect(regionOfHost("")).toBeNull();
  });
  it("parseShareUrl reads region, session and sharer; rejects garbage", () => {
    expect(parseShareUrl(TW_LINK)).toMatchObject({ region: "tw", sessionId: "8092367", shareUserId: "254298659" });
    expect(parseShareUrl(PH_LINK)).toMatchObject({ region: "ph", sessionId: "777", shareUserId: "42" });
    expect(parseShareUrl("https://live.shopee.tw/share?session=abc")).toMatchObject({ region: "tw", sessionId: null });
    expect(parseShareUrl("not a url")).toMatchObject({ region: null, sessionId: null, shareUserId: null });
    expect(looksLikeShopeeLink("https://tw.shp.ee/jBv7BMm9")).toBe(true);
    expect(looksLikeShopeeLink("https://ph.shp.ee/abc")).toBe(true);
    expect(looksLikeShopeeLink("https://www.tiktok.com/@x/live")).toBe(false);
  });
});

describe("host check (own live only)", () => {
  const ids = { sessionId: "8092367", shareUserId: "254298659" };
  it("accepts when the sharer's current session IS the linked session and it is live", () => {
    expect(verifyHost(ids, hostBody())).toEqual({ ok: true, chatroomId: "SPIM-EI7DJUML24O17", uid: "254298659", sessionId: "8092367", title: "sale" });
  });
  it("rejects someone else's live: the sharer's own session differs from the link (the busy-live case)", () => {
    expect(verifyHost({ sessionId: "8091161", shareUserId: "254298659" }, hostBody())).toEqual({ ok: false, error: "not_own" });
    expect(verifyHost(ids, hostBody({ uid: 1 }))).toEqual({ ok: false, error: "not_own" });
    expect(verifyHost(ids, { err_code: 20009, err_msg: "data not exists", data: {} })).toEqual({ ok: false, error: "not_own" });
    expect(verifyHost(ids, null)).toEqual({ ok: false, error: "not_own" });
  });
  it("rejects an ended live (status ≠ 1) and a session without a chat room", () => {
    expect(verifyHost(ids, hostBody({ status: 2, end_time: 1793032930122 }))).toEqual({ ok: false, error: "ended" });
    expect(verifyHost(ids, hostBody({ chatroom_id: "" }))).toEqual({ ok: false, error: "not_own" });
  });
});

describe("chat payload", () => {
  it("flattens the batch shape, keeps the cursor, honours poll_interval (never below 3 s)", () => {
    const d = chatBody([msg(1, "mine 1"), msg(2, "👍3")]);
    const r = parseChatBatches(d.data);
    expect(r.msgs.map((m: { id: number }) => m.id)).toEqual([1, 2]);
    expect(r.cursor).toBe(1793033485); expect(r.pollIntervalMs).toBe(3000);
    expect(parseChatBatches({ system: {}, timestamp: 0, poll_interval: 5 })).toEqual({ msgs: [], cursor: 0, pollIntervalMs: 5000 });
    expect(parseChatBatches({ poll_interval: 1 }).pollIntervalMs).toBe(POLL_MIN_MS);
    expect(parseChatBatches(null).msgs).toEqual([]);
  });
  it("commentTextOf: JSON content type 101 → text; other types → not a comment", () => {
    expect(commentTextOf(msg(1, "我要 2"))).toBe("我要 2");
    expect(commentTextOf({ content: JSON.stringify({ type: 7, content: "joined" }) })).toBe("");
    expect(commentTextOf({ content: "plain" })).toBe("plain");
    expect(commentTextOf({})).toBe("");
  });
  it("shopeeToPayload = the relay shape (platform Shopee, msgId = msg.id, browser sessionId, uid as the scoping key)", () => {
    const p = shopeeToPayload(msg(5, "mine 1"), { sellerId: "seller-1", sessionId: "browser-abc", uid: "254298659", liveSessionId: "8092367", nowMs: 1793033490000 })!;
    expect(p).toMatchObject({ platform: "Shopee", msgId: "5", comment: "mine 1", handle: "jcamial", name: "jcamial", sellerId: "seller-1", sessionId: "browser-abc", sourceUsername: "254298659", roomId: "8092367", isBuy: false, buyerNum: null, buyerData: null });
    expect(p.timestamp).toBe(new Date(1793033483 * 1000).toISOString());
    expect(shopeeToPayload({ content: JSON.stringify({ type: 7, content: "join" }) }, {})).toBeNull(); // system message → nothing
  });
  it("nextDelayMs: server interval when ok; exponential backoff capped at 60 s when failing", () => {
    expect(nextDelayMs({ ok: true, pollIntervalMs: 3000 })).toBe(3000);
    expect(nextDelayMs({ ok: true, pollIntervalMs: 1000 })).toBe(POLL_MIN_MS);
    expect(nextDelayMs({ ok: false, fails: 1 })).toBe(6000);
    expect(nextDelayMs({ ok: false, fails: 3 })).toBe(24000);
    expect(nextDelayMs({ ok: false, fails: 9 })).toBe(POLL_BACKOFF_MAX_MS);
  });
});

function runtime(over: Record<string, unknown> = {}) {
  const emitComment = vi.fn(); const statusEmit = vi.fn(); const rememberAccount = vi.fn(async () => {});
  const fetchImpl = vi.fn();
  let t = 1_000_000;
  const rt = createShopeeLinkRuntime({
    emitComment, statusEmit, rememberAccount, fetchImpl, now: () => t, log: () => {},
    liveKey: (s: string, p: string, k: string) => `${s}:${p}:${k}`,
    enabled: async () => true, betaAllowed: async () => true,
    setLoop: () => 1, clearLoop: () => {},
    ...over,
  });
  return { rt, emitComment, statusEmit, rememberAccount, fetchImpl, tick: (ms: number) => { t += ms; } };
}
const fetchByUrl = (map: Record<string, (u: string) => unknown>) => vi.fn(async (u: string) => { for (const [k, f] of Object.entries(map)) if (u.includes(k)) return f(u); return mkRes(404, { error: "error_not_found" }); });

describe("connect (HTTP-free decision)", () => {
  const base = { sellerId: "seller-1", userId: "u1", email: "s@x", sessionId: "browser-abc" };
  it("short link → session + sharer → host_session → chatroom → poller; remembers the account; status emitted with the browser sessionId", async () => {
    const h = runtime();
    h.fetchImpl.mockImplementation(fetchByUrl({ "tw.shp.ee/": () => mkRes(301, null, TW_LINK), "host_session?uid=254298659": () => mkRes(200, hostBody()) }));
    const r = await h.rt.connect({ ...base, shareLink: "https://tw.shp.ee/jBv7BMm9" });
    expect(r).toEqual({ status: 200, json: { ok: true, region: "tw", session_id: "8092367", uid: "254298659" } });
    expect(h.rememberAccount).toHaveBeenCalledWith("u1", "tw", "254298659");
    expect(h.statusEmit).toHaveBeenCalledWith("seller-1", { connected: true, scopeKey: "254298659", sessionId: "browser-abc" });
    expect(h.rt.listPollers()).toEqual([{ sellerId: "seller-1", region: "tw", liveSessionId: "8092367", scopeKey: "254298659" }]);
    // every request is plain: honest UA, no cookies, no custom anti-bot headers
    for (const call of h.fetchImpl.mock.calls) { const opts = call[1]; expect(opts.headers).toEqual({ "user-agent": SHOPEE_UA, accept: "application/json" }); expect(opts.redirect).toBe("manual"); }
  });
  it("PH links use the .ph hosts", async () => {
    const h = runtime();
    h.fetchImpl.mockImplementation(fetchByUrl({ "live.shopee.ph/api/v1/host_session?uid=42": () => mkRes(200, hostBody({ session_id: 777, uid: 42 })) }));
    const r = await h.rt.connect({ ...base, shareLink: PH_LINK });
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ region: "ph" });
    expect(h.fetchImpl.mock.calls[0][0]).toContain("https://live.shopee.ph/api/v1/host_session?uid=42");
  });
  it("someone else's live → 403 not_own (never polled); ended → 410; bad link → 400; Shopee down → 502", async () => {
    const h = runtime();
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session?uid=254298659": () => mkRes(200, hostBody()) }));
    expect(await h.rt.connect({ ...base, shareLink: "https://live.shopee.tw/share?from=live&session=8091161&share_user_id=254298659" })).toEqual({ status: 403, json: { ok: false, error: "not_own" } });
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(200, hostBody({ status: 2 })) }));
    expect(await h.rt.connect({ ...base, shareLink: TW_LINK })).toEqual({ status: 410, json: { ok: false, error: "ended" } });
    expect(await h.rt.connect({ ...base, shareLink: "https://www.tiktok.com/@x/live" })).toEqual({ status: 400, json: { ok: false, error: "bad_link" } });
    expect(await h.rt.connect({ ...base, shareLink: "https://live.shopee.tw/share?from=live&session=1" })).toEqual({ status: 400, json: { ok: false, error: "not_own" } }); // no sharer id
    h.fetchImpl.mockImplementation(async () => { throw new Error("ECONNRESET"); });
    expect(await h.rt.connect({ ...base, shareLink: TW_LINK })).toEqual({ status: 502, json: { ok: false, error: "unreachable" } });
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(403, { error: 90309999 }) }));
    expect(await h.rt.connect({ ...base, shareLink: TW_LINK })).toEqual({ status: 503, json: { ok: false, error: "blocked" } });
    expect(h.rt.listPollers()).toEqual([]);
  });
  it("kill switch off → 503 shopee_off; no beta → 403 no_beta — nothing is fetched", async () => {
    const off = runtime({ enabled: async () => false });
    expect(await off.rt.connect({ ...base, shareLink: TW_LINK })).toEqual({ status: 503, json: { ok: false, error: "shopee_off" } });
    expect(off.fetchImpl).not.toHaveBeenCalled();
    const nb = runtime({ betaAllowed: async () => false });
    expect(await nb.rt.connect({ ...base, shareLink: TW_LINK })).toEqual({ status: 403, json: { ok: false, error: "no_beta" } });
    expect(nb.fetchImpl).not.toHaveBeenCalled();
  });
  it("single-flight per seller: a second connect restarts the poller (one per seller)", async () => {
    const h = runtime();
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(200, hostBody()) }));
    await h.rt.connect({ ...base, shareLink: TW_LINK });
    await h.rt.connect({ ...base, shareLink: TW_LINK });
    expect(h.rt.listPollers()).toHaveLength(1);
    expect(h.statusEmit.mock.calls.map((c) => c[1].connected)).toEqual([true, false, true]); // start, restart stop, start
  });
});

describe("poll loop (pollOnce driven by hand)", () => {
  async function connected(over: Record<string, unknown> = {}) {
    const h = runtime(over);
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(200, hostBody()) }));
    await h.rt.connect({ sellerId: "seller-1", userId: "u1", email: "s@x", sessionId: "browser-abc", shareLink: TW_LINK });
    const entry = [...h.rt._pollers.values()][0];
    return { ...h, entry };
  }
  it("emits each comment once through emitComment with platform Shopee + the browser sessionId; the first poll's backlog is initial:true; msg.id dedupes", async () => {
    const h = await connected();
    h.fetchImpl.mockImplementation(fetchByUrl({ "fetch/chatroom/SPIM-EI7DJUML24O17/message": () => mkRes(200, chatBody([msg(1, "mine 1"), msg(2, "我要 2")])) }));
    const r = await h.rt.pollOnce(h.entry);
    expect(r).toEqual({ delayMs: 3000 });
    expect(h.emitComment).toHaveBeenCalledTimes(2);
    expect(h.emitComment.mock.calls[0][0]).toBe("seller-1"); expect(h.emitComment.mock.calls[0][1]).toBe("254298659");
    expect(h.emitComment.mock.calls[0][2]).toMatchObject({ platform: "Shopee", comment: "mine 1", msgId: "1", sessionId: "browser-abc", initial: true });
    expect(h.emitComment.mock.calls[1][2]).toMatchObject({ comment: "我要 2", msgId: "2", initial: true });
    // the cursor from the response is sent back; a repeated message is dropped; a new one is live (no initial flag)
    h.fetchImpl.mockImplementation(fetchByUrl({ "message?uuid=": (u: string) => { expect(u).toContain("timestamp=1793033485"); return mkRes(200, chatBody([msg(2, "我要 2"), msg(3, "👍3")])); } }));
    await h.rt.pollOnce(h.entry);
    expect(h.emitComment).toHaveBeenCalledTimes(3);
    expect(h.emitComment.mock.calls[2][2]).toMatchObject({ comment: "👍3", msgId: "3" });
    expect(h.emitComment.mock.calls[2][2].initial).toBeUndefined();
  });
  it("non-200 / code≠0 → exponential backoff, then stop(unreachable) after MAX_CONSECUTIVE_FAILS", async () => {
    const h = await connected();
    h.fetchImpl.mockImplementation(fetchByUrl({ "fetch/chatroom": () => mkRes(200, { code: 1000000, msg: "params invalid" }) }));
    expect(await h.rt.pollOnce(h.entry)).toEqual({ delayMs: 6000 });
    expect(await h.rt.pollOnce(h.entry)).toEqual({ delayMs: 12000 });
    h.fetchImpl.mockImplementation(fetchByUrl({ "fetch/chatroom": () => mkRes(503, null) }));
    let last: unknown;
    for (let i = 0; i < MAX_CONSECUTIVE_FAILS; i++) last = await h.rt.pollOnce(h.entry);
    expect(last).toEqual({ stop: "unreachable" });
    expect(h.emitComment).not.toHaveBeenCalled();
  });
  it("honours a bigger server poll_interval", async () => {
    const h = await connected();
    h.fetchImpl.mockImplementation(fetchByUrl({ "fetch/chatroom": () => mkRes(200, chatBody([], { poll_interval: 8 })) }));
    expect(await h.rt.pollOnce(h.entry)).toEqual({ delayMs: 8000 });
  });
  it("live end: the periodic host_session re-check sees status 2 → stop(session_end); the status emit carries the reason", async () => {
    const h = await connected();
    h.tick(STATUS_RECHECK_MS + 1);
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(200, hostBody({ status: 2 })), "fetch/chatroom": () => mkRes(200, chatBody([])) }));
    expect(await h.rt.pollOnce(h.entry)).toEqual({ stop: "session_end" });
    h.rt.stopPoller(h.entry.key, "session_end");
    expect(h.statusEmit).toHaveBeenLastCalledWith("seller-1", { connected: false, scopeKey: "254298659", sessionId: "browser-abc", reason: "session_end" });
    expect(h.rt.listPollers()).toEqual([]);
  });
  it("idle: quiet for IDLE_STOP_MS → the live is checked; still live → keeps polling; ended → stops", async () => {
    const h = await connected();
    h.tick(IDLE_STOP_MS + 1);
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(200, hostBody()), "fetch/chatroom": () => mkRes(200, chatBody([])) }));
    expect(await h.rt.pollOnce(h.entry)).toEqual({ delayMs: 3000 });
    h.tick(IDLE_STOP_MS + 1);
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(200, hostBody({ status: 2 })), "fetch/chatroom": () => mkRes(200, chatBody([])) }));
    expect(await h.rt.pollOnce(h.entry)).toEqual({ stop: "session_end" });
  });
  it("12 h ceiling → stop(max_session); stopAll stops everything", async () => {
    const h = await connected();
    h.tick(MAX_SESSION_MS);
    expect(await h.rt.pollOnce(h.entry)).toEqual({ stop: "max_session" });
    h.rt.stopAll();
    expect(h.rt.listPollers()).toEqual([]);
  });
});

describe("routes", () => {
  it("POST /shopee/live/connect = requireAuth + requireConnectRate + the connect decision (reads sellerId/authUserId/userEmail/body)", async () => {
    const h = runtime();
    const handlers: Record<string, unknown[]> = {};
    const app = { post: (p: string, ...mw: unknown[]) => { handlers[`POST ${p}`] = mw; }, get: () => {} };
    const requireAuth = vi.fn(); const requireConnectRate = vi.fn();
    h.rt.registerRoutes(app, requireAuth, { requireConnectRate });
    const chain = handlers["POST /shopee/live/connect"];
    expect(chain[0]).toBe(requireAuth); expect(chain[1]).toBe(requireConnectRate);
    h.fetchImpl.mockImplementation(fetchByUrl({ "host_session": () => mkRes(200, hostBody()) }));
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await (chain[2] as (req: unknown, res: unknown) => Promise<void>)({ sellerId: "seller-1", authUserId: "u1", userEmail: "s@x", body: { shareLink: TW_LINK, sessionId: "browser-abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, region: "tw", session_id: "8092367", uid: "254298659" });
    expect(h.statusEmit).toHaveBeenCalledWith("seller-1", expect.objectContaining({ sessionId: "browser-abc" }));
  });
});
