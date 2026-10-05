// Facebook testers without a code change (sql/77 fb_tester_access). FAKE data only.
// Pins: the tester reader (row on/off, disabled row, 60 s cache, read error keeps the last good
// value), the lock (flag OR hard-coded preview OR tester), DB testers still go through the plan
// checks (an expired plan is refused), the 3 hard-coded accounts behave exactly as before, GET
// /fb/access, and the sql/77 mirror.
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createFbTesterReader, createFbLock, createFbAccessHandler, createFbPlanCheck, fbFacebookAllowed,
  FB_FLAG_TTL_MS, FB_PREVIEW_EMAILS,
} from "../../../../server/fbAccess.js";
import { createFbRuntime } from "../../../../server/fbLive.js";

const TESTER = "Tester.One@Example.com";
const flagOff = async () => false;

function reader(answers: Array<boolean | Error>, t = { now: 0 }) {
  const readTester = vi.fn(async () => { const a = answers.length > 1 ? answers.shift()! : answers[0]; if (a instanceof Error) throw a; return a; });
  return { isFbTester: createFbTesterReader({ readTester, now: () => t.now }), readTester, t };
}
function mkRes() {
  let status = 200; let json: Record<string, unknown> = {};
  const res = { status(c: number) { status = c; return res; }, json(b: Record<string, unknown>) { json = b; return res; } };
  return { res, get: () => ({ status, json }) };
}
async function lockPasses(lock: ReturnType<typeof createFbLock>, email: string) {
  const r = mkRes(); let nexted = false;
  await lock({ userEmail: email } as never, r.res as never, () => { nexted = true; });
  return nexted ? "next" : r.get();
}

describe("tester reader (fb_tester_access)", () => {
  it("enabled row → true; no row / disabled row → false; email read in lower case", async () => {
    const on = reader([true]);
    expect(await on.isFbTester(TESTER)).toBe(true);
    expect(on.readTester).toHaveBeenCalledWith("tester.one@example.com");
    expect(await reader([false]).isFbTester(TESTER)).toBe(false); // no row, or enabled = false
    const empty = reader([true]);
    expect(await empty.isFbTester("  ")).toBe(false);
    expect(empty.readTester).not.toHaveBeenCalled();
  });
  it("cached 60 s per email, then read again (a row turned off takes effect within 60 s)", async () => {
    const r = reader([true, false]);
    expect(await r.isFbTester(TESTER)).toBe(true);
    r.t.now = FB_FLAG_TTL_MS - 1;
    expect(await r.isFbTester(TESTER)).toBe(true);
    expect(r.readTester).toHaveBeenCalledTimes(1);
    r.t.now = FB_FLAG_TTL_MS;
    expect(await r.isFbTester(TESTER)).toBe(false);
    expect(r.readTester).toHaveBeenCalledTimes(2);
    expect(FB_FLAG_TTL_MS).toBe(60_000);
  });
  it("read error: keeps the last good value for that email (false if never read); next read 60 s later", async () => {
    const r = reader([true, new Error("db"), false]);
    expect(await r.isFbTester(TESTER)).toBe(true);
    r.t.now = FB_FLAG_TTL_MS;
    expect(await r.isFbTester(TESTER)).toBe(true);            // error → last good
    r.t.now = FB_FLAG_TTL_MS + 1;
    expect(await r.isFbTester(TESTER)).toBe(true);            // no re-read inside 60 s after the error
    expect(r.readTester).toHaveBeenCalledTimes(2);
    expect(await reader([new Error("db")]).isFbTester("new@x.co")).toBe(false); // never read → false
  });
  it("concurrent callers for one email share one read; emails are cached separately", async () => {
    const r = reader([true]);
    await Promise.all([r.isFbTester(TESTER), r.isFbTester(TESTER), r.isFbTester(TESTER.toLowerCase())]);
    expect(r.readTester).toHaveBeenCalledTimes(1);
    await r.isFbTester("other@x.co");
    expect(r.readTester).toHaveBeenCalledTimes(2);
  });
});

