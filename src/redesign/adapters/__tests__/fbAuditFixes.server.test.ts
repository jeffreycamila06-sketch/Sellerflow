// Facebook audit fixes, Part A (server/fbLive.js). Behaviour tests with in-memory fakes:
// A1 error classes (only 190 / HTTP 401 deactivate a page; rate limit waits 30 s, logged once
// per streak) · A2 idle limit asks the live status · A3 limit=100 · A4 10 s Graph timeout ·
// A5 /fb/connect answers · A6 running-poller status replay · A7 stopped poller emits nothing.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createFbRuntime, classifyGraphError, graphGet, fetchComments, fetchLiveStatus, fetchLiveVideos, replayFbStatus,
  IDLE_STOP_MS, IDLE_RECHECK_MS, MAX_IDLE_UNREADABLE, POLL_RATE_LIMIT_MS, COMMENTS_PAGE_LIMIT, GRAPH_TIMEOUT_MS, MAX_AUTH_FAILURES,
} from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const NOW = 1_000_000;
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;
const enc = () => encryptToken("PAGETOK", CONFIG.tokenKey);
const PAGE = { user_id: "u1", page_id: "P1", page_username: "mypage", active: true, access_token: enc() };

function makeStore(page: Record<string, unknown> | null = PAGE, opts: { throwGetPage?: boolean } = {}) {
  const calls = { setActive: [] as unknown[], updateExpiry: [] as unknown[] };
  return {
    calls,
    async getPlan() { return "pro"; },
    async countPages() { return 1; },
    async getPage(userId: string, pageId: string) {
      if (opts.throwGetPage) throw new Error("fb_page_read_failed");
      return page && userId === page.user_id && String(pageId) === page.page_id ? { ...page } : null;
    },
    async listPages() { return page ? [page] : []; },
    async upsertPage() {},
    async listActivePages() { return page ? [{ ...page }] : []; },
    async setActive(userId: string, pageId: string, active: boolean) { calls.setActive.push({ userId, pageId, active }); },
    async updateExpiry(userId: string, pageId: string, iso: string) { calls.updateExpiry.push({ userId, pageId, iso }); },
  };
}

function runtime(o: { store?: ReturnType<typeof makeStore>; fetchImpl?: unknown; now?: () => number; log?: unknown; setLoop?: unknown } = {}) {
  const store = o.store || makeStore();
  const emitComment = vi.fn();
  const statusEmit = vi.fn();
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment, statusEmit, liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl: o.fetchImpl || vi.fn(), now: o.now || (() => NOW), log: o.log || (() => {}),
    setLoop: o.setLoop || (() => 1), clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  return { rt, store, emitComment, statusEmit };
}

function mkEntry(over: Record<string, unknown> = {}) {
  return {
    key: "seller1:Facebook:P1", sellerId: "seller1", userId: "u1", pageId: "P1", scopeKey: "mypage", liveVideoId: "LV1", sessionId: "sess-A",
    emitted: new Set<string>(), authFails: 0, fetchErrors: 0, featureGated: false, rateLimited: false, timer: null, stopped: false,
    firstPollDone: true, startedAtMs: NOW, lastActivityMs: NOW, accessToken: null, tokenExpiresAtMs: 0, reauth: false,
    idleUnreadable: 0, idleRecheckAtMs: 0,
    ...over,
  };
}
const isStatusUrl = (u: string) => /\/LV1\?/.test(u);
const isCommentsUrl = (u: string) => /\/comments\?/.test(u);

afterEach(() => { vi.useRealTimers(); });

// ── A1 ───────────────────────────────────────────────────────────────────────
describe("A1 classifyGraphError", () => {
  it("rate limit = HTTP 429 or a throttling code; never an auth failure", () => {
    for (const code of [4, 17, 32, 613, 80001, 80006]) {
      expect(classifyGraphError(400, { error: { code } })).toMatchObject({ rateLimited: true, authFail: false });
      expect(classifyGraphError(401, { error: { code } })).toMatchObject({ rateLimited: true, authFail: false });
    }
    expect(classifyGraphError(429, {})).toMatchObject({ rateLimited: true, authFail: false });
  });
  it("auth failure = code 190 or HTTP 401 only; a plain 403 is not", () => {
    expect(classifyGraphError(400, { error: { code: 190 } })).toMatchObject({ authFail: true });
    expect(classifyGraphError(401, {})).toMatchObject({ authFail: true });
    expect(classifyGraphError(403, {})).toMatchObject({ authFail: false, rateLimited: false });
    expect(classifyGraphError(403, { error: { code: 10 } })).toMatchObject({ authFail: false });
  });
  it("feature gate (code 200) is neither", () => {
    expect(classifyGraphError(403, { error: { code: 200 } })).toMatchObject({ featureGate: true, authFail: false, rateLimited: false });
    expect(classifyGraphError(401, { error: { code: 200 } })).toMatchObject({ featureGate: true, authFail: false });
  });
});

