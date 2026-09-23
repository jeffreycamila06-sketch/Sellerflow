// FACEBOOK LIVE — Phase 2 runtime (server/fbLive.js). All I/O is injected so vitest
// drives the whole flow with fakes (server.js has no harness). Pins: state nonce
// sign/verify (seller binding, forgery/replay) · new-comment diffing · OAuth callback
// (code→long token→pages, cap, encrypted upsert, redirects) · token re-validation loop ·
// poller (emit exact FB shape once, backoff, ended/auth-fail stop, initial lane,
// idle/max caps, token cache, timer cleared on every stop path) · routes register (5
// endpoints) · /fb/connect middleware chain (F3) · /fb/pages NEVER serializes a token.
// SACRED ZONE untouched: emit goes through the injected emitCommentScoped (which
// sanitizes); this never touches dedup/commentKey/orders.
import { describe, it, expect, vi } from "vitest";
import {
  signState, verifyState, pickNewComments, nextPollDelay, createFbRuntime,
  POLL_ACTIVE_MS, POLL_QUIET_MS, MAX_AUTH_FAILURES, MAX_FETCH_ERRORS, IDLE_STOP_MS, MAX_SESSION_MS,
} from "../../../../server/fbLive.js";
import { encryptToken, decryptToken } from "../../../../server/fbTokens.js";
import { GRAPH_VERSION } from "../../../../server/fbConfig.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;

// In-memory store fake (mirrors the serviceSb-backed store in server.js).
function makeStore(seed: Record<string, unknown>[] = [], plan = "pro") {
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of seed) rows.set(`${r.user_id}:${r.page_id}`, { ...r });
  return {
    rows,
    calls: { upsert: [] as unknown[], setActive: [] as unknown[], updateExpiry: [] as unknown[] },
    getPageCalls: 0,
    async getPlan() { return plan; },
    async countPages(userId: string) { return [...rows.values()].filter((r) => r.user_id === userId).length; },
    async getPage(userId: string, pageId: string) { this.getPageCalls++; return rows.get(`${userId}:${String(pageId)}`) || null; },
    async listPages(userId: string) { return [...rows.values()].filter((r) => r.user_id === userId); },
    async upsertPage(row: Record<string, unknown>) { this.calls.upsert.push(row); rows.set(`${row.user_id}:${row.page_id}`, { ...row }); },
    async listActivePages() { return [...rows.values()].filter((r) => r.active); },
    async setActive(userId: string, pageId: string, active: boolean) { this.calls.setActive.push({ userId, pageId, active }); const k = `${userId}:${String(pageId)}`; if (rows.has(k)) rows.get(k)!.active = active; },
    async updateExpiry(userId: string, pageId: string, iso: string) { this.calls.updateExpiry.push({ userId, pageId, iso }); },
  };
}

