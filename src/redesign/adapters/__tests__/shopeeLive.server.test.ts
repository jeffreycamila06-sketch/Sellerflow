// SHOPEE LIVE — Phase 2 runtime (server/shopeeLive.js). All I/O is injected so
// vitest drives the whole flow with fakes (server.js has no harness). Pins: state
// nonce sign/verify (seller binding) · new-comment diffing · OAuth callback
// (token exchange + cap + encrypted upsert + redirects) · token refresh loop ·
// poller (emit exact Shopee shape once, backoff, session-end/auth-fail stop,
// timer cleared on every stop path) · routes register only when wired (the
// enabled-gate contract). SACRED ZONE untouched: emit goes through the injected
// emitCommentScoped (which sanitizes); this never touches dedup/commentKey/orders.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  signState, verifyState, pickNewComments, nextPollDelay, createShopeeRuntime,
  POLL_ACTIVE_MS, POLL_QUIET_MS, MAX_AUTH_FAILURES, IDLE_STOP_MS, MAX_SESSION_MS,
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
    getShopCalls: 0, // F4 — assert the poller reads the store ONCE, not per tick
    async getPlan() { return plan; },
    async countShops(userId: string) { return [...rows.values()].filter((r) => r.user_id === userId).length; },
    async getShop(userId: string, shopId: string | number) { this.getShopCalls++; return rows.get(`${userId}:${Number(shopId)}`) || null; },
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
    fetchImpl, now: (overrides.now as never) || (() => 1_000_000), log: () => {},
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

const enc = async () => (await import("../../../../server/shopeeTokens.js")).encryptToken("AT", CONFIG.tokenKey);

// Build a poller entry with the P2-fix field shape (firstPollDone / startedAtMs /
// lastActivityMs / accessToken cache). `now` in runtime() is fixed at 1_000_000, so
// the F2 caps never fire unless a test back-dates startedAtMs / lastActivityMs.
function mkEntry(over: Record<string, unknown> = {}) {
  const nowMs = 1_000_000;
  return {
    key: "u1:Shopee:7", sellerId: "seller1", userId: "u1", shopId: 7,
    shopUsername: "7", shopSessionId: "555", sessionId: "sf-browser-A", // Shopee session ≠ browser session
    emitted: new Set<string>(), authFails: 0, timer: null, stopped: false,
    firstPollDone: true,                       // steady-state live by default (F1 tests flip this)
    startedAtMs: nowMs, lastActivityMs: nowMs,  // F2 caps quiet by default
    accessToken: null, tokenExpiresAtMs: 0, reauth: false, // F4 — starts uncached
    ...over,
  };
}

describe("poller — pollOnce", () => {
  it("new comments → emitComment with EXACT Shopee shape, once (dedup on re-poll)", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { response: { list: [{ comment_id: "c1", username: "maria", nickname: "Maria", comment: "mine red", avatar: "http://a", create_time: 1700000000 }] } }));
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    const r1 = await rt.pollOnce(entry);
    expect(r1).toMatchObject({ hadNew: true, stop: false });
    expect(emitComment).toHaveBeenCalledTimes(1);
    const [sellerId, shopUsername, payload] = emitComment.mock.calls[0];
    expect(sellerId).toBe("seller1");
    expect(shopUsername).toBe("7");
    // sessionId = the connecting BROWSER session (this line used to pin "555" — the bug);
    // the Shopee live session rides in roomId + shopeeSessionId.
    expect(payload).toMatchObject({ platform: "Shopee", handle: "maria", name: "Maria", comment: "mine red", avatar: "http://a", msgId: "c1", roomId: "555", shopeeSessionId: "555", sellerId: "seller1", sessionId: "sf-browser-A", isBuy: false, buyerNum: null, buyerData: null });
    expect(payload.initial).toBeUndefined(); // steady-state live comment carries NO initial flag
    // re-poll same list → no new emit (emitted set dedup)
    const r2 = await rt.pollOnce(entry);
    expect(r2.hadNew).toBe(false);
    expect(emitComment).toHaveBeenCalledTimes(1);
  });

  it("session ended → stop", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { response: { session_status: "end", list: [] } }));
    const { rt } = runtime({ store, fetchImpl: f });
    expect(await rt.pollOnce(mkEntry({ sellerId: "s" }))).toMatchObject({ stop: true, reason: "session_end" });
  });

  it("auth failures reach MAX → stop + setActive(false)", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(401, { error: "invalid_access_token" }));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry({ sellerId: "s" });
    let last;
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) last = await rt.pollOnce(entry);
    expect(last).toMatchObject({ stop: true, reason: "auth" });
    expect(store.calls.setActive).toContainEqual({ userId: "u1", shopId: 7, active: false });
  });

  it("429 → backoff, no stop", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(429, {}));
    const { rt } = runtime({ store, fetchImpl: f });
    expect(await rt.pollOnce(mkEntry({ sellerId: "s" }))).toMatchObject({ stop: false, backoff: true });
  });
});