describe("A1 poller — rate limit waits 30 s, logged once per streak; only a real invalid token deactivates", () => {
  it("a rate-limited poll asks for a 30 s wait and is not a hard error or auth strike", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(400, { error: { code: 17, message: "User request limit reached" } }));
    const { rt } = runtime({ fetchImpl: f });
    const entry = mkEntry();
    const r = await rt.pollOnce(entry);
    expect(r).toMatchObject({ stop: false, backoff: true, delayMs: POLL_RATE_LIMIT_MS });
    expect(POLL_RATE_LIMIT_MS).toBe(30_000);
    expect(entry.authFails).toBe(0);
    expect(entry.fetchErrors).toBe(0);
  });
  it("logged once per streak: 3 limited polls → 1 log; clean poll ends the streak; next limit logs again", async () => {
    const limited = mkRes(429, {});
    const f = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(limited).mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(mkRes(200, { data: [] })).mockResolvedValueOnce(limited);
    const log = vi.fn();
    const { rt } = runtime({ fetchImpl: f, log });
    const entry = mkEntry();
    for (let i = 0; i < 5; i++) await rt.pollOnce(entry);
    expect(log.mock.calls.filter((c) => String(c[0]).includes("rate-limited"))).toHaveLength(2);
  });
  it("the scheduler waits delayMs after a rate-limited poll", async () => {
    const delays: number[] = [];
    const fns: (() => Promise<void>)[] = [];
    const setLoop = (fn: () => Promise<void>, ms: number) => { delays.push(ms); fns.push(fn); return fns.length; };
    const f = vi.fn().mockResolvedValue(mkRes(429, {}));
    const { rt } = runtime({ fetchImpl: f, setLoop });
    rt.startPoller({ sellerId: "seller1", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1", sessionId: "s" });
    await fns[0]();
    expect(delays).toEqual([0, POLL_RATE_LIMIT_MS]);
  });
  it("a throttling code on HTTP 401 never deactivates the page", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(401, { error: { code: 80001 } }));
    const { rt, store } = runtime({ fetchImpl: f });
    const entry = mkEntry();
    for (let i = 0; i < MAX_AUTH_FAILURES + 1; i++) await rt.pollOnce(entry);
    expect(store.calls.setActive).toEqual([]);
  });
  it("HTTP 401 (invalid token) still deactivates after MAX_AUTH_FAILURES", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(401, {}));
    const { rt, store } = runtime({ fetchImpl: f });
    const entry = mkEntry();
    let last;
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) last = await rt.pollOnce(entry);
    expect(last).toMatchObject({ stop: true, reason: "auth" });
    expect(store.calls.setActive).toContainEqual({ userId: "u1", pageId: "P1", active: false });
  });
  it("refreshDuePages: 403 / rate limit keep the page active; 190 sets it inactive", async () => {
    const due = { ...PAGE, token_expires_at: new Date(NOW).toISOString() };
    for (const [res, inactive] of [[mkRes(403, { error: { code: 10 } }), false], [mkRes(400, { error: { code: 4 } }), false], [mkRes(400, { error: { code: 190 } }), true]] as const) {
      const store = makeStore(due);
      const { rt } = runtime({ store, fetchImpl: vi.fn().mockResolvedValue(res) });
      await rt.refreshDuePages();
      expect(store.calls.setActive.length > 0).toBe(inactive);
    }
  });
});

