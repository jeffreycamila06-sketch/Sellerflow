// Account total, Build 2 (sql/85) — server side: the pure verdict, the fail-open call,
// accountCapVerdict's two options against today's results, and the three connect routes
// (TikTok / Facebook / Shopee): checked only for a NEW connect, refused as account_not_covered.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { liveCoverageVerdict, checkAccountLive, ACCOUNT_LIVE_TIMEOUT_MS, createLiveAdmissions } from "../../../../server/accountLive.js";
import { accountCapVerdict, maxAccountsForPlan, parseRegisteredList, normalizeAccount } from "../../../../server/accountCap.js";
import { createFbRuntime } from "../../../../server/fbLive.js";
import { createShopeeRuntime } from "../../../../server/shopeeLive.js";

const covered = { allowed: true, registered: true, covered: true, rank: 1, limit: 1, enforce: true, unregistered_enforce: false };
const notCoveredEnforced = { allowed: false, registered: true, covered: false, rank: 2, limit: 1, enforce: true, unregistered_enforce: false };
const notCoveredLogOnly = { ...notCoveredEnforced, allowed: true, enforce: false };

describe("liveCoverageVerdict", () => {
  it("allows a covered account; ignores list order only while enforcing", () => {
    expect(liveCoverageVerdict(covered)).toMatchObject({ allow: true, failOpen: false, ignoreListOrder: true });
    expect(liveCoverageVerdict({ ...covered, enforce: false })).toMatchObject({ allow: true, ignoreListOrder: false });
  });
  it("refuses only an ENFORCED registered-but-not-covered answer", () => {
    expect(liveCoverageVerdict(notCoveredEnforced)).toMatchObject({ allow: false, rank: 2, limit: 1 });
    expect(liveCoverageVerdict(notCoveredLogOnly)).toMatchObject({ allow: true, ignoreListOrder: false });
  });
  it("unregistered names are left to accountCapVerdict, following the second switch", () => {
    expect(liveCoverageVerdict({ allowed: true, registered: false, enforce: false, unregistered_enforce: false })).toMatchObject({ allow: true, refuseUnregistered: false });
    expect(liveCoverageVerdict({ allowed: false, registered: false, enforce: false, unregistered_enforce: true })).toMatchObject({ allow: true, refuseUnregistered: true });
  });
  it("junk / error / missing → allow (fail-open)", () => {
    for (const j of [null, undefined, 1, "x", [], {}, { allowed: "no" }, { allowed: true, error: "42P01" }, { allowed: false, error: "XX000" }]) {
      expect(liveCoverageVerdict(j), JSON.stringify(j)).toMatchObject({ allow: true, failOpen: true, ignoreListOrder: false, refuseUnregistered: false });
    }
  });
});

describe("checkAccountLive — never blocks on infrastructure", () => {
  it("passes a good answer through", async () => {
    const log = vi.fn();
    expect(await checkAccountLive(async () => ({ data: notCoveredEnforced, error: null }), { log })).toMatchObject({ allow: false });
    expect(log).not.toHaveBeenCalled();
  });
  it("database error / missing function / throw / timeout → allow + one console line, no names", async () => {
    const log = vi.fn();
    const cases: (() => Promise<unknown>)[] = [
      async () => ({ data: null, error: { message: "function account_live_check(text, text) does not exist" } }),
      async () => { throw new Error("boom"); },
      () => new Promise(() => {}),                                    // hangs → timeout
    ];
    for (const c of cases) expect(await checkAccountLive(c as never, { log, timeoutMs: 20 })).toMatchObject({ allow: true, failOpen: true });
    expect(log).toHaveBeenCalledTimes(3);
    for (const [line] of log.mock.calls) expect(line).toBe("[ACCOUNT-LIVE] ERROR → FAIL-OPEN");
  });
  it("timeout is ~1.5 s", () => { expect(ACCOUNT_LIVE_TIMEOUT_MS).toBe(1500); });
});