describe("the Facebook lock", () => {
  it("tester row on → passes; off → 403 fb_not_available", async () => {
    expect(await lockPasses(createFbLock({ fbEnabled: flagOff, isFbTester: reader([true]).isFbTester }), TESTER)).toBe("next");
    expect(await lockPasses(createFbLock({ fbEnabled: flagOff, isFbTester: reader([false]).isFbTester }), TESTER)).toEqual({ status: 403, json: { ok: false, error: "fb_not_available" } });
  });
  it("tester read error with no earlier answer → refused (fail closed)", async () => {
    expect(await lockPasses(createFbLock({ fbEnabled: flagOff, isFbTester: reader([new Error("db")]).isFbTester }), TESTER)).toMatchObject({ status: 403 });
  });
  it("the 3 hard-coded accounts pass with no flag or tester read, exactly as before", async () => {
    expect(FB_PREVIEW_EMAILS).toEqual(["camilajeffrey1@gmail.com", "googletest@gmail.com", "test@gmail.com"]);
    const fbEnabled = vi.fn(flagOff);
    const r = reader([false]);
    const lock = createFbLock({ fbEnabled, isFbTester: r.isFbTester });
    for (const e of FB_PREVIEW_EMAILS) expect(await lockPasses(lock, e)).toBe("next");
    expect(fbEnabled).not.toHaveBeenCalled();
    expect(r.readTester).not.toHaveBeenCalled();
  });
  it("fb_enabled 'true' still opens it for everyone (no tester read needed)", async () => {
    const r = reader([false]);
    expect(await lockPasses(createFbLock({ fbEnabled: async () => true, isFbTester: r.isFbTester }), "anyone@x.co")).toBe("next");
    expect(r.readTester).not.toHaveBeenCalled();
  });
  it("without a tester reader (old wiring) a non-preview seller is refused as before", async () => {
    expect(await lockPasses(createFbLock({ fbEnabled: flagOff }), "anyone@x.co")).toMatchObject({ status: 403 });
  });
});

// The real route chains: requireAuth → lock → (start) startPlanActive → requireFbPlan, or
// (connect) rate → requirePlanActive → requireFbPlan. requirePlanActive is a fake that behaves
// like checkPlanActive (paid + expired → 403 plan_expired).
type Profile = { plan: string; plan_status: string; role: string };
function chains(profile: Profile, tester: boolean) {
  const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
  const store = {
    async hasReceiptAccess() { return false; }, async getPage() { return null; }, async getPlan() { return profile.plan; },
    async countPages() { return 0; }, async listPages() { return []; }, async upsertPage() {}, async listActivePages() { return []; },
    async setActive() {}, async updateExpiry() {},
  };
  const rt = createFbRuntime({ config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl: vi.fn(), now: () => 1, setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} });
  const requirePlanActive = vi.fn((req: Record<string, unknown>, res: { status: (c: number) => { json: (b: unknown) => unknown } }, next: () => void) => {
    if (profile.plan !== "free" && profile.plan_status === "expired") return res.status(403).json({ success: false, error: "plan_expired" });
    req.sellerPlan = profile.plan; req.sellerRole = profile.role; return next();
  });
  const routes: Record<string, ((q: unknown, s: unknown, n: () => void) => unknown)[]> = {};
  const app = { get: (p: string, ...h: never[]) => { routes[`GET ${p}`] = h; }, post: (p: string, ...h: never[]) => { routes[`POST ${p}`] = h; } };
  rt.registerRoutes(app as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never, {
    requirePlanActive, requireFbAvailable: createFbLock({ fbEnabled: flagOff, isFbTester: reader([tester]).isFbTester }),
    requireFbPlan: createFbPlanCheck({ readProfile: async () => profile }),
  });
  const run = async (route: string, email: string) => {
    const r = mkRes();
    const req = { authUserId: "u1", sellerId: "u1", userEmail: email, query: {}, body: { page_id: "P1" } };
    for (const h of routes[route]) { let go = false; await h(req, r.res, () => { go = true; }); if (!go) break; }
    return { ...r.get(), planChecked: requirePlanActive.mock.calls.length > 0 };
  };
  return { run };
}