// ── A2 ───────────────────────────────────────────────────────────────────────
describe("A2 idle limit asks whether the live is still on", () => {
  it("LIVE → keeps polling (comments fetched this tick), idle clock reset; asks again after the next quiet IDLE_STOP_MS", async () => {
    let now = NOW;
    const f = vi.fn().mockImplementation((u: string) => Promise.resolve(isStatusUrl(u) ? mkRes(200, { status: "LIVE" }) : mkRes(200, { data: [] })));
    const { rt } = runtime({ fetchImpl: f, now: () => now });
    const entry = mkEntry({ lastActivityMs: NOW - IDLE_STOP_MS });
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: false });
    expect(entry.lastActivityMs).toBe(NOW);
    expect(f.mock.calls.filter((c) => isCommentsUrl(String(c[0])))).toHaveLength(1);
    now = NOW + IDLE_STOP_MS - 1;
    await rt.pollOnce(entry);
    expect(f.mock.calls.filter((c) => isStatusUrl(String(c[0])))).toHaveLength(1); // not yet
    now = NOW + IDLE_STOP_MS;
    await rt.pollOnce(entry);
    expect(f.mock.calls.filter((c) => isStatusUrl(String(c[0])))).toHaveLength(2); // re-checked
  });
  it("any other status → stop(session_end)", async () => {
    for (const status of ["VOD", "LIVE_STOPPED", "PROCESSING"]) {
      const f = vi.fn().mockResolvedValue(mkRes(200, { status }));
      const { rt } = runtime({ fetchImpl: f });
      expect(await rt.pollOnce(mkEntry({ lastActivityMs: NOW - IDLE_STOP_MS }))).toMatchObject({ stop: true, reason: "session_end" });
    }
  });
  it("unreadable → keep polling, re-check only after 60 s; 3 unreadable in a row → stop(idle)", async () => {
    let now = NOW;
    const f = vi.fn().mockImplementation((u: string) => Promise.resolve(isStatusUrl(u) ? mkRes(500, {}) : mkRes(200, { data: [] })));
    const { rt } = runtime({ fetchImpl: f, now: () => now });
    const entry = mkEntry({ lastActivityMs: NOW - IDLE_STOP_MS });
    const statusCalls = () => f.mock.calls.filter((c) => isStatusUrl(String(c[0]))).length;
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: false });
    expect(statusCalls()).toBe(1);
    now = NOW + 30_000;
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: false });
    expect(statusCalls()).toBe(1); // 60 s not over
    now = NOW + IDLE_RECHECK_MS;
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: false });
    expect(statusCalls()).toBe(2);
    now = NOW + 2 * IDLE_RECHECK_MS;
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: true, reason: "idle" });
    expect(statusCalls()).toBe(MAX_IDLE_UNREADABLE);
  });
  it("a readable LIVE between unreadable checks resets the count", async () => {
    let now = NOW;
    const answers = [mkRes(500, {}), mkRes(500, {}), mkRes(200, { status: "LIVE" })];
    const f = vi.fn().mockImplementation((u: string) => Promise.resolve(isStatusUrl(u) ? answers.shift() || mkRes(500, {}) : mkRes(200, { data: [] })));
    const { rt } = runtime({ fetchImpl: f, now: () => now });
    const entry = mkEntry({ lastActivityMs: NOW - IDLE_STOP_MS });
    await rt.pollOnce(entry); now += IDLE_RECHECK_MS; await rt.pollOnce(entry); now += IDLE_RECHECK_MS;
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: false });
    expect(entry.idleUnreadable).toBe(0);
  });
  it("a feature-gated session still stops with feature_gate at the idle limit, without asking", async () => {
    const f = vi.fn();
    const { rt } = runtime({ fetchImpl: f });
    expect(await rt.pollOnce(mkEntry({ featureGated: true, lastActivityMs: NOW - IDLE_STOP_MS }))).toMatchObject({ stop: true, reason: "feature_gate" });
    expect(f).not.toHaveBeenCalled();
  });
});

// ── A3 ───────────────────────────────────────────────────────────────────────
describe("A3 fetchComments asks for 100 comments; nothing else changes", () => {
  it("limit=100 plus the existing params", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(200, { data: [] }));
    await fetchComments({ config: CONFIG, fetchImpl: f, liveVideoId: "LV1", pageToken: "T" });
    const qs = new URLSearchParams(String(f.mock.calls[0][0]).split("?")[1]);
    expect(COMMENTS_PAGE_LIMIT).toBe(100);
    expect(Object.fromEntries(qs)).toEqual({
      fields: "id,message,from{id,name,picture},created_time", filter: "stream", live_filter: "no_filter",
      order: "reverse_chronological", limit: "100", access_token: "T",
    });
  });
});

// ── A4 ───────────────────────────────────────────────────────────────────────
// A fetch that only settles when aborted (never answers on its own).
const hangingFetch = () => vi.fn((_u: string, init?: { signal?: AbortSignal }) => new Promise((_res, rej) => {
  init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
}));