// Verbatim copy of accountCapVerdict as it was on main before Build 2.
function oldVerdict({ plan, role, tiktok, facebook, platform, username }: Record<string, unknown>) {
  if (String(role == null ? "" : role).trim().toLowerCase() === "admin") return { allowed: true };
  const req = normalizeAccount(username);
  if (!req) return { allowed: true };
  const registered = parseRegisteredList(platform === "Facebook" ? facebook : tiktok);
  if (!registered.length) return { allowed: true };
  const max = maxAccountsForPlan(plan);
  if (new Set(registered.slice(0, max)).has(req)) return { allowed: true };
  return { allowed: false, reason: "account_limit", max, plan: String(plan) };
}

describe("accountCapVerdict — default options = today, byte for byte", () => {
  const plans = ["free", "basic", "plus", "pro", "master", "", "gold", undefined];
  const roles = ["seller", "admin", "", undefined];
  const lists = ["", "a", "a,b", "b,a,c", "@A, b\nc,d,e,f", undefined];
  const names = ["a", "@A ", "c", "f", "zz", ""];
  it("every combination matches the old function", () => {
    let n = 0;
    for (const plan of plans) for (const role of roles) for (const tiktok of lists) for (const facebook of ["", "fb1"]) for (const platform of ["TikTok", "Facebook"]) for (const username of names) {
      const a = { plan, role, tiktok, facebook, platform, username };
      expect(accountCapVerdict(a as never), JSON.stringify(a)).toEqual(oldVerdict(a));
      expect(accountCapVerdict({ ...a, ignoreListOrder: false, refuseUnregistered: false } as never)).toEqual(oldVerdict(a));
      n++;
    }
    expect(n).toBeGreaterThan(3000);
  });
  it("ignoreListOrder: any registered name passes, an unregistered one is refused", () => {
    const base = { plan: "basic", role: "seller", tiktok: "a,b,c", facebook: "", platform: "TikTok" };
    expect(accountCapVerdict({ ...base, username: "c" } as never)).toMatchObject({ allowed: false });   // today: list order
    expect(accountCapVerdict({ ...base, username: "c", ignoreListOrder: true } as never)).toEqual({ allowed: true });
    expect(accountCapVerdict({ ...base, username: "zz", ignoreListOrder: true } as never)).toMatchObject({ allowed: false, reason: "account_limit" });
  });
  it("refuseUnregistered closes the empty-list exception only", () => {
    const base = { plan: "basic", role: "seller", tiktok: "", facebook: "", platform: "TikTok", username: "x" };
    expect(accountCapVerdict(base as never)).toEqual({ allowed: true });
    expect(accountCapVerdict({ ...base, refuseUnregistered: true } as never)).toMatchObject({ allowed: false, reason: "account_limit" });
    expect(accountCapVerdict({ ...base, username: "", refuseUnregistered: true } as never)).toEqual({ allowed: true });   // empty → the route's 400
    expect(accountCapVerdict({ ...base, role: "admin", refuseUnregistered: true } as never)).toEqual({ allowed: true });
  });
});