// ── F1 — re-emit safety (the MONEY PATH fix) ─────────────────────────────────
describe("poller F1 — first-poll comments are DISPLAY-ONLY (initial:true), never live orders", () => {
  it("first poll after (re)Connect emits existing comments with initial:true; new comments after are live", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const c1 = { comment_id: "c1", username: "maria", comment: "mine red", create_time: 1700000000 };
    const c2 = { comment_id: "c2", username: "juan", comment: "mine blue", create_time: 1700000005 };
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { response: { list: [c1] } }))        // reconnect: c1 already existed
      .mockResolvedValueOnce(mkRes(200, { response: { list: [c1, c2] } }));   // then c2 arrives NEW
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    const entry = mkEntry({ firstPollDone: false }); // simulate a fresh poller (Connect/reconnect)

    await rt.pollOnce(entry);                          // FIRST poll
    expect(emitComment).toHaveBeenCalledTimes(1);
    expect(emitComment.mock.calls[0][2].initial).toBe(true); // c1 → display-only lane, cannot order

    await rt.pollOnce(entry);                          // SECOND poll: c1 deduped, c2 is genuinely new
    expect(emitComment).toHaveBeenCalledTimes(2);
    const c2payload = emitComment.mock.calls[1][2];
    expect(c2payload.msgId).toBe("c2");
    expect(c2payload.initial).toBeUndefined();         // live → orderable
  });

  it("empty first poll (fresh live, no history) consumes the flag → the first REAL comment is live", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc() }]);
    const c1 = { comment_id: "c1", username: "maria", comment: "mine", create_time: 1700000000 };
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { response: { list: [] } }))   // no history at connect
      .mockResolvedValueOnce(mkRes(200, { response: { list: [c1] } })); // first real comment
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    const entry = mkEntry({ firstPollDone: false });

    await rt.pollOnce(entry);                          // empty first poll → flag consumed
    expect(emitComment).not.toHaveBeenCalled();
    await rt.pollOnce(entry);                          // first real comment → live
    expect(emitComment).toHaveBeenCalledTimes(1);
    expect(emitComment.mock.calls[0][2].initial).toBeUndefined();
  });

  it("timestamp basis is the comment's own id (not now) → stable across a reconnect re-emit", async () => {
    // A comment with NO create_time. shopeeToPayload derives the ms from comment_id,
    // so the client's commentKey stays identical across a reconnect (different clocks)
    // → the same comment collapses instead of minting a fresh key.
    const token = await enc();
    const bare = { comment_id: "1700000000", username: "maria", comment: "mine" }; // no create_time
    const mk = (now: number) => {
      const f = vi.fn().mockResolvedValue(mkRes(200, { response: { list: [bare] } }));
      return runtime({ store: makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: token }]), fetchImpl: f, now: () => now });
    };
    const a = mk(1_000_000);
    await a.rt.pollOnce(mkEntry({ firstPollDone: false, startedAtMs: 1_000_000, lastActivityMs: 1_000_000 }));
    const b = mk(9_999_999);                           // different clock (a "reconnect")
    await b.rt.pollOnce(mkEntry({ firstPollDone: false, startedAtMs: 9_999_999, lastActivityMs: 9_999_999 }));
    const tsA = a.emitComment.mock.calls[0][2].timestamp;
    const tsB = b.emitComment.mock.calls[0][2].timestamp;
    expect(tsA).toBe(tsB);                             // stable → same commentKey on re-emit
  });
});

