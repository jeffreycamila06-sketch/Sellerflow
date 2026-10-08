// @vitest-environment node
// Build 1 — "Facebook connect safety", server half. Pins:
//   • POST /fb/live-check answers exactly like /fb/connect's pre-poller section (not_live / ok /
//     409 needs_reauth / 502 fb_check_failed + fb_code / 404 for a page that is not the caller's)
//     and NEVER starts a poller or runs the account admission check;
//   • its chain = requireAuth → requireFbAvailable → requireConnectRate (no plan reads);
//   • /fb/connect still starts the poller with the same answers (shared helper);
//   • POST /disconnect/tiktok (server.js, no harness → source contract): requireAuth first, the
//     key comes from req.sellerId only, the existing manual teardown, ONE terminal gray,
//     stopped:false when nothing runs.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbRuntime } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;
const enc = () => encryptToken("PAGETOK", CONFIG.tokenKey);
type Handler = (req: unknown, res: unknown, next: () => void) => unknown;

function setup(fetchImpl: ReturnType<typeof vi.fn>, rows: Record<string, unknown>[] = [{ user_id: "u1", page_id: "P1", page_username: "mypage", active: true, access_token: enc() }]) {
  const store = {
    async getPage(userId: string, pageId: string) { return rows.find((r) => r.user_id === userId && r.page_id === pageId) || null; },
    async listActivePages() { return []; },
  };
  const setLoop = vi.fn(() => 1);
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl, now: () => 1_000_000, log: () => {}, setLoop, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  const handlers: Record<string, Handler[]> = {};
  const rec = (m: string) => (p: string, ...h: Handler[]) => { handlers[`${m} ${p}`] = h; };
  const marks = { auth: vi.fn(), lock: vi.fn(), rate: vi.fn(), plan: vi.fn(), fbPlan: vi.fn(), admission: vi.fn(async () => ({ allow: true })) };
  const mw = (f: () => unknown): Handler => (_q, _s, next) => { f(); next(); };
  rt.registerRoutes({ get: rec("GET"), post: rec("POST") } as never, mw(marks.auth) as never, {
    requireFbAvailable: mw(marks.lock), requireConnectRate: mw(marks.rate), requirePlanActive: mw(marks.plan), requireFbPlan: mw(marks.fbPlan), accountLiveCheck: marks.admission,
  } as never);
  async function call(route: string, body: Record<string, unknown>, authUserId = "u1") {
    const chain = handlers[route];
    let status = 200; let json: Record<string, unknown> = {};
    const res = { status(n: number) { status = n; return this; }, json(b: Record<string, unknown>) { json = b; return this; } };
    for (let i = 0; i < chain.length - 1; i++) await chain[i]({}, res, () => {});
    await chain[chain.length - 1]({ authUserId, sellerId: "s", body }, res, () => {});
    return { status, json };
  }
  return { rt, call, marks, handlers, setLoop };
}
const liveOk = () => vi.fn().mockResolvedValue(mkRes(200, { data: [{ id: "LV42", status: "LIVE" }] }));

