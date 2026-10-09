// Facebook server lock (server/fbAccess.js) + the OAuth callback's save accounting
// (server/fbLive.js handleCallback). FAKE data only — Graph, Supabase and Express are fakes.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbFlagReader, createFbLock, fbPreviewEmail, FB_PREVIEW_EMAILS, FB_FLAG_TTL_MS } from "../../../../server/fbAccess.js";
import { createFbRuntime, signState } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import { seedEmails } from "./featureSeed";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (s: string, p: string, page: string) => `${s}:${p}:${page}`;

function makeStore(opts: { plan?: string; seed?: Record<string, unknown>[]; failPages?: string[] } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of opts.seed ?? []) rows.set(`${r.user_id}:${r.page_id}`, { ...r });
  return {
    rows,
    upserts: [] as Record<string, unknown>[],
    async getPlan() { return opts.plan ?? "pro"; },
    async countPages(uid: string) { return [...rows.values()].filter((r) => r.user_id === uid).length; },
    async getPage(uid: string, pid: string) { return rows.get(`${uid}:${pid}`) || null; },
    async listPages(uid: string) { return [...rows.values()].filter((r) => r.user_id === uid); },
    async upsertPage(row: Record<string, unknown>) {
      if ((opts.failPages ?? []).includes(String(row.page_id))) throw new Error("fb_page_save_failed");
      this.upserts.push(row); rows.set(`${row.user_id}:${row.page_id}`, { ...row });
    },
    async listActivePages() { return []; },
    async setActive() {}, async updateExpiry() {},
  };
}
function runtime(store: ReturnType<typeof makeStore>, fetchImpl: ReturnType<typeof vi.fn> = vi.fn(), log: (l: string) => void = () => {}) {
  return createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey,
    renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl, now: () => 1_000_000, log,
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
}

// ── OAuth callback: a failed save is never reported as success ─────────────────
describe("handleCallback — save accounting", () => {
  const chain = (pages: { id: string; name: string; access_token: string }[]) => vi.fn()
    .mockResolvedValueOnce(mkRes(200, { access_token: "SHORT" }))
    .mockResolvedValueOnce(mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 }))
    .mockResolvedValueOnce(mkRes(200, { data: pages }))
    .mockResolvedValueOnce(mkRes(200, { data: [] }));                 // /me/permissions
  const state = () => signState({ userId: "user-1", key: CONFIG.appSecret, nowMs: 1_000_000 });

  it("the only page fails to save → ?fb=error&code=save_failed, nothing counted as saved", async () => {
    const store = makeStore({ failPages: ["P1"] });
    const logs: string[] = [];
    const rt = runtime(store, chain([{ id: "P1", name: "One", access_token: "TOK1" }]), (l) => logs.push(l));
    const out = await rt.handleCallback({ code: "C", state: state() });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=save_failed");
    expect(store.upserts).toHaveLength(0);
    expect(logs).toEqual(["[FB] callback save_failed user=user-1 failed=1"]);
  });

  it("one of two pages fails → ?fb=connected with ONE saved; the log has counts only (no token)", async () => {
    const store = makeStore({ failPages: ["P2"] });
    const logs: string[] = [];
    const rt = runtime(store, chain([{ id: "P1", name: "One", access_token: "TOK1" }, { id: "P2", name: "Two", access_token: "TOK2" }]), (l) => logs.push(l));
    const out = await rt.handleCallback({ code: "C", state: state() });
    expect(out.redirect).toBe("https://app.test/?fb=connected");
    expect(store.upserts.map((r) => r.page_id)).toEqual(["P1"]);
    expect(logs).toEqual(["[FB] callback ok user=user-1 pages=1 capped=0 failed=1"]);
    expect(logs.join("")).not.toMatch(/TOK|LONGUSER|SHORT/);
  });

  it("a failed save does not use the plan cap: basic (cap 1) — first NEW page fails, the second still saves", async () => {
    const store = makeStore({ plan: "basic", failPages: ["P1"] });
    const rt = runtime(store, chain([{ id: "P1", name: "One", access_token: "TOK1" }, { id: "P2", name: "Two", access_token: "TOK2" }]));
    const out = await rt.handleCallback({ code: "C", state: state() });
    expect(out.redirect).toBe("https://app.test/?fb=connected");
    expect(store.upserts.map((r) => r.page_id)).toEqual(["P2"]);
  });

  it("existing outcomes unchanged: cap with no failures → code=cap", async () => {
    const store = makeStore({ plan: "basic", seed: [{ user_id: "user-1", page_id: "OLD", active: true }] });
    const out = await runtime(store, chain([{ id: "NEW", name: "N", access_token: "T" }])).handleCallback({ code: "C", state: state() });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=cap");
  });

  it("server.js upsertPage throws when Supabase returns an error", () => {
    const src = readFileSync("server.js", "utf8");
    const fn = src.slice(src.indexOf("async upsertPage(row)"), src.indexOf("async listActivePages()"));
    expect(fn).toContain("const { error } = await serviceSb.from(\"fb_pages\").upsert(");
    expect(fn).toContain('if (error) throw new Error(/account_limit/.test(String(error.message || "")) ? "account_limit" : "fb_page_save_failed");');
  });
});

