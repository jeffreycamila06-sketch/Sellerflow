// Facebook video path (server/fbLive.js). When /{page}/live_videos is refused with code 10 (the
// seller is not an admin / developer / tester of our Meta app), /fb/connect finds the LIVE
// broadcast in /{page}/videos and polls /{video}/comments; the live status comes from
// /{video}?fields=live_status. Pins: connect answers (ok / not_live / 502 with the lookup's code /
// 409 on an invalid token), the poller's video mode (same comments request + payload, same
// rate-limit / auth / idle rules, VOD ends the session), a seller whose live_videos works never
// calls /videos, the alt probe is no longer started, and no log line holds the token or a URL.
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  createFbRuntime, fetchLiveVideoFromVideos, fetchVideoLiveStatus,
  IDLE_STOP_MS, MAX_IDLE_UNREADABLE, MAX_AUTH_FAILURES, POLL_RATE_LIMIT_MS, COMMENTS_PAGE_LIMIT, VIDEO_LOOKUP_LIMIT,
} from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-10-06T12:00:00Z");
const TOKEN = "PAGETOK-SECRET-123";
const USER = "user-1234567890";
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;
const PAGE = { user_id: USER, page_id: "P1", page_username: "mypage", active: true, access_token: encryptToken(TOKEN, CONFIG.tokenKey) };
const ago = (s: number) => new Date(NOW - s * 1000).toISOString().replace(".000Z", "+0000");
const CODE10 = mkRes(400, { error: { code: 10, type: "OAuthException", message: "(#10) To use 'live-video-api' on behalf of people who are not admins, developers and testers of your app" } });
const COMMENTS = { data: [
  { id: "c2", created_time: ago(5), from: { id: "B2", name: "Ana", picture: { data: { url: "https://pic/2" } } }, message: "mine 2" },
  { id: "c1", created_time: ago(12), from: { id: "B1", name: "Juan", picture: { data: { url: "https://pic/1" } } }, message: "mine" },
] };
const VIDEOS = mkRes(200, { data: [
  { id: "V7", created_time: ago(3600), live_status: "LIVE" },   // older LIVE (stale) — not picked
  { id: "V8", created_time: ago(1800), live_status: "VOD" },
  { id: "V9", created_time: ago(34), live_status: "LIVE" },     // newest LIVE
] });

type Over = { live?: unknown; videos?: unknown; vstatus?: unknown; lvstatus?: unknown; comments?: unknown };
function graph(over: Over = {}) {
  return vi.fn(async (url: string) => {
    const u = new URL(url); const path = u.pathname.replace(/^\/v[\d.]+/, "");
    if (path === "/P1/live_videos") return (over.live as never) ?? CODE10;
    if (path === "/P1/videos") return (over.videos as never) ?? VIDEOS;
    if (path.endsWith("/comments")) return (over.comments as never) ?? mkRes(200, COMMENTS);
    if (path === "/V9") return (over.vstatus as never) ?? mkRes(200, { id: "V9", live_status: "LIVE" });
    if (path === "/LV1") return (over.lvstatus as never) ?? mkRes(200, { id: "LV1", status: "LIVE" });
    return mkRes(404, {});
  });
}
const paths = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => new URL(String(c[0])).pathname.replace(/^\/v[\d.]+/, ""));
const params = (f: ReturnType<typeof vi.fn>, path: string) => {
  const c = f.mock.calls.find((x) => new URL(String(x[0])).pathname.endsWith(path));
  return c ? Object.fromEntries(new URL(String(c[0])).searchParams) : null;
};