// ── F2 — orphan / idle caps ──────────────────────────────────────────────────
describe("poller F2 — idle + max-session caps stop the poller", () => {
  it("no NEW comments for IDLE_STOP_MS → stop(idle)", async () => {
    const { rt } = runtime({ fetchImpl: vi.fn() });
    const entry = mkEntry({ lastActivityMs: 1_000_000 - IDLE_STOP_MS }); // idle exactly at the cap
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: true, reason: "idle" });
  });
  it("session older than MAX_SESSION_MS → stop(max_session), independent of the end signal", async () => {
    const { rt } = runtime({ fetchImpl: vi.fn() });
    const entry = mkEntry({ startedAtMs: 1_000_000 - MAX_SESSION_MS });
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: true, reason: "max_session" });
  });
  it("a stop from the loop clears the timer + removes the registry entry + emits disconnected", () => {
    const clearLoop = vi.fn();
    const { rt, statusEmit } = runtime({ setLoop: vi.fn(() => 1), clearLoop });
    rt.startPoller({ sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", shopSessionId: "555", sessionId: "sf-browser-A" });
    rt.stopPoller("s:Shopee:7", "idle");
    expect(clearLoop).toHaveBeenCalled();
    expect(rt._pollers.size).toBe(0);
    expect(statusEmit).toHaveBeenCalledWith("s", expect.objectContaining({ connected: false, shopId: 7 }));
  });
});

// ── F4 — token cached on the entry; NO getShop per tick ──────────────────────
describe("poller F4 — the access token is read from the store ONCE, then cached", () => {
  it("N polls → getShop called exactly once (egress discipline)", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc(), token_expires_at: new Date(1_000_000 + 4 * 60 * 60 * 1000).toISOString() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { response: { list: [] } }));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    await rt.pollOnce(entry);
    await rt.pollOnce(entry);
    await rt.pollOnce(entry);
    expect(store.getShopCalls).toBe(1);                // cached after the first read
    expect(entry.accessToken).toBe("AT");
  });
  it("auth failure sets reauth → the NEXT poll re-reads the store (self-heal)", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc(), token_expires_at: new Date(1_000_000 + 4 * 60 * 60 * 1000).toISOString() }]);
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { response: { list: [] } }))          // poll 1: cache token (read #1)
      .mockResolvedValueOnce(mkRes(401, { error: "invalid_access_token" }))   // poll 2: auth fail → reauth=true
      .mockResolvedValueOnce(mkRes(200, { response: { list: [] } }));         // poll 3: re-read token (read #2)
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    await rt.pollOnce(entry);
    expect(store.getShopCalls).toBe(1);
    await rt.pollOnce(entry);
    expect(entry.reauth).toBe(true);
    await rt.pollOnce(entry);
    expect(store.getShopCalls).toBe(2);                // reauth forced a fresh read
  });
});