// ── fb_enabled reader: 60 s cache, last good value on error ────────────────────
describe("createFbFlagReader", () => {
  it("caches a successful read for 60 s, then reads again", async () => {
    let t = 0;
    const readFlag = vi.fn(async () => "true");
    const fbEnabled = createFbFlagReader({ readFlag, now: () => t });
    expect(await fbEnabled()).toBe(true);
    t = FB_FLAG_TTL_MS - 1;
    expect(await fbEnabled()).toBe(true);
    expect(readFlag).toHaveBeenCalledTimes(1);
    t = FB_FLAG_TTL_MS;
    readFlag.mockResolvedValueOnce("false");
    expect(await fbEnabled()).toBe(false);
    expect(readFlag).toHaveBeenCalledTimes(2);
  });
  it("read error with a previous good value → that value; without one → false", async () => {
    let t = 0;
    const readFlag = vi.fn().mockResolvedValueOnce("true").mockRejectedValueOnce(new Error("db"));
    const withPrev = createFbFlagReader({ readFlag, now: () => t });
    expect(await withPrev()).toBe(true);
    t = FB_FLAG_TTL_MS;
    expect(await withPrev()).toBe(true);                    // error → last good value (true)
    const noPrev = createFbFlagReader({ readFlag: vi.fn(async () => { throw new Error("db"); }), now: () => 0 });
    expect(await noPrev()).toBe(false);
  });
  it("only the literal 'true' opens it; a missing row is false; concurrent callers share one read", async () => {
    for (const v of [null, undefined, "TRUE ", "yes", "1", false]) {
      expect(await createFbFlagReader({ readFlag: async () => v, now: () => 0 })(), String(v)).toBe(String(v ?? "").trim() === "true");
    }
    const readFlag = vi.fn(async () => "true");
    const fbEnabled = createFbFlagReader({ readFlag, now: () => 0 });
    await Promise.all([fbEnabled(), fbEnabled(), fbEnabled()]);
    expect(readFlag).toHaveBeenCalledTimes(1);
  });
});