function setup(f: ReturnType<typeof vi.fn>, o: { now?: () => number } = {}) {
  const logs: string[] = [];
  const calls = { setActive: [] as unknown[] };
  const store = {
    async getPlan() { return "pro"; }, async countPages() { return 1; },
    async getPage(userId: string, pageId: string) { return userId === USER && pageId === "P1" ? { ...PAGE } : null; },
    async listPages() { return [PAGE]; }, async upsertPage() {}, async listActivePages() { return []; },
    async setActive(userId: string, pageId: string, active: boolean) { calls.setActive.push({ userId, pageId, active }); },
    async updateExpiry() {},
    insertProbeRow: vi.fn(),
  };
  const emitComment = vi.fn();
  const statusEmit = vi.fn();
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment, statusEmit, liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl: f, now: o.now || (() => NOW), log: (l: string) => logs.push(l),
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  const handlers: Record<string, ((q: unknown, s: unknown, n: () => void) => unknown)[]> = {};
  const rec = (m: string) => (p: string, ...h: never[]) => { handlers[`${m} ${p}`] = h; };
  rt.registerRoutes({ get: rec("GET"), post: rec("POST") } as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never);
  const call = async (path: string, body: unknown) => {
    let status = 200; let json: Record<string, unknown> = {};
    const res = { status(c: number) { status = c; return this; }, json(b: Record<string, unknown>) { json = b; return this; } };
    const chain = handlers[path];
    await chain[chain.length - 1]({ authUserId: USER, sellerId: "seller1", body }, res, () => {});
    return { status, json };
  };
  const connect = () => call("POST /fb/connect", { page_id: "P1", sessionId: "sess-A" });
  const entry = () => rt._pollers.get("seller1:Facebook:P1") as Record<string, unknown> & { lastActivityMs: number };
  return { rt, logs, calls, store, emitComment, statusEmit, connect, call, entry };
}
const noSecrets = (logs: string[]) => {
  const all = logs.join("\n");
  for (const bad of [TOKEN, "access_token", "https://", "graph.facebook.com"]) expect(all, bad).not.toContain(bad);
};

describe("/fb/connect — code 10 → video path", () => {
  it("a LIVE video → ok:true with the video id, poller in video mode, one 'video path' log line", async () => {
    const f = graph();
    const s = setup(f);
    expect(await s.connect()).toEqual({ status: 200, json: { ok: true, live_video_id: "V9" } });
    expect(s.entry()).toMatchObject({ videoMode: true, liveVideoId: "V9", scopeKey: "mypage", sessionId: "sess-A" });
    expect(params(f, "/P1/videos")).toMatchObject({ fields: "id,created_time,live_status", limit: String(VIDEO_LOOKUP_LIMIT) });
    expect(s.logs.filter((l) => l.startsWith("[FB] video path"))).toEqual([`[FB] video path user=${USER.slice(0, 8)} page=P1 video=V9`]);
    expect(s.statusEmit).toHaveBeenCalledWith("seller1", { connected: true, pageId: "P1", liveVideoId: "V9", scopeKey: "mypage", sessionId: "sess-A" });
    noSecrets(s.logs);
  });

  it("no LIVE video → not_live (same body as today), no poller", async () => {
    for (const videos of [mkRes(200, { data: [{ id: "V8", created_time: ago(60), live_status: "VOD" }] }), mkRes(200, { data: [] })]) {
      const s = setup(graph({ videos }));
      expect(await s.connect()).toEqual({ status: 200, json: { ok: false, reason: "not_live" } });
      expect(s.rt._pollers.size).toBe(0);
    }
  });

  it("the videos lookup failing → today's 502 fb_check_failed with the lookup's code + the existing log line", async () => {
    const s = setup(graph({ videos: mkRes(400, { error: { code: 100, error_subcode: 33, type: "GraphMethodException", message: `bad ${TOKEN}` } }) }));
    expect(await s.connect()).toEqual({ status: 502, json: { ok: false, error: "fb_check_failed", fb_code: 100, fb_http: 400, fb_timeout: false } });
    expect(s.rt._pollers.size).toBe(0);
    expect(s.logs).toContain(`[FB] connect check failed user=${USER.slice(0, 8)} page=P1 http=400 code=100 subcode=33 type=GraphMethodException timeout=false msg=bad [redacted]`);
    noSecrets(s.logs);
    for (const videos of [mkRes(500, {}), mkRes(200, {})]) {
      const s2 = setup(graph({ videos }));
      expect(await s2.connect()).toMatchObject({ status: 502, json: { ok: false, error: "fb_check_failed" } });
    }
    const s3 = setup(vi.fn(async (url: string) => (String(url).includes("/live_videos") ? CODE10 : Promise.reject(new Error("net")))));
    expect(await s3.connect()).toMatchObject({ status: 502, json: { ok: false, error: "fb_check_failed", fb_code: null } });
  });

  it("the videos lookup saying the token is invalid → 409 needs_reauth (today's rule), page row untouched", async () => {
    const s = setup(graph({ videos: mkRes(400, { error: { code: 190 } }) }));
    expect(await s.connect()).toEqual({ status: 409, json: { ok: false, error: "needs_reauth" } });
    expect(s.calls.setActive).toEqual([]);
  });

  it("no longer starts the alt probe (no /posts, no probe rows, no probe log)", async () => {
    for (const videos of [VIDEOS, mkRes(500, {})]) {
      const f = graph({ videos });
      const s = setup(f);
      await s.connect();
      await new Promise((r) => setTimeout(r, 20));
      expect(paths(f).some((p) => p.includes("/posts") || p === "/P1")).toBe(false);
      expect(s.store.insertProbeRow).not.toHaveBeenCalled();
      expect(s.logs.some((l) => l.includes("alt probe"))).toBe(false);
    }
  });
});

