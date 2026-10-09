// /fb/connect live-check failures are now diagnosable: one log line with Facebook's own error
// fields (never the token or the request URL), fb_code / fb_http / fb_timeout in the 502 body,
// and " (FB <code>)" / " (FB timeout)" after the generic toast. Other texts are unchanged and the
// poller is untouched.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "JWT" } } }) } } }));
import { createFbRuntime, fetchLiveVideos, GRAPH_TIMEOUT_MS } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import { fbConnect, fbConnectFailText } from "../fb";
import { buildT } from "../../i18n";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const TOKEN = "EAAB-PAGE-TOKEN-SECRET";
const USER = "user-1234567890";
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const t = buildT("en");
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function connect(fetchImpl: unknown) {
  const logs: string[] = [];
  const page = { user_id: USER, page_id: "P1", page_username: "mypage", active: true, access_token: encryptToken(TOKEN, CONFIG.tokenKey) };
  const store = {
    async getPage() { return { ...page }; }, async getPlan() { return "pro"; }, async countPages() { return 1; }, async listPages() { return []; },
    async upsertPage() {}, async listActivePages() { return []; }, setActive: vi.fn(), async updateExpiry() {},
  };
  const setLoop = vi.fn(() => 1);
  const rt = createFbRuntime({ config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl, now: () => 1_000_000, log: (l: string) => logs.push(l), setLoop, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} });
  const handlers: Record<string, ((q: unknown, s: unknown, n: () => void) => unknown)[]> = {};
  const rec = (m: string) => (p: string, ...h: never[]) => { handlers[`${m} ${p}`] = h; };
  rt.registerRoutes({ get: rec("GET"), post: rec("POST") } as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never);
  const run = async () => {
    let status = 200; let json: Record<string, unknown> = {};
    const res = { status(c: number) { status = c; return this; }, json(b: Record<string, unknown>) { json = b; return this; } };
    const chain = handlers["POST /fb/connect"];
    await chain[chain.length - 1]({ authUserId: USER, sellerId: "s1", body: { page_id: "P1" } }, res, () => {});
    return { status, json };
  };
  return { run, logs, store, setLoop };
}
const fbError = (http: number, code: number, extra: Record<string, unknown> = {}) =>
  vi.fn(async () => mkRes(http, { error: { code, error_subcode: 33, type: "GraphMethodException", message: "Unsupported get request. Object with ID 'P1' does not exist", ...extra } }));

