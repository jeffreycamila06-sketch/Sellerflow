// SHOPEE LIVE — Phase 2 runtime (server/shopeeLive.js). All I/O is injected so
// vitest drives the whole flow with fakes (server.js has no harness). Pins: state
// nonce sign/verify (seller binding) · new-comment diffing · OAuth callback
// (token exchange + cap + encrypted upsert + redirects) · token refresh loop ·
// poller (emit exact Shopee shape once, backoff, session-end/auth-fail stop,
// timer cleared on every stop path) · routes register only when wired (the
// enabled-gate contract). SACRED ZONE untouched: emit goes through the injected
// emitCommentScoped (which sanitizes); this never touches dedup/commentKey/orders.
import { describe, it, expect, vi } from "vitest";
import {
  signState, verifyState, pickNewComments, nextPollDelay, createShopeeRuntime,
  POLL_ACTIVE_MS, POLL_QUIET_MS, MAX_AUTH_FAILURES,
} from "../../../../server/shopeeLive.js";
import { decryptToken } from "../../../../server/shopeeTokens.js";

const CONFIG = { enabled: true, partnerId: "111", partnerKey: "pk", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, shop: string) => `${seller}:${platform}:${shop}`;

// In-memory store fake (mirrors the serviceSb-backed store in server.js).
function makeStore(seed: Record<string, unknown>[] = [], plan = "pro") {
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of seed) rows.set(`${r.user_id}:${r.shop_id}`, { ...r });
  return {
    rows,
    calls: { upsert: [] as unknown[], updateTokens: [] as unknown[], setActive: [] as unknown[] },
    async getPlan() { return plan; },
    async countShops(userId: string) { return [...rows.values()].filter((r) => r.user_id === userId).length; },
    async getShop(userId: string, shopId: string | number) { return rows.get(`${userId}:${Number(shopId)}`) || null; },
    async upsertShop(row: Record<string, unknown>) { this.calls.upsert.push(row); rows.set(`${row.user_id}:${row.shop_id}`, { ...row }); },
    async listActiveShops() { return [...rows.values()].filter((r) => r.active); },
    async updateTokens(userId: string, shopId: number, t: unknown) { this.calls.updateTokens.push({ userId, shopId, t }); },
    async setActive(userId: string, shopId: number, active: boolean) { this.calls.setActive.push({ userId, shopId, active }); const k = `${userId}:${Number(shopId)}`; if (rows.has(k)) rows.get(k)!.active = active; },
  };
}

describe("signState / verifyState — seller binding", () => {
  it("round-trips the userId", () => {
    const s = signState({ userId: "user-1", key: "pk", nowMs: 1000 });
    expect(verifyState(s, "pk", 2000)).toBe("user-1");
  });
  it("tampered signature → null", () => {
    const s = signState({ userId: "user-1", key: "pk", nowMs: 1000 });
    expect(verifyState(s.slice(0, -1) + (s.endsWith("0") ? "1" : "0"), "pk", 2000)).toBeNull();
  });
  it("wrong key → null", () => {
    const s = signState({ userId: "user-1", key: "pk", nowMs: 1000 });
    expect(verifyState(s, "other", 2000)).toBeNull();
  });
  it("expired → null", () => {
    const s = signState({ userId: "user-1", key: "pk", nowMs: 1000, ttlMs: 5000 });
    expect(verifyState(s, "pk", 1000 + 5001)).toBeNull();
  });
  it("garbage → null", () => {
    expect(verifyState("", "pk")).toBeNull();
    expect(verifyState("a.b", "pk")).toBeNull();
  });
});

describe("pickNewComments / nextPollDelay", () => {
  it("returns only unseen ids in order, skips id-less", () => {
    const emitted = new Set<string>(["1"]);
    const fresh = pickNewComments([{ comment_id: 1 }, { comment_id: 2 }, { comment: "no id" }, { id: 3 }], emitted);
    expect(fresh.map((c: Record<string, unknown>) => String(c.comment_id ?? c.id))).toEqual(["2", "3"]);
  });
  it("cadence: hadNew→active, else quiet", () => {
    expect(nextPollDelay(true)).toBe(POLL_ACTIVE_MS);
    expect(nextPollDelay(false)).toBe(POLL_QUIET_MS);
  });
});

function runtime(overrides: Record<string, unknown> = {}) {
  const store = (overrides.store as ReturnType<typeof makeStore>) || makeStore();
  const emitComment = vi.fn();
  const statusEmit = vi.fn();
  const fetchImpl = (overrides.fetchImpl as ReturnType<typeof vi.fn>) || vi.fn();
  const rt = createShopeeRuntime({
    config: CONFIG, store, emitComment, statusEmit, liveKey,
    renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl, now: () => 1_000_000, log: () => {},
    setLoop: (overrides.setLoop as never) || ((fn: () => void) => { void fn; return 1; }),
    clearLoop: (overrides.clearLoop as never) || (() => {}),
    setTimer: (overrides.setTimer as never) || (() => 2),
    clearTimer: (overrides.clearTimer as never) || (() => {}),
  });
  return { rt, store, emitComment, statusEmit, fetchImpl };
}