describe("TikTok /connect route (server.js source contract)", () => {
  const src = readFileSync("server.js", "utf8");
  const route = src.slice(src.indexOf('app.post("/connect/tiktok"'), src.indexOf('app.post("/connect/facebook"'));
  it("asks only for a NEW connect (no running connection, non-empty name)", () => {
    expect(route).toContain('const tkKey = liveKey(req.sellerId, "TikTok", req.body.username);');
    expect(route).toContain("const isNew = !!cleanAccountKey(req.body.username) && !tiktokConnections.has(tkKey);");
    expect(route).toContain('const live = isNew ? await accountLiveCheck(req, "tiktok", req.body.username) : null;');
  });
  it("reuse path: the remembered options, no database call; a new connect forgets then remembers", () => {
    const i = (x: string) => route.indexOf(x);
    expect(route).toContain("if (isNew) liveAdmissions.forget(tkKey);");
    expect(route).toContain('accountCapReject(req, "TikTok", req.body.username, live || liveAdmissions.optionsFor(tkKey))');
    expect(route).toContain("if (live) liveAdmissions.remember(tkKey, live, (k) => tiktokConnections.has(k));");
    expect(i("liveAdmissions.forget(")).toBeLessThan(i("accountLiveCheck("));
    expect(i("if (live && !live.allow)")).toBeLessThan(i("liveAdmissions.remember("));
    expect(i("liveAdmissions.remember(")).toBeLessThan(i("return connectTikTok("));
    expect(src.match(/accountLiveCheck\(req, "tiktok"/g)).toHaveLength(1);
  });
  it("order: plan middleware → check → accountCapReject (with the flags) → refusal → connectTikTok", () => {
    expect(route).toMatch(/^app\.post\("\/connect\/tiktok", requireAuth, requireConnectRate, requirePlanActive, async/);
    const i = (s: string) => route.indexOf(s);
    expect(i("accountLiveCheck(")).toBeLessThan(i("accountCapReject("));
    expect(i("accountCapReject(")).toBeLessThan(i("if (live && !live.allow) return res.status(403).json(ACCOUNT_LIVE_REFUSAL);"));
    expect(i("ACCOUNT_LIVE_REFUSAL)")).toBeLessThan(i("return connectTikTok("));
  });
  it("the refusal code, the fail-open helper and the wiring to Facebook / Shopee", () => {
    expect(src).toContain('error: "account_not_covered"');
    expect(src).toContain('userSb.rpc("account_live_check", { p_platform: platform, p_key: String(key == null ? "" : key) })');
    expect(src).toMatch(/shopeeRuntime\.registerRoutes\(app, requireAuth, \{[^}]*accountLiveCheck \}\)/);
    expect(src).toMatch(/fbRuntime\.registerRoutes\(app, requireAuth, \{[^}]*accountLiveCheck \}\)/);
    expect(src).not.toMatch(/\[ACCOUNT-LIVE\][^\n]*\$\{(username|key|req\.body)/);
  });
  it("concurrency kick-oldest untouched", () => {
    expect(src).toContain("const decision = capDecision({ realFresh, reservedCount, max: concurrencyCap(meta.plan, meta.role) });");
  });
});

// ── Facebook / Shopee routes (real handlers, fake app) ───────────────────────
const liveKey = (a: string, b: string, c: string) => `${a}:${b}:${c}`;
const loops = { setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} };
const pass = (_req: unknown, _res: unknown, next: () => void) => next();
function fakeApp() {
  const handlers: Record<string, ((req: unknown, res: unknown, next: () => void) => unknown)[]> = {};
  const rec = (m: string) => (p: string, ...h: never[]) => { handlers[`${m} ${p}`] = h; };
  return { app: { get: rec("GET"), post: rec("POST") }, handlers };
}
async function call(handlers: ReturnType<typeof fakeApp>["handlers"], route: string, body: Record<string, unknown>) {
  const chain = handlers[route];
  const out = { status: 200, json: null as unknown };
  const res = { status(c: number) { out.status = c; return this; }, json(b: unknown) { out.json = b; return this; } };
  await chain[chain.length - 1]({ authUserId: "u1", sellerId: "s", body }, res, () => {});
  return out;
}