// ── The lock on the real routes ────────────────────────────────────────────────
describe("server-side Facebook lock on /fb/* routes", () => {
  const PAGE = { user_id: "user-1", page_id: "P1", page_name: "Mine", page_username: "mine", active: true, access_token: encryptToken("PAGETOK", "tk") };
  function app(flag: string | null) {
    const store = makeStore({ seed: [PAGE] });
    const graph = vi.fn(async () => mkRes(200, { data: [{ id: "LV1", status: "LIVE" }] }));
    const rt = runtime(store, graph);
    const rate = vi.fn((_q: unknown, _s: unknown, next: () => void) => next());
    const plan = vi.fn((_q: unknown, _s: unknown, next: () => void) => next());
    const lock = createFbLock({ fbEnabled: createFbFlagReader({ readFlag: async () => flag, now: () => 0 }) });
    const routes: Record<string, ((req: unknown, res: unknown, next: () => void) => unknown)[]> = {};
    const fake = { get: (p: string, ...h: never[]) => { routes[`GET ${p}`] = h; }, post: (p: string, ...h: never[]) => { routes[`POST ${p}`] = h; } };
    rt.registerRoutes(fake as never, ((_q: unknown, _s: unknown, next: () => void) => next()) as never, { requireConnectRate: rate, requirePlanActive: plan, requireFbAvailable: lock });
    async function call(route: string, email: string, body: Record<string, unknown> = {}) {
      let status = 200; let json: unknown = null;
      const res = { status(c: number) { status = c; return this; }, json(b: unknown) { json = b; return this; }, redirect() { return this; } };
      const req = { authUserId: "user-1", sellerId: "user-1", userEmail: email, body, query: {} };
      for (const h of routes[route]) {
        let advanced = false;
        await h(req, res, () => { advanced = true; });
        if (!advanced) break;
      }
      return { status, json };
    }
    return { rt, graph, rate, plan, call, routes };
  }
  const LOCKED = ["GET /fb/oauth/start", "GET /fb/pages", "POST /fb/connect"];

  it("fb_enabled false + non-preview email → 403 fb_not_available on all three; no Graph call, no poller, no rate-limit/plan step", async () => {
    const a = app("false");
    for (const r of LOCKED) expect(await a.call(r, "seller@example.com", { page_id: "P1" }), r).toEqual({ status: 403, json: { ok: false, error: "fb_not_available" } });
    expect(a.graph).not.toHaveBeenCalled();
    expect(a.rt._pollers.size).toBe(0);
    expect(a.rate).not.toHaveBeenCalled();
    expect(a.plan).not.toHaveBeenCalled();
  });
  it("each preview email passes, in any letter case / with spaces", async () => {
    for (const e of ["camilajeffrey1@gmail.com", " GoogleTest@Gmail.com ", "TEST@gmail.com"]) {
      const a = app("false");
      expect((await a.call("GET /fb/oauth/start", e)).json).toMatchObject({ url: expect.stringContaining("dialog/oauth") });
      expect((await a.call("GET /fb/pages", e)).json).toMatchObject({ ok: true });
      expect((await a.call("POST /fb/connect", e, { page_id: "P1" })).json).toEqual({ ok: true, live_video_id: "LV1" });
    }
    expect(fbPreviewEmail("someone@gmail.com")).toBe(false);
    expect(fbPreviewEmail("")).toBe(false);
  });
  it("fb_enabled 'true' → everyone passes", async () => {
    const a = app("true");
    expect((await a.call("GET /fb/pages", "seller@example.com")).status).toBe(200);
    expect((await a.call("POST /fb/connect", "seller@example.com", { page_id: "P1" })).json).toEqual({ ok: true, live_video_id: "LV1" });
    expect(a.rate).toHaveBeenCalledTimes(1);
  });
  it("/fb/disconnect and the OAuth callback are never locked", async () => {
    const a = app("false");
    expect(a.routes["POST /fb/disconnect"]).toHaveLength(2);       // requireAuth + handler only
    expect(a.routes["GET /fb/oauth/callback"]).toHaveLength(1);     // handler only
    expect((await a.call("POST /fb/disconnect", "seller@example.com", { page_id: "P1" })).status).toBe(200);
  });
  it("server.js wires the lock: service-role read of app_settings fb_enabled, passed to registerRoutes", () => {
    const src = readFileSync("server.js", "utf8");
    expect(src).toContain('serviceSb.from("app_settings").select("value").eq("key", "fb_enabled").maybeSingle()');
    expect(src).toContain("const requireFbAvailable = createFbLock({ fbEnabled, isFbTester });");
    expect(src).toContain("fbRuntime.registerRoutes(app, requireAuth, { requireConnectRate, requirePlanActive, requireFbAvailable, requireFbPlan, accountLiveCheck });");
  });
});

// ── The preview list exists twice: server and client must match ───────────────
describe("preview-list parity", () => {
  it("server FB_PREVIEW_EMAILS equals the database list (sql/112 fb_preview) — the app no longer carries it", () => {
    expect([...FB_PREVIEW_EMAILS].sort()).toEqual([...seedEmails("fb_preview")].sort());
  });
});