describe("a seller whose live_videos works keeps today's path", () => {
  it("LIVE / not LIVE / other failures never call /videos; poller not in video mode; no video-path log", async () => {
    const f = graph({ live: mkRes(200, { data: [{ id: "LV1", status: "LIVE", broadcast_start_time: ago(60) }] }) });
    const s = setup(f);
    expect(await s.connect()).toEqual({ status: 200, json: { ok: true, live_video_id: "LV1" } });
    expect(s.entry()).toMatchObject({ videoMode: false, liveVideoId: "LV1" });
    await s.rt.pollOnce(s.entry() as never);
    expect(paths(f)).toEqual(["/P1/live_videos", "/LV1/comments"]);
    expect(s.logs.some((l) => l.includes("video path"))).toBe(false);
    for (const live of [mkRes(200, { data: [{ id: "LV1", status: "VOD" }] }), mkRes(400, { error: { code: 100 } }), mkRes(500, {}), mkRes(400, { error: { code: 4 } })]) {
      const f2 = graph({ live });
      await setup(f2).connect();
      expect(paths(f2)).toEqual(["/P1/live_videos"]);
    }
  });
});

describe("poller — video mode", () => {
  async function started(over: Over = {}, o: { now?: () => number } = {}) {
    const f = graph(over);
    const s = setup(f, o);
    await s.connect();
    return { f, s, e: s.entry() };
  }

  it("comments come from /{video}/comments with the same request and the same payload shape as today", async () => {
    // Video path.
    const v = await started();
    await v.s.rt.pollOnce(v.e as never);
    // Today's path, same comments.
    const l = setup(graph({ live: mkRes(200, { data: [{ id: "LV1", status: "LIVE", broadcast_start_time: ago(60) }] }) }));
    await l.connect();
    await l.rt.pollOnce(l.entry() as never);
    const vp = params(v.f, "/V9/comments")!;
    expect(vp).toMatchObject({ filter: "stream", order: "reverse_chronological", live_filter: "no_filter", limit: String(COMMENTS_PAGE_LIMIT) });
    expect(vp.fields.split(",").sort()).toEqual(["created_time", "from{id", "id", "message", "name", "picture}"].sort());
    expect(v.s.emitComment).toHaveBeenCalledTimes(2);
    const norm = (calls: unknown[][]) => JSON.parse(JSON.stringify(calls).split("V9").join("LIVEID").split("LV1").join("LIVEID"));
    expect(norm(v.s.emitComment.mock.calls)).toEqual(norm(l.emitComment.mock.calls));
    const [seller, scope, payload] = v.s.emitComment.mock.calls[0] as [string, string, Record<string, unknown>];
    expect([seller, scope]).toEqual(["seller1", "mypage"]);
    expect(JSON.stringify(payload)).toContain("B1"); // commenter id carried in the payload as today
    // Dedup by comment id: the same comments again → nothing new.
    await v.s.rt.pollOnce(v.e as never);
    expect(v.s.emitComment).toHaveBeenCalledTimes(2);
  });

  it("idle check asks /{video}?fields=live_status: LIVE keeps polling, VOD ends the session", async () => {
    let t = NOW;
    const v = await started({}, { now: () => t });
    t = NOW + IDLE_STOP_MS;
    expect(await v.s.rt.pollOnce(v.e as never)).toMatchObject({ stop: false });
    expect(params(v.f, "/V9")).toMatchObject({ fields: "live_status" });
    expect(paths(v.f)).not.toContain("/LV1");
    t = NOW;
    const ended = await started({ vstatus: mkRes(200, { id: "V9", live_status: "VOD" }) }, { now: () => t });
    t = NOW + IDLE_STOP_MS;
    expect(await ended.s.rt.pollOnce(ended.e as never)).toEqual({ hadNew: false, stop: true, reason: "session_end" });
  });

  it("unreadable live_status follows today's rule: keep polling, stop(idle) after MAX_IDLE_UNREADABLE in a row", async () => {
    let t = NOW;
    const v = await started({ vstatus: mkRes(500, {}), comments: mkRes(200, { data: [] }) }, { now: () => t }); // quiet room
    let last: unknown;
    for (let i = 0; i < MAX_IDLE_UNREADABLE; i++) {
      t = NOW + IDLE_STOP_MS + i * 61_000;
      last = await v.s.rt.pollOnce(v.e as never);
    }
    expect(last).toEqual({ hadNew: false, stop: true, reason: "idle" });
  });

  it("rate limit waits POLL_RATE_LIMIT_MS (logged once); invalid token ×MAX → stop(auth) + page inactive", async () => {
    const rl = await started({ comments: mkRes(400, { error: { code: 4 } }) });
    expect(await rl.s.rt.pollOnce(rl.e as never)).toMatchObject({ stop: false, delayMs: POLL_RATE_LIMIT_MS });
    await rl.s.rt.pollOnce(rl.e as never);
    expect(rl.s.logs.filter((l) => l.includes("rate-limited"))).toHaveLength(1);
    const au = await started({ comments: mkRes(400, { error: { code: 190 } }) });
    let last: unknown;
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) last = await au.s.rt.pollOnce(au.e as never);
    expect(last).toMatchObject({ stop: true, reason: "auth" });
    expect(au.s.calls.setActive).toContainEqual({ userId: USER, pageId: "P1", active: false });
    noSecrets([...rl.s.logs, ...au.s.logs]);
  });

  it("repeated comment errors confirm against live_status (VOD → session_end)", async () => {
    const v = await started({ comments: mkRes(400, { error: { code: 100 } }), vstatus: mkRes(200, { live_status: "VOD" }) });
    let last: unknown;
    for (let i = 0; i < 3; i++) last = await v.s.rt.pollOnce(v.e as never);
    expect(last).toMatchObject({ stop: true, reason: "session_end" });
    expect(params(v.f, "/V9")).toMatchObject({ fields: "live_status" });
  });

  it("status replay and disconnect work the same", async () => {
    const v = await started();
    expect(v.s.rt.listPollers("seller1")).toEqual([{ scopeKey: "mypage", sessionId: "sess-A", pageId: "P1" }]);
    expect(await v.s.call("POST /fb/disconnect", { page_id: "P1" })).toEqual({ status: 200, json: { ok: true, stopped: true } });
    expect(v.s.rt._pollers.size).toBe(0);
  });
});

describe("helpers", () => {
  it("fetchLiveVideoFromVideos picks the newest LIVE; fetchVideoLiveStatus uppercases or returns '' when unreadable", async () => {
    expect(await fetchLiveVideoFromVideos({ fetchImpl: graph(), pageId: "P1", pageToken: TOKEN })).toEqual({ liveVideoId: "V9", failed: false, authFail: false });
    expect(await fetchVideoLiveStatus({ fetchImpl: graph({ vstatus: mkRes(200, { live_status: "live" }) }), videoId: "V9", pageToken: TOKEN })).toBe("LIVE");
    expect(await fetchVideoLiveStatus({ fetchImpl: graph({ vstatus: mkRes(400, { error: { code: 100 } }) }), videoId: "V9", pageToken: TOKEN })).toBe("");
    expect(await fetchVideoLiveStatus({ fetchImpl: vi.fn().mockRejectedValue(new Error("x")), videoId: "V9", pageToken: TOKEN })).toBe("");
  });
});