describe("poller lifecycle — timers cleared on every stop path", () => {
  it("start schedules; stop clears the loop timer + emits disconnected", () => {
    const clearLoop = vi.fn();
    let scheduled = 0;
    const setLoop = vi.fn(() => { scheduled++; return scheduled; });
    const { rt, statusEmit } = runtime({ setLoop, clearLoop });
    rt.startPoller({ sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", shopSessionId: "555", sessionId: "sf-browser-A" });
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
    rt.startPoller({ sellerId: "s", userId: "u1", shopId: 7, shopUsername: "7", shopSessionId: "555", sessionId: "sf-browser-A" });
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

// ── F3 — /shopee/connect enforces the paywall + rate limit (MIRRORS /connect/tiktok) ──
describe("routes F3 — /shopee/connect runs requireConnectRate + requirePlanActive", () => {
  // Capture the full middleware chain registered per route.
  function fakeApp() {
    const handlers: Record<string, unknown[]> = {};
    const rec = (m: string) => (p: string, ...h: unknown[]) => { handlers[`${m} ${p}`] = h; };
    return { app: { get: rec("GET"), post: rec("POST") }, handlers };
  }
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();

  it("wires requirePlanActive into the POST /shopee/connect chain", () => {
    const { rt } = runtime();
    const { app, handlers } = fakeApp();
    const requirePlanActive = vi.fn(pass);
    const requireConnectRate = vi.fn(pass);
    rt.registerRoutes(app as never, pass as never, { requireConnectRate, requirePlanActive });
    const chain = handlers["POST /shopee/connect"];
    expect(chain).toContain(requirePlanActive);   // paywall middleware present
    expect(chain).toContain(requireConnectRate);  // rate-limit middleware present
  });

  it("expired plan (requirePlanActive → 403) short-circuits: NO poller started", async () => {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true }]);
    const { rt } = runtime({ store });
    const { app, handlers } = fakeApp();
    // requirePlanActive rejects like server.js:260 does for an expired plan.
    const requirePlanActive = vi.fn((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => { res.status(403).json({ error: "plan_inactive" }); });
    rt.registerRoutes(app as never, pass as never, { requireConnectRate: pass, requirePlanActive });

    const chain = handlers["POST /shopee/connect"] as ((req: unknown, res: unknown, next: () => void) => unknown)[];
    const req = { authUserId: "u1", sellerId: "s", body: { shop_id: "7", session_id: "555" } };
    let statusCode = 0; let jsonBody: unknown = null;
    const res = { status(c: number) { statusCode = c; return this; }, json(b: unknown) { jsonBody = b; return this; } };
    // Run the chain in order; stop when a middleware does NOT call next (it responded).
    for (const h of chain) {
      let nexted = false;
      await h(req, res, () => { nexted = true; });
      if (!nexted) break;
    }
    expect(statusCode).toBe(403);
    expect(jsonBody).toMatchObject({ error: "plan_inactive" });
    expect(requirePlanActive).toHaveBeenCalled();
    expect(rt._pollers.size).toBe(0); // final handler (startPoller) never ran
  });
});

// ── SESSION-ID CONTRACT (mirrors the Facebook fix, fbLive.server.test.ts). useLiveFeed drops
// any comment / platform_status whose sessionId ≠ THIS browser's session id. Shopee used to
// stamp the SHOPEE live-session id there → every Shopee event would be dropped once live.
// End to end: /shopee/connect body.sessionId → poller entry → EVERY emitted comment + status
// event; the Shopee live session keeps its own fields AND is still what Shopee is polled with.
describe("session-ID contract — Shopee events carry the CONNECTING browser session, never the Shopee live-session id", () => {
  // The exact client drop rule (useLiveFeed.ts, comment + platform_status handlers).
  const clientAccepts = (evt: { sessionId?: string }, mySession: string) => !(evt.sessionId && evt.sessionId !== mySession);
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  function fakeApp() {
    const handlers: Record<string, unknown[]> = {};
    const rec = (m: string) => (p: string, ...h: unknown[]) => { handlers[`${m} ${p}`] = h; };
    return { app: { get: rec("GET"), post: rec("POST") }, handlers };
  }

  async function connectAndPoll(body: Record<string, unknown>) {
    const store = makeStore([{ user_id: "u1", shop_id: 7, active: true, access_token: await enc(), token_expires_at: new Date(1_000_000 + 4 * 60 * 60 * 1000).toISOString() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { response: { list: [{ comment_id: "c1", username: "maria", nickname: "Maria", comment: "mine red", create_time: 1700000000 }] } }));
    const { rt, emitComment, statusEmit } = runtime({ store, fetchImpl: f, setLoop: vi.fn(() => 1) });
    const { app, handlers } = fakeApp();
    rt.registerRoutes(app as never, pass as never);
    const chain = handlers["POST /shopee/connect"] as ((req: unknown, res: unknown, next: () => void) => unknown)[];
    const res = { status() { return this; }, json() { return this; } };
    await chain[chain.length - 1]({ authUserId: "u1", sellerId: "s", body }, res, () => {});
    const entry = [...rt._pollers.values()][0];
    await rt.pollOnce(entry);   // first poll (initial:true)
    return { rt, entry, emitComment, statusEmit, fetchImpl: f };
  }

  it("/shopee/connect body.sessionId → poller entry → comment payload.sessionId (NOT the Shopee session)", async () => {
    const { entry, emitComment } = await connectAndPoll({ shop_id: "7", session_id: "555", sessionId: "sf-browser-A" });
    expect(entry.sessionId).toBe("sf-browser-A");
    expect(entry.shopSessionId).toBe("555");
    const payload = emitComment.mock.calls[0][2];
    expect(payload.sessionId).toBe("sf-browser-A");
    expect(payload.sessionId).not.toBe("555");        // the bug
    expect(payload.shopeeSessionId).toBe("555");      // the Shopee live session lives in its own field
    expect(payload.roomId).toBe("555");
  });

  it("Shopee is still POLLED with its own live session (session_id=555), not the browser session", async () => {
    const { fetchImpl } = await connectAndPoll({ shop_id: "7", session_id: "555", sessionId: "sf-browser-A" });
    const qs = new URLSearchParams(String(fetchImpl.mock.calls[0][0]).split("?")[1]);
    expect(qs.get("session_id")).toBe("555");
  });

  it("platform_status (connected + disconnected) carries the browser session → the Shopee pill can go green", async () => {
    const { rt, entry, statusEmit } = await connectAndPoll({ shop_id: "7", session_id: "555", sessionId: "sf-browser-A" });
    expect(statusEmit).toHaveBeenCalledWith("s", expect.objectContaining({ connected: true, sessionId: "sf-browser-A", shopSessionId: "555" }));
    rt.stopPoller(entry.key, "disconnect");
    expect(statusEmit).toHaveBeenLastCalledWith("s", expect.objectContaining({ connected: false, sessionId: "sf-browser-A" }));
  });

  it("END TO END with the client drop rule: the connecting device ACCEPTS, a second device of the same seller DROPS (duplicate-order safeguard)", async () => {
    const { emitComment, statusEmit } = await connectAndPoll({ shop_id: "7", session_id: "555", sessionId: "sf-browser-A" });
    const comment = emitComment.mock.calls[0][2];
    const status = statusEmit.mock.calls[0][1];
    expect(clientAccepts(comment, "sf-browser-A")).toBe(true);   // the device that tapped Connect
    expect(clientAccepts(status, "sf-browser-A")).toBe(true);
    expect(clientAccepts(comment, "sf-browser-B")).toBe(false);  // another phone on the same account
    expect(clientAccepts(status, "sf-browser-B")).toBe(false);
  });

  it("the drop rule asserted above IS the one in useLiveFeed (comment + platform_status, before the Shopee branch)", () => {
    const feedSrc = readFileSync("src/redesign/adapters/useLiveFeed.ts", "utf8");
    expect(feedSrc).toContain("if (c.sessionId && c.sessionId !== sessionId) return;");
    expect(feedSrc).toContain("if (p.sessionId && p.sessionId !== sessionId) return;");
    expect(feedSrc.indexOf("if (p.sessionId && p.sessionId !== sessionId) return;"))
      .toBeLessThan(feedSrc.indexOf('if (p.platform === "Shopee")')); // applies to Shopee status too
  });

  it("old client (no sessionId in body) → \"\" → accepted by every device (degrades open, never drops)", async () => {
    const { entry, emitComment } = await connectAndPoll({ shop_id: "7", session_id: "555" });
    expect(entry.sessionId).toBe("");
    expect(clientAccepts(emitComment.mock.calls[0][2], "sf-anything")).toBe(true);
  });

  it("server.js Shopee statusEmit stamps the passed sessionId (the browser session) onto platform_status", () => {
    const srv = readFileSync("server.js", "utf8");
    const i = srv.indexOf('platform: "Shopee", connected, sellerId, username: String(shopId)');
    expect(i).toBeGreaterThan(-1);
    const line = srv.slice(i, srv.indexOf("\n", i));
    expect(line).toContain('sessionId: String(sessionId || "")');
  });
});