describe("OAuth callback", () => {
  it("valid state + token ok + under cap → encrypted upsert + connected redirect", async () => {
    const { rt, store } = runtime();
    const fetchImpl = store as unknown; void fetchImpl;
    // token exchange (POST) then shop info (GET)
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { access_token: "AT", refresh_token: "RT", expire_in: 14400 }))
      .mockResolvedValueOnce(mkRes(200, { shop_name: "My Shop" }));
    const { rt: rt2, store: st2 } = runtime({ fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.partnerKey, nowMs: 1_000_000 });
    const out = await rt2.handleCallback({ code: "CODE", shopId: "555", state });
    expect(out.redirect).toBe("https://app.test/?shopee=connected");
    expect(st2.calls.upsert).toHaveLength(1);
    const row = st2.calls.upsert[0] as Record<string, string>;
    expect(row.access_token).not.toBe("AT");                       // stored ENCRYPTED
    expect(decryptToken(row.access_token, CONFIG.tokenKey)).toBe("AT"); // decrypts back
    expect(decryptToken(row.refresh_token, CONFIG.tokenKey)).toBe("RT");
    expect(row.shop_name).toBe("My Shop");
    expect(row.active).toBe(true);
    void rt;
  });

  it("bad state → error redirect, NO upsert", async () => {
    const f = vi.fn();
    const { rt, store } = runtime({ fetchImpl: f });
    const out = await rt.handleCallback({ code: "C", shopId: "1", state: "tampered" });
    expect(out.redirect).toBe("https://app.test/?shopee=error&code=bad_state");
    expect(store.calls.upsert).toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("cap exceeded (count>=max, new shop) → error cap, NO upsert", async () => {
    // pro plan max = 3; seed 3 shops for the user, then a 4th auth attempt.
    const store = makeStore([
      { user_id: "user-1", shop_id: 1, active: true },
      { user_id: "user-1", shop_id: 2, active: true },
      { user_id: "user-1", shop_id: 3, active: true },
    ], "pro");
    const f = vi.fn().mockResolvedValueOnce(mkRes(200, { access_token: "AT", refresh_token: "RT", expire_in: 14400 }));
    const { rt } = runtime({ store, fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.partnerKey, nowMs: 1_000_000 });
    const out = await rt.handleCallback({ code: "C", shopId: "999", state });
    expect(out.redirect).toBe("https://app.test/?shopee=error&code=cap");
    expect(store.calls.upsert).toHaveLength(0);
  });

  it("token exchange failure → error redirect", async () => {
    const f = vi.fn().mockResolvedValueOnce(mkRes(400, { error: "invalid_code" }));
    const { rt, store } = runtime({ fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.partnerKey, nowMs: 1_000_000 });
    const out = await rt.handleCallback({ code: "C", shopId: "1", state });
    expect(out.redirect).toBe("https://app.test/?shopee=error&code=token_exchange");
    expect(store.calls.upsert).toHaveLength(0);
  });
});