describe("A4 every Graph GET has a 10 s timeout", () => {
  it("graphGet passes a signal and rejects after GRAPH_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    const f = hangingFetch();
    const p = graphGet({ fetchImpl: f, url: "https://graph.test/x" });
    const settled = expect(p).rejects.toThrow();
    expect(f.mock.calls[0][1]?.signal).toBeDefined();
    expect(GRAPH_TIMEOUT_MS).toBe(10_000);
    await vi.advanceTimersByTimeAsync(GRAPH_TIMEOUT_MS);
    await settled;
  });
  it("a slow body read after the timeout is a failure, not an empty answer", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => ({ status: 200, json: () => new Promise((r) => setTimeout(() => r({ data: [] }), GRAPH_TIMEOUT_MS + 5)) }));
    const p = graphGet({ fetchImpl: f, url: "https://graph.test/x" });
    const settled = expect(p).rejects.toThrow("graph_timeout");
    await vi.advanceTimersByTimeAsync(GRAPH_TIMEOUT_MS + 10);
    await settled;
  });
  it("helpers that never throw still never throw; the poller keeps looping", async () => {
    vi.useFakeTimers();
    const f = hangingFetch();
    const status = fetchLiveStatus({ config: CONFIG, fetchImpl: f, liveVideoId: "LV1", pageToken: "T" });
    const videos = fetchLiveVideos({ config: CONFIG, fetchImpl: f, pageId: "P1", pageToken: "T" });
    const { rt } = runtime({ fetchImpl: f });
    const poll = rt.pollOnce(mkEntry());
    await vi.advanceTimersByTimeAsync(GRAPH_TIMEOUT_MS);
    expect(await status).toBe("");
    expect(await videos).toEqual({ liveVideoId: "", failed: true, authFail: false });
    expect(await poll).toMatchObject({ stop: false });
  });
  it("the OAuth callback redirects with its existing error code (exception)", async () => {
    vi.useFakeTimers();
    const { rt } = runtime({ fetchImpl: hangingFetch() });
    const { signState } = await import("../../../../server/fbLive.js");
    const state = signState({ userId: "u1", key: CONFIG.appSecret, nowMs: NOW });
    const p = rt.handleCallback({ code: "c", state });
    await vi.advanceTimersByTimeAsync(GRAPH_TIMEOUT_MS);
    expect(await p).toEqual({ redirect: "https://app.test/?fb=error&code=exception" });
  });
});

// ── A5 ───────────────────────────────────────────────────────────────────────
function connectRoute(rt: ReturnType<typeof runtime>["rt"]) {
  const handlers: Record<string, ((req: unknown, res: unknown, next: () => void) => unknown)[]> = {};
  const rec = (m: string) => (p: string, ...h: never[]) => { handlers[`${m} ${p}`] = h; };
  rt.registerRoutes({ get: rec("GET"), post: rec("POST") } as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never);
  const call = async (path: string, body: unknown) => {
    const chain = handlers[path];
    let status = 200; let json: Record<string, unknown> = {};
    const res = { status(c: number) { status = c; return this; }, json(b: Record<string, unknown>) { json = b; return this; } };
    await chain[chain.length - 1]({ authUserId: "u1", sellerId: "seller1", body }, res, () => {});
    return { status, json };
  };
  return call;
}