describe("Facebook /fb/connect", () => {
  function setup(check: ReturnType<typeof vi.fn>) {
    const store = { async getPage() { return { page_id: "P1", active: true, access_token: "" }; }, async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {} };
    const rt = createFbRuntime({ config: { enabled: true, appId: "a", appSecret: "s", tokenKey: "tk" }, store, liveKey, emitComment: vi.fn(), statusEmit: vi.fn(), renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl: vi.fn(), now: () => 1_000_000, log: () => {}, ...loops } as never);
    const { app, handlers } = fakeApp();
    rt.registerRoutes(app as never, pass as never, { accountLiveCheck: check });
    return { rt, handlers };
  }
  it("a not-covered Page → 403 account_not_covered, nothing started", async () => {
    const check = vi.fn(async () => ({ allow: false }));
    const { rt, handlers } = setup(check);
    expect(await call(handlers, "POST /fb/connect", { page_id: "P1" })).toEqual({ status: 403, json: { ok: false, error: "account_not_covered" } });
    expect(check).toHaveBeenCalledWith(expect.anything(), "facebook", "P1");
    expect(rt._pollers.size).toBe(0);
  });
  it("allowed → today's path continues (here: token check)", async () => {
    const { handlers } = setup(vi.fn(async () => ({ allow: true })));
    expect((await call(handlers, "POST /fb/connect", { page_id: "P1" })).json).toEqual({ ok: false, error: "needs_reauth" });
  });
  it("a poller already running for the Page → not checked", async () => {
    const check = vi.fn(async () => ({ allow: false }));
    const { rt, handlers } = setup(check);
    rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "p", liveVideoId: "LV" });
    const out = await call(handlers, "POST /fb/connect", { page_id: "P1" });
    expect(check).not.toHaveBeenCalled();
    expect(out.json).not.toEqual({ ok: false, error: "account_not_covered" });
    rt.stopAll();
  });
  it("no wiring (default) → allowed", async () => {
    const store = { async getPage() { return { page_id: "P1", active: true, access_token: "" }; }, async listActivePages() { return []; } };
    const rt = createFbRuntime({ config: { enabled: true, appId: "a", appSecret: "s", tokenKey: "tk" }, store, liveKey, emitComment: vi.fn(), statusEmit: vi.fn(), renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl: vi.fn(), now: () => 1, log: () => {}, ...loops } as never);
    const { app, handlers } = fakeApp();
    rt.registerRoutes(app as never, pass as never);
    expect((await call(handlers, "POST /fb/connect", { page_id: "P1" })).json).toEqual({ ok: false, error: "needs_reauth" });
  });
});

describe("Shopee /shopee/connect", () => {
  function setup(check: ReturnType<typeof vi.fn>) {
    const store = { async getShop() { return { shop_id: 7, active: true }; }, async listActiveShops() { return []; }, async updateTokens() {}, async setActive() {} };
    const rt = createShopeeRuntime({ config: { enabled: true, partnerId: "1", partnerKey: "pk", tokenKey: "tk" }, store, liveKey, emitComment: vi.fn(), statusEmit: vi.fn(), renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl: vi.fn(), now: () => 1_000_000, log: () => {}, ...loops } as never);
    const { app, handlers } = fakeApp();
    rt.registerRoutes(app as never, pass as never, { accountLiveCheck: check });
    return { rt, handlers };
  }
  it("a not-covered shop → 403 account_not_covered", async () => {
    const check = vi.fn(async () => ({ allow: false }));
    const { rt, handlers } = setup(check);
    expect(await call(handlers, "POST /shopee/connect", { shop_id: "7", session_id: "S" })).toEqual({ status: 403, json: { ok: false, error: "account_not_covered" } });
    expect(check).toHaveBeenCalledWith(expect.anything(), "shopee", "7");
    expect(rt._pollers.size).toBe(0);
  });
  it("allowed → today's path (poller starts)", async () => {
    const { rt, handlers } = setup(vi.fn(async () => ({ allow: true })));
    expect((await call(handlers, "POST /shopee/connect", { shop_id: "7", session_id: "S" })).json).toEqual({ ok: true, session_id: "S" });
    rt.stopAll();
  });
  it("a poller already running for the shop → not checked", async () => {
    const check = vi.fn(async () => ({ allow: false }));
    const { rt, handlers } = setup(check);
    rt.startPoller({ sellerId: "s", userId: "u1", shopId: "7", shopUsername: "7", shopSessionId: "S" });
    expect((await call(handlers, "POST /shopee/connect", { shop_id: "7", session_id: "S" })).json).toEqual({ ok: true, session_id: "S" });
    expect(check).not.toHaveBeenCalled();
    rt.stopAll();
  });
});