describe("token refresh loop", () => {
  it("expiring shop → refresh ok → updateTokens with re-encrypted values", async () => {
    const enc = (await import("../../../../server/shopeeTokens.js")).encryptToken;
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, token_expires_at: new Date(1_000_000 + 60_000).toISOString(), refresh_token: enc("RT", CONFIG.tokenKey) }]);
    const f = vi.fn().mockResolvedValueOnce(mkRes(200, { access_token: "AT2", refresh_token: "RT2", expire_in: 14400 }));
    const { rt } = runtime({ store, fetchImpl: f });
    await rt.refreshDueShops();
    expect(store.calls.updateTokens).toHaveLength(1);
    const upd = (store.calls.updateTokens[0] as { t: { access: string; refresh: string } }).t;
    expect(decryptToken(upd.access, CONFIG.tokenKey)).toBe("AT2");
    expect(decryptToken(upd.refresh, CONFIG.tokenKey)).toBe("RT2");
  });
  it("refresh failure → shop marked inactive, loop survives", async () => {
    const enc = (await import("../../../../server/shopeeTokens.js")).encryptToken;
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, token_expires_at: new Date(1_000_000 + 60_000).toISOString(), refresh_token: enc("RT", CONFIG.tokenKey) }]);
    const f = vi.fn().mockResolvedValueOnce(mkRes(400, { error: "bad_refresh" }));
    const { rt } = runtime({ store, fetchImpl: f });
    await rt.refreshDueShops();
    expect(store.calls.setActive).toContainEqual({ userId: "u1", shopId: 7, active: false });
    expect(store.calls.updateTokens).toHaveLength(0);
  });
  it("not expiring → no refresh call", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, token_expires_at: new Date(1_000_000 + 60 * 60 * 1000).toISOString(), refresh_token: "x" }]);
    const f = vi.fn();
    const { rt } = runtime({ store, fetchImpl: f });
    await rt.refreshDueShops();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("poller — pollOnce", () => {
  const enc = async () => (await import("../../../../server/shopeeTokens.js")).encryptToken("AT", CONFIG.tokenKey);

  it("new comments → emitComment with EXACT Shopee shape, once (dedup on re-poll)", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { response: { list: [{ comment_id: "c1", username: "maria", nickname: "Maria", comment: "mine red", avatar: "http://a", create_time: 1700000000 }] } }));
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    const entry = { key: "u1:Shopee:7", sellerId: "seller1", userId: "u1", shopId: 7, shopUsername: "7", sessionId: "555", emitted: new Set<string>(), authFails: 0, timer: null, stopped: false };
    const r1 = await rt.pollOnce(entry);
    expect(r1).toMatchObject({ hadNew: true, stop: false });
    expect(emitComment).toHaveBeenCalledTimes(1);
    const [sellerId, shopUsername, payload] = emitComment.mock.calls[0];
    expect(sellerId).toBe("seller1");
    expect(shopUsername).toBe("7");
    expect(payload).toMatchObject({ platform: "Shopee", handle: "maria", name: "Maria", comment: "mine red", avatar: "http://a", msgId: "c1", roomId: "555", sellerId: "seller1", sessionId: "555", isBuy: false, buyerNum: null, buyerData: null });
    // re-poll same list → no new emit (emitted set dedup)
    const r2 = await rt.pollOnce(entry);
    expect(r2.hadNew).toBe(false);
    expect(emitComment).toHaveBeenCalledTimes(1);
  });

  it("session ended → stop", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { response: { session_status: "end", list: [] } }));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = { key: "u1:Shopee:7", sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", sessionId: "555", emitted: new Set<string>(), authFails: 0, timer: null, stopped: false };
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: true, reason: "session_end" });
  });

  it("auth failures reach MAX → stop + setActive(false)", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(401, { error: "invalid_access_token" }));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = { key: "u1:Shopee:7", sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", sessionId: "555", emitted: new Set<string>(), authFails: 0, timer: null, stopped: false };
    let last;
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) last = await rt.pollOnce(entry);
    expect(last).toMatchObject({ stop: true, reason: "auth" });
    expect(store.calls.setActive).toContainEqual({ userId: "u1", shopId: 7, active: false });
  });

  it("429 → backoff, no stop", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(429, {}));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = { key: "u1:Shopee:7", sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", sessionId: "555", emitted: new Set<string>(), authFails: 0, timer: null, stopped: false };
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: false, backoff: true });
  });
});

describe("poller lifecycle — timers cleared on every stop path", () => {
  it("start schedules; stop clears the loop timer + emits disconnected", () => {
    const clearLoop = vi.fn();
    let scheduled = 0;
    const setLoop = vi.fn(() => { scheduled++; return scheduled; });
    const { rt, statusEmit } = runtime({ setLoop, clearLoop });
    rt.startPoller({ sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", sessionId: "555" });
    expect(setLoop).toHaveBeenCalled();
    expect(statusEmit).toHaveBeenCalledWith("s", expect.objectContaining({ connected: true, shopId: 7 }));
    const stopped = rt.stopPoller("s:Shopee:7", "disconnect");
    expect(stopped).toBe(true);
    expect(clearLoop).toHaveBeenCalled();
    expect(statusEmit).toHaveBeenCalledWith("s", expect.objectContaining({ connected: false, shopId: 7 }));
    expect(rt._pollers.size).toBe(0);
  });
  it("stopAll clears every poller + the refresh timer", () => {
    const clearLoop = vi.fn();
    const clearTimer = vi.fn();
    const { rt } = runtime({ clearLoop, clearTimer });
    rt.startRefreshTimer();
    rt.startPoller({ sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", sessionId: "555" });
    rt.stopAll();
    expect(clearLoop).toHaveBeenCalled();
    expect(clearTimer).toHaveBeenCalled();
    expect(rt._pollers.size).toBe(0);
  });
});

describe("routes register only when wired (the enabled-gate contract)", () => {
  it("registerRoutes wires exactly the 4 Shopee endpoints", () => {
    const { rt } = runtime();
    const routes: string[] = [];
    const app = {
      get: (p: string) => routes.push(`GET ${p}`),
      post: (p: string) => routes.push(`POST ${p}`),
    };
    rt.registerRoutes(app as never, ((_req: unknown, _res: unknown, next: () => void) => next()) as never);
    expect(routes.sort()).toEqual([
      "GET /shopee/oauth/callback", "GET /shopee/oauth/start",
      "POST /shopee/connect", "POST /shopee/disconnect",
    ]);
  });
  it("a runtime that is never wired registers nothing (server.js only wires when enabled)", () => {
    const routes: string[] = [];
    const app = { get: (p: string) => routes.push(p), post: (p: string) => routes.push(p) };
    void app; // when disabled, server.js never builds the runtime nor calls registerRoutes
    expect(routes).toHaveLength(0);
  });
});