describe("A5 POST /fb/connect answers", () => {
  it("invalid token on the live check (190 / 401) → 409 needs_reauth; page row untouched; no poller", async () => {
    for (const res of [mkRes(400, { error: { code: 190 } }), mkRes(401, {})]) {
      const { rt, store } = runtime({ fetchImpl: vi.fn().mockResolvedValue(res) });
      const out = await connectRoute(rt)("POST /fb/connect", { page_id: "P1" });
      expect(out).toEqual({ status: 409, json: { ok: false, error: "needs_reauth" } });
      expect(store.calls.setActive).toEqual([]);
      expect(rt._pollers.size).toBe(0);
    }
  });
  it("any other unanswered check → 502 fb_check_failed (Graph error, non-200, no data, throttled, network)", async () => {
    const answers = [mkRes(500, {}), mkRes(400, { error: { code: 100 } }), mkRes(200, {}), mkRes(403, { error: { code: 10 } }), mkRes(400, { error: { code: 4 } })];
    for (const a of answers) {
      const { rt } = runtime({ fetchImpl: vi.fn().mockResolvedValue(a) });
      expect(await connectRoute(rt)("POST /fb/connect", { page_id: "P1" })).toEqual({ status: 502, json: { ok: false, error: "fb_check_failed" } });
      expect(rt._pollers.size).toBe(0);
    }
    const { rt } = runtime({ fetchImpl: vi.fn().mockRejectedValue(new Error("net")) });
    expect(await connectRoute(rt)("POST /fb/connect", { page_id: "P1" })).toEqual({ status: 502, json: { ok: false, error: "fb_check_failed" } });
  });
  it("a clean answer with no LIVE video → not_live as today", async () => {
    const { rt } = runtime({ fetchImpl: vi.fn().mockResolvedValue(mkRes(200, { data: [{ id: "LVx", status: "VOD" }] })) });
    expect(await connectRoute(rt)("POST /fb/connect", { page_id: "P1" })).toEqual({ status: 200, json: { ok: false, reason: "not_live" } });
  });
  it("A7: a database error reading the page → 502 fb_check_failed, not page_not_found", async () => {
    const { rt } = runtime({ store: makeStore(PAGE, { throwGetPage: true }), fetchImpl: vi.fn() });
    expect(await connectRoute(rt)("POST /fb/connect", { page_id: "P1" })).toEqual({ status: 502, json: { ok: false, error: "fb_check_failed" } });
    const { rt: rt2 } = runtime({ store: makeStore(null), fetchImpl: vi.fn() });
    expect(await connectRoute(rt2)("POST /fb/connect", { page_id: "P1" })).toEqual({ status: 404, json: { ok: false, error: "page_not_found" } });
  });
  it("a missing body never throws: connect → 400, disconnect → ok", async () => {
    const { rt } = runtime();
    const call = connectRoute(rt);
    expect(await call("POST /fb/connect", undefined)).toEqual({ status: 400, json: { ok: false, error: "page_id required" } });
    expect(await call("POST /fb/disconnect", undefined)).toEqual({ status: 200, json: { ok: true, stopped: false } });
  });
});

// ── A6 ───────────────────────────────────────────────────────────────────────
describe("A6 status replay after a socket reconnect", () => {
  it("listPollers → only this seller's running pollers", () => {
    const { rt } = runtime();
    rt.startPoller({ sellerId: "seller1", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1", sessionId: "sA" });
    rt.startPoller({ sellerId: "seller1", userId: "u1", pageId: "P2", pageUsername: "", liveVideoId: "LV2", sessionId: "sB" });
    rt.startPoller({ sellerId: "seller2", userId: "u2", pageId: "P9", pageUsername: "x", liveVideoId: "LV9", sessionId: "sC" });
    expect(rt.listPollers("seller1")).toEqual([{ scopeKey: "mypage", sessionId: "sA", pageId: "P1" }, { scopeKey: "P2", sessionId: "sB", pageId: "P2" }]);
    rt.stopPoller("seller1:Facebook:P1", "disconnect");
    expect(rt.listPollers("seller1")).toEqual([{ scopeKey: "P2", sessionId: "sB", pageId: "P2" }]);
  });
  it("replayFbStatus emits one connected status per running poller, with the email id", () => {
    const { rt } = runtime();
    rt.startPoller({ sellerId: "seller1", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1", sessionId: "sA" });
    const emit = vi.fn();
    replayFbStatus(rt, "seller1", "me@example.com", emit);
    expect(emit.mock.calls).toEqual([[{ platform: "Facebook", connected: true, sellerId: "me@example.com", username: "mypage", sessionId: "sA" }]]);
  });
  it("null runtime / throwing runtime → no emit, never throws", () => {
    const emit = vi.fn();
    expect(() => replayFbStatus(null, "s", "e", emit)).not.toThrow();
    expect(() => replayFbStatus({ listPollers: () => { throw new Error("x"); } }, "s", "e", emit)).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
});

// ── A7 ───────────────────────────────────────────────────────────────────────
describe("A7 a poller stopped while the comments request was out emits nothing", () => {
  it("stopped after the fetch → no emit, comments not remembered", async () => {
    const entry = mkEntry();
    const f = vi.fn(async () => { entry.stopped = true; return mkRes(200, { data: [{ id: "c1", message: "mine", from: { id: "u", name: "M" } }] }); });
    const { rt, emitComment } = runtime({ fetchImpl: f });
    expect(await rt.pollOnce(entry)).toMatchObject({ stop: false, hadNew: false });
    expect(emitComment).not.toHaveBeenCalled();
    expect(entry.emitted.size).toBe(0);
  });
  it("a database error reading the page keeps the poller looping", async () => {
    const { rt } = runtime({ store: makeStore(PAGE, { throwGetPage: true }), fetchImpl: vi.fn() });
    expect(await rt.pollOnce(mkEntry())).toEqual({ hadNew: false, stop: false });
  });
});