describe("server: the failed live check is logged and returned", () => {
  it("one log line with Facebook's fields; 502 body carries fb_code and fb_http", async () => {
    const c = connect(fbError(400, 100));
    expect(await c.run()).toEqual({ status: 502, json: { ok: false, error: "fb_check_failed", fb_code: 100, fb_http: 400, fb_timeout: false } });
    const lines = c.logs.filter((l) => l.startsWith("[FB] connect check failed"));
    expect(lines).toEqual([`[FB] connect check failed user=${USER.slice(0, 8)} page=P1 http=400 code=100 subcode=33 type=GraphMethodException timeout=false msg=Unsupported get request. Object with ID 'P1' does not exist`]);
  });
  it("the log line never contains the token or the request URL, even if Facebook echoes the token", async () => {
    const c = connect(fbError(400, 100, { message: `Bad token ${TOKEN} in https://graph.facebook.com/x?access_token=${TOKEN}` }));
    await c.run();
    const all = c.logs.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("[redacted]");
    expect(c.logs.find((l) => l.startsWith("[FB] connect check failed"))!.length).toBeLessThan(400);
  });
  it("the message is cut to 120 characters", async () => {
    const c = connect(fbError(500, 2, { message: "x".repeat(300) }));
    await c.run();
    expect(c.logs.find((l) => l.startsWith("[FB] connect check failed"))!.endsWith(`msg=${"x".repeat(120)}`)).toBe(true);
  });
  it("needs_reauth also logs the line; its 409 body is unchanged; the page row is untouched", async () => {
    const c = connect(fbError(401, 190, { type: "OAuthException", message: "Error validating access token" }));
    expect(await c.run()).toEqual({ status: 409, json: { ok: false, error: "needs_reauth" } });
    expect(c.logs).toContain(`[FB] connect check failed user=${USER.slice(0, 8)} page=P1 http=401 code=190 subcode=33 type=OAuthException timeout=false msg=Error validating access token`);
    expect(c.store.setActive).not.toHaveBeenCalled();
  });
  it("a timeout is reported as timeout=true / fb_timeout true, fb_code null", async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_u: string, init?: { signal?: AbortSignal }) => new Promise((_r, rej) => { init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))); }));
    const c = connect(hang);
    const p = c.run();
    await vi.advanceTimersByTimeAsync(GRAPH_TIMEOUT_MS);
    expect(await p).toEqual({ status: 502, json: { ok: false, error: "fb_check_failed", fb_code: null, fb_http: null, fb_timeout: true } });
    expect(c.logs.some((l) => l.includes("timeout=true"))).toBe(true);
  });
  it("success and not_live write no failure line and keep their bodies", async () => {
    const live = connect(vi.fn(async () => mkRes(200, { data: [{ id: "LV1", status: "LIVE" }] })));
    expect(await live.run()).toEqual({ status: 200, json: { ok: true, live_video_id: "LV1" } });
    const notLive = connect(vi.fn(async () => mkRes(200, { data: [{ id: "LV1", status: "VOD" }] })));
    expect(await notLive.run()).toEqual({ status: 200, json: { ok: false, reason: "not_live" } });
    expect([...live.logs, ...notLive.logs].some((l) => l.startsWith("[FB] connect check failed"))).toBe(false);
  });
  it("fetchLiveVideos detail never holds the token or a URL", async () => {
    const r = await fetchLiveVideos({ config: CONFIG, fetchImpl: fbError(400, 100), pageId: "P1", pageToken: TOKEN });
    expect(r.detail).toEqual({ httpStatus: 400, code: 100, subcode: 33, type: "GraphMethodException", timedOut: false, message: "Unsupported get request. Object with ID 'P1' does not exist" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain("graph.facebook.com");
  });
});

describe("client: fb_code reaches the toast; other texts unchanged", () => {
  const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  it("fbConnect keeps fb_code / fb_timeout from a 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(502, { ok: false, error: "fb_check_failed", fb_code: 100, fb_http: 400, fb_timeout: false })));
    expect(await fbConnect("P1")).toEqual({ ok: false, error: "fb_check_failed", fbCode: 100 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(502, { ok: false, error: "fb_check_failed", fb_code: null, fb_http: null, fb_timeout: true })));
    expect(await fbConnect("P1")).toEqual({ ok: false, error: "fb_check_failed", fbTimeout: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(502, { ok: false, error: "fb_check_failed" })));
    expect(await fbConnect("P1")).toEqual({ ok: false, error: "fb_check_failed" }); // an older server
  });
  it("Build 10b: a Facebook code or timeout shows 'reconnect your Page' — never '(FB <code>)'", () => {
    expect(fbConnectFailText({ ok: false, error: "fb_check_failed", fbCode: 100 }, t)).toBe(t.rd_cm_reconnect_page);
    expect(fbConnectFailText({ ok: false, error: "fb_check_failed", fbTimeout: true }, t)).toBe(t.rd_cm_reconnect_page);
    expect(fbConnectFailText({ ok: false, error: "fb_check_failed" }, t)).toBe(t.rd_cm_conn_failed);
  });
  it("not_live, needs_reauth, too_many_requests and unreachable texts are unchanged", () => {
    expect(fbConnectFailText({ ok: false, reason: "not_live", fbCode: 100 }, t)).toBe(t.rd_fb_not_live);
    expect(fbConnectFailText({ ok: false, error: "needs_reauth", fbCode: 190 }, t)).toBe(t.rd_fb_reauth_toast);
    expect(fbConnectFailText({ ok: false, error: "too_many_requests" }, t)).toBe(t.rd_fb_too_many);
    expect(fbConnectFailText({ ok: false, unreachable: true, error: "x" }, t)).toBe(t.rd_cm_cant_reach);
  });
});

describe("the poller is untouched", () => {
  it("a connect failure starts no poller and the poll loop never schedules", async () => {
    const c = connect(fbError(400, 100));
    await c.run();
    expect(c.setLoop).not.toHaveBeenCalled();
  });
});