function runtime(overrides: Record<string, unknown> = {}) {
  const store = (overrides.store as ReturnType<typeof makeStore>) || makeStore();
  const emitComment = vi.fn();
  const statusEmit = vi.fn();
  const fetchImpl = (overrides.fetchImpl as ReturnType<typeof vi.fn>) || vi.fn();
  const rt = createFbRuntime({
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

describe("signState / verifyState — seller binding", () => {
  it("round-trips the userId", () => {
    const s = signState({ userId: "user-1", key: "sekret", nowMs: 1000 });
    expect(verifyState(s, "sekret", 2000)).toBe("user-1");
  });
  it("tampered signature → null", () => {
    const s = signState({ userId: "user-1", key: "sekret", nowMs: 1000 });
    expect(verifyState(s.slice(0, -1) + (s.endsWith("0") ? "1" : "0"), "sekret", 2000)).toBeNull();
  });
  it("wrong key → null", () => {
    const s = signState({ userId: "user-1", key: "sekret", nowMs: 1000 });
    expect(verifyState(s, "other", 2000)).toBeNull();
  });
  it("expired (replay past TTL) → null", () => {
    const s = signState({ userId: "user-1", key: "sekret", nowMs: 1000, ttlMs: 5000 });
    expect(verifyState(s, "sekret", 1000 + 5001)).toBeNull();
  });
  it("garbage → null", () => {
    expect(verifyState("", "sekret")).toBeNull();
    expect(verifyState("a.b", "sekret")).toBeNull();
  });
});

describe("pickNewComments / nextPollDelay", () => {
  it("returns only unseen ids in order, skips id-less", () => {
    const emitted = new Set<string>(["1"]);
    const fresh = pickNewComments([{ id: 1 }, { id: 2 }, { message: "no id" }, { id: 3 }], emitted);
    expect(fresh.map((c: Record<string, unknown>) => String(c.id))).toEqual(["2", "3"]);
  });
  it("cadence: hadNew→active, else quiet", () => {
    expect(nextPollDelay(true)).toBe(POLL_ACTIVE_MS);
    expect(nextPollDelay(false)).toBe(POLL_QUIET_MS);
  });
});

describe("buildAuthUrl — versioned dialog + scope + bound state", () => {
  it("uses the pinned Graph version, the OAuth scope, and a verifiable state", () => {
    const { rt } = runtime();
    const url = rt.buildAuthUrl("user-1");
    expect(url.startsWith(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?`)).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("client_id")).toBe("app123");
    expect(qs.get("scope")).toBe("pages_show_list,pages_read_engagement");
    expect(qs.get("redirect_uri")).toBe("https://srv.test/fb/oauth/callback");
    expect(verifyState(String(qs.get("state")), CONFIG.appSecret, 1_000_000)).toBe("user-1");
  });
});

describe("OAuth callback — code → long token → pages → encrypted upsert", () => {
  const goodChain = () => vi.fn()
    .mockResolvedValueOnce(mkRes(200, { access_token: "SHORT" }))                                    // code → short user token
    .mockResolvedValueOnce(mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 }))            // → long-lived user token
    .mockResolvedValueOnce(mkRes(200, { data: [{ id: "P1", name: "My Page", username: "mypage", access_token: "PAGETOK" }] })); // /me/accounts

  it("valid state + under cap → encrypted page upsert + connected redirect", async () => {
    const f = goodChain();
    const { rt, store } = runtime({ fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.appSecret, nowMs: 1_000_000 });
    const out = await rt.handleCallback({ code: "CODE", state });
    expect(out.redirect).toBe("https://app.test/?fb=connected");
    expect(store.calls.upsert).toHaveLength(1);
    const row = store.calls.upsert[0] as Record<string, string>;
    expect(row.page_id).toBe("P1");
    expect(row.page_name).toBe("My Page");
    expect(row.page_username).toBe("mypage");
    expect(row.access_token).not.toBe("PAGETOK");                        // stored ENCRYPTED
    expect(decryptToken(row.access_token, CONFIG.tokenKey)).toBe("PAGETOK"); // decrypts back
    expect(row.active).toBe(true);
    expect(typeof row.token_expires_at).toBe("string");
  });

  it("bad state → error redirect, NO fetch, NO upsert", async () => {
    const f = vi.fn();
    const { rt, store } = runtime({ fetchImpl: f });
    const out = await rt.handleCallback({ code: "C", state: "tampered" });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=bad_state");
    expect(store.calls.upsert).toHaveLength(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("cap exceeded (count>=max, all NEW pages) → cap redirect, NO upsert", async () => {
    const store = makeStore([
      { user_id: "user-1", page_id: "A", active: true },
      { user_id: "user-1", page_id: "B", active: true },
      { user_id: "user-1", page_id: "C", active: true },
    ], "pro"); // pro max = 3
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { access_token: "SHORT" }))
      .mockResolvedValueOnce(mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 }))
      .mockResolvedValueOnce(mkRes(200, { data: [{ id: "NEW9", name: "New", access_token: "PAGETOK" }] }));
    const { rt } = runtime({ store, fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.appSecret, nowMs: 1_000_000 });
    const out = await rt.handleCallback({ code: "C", state });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=cap");
    expect(store.calls.upsert).toHaveLength(0);
  });

  it("re-auth of an EXISTING page is allowed even at cap", async () => {
    const store = makeStore([
      { user_id: "user-1", page_id: "P1", active: true },
      { user_id: "user-1", page_id: "B", active: true },
      { user_id: "user-1", page_id: "C", active: true },
    ], "pro");
    const f = goodChain(); // returns page P1 (already owned)
    const { rt } = runtime({ store, fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.appSecret, nowMs: 1_000_000 });
    const out = await rt.handleCallback({ code: "C", state });
    expect(out.redirect).toBe("https://app.test/?fb=connected");
    expect(store.calls.upsert).toHaveLength(1); // P1 refreshed, not blocked
  });

  it("token exchange failure → error redirect, NO upsert", async () => {
    const f = vi.fn().mockResolvedValueOnce(mkRes(400, { error: { message: "bad code" } }));
    const { rt, store } = runtime({ fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.appSecret, nowMs: 1_000_000 });
    const out = await rt.handleCallback({ code: "C", state });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=token_exchange");
    expect(store.calls.upsert).toHaveLength(0);
  });

  it("no pages returned → no_pages redirect", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { access_token: "SHORT" }))
      .mockResolvedValueOnce(mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 }))
      .mockResolvedValueOnce(mkRes(200, { data: [] }));
    const { rt } = runtime({ fetchImpl: f });
    const state = signState({ userId: "user-1", key: CONFIG.appSecret, nowMs: 1_000_000 });
    const out = await rt.handleCallback({ code: "C", state });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=no_pages");
  });
});

describe("token re-validation loop (FB deviation: revalidate, never a bogus re-exchange)", () => {
  it("expiring page still valid → updateExpiry (reminder extended), NOT inactivated", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, token_expires_at: new Date(1_000_000 + 60_000).toISOString(), access_token: encryptToken("PAGETOK", CONFIG.tokenKey) }]);
    const f = vi.fn().mockResolvedValueOnce(mkRes(200, { id: "P1" }));
    const { rt } = runtime({ store, fetchImpl: f });
    await rt.refreshDuePages();
    expect(store.calls.updateExpiry).toHaveLength(1);
    expect(store.calls.setActive).toHaveLength(0);
  });
  it("expiring page revoked (190) → marked inactive, loop survives", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, token_expires_at: new Date(1_000_000 + 60_000).toISOString(), access_token: encryptToken("PAGETOK", CONFIG.tokenKey) }]);
    const f = vi.fn().mockResolvedValueOnce(mkRes(400, { error: { code: 190, message: "revoked" } }));
    const { rt } = runtime({ store, fetchImpl: f });
    await rt.refreshDuePages();
    expect(store.calls.setActive).toContainEqual({ userId: "u1", pageId: "P1", active: false });
    expect(store.calls.updateExpiry).toHaveLength(0);
  });
  it("not expiring → no revalidation call", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, token_expires_at: new Date(1_000_000 + 30 * 24 * 60 * 60 * 1000).toISOString(), access_token: "x" }]);
    const f = vi.fn();
    const { rt } = runtime({ store, fetchImpl: f });
    await rt.refreshDuePages();
    expect(f).not.toHaveBeenCalled();
  });
});

const enc = () => encryptToken("PAGETOK", CONFIG.tokenKey);
function mkEntry(over: Record<string, unknown> = {}) {
  const nowMs = 1_000_000;
  return {
    key: "seller1:Facebook:P1", sellerId: "seller1", userId: "u1", pageId: "P1",
    scopeKey: "mypage", liveVideoId: "LV1",
    emitted: new Set<string>(), authFails: 0, fetchErrors: 0, timer: null, stopped: false,
    firstPollDone: true,
    startedAtMs: nowMs, lastActivityMs: nowMs,
    accessToken: null, tokenExpiresAtMs: 0, reauth: false,
    ...over,
  };
}
const cmt = (id: string, msg: string, extra: Record<string, unknown> = {}) => ({ id, message: msg, from: { name: "Maria", id: "u77" }, created_time: "2026-09-16T00:00:00+0000", ...extra });

describe("poller — pollOnce", () => {
  it("new comments → emitComment with EXACT FB shape, once (dedup on re-poll)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { data: [cmt("c1", "mine red")] }));
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    const r1 = await rt.pollOnce(entry);
    expect(r1).toMatchObject({ hadNew: true, stop: false });
    expect(emitComment).toHaveBeenCalledTimes(1);
    const [sellerId, scopeKey, payload] = emitComment.mock.calls[0];
    expect(sellerId).toBe("seller1");
    expect(scopeKey).toBe("mypage");
    expect(payload).toMatchObject({ platform: "Facebook", handle: "Maria", comment: "mine red", msgId: "c1", roomId: "LV1", sellerId: "seller1", sessionId: "LV1", pageId: "P1", liveVideoId: "LV1", isBuy: false, buyerNum: null, buyerData: null });
    expect(payload.initial).toBeUndefined(); // steady-state live comment carries NO initial flag
    const r2 = await rt.pollOnce(entry);
    expect(r2.hadNew).toBe(false);
    expect(emitComment).toHaveBeenCalledTimes(1);
  });

  it("comments fetch uses the CORRECT Graph params (filter=stream, live_filter=no_filter, order=reverse_chronological)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { data: [] }));
    const { rt } = runtime({ store, fetchImpl: f });
    await rt.pollOnce(mkEntry());
    const url = String(f.mock.calls[0][0]);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("filter")).toBe("stream");            // "stream" is a `filter` value…
    expect(qs.get("live_filter")).toBe("no_filter");    // …NOT a live_filter value (the bug)
    expect(qs.get("order")).toBe("reverse_chronological");
    expect(url).not.toMatch(/live_filter=stream/);      // the exact invalid param is gone
  });

  // ⚠️ THE BUG FIX: a code-100 (invalid-param / generic) comments error must NEVER be
  // read as session_end. It retries with backoff; only after MAX_FETCH_ERRORS consecutive
  // AND an authoritative live_videos status check does it stop — session_end if the video
  // is no longer LIVE, else fetch_error (distinct).
  it("code 100 comments error → RETRY (backoff, no stop), NOT session_end", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(400, { error: { code: 100, message: "Invalid parameter" } }));
    const { rt } = runtime({ store, fetchImpl: f });
    const r = await rt.pollOnce(mkEntry());
    expect(r).toMatchObject({ stop: false, backoff: true }); // retry, NOT stop
    expect(r).not.toMatchObject({ reason: "session_end" });
  });

  it("MAX_FETCH_ERRORS consecutive code-100 + live still LIVE → stop reason=fetch_error (NOT session_end)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    // comments error every poll; the live-status confirm (GET /{lv}?fields=status) says LIVE.
    const err = mkRes(400, { error: { code: 100, message: "Invalid parameter" } });
    const f = vi.fn().mockImplementation((url: string) =>
      /\/comments\?/.test(url) ? Promise.resolve(err) : Promise.resolve(mkRes(200, { status: "LIVE" })));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    let last;
    for (let i = 0; i < MAX_FETCH_ERRORS; i++) last = await rt.pollOnce(entry);
    expect(last).toMatchObject({ stop: true, reason: "fetch_error" });
  });

  it("MAX_FETCH_ERRORS consecutive + live NOT LIVE (VOD) → stop reason=session_end (authoritative)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const err = mkRes(400, { error: { code: 100, message: "Invalid parameter" } });
    const f = vi.fn().mockImplementation((url: string) =>
      /\/comments\?/.test(url) ? Promise.resolve(err) : Promise.resolve(mkRes(200, { status: "VOD" })));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    let last;
    for (let i = 0; i < MAX_FETCH_ERRORS; i++) last = await rt.pollOnce(entry);
    expect(last).toMatchObject({ stop: true, reason: "session_end" });
  });

  it("a clean fetch RESETS the hard-error streak (transient blip doesn't accumulate)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const err = mkRes(400, { error: { code: 100, message: "Invalid parameter" } });
    const ok = mkRes(200, { data: [] });
    const f = vi.fn()
      .mockResolvedValueOnce(err)   // 1 hard error
      .mockResolvedValueOnce(ok)    // clean → streak resets
      .mockResolvedValueOnce(err);  // 1 hard error again (not 2)
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    await rt.pollOnce(entry);
    await rt.pollOnce(entry);
    const r = await rt.pollOnce(entry);
    expect(r).toMatchObject({ stop: false, backoff: true }); // streak was reset → still retrying, not stopped
  });

  it("auth failures (190) reach MAX → stop + setActive(false)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(401, { error: { code: 190, message: "invalid token" } }));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    let last;
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) last = await rt.pollOnce(entry);
    expect(last).toMatchObject({ stop: true, reason: "auth" });
    expect(store.calls.setActive).toContainEqual({ userId: "u1", pageId: "P1", active: false });
  });

  it("429 → backoff, no stop (NOT misread as ended)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(429, {}));
    const { rt } = runtime({ store, fetchImpl: f });
    expect(await rt.pollOnce(mkEntry())).toMatchObject({ stop: false, backoff: true });
  });

  it("5xx → backoff, no stop", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValue(mkRes(503, {}));
    const { rt } = runtime({ store, fetchImpl: f });
    expect(await rt.pollOnce(mkEntry())).toMatchObject({ stop: false, backoff: true });
  });
});

describe("poller F1 — first-poll comments are DISPLAY-ONLY (initial:true), never live orders", () => {
  it("first poll emits existing comments with initial:true; comments after are live", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { data: [cmt("c1", "mine red")] }))                        // reconnect: c1 existed
      .mockResolvedValueOnce(mkRes(200, { data: [cmt("c2", "mine blue"), cmt("c1", "mine red")] })); // newest-first; c2 NEW
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    const entry = mkEntry({ firstPollDone: false });
    await rt.pollOnce(entry);
    expect(emitComment).toHaveBeenCalledTimes(1);
    expect(emitComment.mock.calls[0][2].initial).toBe(true);   // c1 → display-only lane
    await rt.pollOnce(entry);
    expect(emitComment).toHaveBeenCalledTimes(2);
    expect(emitComment.mock.calls[1][2].msgId).toBe("c2");
    expect(emitComment.mock.calls[1][2].initial).toBeUndefined(); // live → orderable
  });

  it("empty first poll consumes the flag → the first REAL comment is live", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { data: [] }))
      .mockResolvedValueOnce(mkRes(200, { data: [cmt("c1", "mine")] }));
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    const entry = mkEntry({ firstPollDone: false });
    await rt.pollOnce(entry);
    expect(emitComment).not.toHaveBeenCalled();
    await rt.pollOnce(entry);
    expect(emitComment).toHaveBeenCalledTimes(1);
    expect(emitComment.mock.calls[0][2].initial).toBeUndefined();
  });

  it("first-poll batch emits OLDEST→newest (reverse of reverse_chronological)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    // Graph returns newest-first; the feed should append oldest-first.
    const f = vi.fn().mockResolvedValueOnce(mkRes(200, { data: [cmt("c3", "third"), cmt("c2", "second"), cmt("c1", "first")] }));
    const { rt, emitComment } = runtime({ store, fetchImpl: f });
    await rt.pollOnce(mkEntry({ firstPollDone: false }));
    expect(emitComment.mock.calls.map((c) => c[2].msgId)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("poller F2 — idle + max-session caps stop the poller", () => {
  it("no NEW comments for IDLE_STOP_MS → stop(idle)", async () => {
    const { rt } = runtime({ fetchImpl: vi.fn() });
    expect(await rt.pollOnce(mkEntry({ lastActivityMs: 1_000_000 - IDLE_STOP_MS }))).toMatchObject({ stop: true, reason: "idle" });
  });
  it("session older than MAX_SESSION_MS → stop(max_session)", async () => {
    const { rt } = runtime({ fetchImpl: vi.fn() });
    expect(await rt.pollOnce(mkEntry({ startedAtMs: 1_000_000 - MAX_SESSION_MS }))).toMatchObject({ stop: true, reason: "max_session" });
  });
});

describe("poller F4 — token cached on the entry; NO getPage per tick", () => {
  it("N polls → getPage called exactly once", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc(), token_expires_at: new Date(1_000_000 + 60 * 24 * 60 * 60 * 1000).toISOString() }]);
    const f = vi.fn().mockResolvedValue(mkRes(200, { data: [] }));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    await rt.pollOnce(entry); await rt.pollOnce(entry); await rt.pollOnce(entry);
    expect(store.getPageCalls).toBe(1);
    expect(entry.accessToken).toBe("PAGETOK");
  });
  it("auth failure sets reauth → the NEXT poll re-reads the store", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc(), token_expires_at: new Date(1_000_000 + 60 * 24 * 60 * 60 * 1000).toISOString() }]);
    const f = vi.fn()
      .mockResolvedValueOnce(mkRes(200, { data: [] }))
      .mockResolvedValueOnce(mkRes(401, { error: { code: 190 } }))
      .mockResolvedValueOnce(mkRes(200, { data: [] }));
    const { rt } = runtime({ store, fetchImpl: f });
    const entry = mkEntry();
    await rt.pollOnce(entry);
    expect(store.getPageCalls).toBe(1);
    await rt.pollOnce(entry);
    expect(entry.reauth).toBe(true);
    await rt.pollOnce(entry);
    expect(store.getPageCalls).toBe(2);
  });
});

describe("poller lifecycle — timers cleared on every stop path", () => {
  it("start schedules + emits connected; stop clears the loop timer + emits disconnected", () => {
    const clearLoop = vi.fn();
    const setLoop = vi.fn(() => 1);
    const { rt, statusEmit } = runtime({ setLoop, clearLoop });
    rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1" });
    expect(setLoop).toHaveBeenCalled();
    expect(statusEmit).toHaveBeenCalledWith("s", expect.objectContaining({ connected: true, scopeKey: "mypage" }));
    const stopped = rt.stopPoller("s:Facebook:P1", "disconnect");
    expect(stopped).toBe(true);
    expect(clearLoop).toHaveBeenCalled();
    expect(statusEmit).toHaveBeenCalledWith("s", expect.objectContaining({ connected: false, scopeKey: "mypage" }));
    expect(rt._pollers.size).toBe(0);
  });
  it("scopeKey falls back to pageId when the page has no username", () => {
    const { rt, statusEmit } = runtime({ setLoop: vi.fn(() => 1) });
    rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P9", pageUsername: "", liveVideoId: "LV1" });
    expect(statusEmit).toHaveBeenCalledWith("s", expect.objectContaining({ scopeKey: "P9" }));
  });
  it("stopAll clears every poller + the refresh timer", () => {
    const clearLoop = vi.fn();
    const clearTimer = vi.fn();
    const { rt } = runtime({ clearLoop, clearTimer });
    rt.startRefreshTimer();
    rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1" });
    rt.stopAll();
    expect(clearLoop).toHaveBeenCalled();
    expect(clearTimer).toHaveBeenCalled();
    expect(rt._pollers.size).toBe(0);
  });
});

describe("routes register + /fb/pages token safety + F3 chain", () => {
  function fakeApp() {
    const handlers: Record<string, unknown[]> = {};
    const rec = (m: string) => (p: string, ...h: unknown[]) => { handlers[`${m} ${p}`] = h; };
    return { app: { get: rec("GET"), post: rec("POST") }, handlers };
  }
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();

  it("registerRoutes wires exactly the 5 FB endpoints", () => {
    const { rt } = runtime();
    const routes: string[] = [];
    const app = { get: (p: string) => routes.push(`GET ${p}`), post: (p: string) => routes.push(`POST ${p}`) };
    rt.registerRoutes(app as never, pass as never);
    expect(routes.sort()).toEqual([
      "GET /fb/oauth/callback", "GET /fb/oauth/start", "GET /fb/pages",
      "POST /fb/connect", "POST /fb/disconnect",
    ]);
  });

  it("GET /fb/pages NEVER serializes a token column (even if the store row carries one)", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", page_name: "My Page", page_username: "mypage", active: true, access_token: "SECRET_CIPHERTEXT" }]);
    const { rt } = runtime({ store });
    const { app, handlers } = fakeApp();
    rt.registerRoutes(app as never, pass as never);
    const chain = handlers["GET /fb/pages"] as ((req: unknown, res: unknown) => Promise<void>)[];
    const handler = chain[chain.length - 1];
    let jsonBody: Record<string, unknown> = {};
    const res = { status() { return this; }, json(b: Record<string, unknown>) { jsonBody = b; return this; } };
    await handler({ authUserId: "u1" }, res);
    const serialized = JSON.stringify(jsonBody);
    expect(serialized).not.toContain("SECRET_CIPHERTEXT");
    expect(serialized).not.toContain("access_token");
    expect((jsonBody.pages as Record<string, unknown>[])[0]).toMatchObject({ page_id: "P1", name: "My Page", username: "mypage", active: true });
  });

  it("wires requirePlanActive + requireConnectRate into POST /fb/connect (F3)", () => {
    const { rt } = runtime();
    const { app, handlers } = fakeApp();
    const requirePlanActive = vi.fn(pass);
    const requireConnectRate = vi.fn(pass);
    rt.registerRoutes(app as never, pass as never, { requireConnectRate, requirePlanActive });
    const chain = handlers["POST /fb/connect"];
    expect(chain).toContain(requirePlanActive);
    expect(chain).toContain(requireConnectRate);
  });

  it("expired plan (requirePlanActive → 403) short-circuits: NO poller started", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true }]);
    const { rt } = runtime({ store });
    const { app, handlers } = fakeApp();
    const requirePlanActive = vi.fn((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => { res.status(403).json({ error: "plan_inactive" }); });
    rt.registerRoutes(app as never, pass as never, { requireConnectRate: pass, requirePlanActive });
    const chain = handlers["POST /fb/connect"] as ((req: unknown, res: unknown, next: () => void) => unknown)[];
    const req = { authUserId: "u1", sellerId: "s", body: { page_id: "P1" } };
    let statusCode = 0; let jsonBody: unknown = null;
    const res = { status(c: number) { statusCode = c; return this; }, json(b: unknown) { jsonBody = b; return this; } };
    for (const h of chain) {
      let nexted = false;
      await h(req, res, () => { nexted = true; });
      if (!nexted) break;
    }
    expect(statusCode).toBe(403);
    expect(jsonBody).toMatchObject({ error: "plan_inactive" });
    expect(rt._pollers.size).toBe(0);
  });

  it("/fb/connect not-live → { ok:false, reason:'not_live' }, no poller", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValueOnce(mkRes(200, { data: [{ id: "LVx", status: "VOD" }] })); // no LIVE
    const { rt } = runtime({ store, fetchImpl: f });
    const { app, handlers } = fakeApp();
    rt.registerRoutes(app as never, pass as never);
    const chain = handlers["POST /fb/connect"] as ((req: unknown, res: unknown, next: () => void) => unknown)[];
    const handler = chain[chain.length - 1];
    let jsonBody: unknown = null;
    const res = { status() { return this; }, json(b: unknown) { jsonBody = b; return this; } };
    await handler({ authUserId: "u1", sellerId: "s", body: { page_id: "P1" } }, res, () => {});
    expect(jsonBody).toMatchObject({ ok: false, reason: "not_live" });
    expect(rt._pollers.size).toBe(0);
  });

  it("/fb/connect LIVE → starts poller + returns the live_video_id", async () => {
    const store = makeStore([{ user_id: "u1", page_id: "P1", page_username: "mypage", active: true, access_token: enc() }]);
    const f = vi.fn().mockResolvedValueOnce(mkRes(200, { data: [{ id: "LV42", status: "LIVE" }] }));
    const { rt } = runtime({ store, fetchImpl: f, setLoop: vi.fn(() => 1) });
    const { app, handlers } = fakeApp();
    rt.registerRoutes(app as never, pass as never);
    const chain = handlers["POST /fb/connect"] as ((req: unknown, res: unknown, next: () => void) => unknown)[];
    const handler = chain[chain.length - 1];
    let jsonBody: Record<string, unknown> = {};
    const res = { status() { return this; }, json(b: Record<string, unknown>) { jsonBody = b; return this; } };
    await handler({ authUserId: "u1", sellerId: "s", body: { page_id: "P1" } }, res, () => {});
    expect(jsonBody).toMatchObject({ ok: true, live_video_id: "LV42" });
    expect(rt._pollers.size).toBe(1);
  });
});