describe("DB testers go through the plan checks like any seller", () => {
  it("tester with an expired paid plan → Authorize and Connect refused (plan_expired)", async () => {
    const c = chains({ plan: "pro", plan_status: "expired", role: "seller" }, true);
    const start = await c.run("GET /fb/oauth/start", TESTER);
    expect(start.status).toBe(403);
    expect(start.json.error).toBe("plan_expired");
    expect(start.planChecked).toBe(true);
    expect((await c.run("POST /fb/connect", TESTER)).json.error).toBe("plan_expired");
  });
  it("tester on a free plan that is not active → refused by requireFbPlan", async () => {
    const c = chains({ plan: "free", plan_status: "pending", role: "seller" }, true);
    expect(await c.run("GET /fb/oauth/start", TESTER)).toMatchObject({ status: 403, json: { ok: false, error: "plan_expired" } });
  });
  it("tester with an active plan → Authorize URL", async () => {
    const r = await chains({ plan: "pro", plan_status: "active", role: "seller" }, true).run("GET /fb/oauth/start", TESTER);
    expect(r.status).toBe(200);
    expect(String(r.json.url)).toContain("facebook.com");
  });
  it("hard-coded preview account with an expired plan still gets its URL (plan check skipped, as before)", async () => {
    const r = await chains({ plan: "pro", plan_status: "expired", role: "seller" }, false).run("GET /fb/oauth/start", "googletest@gmail.com");
    expect(r.status).toBe(200);
    expect(r.planChecked).toBe(false);
  });
  it("non-tester with an active plan → fb_not_available (the lock)", async () => {
    expect(await chains({ plan: "pro", plan_status: "active", role: "seller" }, false).run("GET /fb/oauth/start", "seller@x.co")).toMatchObject({ status: 403, json: { error: "fb_not_available" } });
  });
});

describe("GET /fb/access", () => {
  async function access(o: { email: string; flag?: boolean; tester?: boolean | Error; receipt?: boolean | Error }) {
    const h = createFbAccessHandler({
      fbEnabled: async () => o.flag === true, isFbTester: reader([o.tester ?? false]).isFbTester,
      hasReceiptAccess: async () => { if (o.receipt instanceof Error) throw o.receipt; return o.receipt === true; },
    });
    const r = mkRes();
    await h({ userEmail: o.email, authUserId: "u1" } as never, r.res as never);
    return r.get();
  }
  it("facebook = the lock's decision; receipt = hasReceiptAccess", async () => {
    expect(await access({ email: TESTER, tester: true })).toEqual({ status: 200, json: { ok: true, facebook: true, receipt: false } });
    expect(await access({ email: TESTER, tester: true, receipt: true })).toEqual({ status: 200, json: { ok: true, facebook: true, receipt: true } });
    expect(await access({ email: "seller@x.co" })).toEqual({ status: 200, json: { ok: true, facebook: false, receipt: false } });
    expect(await access({ email: "test@gmail.com" })).toEqual({ status: 200, json: { ok: true, facebook: true, receipt: false } });
    expect(await access({ email: "seller@x.co", flag: true })).toEqual({ status: 200, json: { ok: true, facebook: true, receipt: false } });
  });
  it("read errors answer false for that part, never a 500", async () => {
    expect(await access({ email: TESTER, tester: new Error("db"), receipt: new Error("db") })).toEqual({ status: 200, json: { ok: true, facebook: false, receipt: false } });
    expect(await fbFacebookAllowed({ email: "x@y.co", fbEnabled: async () => { throw new Error("db"); }, isFbTester: async () => true })).toBe(true);
  });
  it("server.js registers GET /fb/access behind requireAuth with the same flag + tester readers", () => {
    const src = readFileSync("server.js", "utf8");
    expect(src).toContain('app.get("/fb/access", requireAuth, createFbAccessHandler({ fbEnabled, isFbTester, hasReceiptAccess: (uid) => store.hasReceiptAccess(uid) }));');
    expect(src).toContain('serviceSb.from("fb_tester_access").select("email").eq("email", email).eq("enabled", true).maybeSingle()');
  });
});

describe("sql/77 mirror", () => {
  const sql = readFileSync("sql/77_fb_tester_access.sql", "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").toLowerCase();
  it("table with the asked columns, lower-case email, RLS on, revoked from anon/authenticated; idempotent; no drop", () => {
    expect(code).toContain("create table if not exists public.fb_tester_access");
    expect(code).toMatch(/email text primary key check \(email = lower\(email\)\)/);
    expect(code).toContain("enabled boolean not null default true");
    expect(code).toContain("note text");
    expect(code).toContain("created_at timestamptz default now()");
    expect(code).toContain("alter table public.fb_tester_access enable row level security");
    expect(code).toContain("revoke all on table public.fb_tester_access from anon");
    expect(code).toContain("revoke all on table public.fb_tester_access from authenticated");
    expect(code).not.toMatch(/\bdrop\b|\bgrant\b/);
  });
});