describe("POST /fb/live-check", () => {
  it("LIVE → ok + live_video_id; no poller, no loop, no admission check", async () => {
    const t = setup(liveOk());
    expect(await t.call("POST /fb/live-check", { page_id: "P1" })).toEqual({ status: 200, json: { ok: true, live_video_id: "LV42" } });
    expect(t.rt._pollers.size).toBe(0);
    expect(t.setLoop).not.toHaveBeenCalled();
    expect(t.marks.admission).not.toHaveBeenCalled();
  });
  it("no LIVE video → { ok:false, reason:not_live }", async () => {
    const t = setup(vi.fn().mockResolvedValue(mkRes(200, { data: [{ id: "LVx", status: "VOD" }] })));
    expect(await t.call("POST /fb/live-check", { page_id: "P1" })).toEqual({ status: 200, json: { ok: false, reason: "not_live" } });
    expect(t.rt._pollers.size).toBe(0);
  });
  it("token Facebook refuses → 409 needs_reauth; Graph failure → 502 with fb_code", async () => {
    const t = setup(vi.fn().mockResolvedValue(mkRes(400, { error: { code: 190, message: "x" } })));
    expect(await t.call("POST /fb/live-check", { page_id: "P1" })).toEqual({ status: 409, json: { ok: false, error: "needs_reauth" } });
    const u = setup(vi.fn().mockResolvedValue(mkRes(500, { error: { code: 2, message: "x" } })));
    const r = await u.call("POST /fb/live-check", { page_id: "P1" });
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ ok: false, error: "fb_check_failed", fb_code: 2 });
  });
  it("undecryptable token → 409; another seller's page / inactive / missing → 404; no page_id → 400", async () => {
    const bad = setup(liveOk(), [{ user_id: "u1", page_id: "P1", active: true, access_token: "garbage" }]);
    expect((await bad.call("POST /fb/live-check", { page_id: "P1" })).status).toBe(409);
    const t = setup(liveOk(), [{ user_id: "other", page_id: "P1", active: true, access_token: enc() }, { user_id: "u1", page_id: "P2", active: false, access_token: enc() }]);
    expect((await t.call("POST /fb/live-check", { page_id: "P1" })).status).toBe(404);
    expect((await t.call("POST /fb/live-check", { page_id: "P2" })).status).toBe(404);
    expect((await t.call("POST /fb/live-check", {})).status).toBe(400);
  });
  it("chain = auth → Facebook lock → connect rate limit → handler (no plan reads)", async () => {
    const t = setup(liveOk());
    expect(t.handlers["POST /fb/live-check"]).toHaveLength(4);
    await t.call("POST /fb/live-check", { page_id: "P1" });
    expect(t.marks.auth).toHaveBeenCalledTimes(1);
    expect(t.marks.lock).toHaveBeenCalledTimes(1);
    expect(t.marks.rate).toHaveBeenCalledTimes(1);
    expect(t.marks.plan).not.toHaveBeenCalled();
    expect(t.marks.fbPlan).not.toHaveBeenCalled();
  });
  it("/fb/connect (shared helper) still starts the poller and gives the same answers", async () => {
    const t = setup(liveOk());
    expect(await t.call("POST /fb/connect", { page_id: "P1", sessionId: "S" })).toEqual({ status: 200, json: { ok: true, live_video_id: "LV42" } });
    expect(t.rt._pollers.size).toBe(1);
    const n = setup(vi.fn().mockResolvedValue(mkRes(200, { data: [] })));
    expect(await n.call("POST /fb/connect", { page_id: "P1" })).toEqual({ status: 200, json: { ok: false, reason: "not_live" } });
    expect(n.rt._pollers.size).toBe(0);
  });
});

describe("POST /disconnect/tiktok (server.js source contract)", () => {
  const src = readFileSync("server.js", "utf8");
  const route = src.slice(src.indexOf('app.post("/disconnect/tiktok"'), src.indexOf('app.post("/connect/tiktok"'));
  it("auth first; key from req.sellerId only (never a body sellerId)", () => {
    expect(route).toMatch(/^app\.post\("\/disconnect\/tiktok", requireAuth, async \(req, res\) => \{/);
    expect(route).toContain('const key = liveKey(req.sellerId, "TikTok", (req.body || {}).username);');
    expect(route).not.toMatch(/body[^\n]*sellerId/);
  });
  it("existing manual teardown, then ONE terminal gray; nothing running → stopped:false", () => {
    expect(route).toContain("await disconnectTikTokConnection(key, { manual: true });");
    expect(route.match(/emitTikTokStatus\(/g)).toHaveLength(1);
    expect(route).toContain("connected: false, reconnecting: false, reason: \"disconnect\"");
    expect(route.indexOf("await disconnectTikTokConnection")).toBeLessThan(route.indexOf("emitTikTokStatus("));
    expect(route).toContain("return res.json({ ok: true, stopped: false });");
    expect(route).toContain("return res.json({ ok: true, stopped: true });");
  });
  it("touches no comment / health / connect internals", () => {
    for (const s of ["startTikTokConnection", "emitCommentScoped", "TikTokHealth", "tiktokConnections.set"]) expect(route).not.toContain(s);
  });
});