describe("reuse path keeps the admitted options (FIX 1)", () => {
  // Basic seller, list [b, a]; a is older → covered by age, but NOT in the first N of the list.
  const base = { plan: "basic", role: "seller", tiktok: "b,a", facebook: "", platform: "TikTok", username: "a" };
  const answer = (enforce: boolean) => ({ allowed: true, registered: true, covered: true, rank: 1, limit: 1, enforce, unregistered_enforce: false });
  function connect(adm: ReturnType<typeof createLiveAdmissions>, running: Set<string>, key: string, enforce: boolean, username = "a") {
    const isNew = !running.has(key);
    if (isNew) adm.forget(key);
    const live = isNew ? liveCoverageVerdict(answer(enforce)) : null;
    const v = accountCapVerdict({ ...base, username, ...(live || adm.optionsFor(key)) } as never);
    if (v.allowed && live) { adm.remember(key, live, (k) => running.has(k)); running.add(key); }
    return v;
  }
  it("enforce on: first connect allowed, a Connect tap on the running live allowed too", () => {
    const adm = createLiveAdmissions(); const running = new Set<string>();
    expect(connect(adm, running, "s:TikTok:a", true)).toEqual({ allowed: true });
    expect(connect(adm, running, "s:TikTok:a", true)).toEqual({ allowed: true });
    expect(accountCapVerdict(base as never)).toMatchObject({ allowed: false });   // without the fix: list order refuses
  });
  it("log-only: both paths byte-identical to today", () => {
    const adm = createLiveAdmissions(); const running = new Set<string>();
    const first = connect(adm, running, "s:TikTok:b", false, "b");
    expect(first).toEqual(oldVerdict({ ...base, username: "b" }));
    const reuse = accountCapVerdict({ ...base, username: "b", ...adm.optionsFor("s:TikTok:b") } as never);
    expect(reuse).toEqual(oldVerdict({ ...base, username: "b" }));
    expect(adm.optionsFor("s:TikTok:b")).toEqual({ ignoreListOrder: false, refuseUnregistered: false });
    for (const u of ["a", "b", "zz"]) expect(accountCapVerdict({ ...base, username: u, ...adm.optionsFor("nothing") } as never)).toEqual(oldVerdict({ ...base, username: u }));
  });
  it("nothing remembered (connection from before the deploy) → today's behaviour", () => {
    expect(createLiveAdmissions().optionsFor("k")).toEqual({});
  });
  it("a NEW connect forgets the old options before deciding again", () => {
    const adm = createLiveAdmissions();
    adm.remember("k", { ignoreListOrder: true }, () => true);
    adm.forget("k");
    expect(adm.optionsFor("k")).toEqual({});
  });
  it("bounded: past the limit, keys whose connection is gone are dropped", () => {
    const adm = createLiveAdmissions({ max: 3 });
    const running = new Set(["k1", "k2"]);
    for (const k of ["k1", "k2", "k3", "k4", "k5"]) adm.remember(k, { ignoreListOrder: true }, (x) => running.has(x));
    expect(adm.size()).toBeLessThanOrEqual(3);
    expect(adm.optionsFor("k1")).toEqual({ ignoreListOrder: true, refuseUnregistered: false });
    expect(adm.optionsFor("k2")).toEqual({ ignoreListOrder: true, refuseUnregistered: false });
    expect(adm.optionsFor("k5")).toEqual({ ignoreListOrder: true, refuseUnregistered: false });
    expect(adm.optionsFor("k3")).toEqual({});
  });
});
