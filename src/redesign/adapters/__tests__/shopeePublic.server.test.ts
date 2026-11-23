// Shopee Live for every seller (sql/206): the server's access step (server/shopeePublic.js) and the reader's
// use of it (server/shopeeLiveLink.js — asked only when the beta rule refused the seller).
//   A  OFF = MAIN: with Shopee not open (switch off / no preview key / database error / function missing / no
//      access step at all) the branch reader answers, requests, emits and logs EXACTLY like main's (frozen copy
//      fixtures/shopeeLiveLink.main206.js) — beta sellers and everyone else, 10 situations each
//   B  ON: a seller with no beta row connects under the plan rule of POST /connect/tiktok
//   C  active beta row = today's connect, the plan is not asked; ended beta row = the plan like everyone else
//   D  the plan rule is server.js's REAL checkPlanActive (lifted from the file), the one /connect/tiktok uses
//   E  the wiring in server.js
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createShopeeLinkRuntime } from "../../../../server/shopeeLiveLink.js";
import { createShopeeLinkRuntime as createMain } from "./fixtures/shopeeLiveLink.main206.js";
import { createShopeePublicGate } from "../../../../server/shopeePublic.js";

const TW_LINK = "https://live.shopee.tw/share?from=live&session=8092367&share_user_id=254298659";
const PH_LINK = "https://live.shopee.ph/share?from=live&session=777&share_user_id=42";
const hostBody = (over: Record<string, unknown> = {}) => ({ err_code: 0, data: { session: { session_id: 8092367, uid: 254298659, title: "sale", status: 1, chatroom_id: "SPIM-X", ...over } } });
const mkRes = (status: number, body: unknown, location?: string) => ({ status, json: async () => body, headers: { get: (k: string) => (k === "location" ? location || null : null) } });
const fetchByUrl = (map: Record<string, (u: string) => unknown>) => vi.fn(async (u: string) => { for (const [k, f] of Object.entries(map)) if (u.includes(k)) return f(u); return mkRes(404, { error: "error_not_found" }); });
type Create = typeof createShopeeLinkRuntime;

function rig(create: Create, fetchMap: Record<string, (u: string) => unknown>, over: Record<string, unknown> = {}) {
  const events: string[] = [];
  const fetchImpl = fetchByUrl(fetchMap);
  const rt = create({
    emitComment: (...a: unknown[]) => events.push(`emit ${JSON.stringify(a)}`),
    statusEmit: (...a: unknown[]) => events.push(`status ${JSON.stringify(a)}`),
    rememberAccount: async (...a: unknown[]) => { events.push(`remember ${JSON.stringify(a)}`); },
    fetchImpl, now: () => 1_000_000, log: (l: string) => events.push(`log ${l}`),
    liveKey: (s: string, p: string, k: string) => `${s}:${p}:${k}`,
    enabled: async () => true, betaAllowed: async () => true,
    setLoop: () => 1, clearLoop: () => {}, diag: false,
    ...over,
  });
  return { rt, events, fetchImpl };
}
const LIVE = { "host_session?uid=254298659": () => mkRes(200, hostBody()) };
const SCENARIOS: Array<[string, Record<string, (u: string) => unknown>, string, Record<string, unknown>?]> = [
  ["TW own live", LIVE, TW_LINK],
  ["PH own live", { "host_session?uid=42": () => mkRes(200, hostBody({ uid: 42, session_id: 777 })) }, PH_LINK],
  ["short link", { "tw.shp.ee/": () => mkRes(301, null, TW_LINK), "host_session?uid=254298659": () => mkRes(200, hostBody()) }, "https://tw.shp.ee/jBv7BMm9"],
  ["someone else's live", { "host_session": () => mkRes(200, hostBody({ session_id: 1 })) }, TW_LINK],
  ["ended", { "host_session": () => mkRes(200, hostBody({ status: 2 })) }, TW_LINK],
  ["bad link", {}, "https://www.tiktok.com/@x/live"],
  ["unreachable", { "host_session": () => mkRes(500, null) }, TW_LINK],
  ["blocked", { "host_session": () => mkRes(403, null) }, TW_LINK],
  ["switch shopee_live_enabled off", LIVE, TW_LINK, { enabled: async () => false }],
  ["the beta check throws", LIVE, TW_LINK, { betaAllowed: async () => { throw new Error("db"); } }],
];
const base = { sellerId: "seller-1", userId: "u1", email: "s@x", sessionId: "browser-abc" };
const REQ = { sellerId: "seller-1", authUserId: "u1", userEmail: "s@x", authToken: "jwt" };
const reqs = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([u, o]: [string, { headers?: unknown; redirect?: unknown }]) => [u, o && o.headers, o && o.redirect]);
const NO_BETA = { status: 403, json: { ok: false, error: "no_beta" } };

// every way "Shopee is not open for this seller" can reach the reader
const planNever = vi.fn(async () => ({ allowed: true }));
const NOT_OPEN: Array<[string, (() => Promise<unknown>) | null]> = [
  ["no access step (server not wired)", null],
  ["the database says false (switch off, not on the preview list)", () => createShopeePublicGate({ publicOn: async () => ({ data: false, error: null }), planCheck: planNever })(REQ)],
  ["the database answers null", () => createShopeePublicGate({ publicOn: async () => ({ data: null, error: null }), planCheck: planNever })(REQ)],
  ["the function is missing (sql/206 not applied)", () => createShopeePublicGate({ publicOn: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.shopee_public_on(p_user)" } }), planCheck: planNever })(REQ)],
  ["a database error", () => createShopeePublicGate({ publicOn: async () => ({ data: null, error: { code: "57014", message: "timeout" } }), planCheck: planNever })(REQ)],
  ["the database call throws", () => createShopeePublicGate({ publicOn: async () => { throw new Error("network"); }, planCheck: planNever })(REQ)],
  ["a word instead of true", () => createShopeePublicGate({ publicOn: async () => ({ data: "true", error: null }), planCheck: planNever })(REQ)],
  ["the access step itself throws", async () => { throw new Error("boom"); }],
];

describe("A — OFF = MAIN (frozen copy of main 8a237c68)", () => {
  for (const beta of [true, false]) {
    for (const [name, map, link, over] of SCENARIOS) {
      for (const [why, access] of NOT_OPEN) {
        it(`${beta ? "beta seller" : "no beta row"} · ${name} · ${why}`, async () => {
          const o = { ...(beta ? {} : { betaAllowed: async () => false }), ...over };
          const main = rig(createMain as unknown as Create, map, o);
          const here = rig(createShopeeLinkRuntime, map, o);
          const rm = await main.rt.connect({ ...base, shareLink: link });
          const rh = await here.rt.connect({ ...base, shareLink: link, ...(access ? { access } : {}) });
          expect(rh).toEqual(rm);
          expect(here.events).toEqual(main.events);
          expect(reqs(here.fetchImpl)).toEqual(reqs(main.fetchImpl));
          expect(here.rt.listPollers()).toEqual(main.rt.listPollers());
        });
      }
    }
  }
  it("a seller with no beta row gets main's 403 no_beta in every one of those cases, and the plan is never read", async () => {
    for (const [, access] of NOT_OPEN) {
      const h = rig(createShopeeLinkRuntime, LIVE, { betaAllowed: async () => false });
      expect(await h.rt.connect({ ...base, shareLink: TW_LINK, ...(access ? { access } : {}) })).toEqual(NO_BETA);
      expect(h.fetchImpl).not.toHaveBeenCalled();
    }
    expect(planNever).not.toHaveBeenCalled();
  });
  it("the routes are main's: one connect route, same middleware order", () => {
    const seen: Array<[string, number]> = [];
    const app = { post: (p: string, ...mw: unknown[]) => { seen.push([p, mw.length]); }, get: () => {} };
    rig(createShopeeLinkRuntime, {}).rt.registerRoutes(app, vi.fn(), { requireConnectRate: vi.fn(), publicGate: vi.fn() });
    const seenMain: Array<[string, number]> = [];
    rig(createMain as unknown as Create, {}).rt.registerRoutes({ post: (p: string, ...mw: unknown[]) => { seenMain.push([p, mw.length]); }, get: () => {} }, vi.fn(), { requireConnectRate: vi.fn() });
    expect(seen).toEqual(seenMain);
    expect(seen).toEqual([["/shopee/live/connect", 3]]);
  });
});

const open = (plan: unknown, log: (l: string) => void = () => {}) => {
  const planCheck = vi.fn(async () => plan);
  const publicOn = vi.fn(async () => ({ data: true, error: null }));
  return { planCheck, publicOn, access: () => createShopeePublicGate({ publicOn, planCheck, log })(REQ) };
};

describe("B — ON: a seller with no beta row", () => {
  const noBeta = { betaAllowed: async () => false };
  for (const [name, plan] of [
    ["free plan", { allowed: true, plan: "free", role: "seller" }],
    ["paid plan, active", { allowed: true, plan: "basic", role: "seller" }],
    ["the plan read failed (allowed, as for TikTok)", { allowed: true }],
  ] as const) {
    it(`${name} → connects exactly like a beta seller does on main (answer, requests, statuses, reader)`, async () => {
      const main = rig(createMain as unknown as Create, LIVE);                      // main, beta seller
      const here = rig(createShopeeLinkRuntime, LIVE, noBeta);
      const o = open(plan);
      const rm = await main.rt.connect({ ...base, shareLink: TW_LINK });
      const rh = await here.rt.connect({ ...base, shareLink: TW_LINK, access: o.access });
      expect(rm.status).toBe(200);
      expect(rh).toEqual(rm);
      expect(here.events).toEqual(main.events);
      expect(reqs(here.fetchImpl)).toEqual(reqs(main.fetchImpl));
      expect(here.rt.listPollers()).toEqual(main.rt.listPollers());
      expect(o.publicOn).toHaveBeenCalledWith("u1");
      expect(o.planCheck).toHaveBeenCalledWith(REQ);
    });
  }
  for (const [name, plan, code] of [
    ["paid plan, status expired", { allowed: false, reason: "expired" }, "plan_expired"],
    ["paid plan, past its date", { allowed: false, reason: "past_expiry" }, "plan_expired"],
    ["no profile row", { allowed: false, reason: "no_profile" }, "no_profile"],
  ] as const) {
    it(`${name} → 403 ${code}; nothing is asked of Shopee, no reader, no status`, async () => {
      const logs: string[] = [];
      const h = rig(createShopeeLinkRuntime, LIVE, noBeta);
      const r = await h.rt.connect({ ...base, shareLink: TW_LINK, access: open(plan, (l) => logs.push(l)).access });
      expect(r).toEqual({ status: 403, json: { ok: false, error: code } });
      expect(h.fetchImpl).not.toHaveBeenCalled();
      expect(h.rt.listPollers()).toEqual([]);
      expect(h.events).toEqual([]);
      expect(logs).toEqual([`[SHOPEE-PUBLIC] refuse code=${code}`]);          // the word only: no email, name or link
    });
  }
  it("a plan check that throws allows (the TikTok connect allows when its plan read fails)", async () => {
    const h = rig(createShopeeLinkRuntime, LIVE, noBeta);
    const access = () => createShopeePublicGate({ publicOn: async () => ({ data: true, error: null }), planCheck: async () => { throw new Error("x"); } })(REQ);
    expect((await h.rt.connect({ ...base, shareLink: TW_LINK, access })).status).toBe(200);
  });
  it("the kill switch shopee_live_enabled still wins: 503 shopee_off, the access step is not asked", async () => {
    const h = rig(createShopeeLinkRuntime, LIVE, { ...noBeta, enabled: async () => false });
    const o = open({ allowed: true, plan: "free" });
    expect(await h.rt.connect({ ...base, shareLink: TW_LINK, access: o.access })).toEqual({ status: 503, json: { ok: false, error: "shopee_off" } });
    expect(o.publicOn).not.toHaveBeenCalled();
  });
  it("the same link checks as a beta seller: someone else's live, an ended live, a bad link", async () => {
    for (const [, map, link] of SCENARIOS.slice(3, 8)) {
      const main = rig(createMain as unknown as Create, map);
      const here = rig(createShopeeLinkRuntime, map, noBeta);
      expect(await here.rt.connect({ ...base, shareLink: link, access: open({ allowed: true, plan: "free" }).access })).toEqual(await main.rt.connect({ ...base, shareLink: link }));
    }
  });
  it("the account step still runs after it (the shop counts in the plan's accounts): full → 409 shop_limit", async () => {
    const h = rig(createShopeeLinkRuntime, LIVE, noBeta);
    const gate = vi.fn(async () => ({ ok: false, status: 409, code: "shop_limit", info: { used: 1, limit: 1 } }));
    const r = await h.rt.connect({ ...base, shareLink: TW_LINK, access: open({ allowed: true, plan: "free" }).access, gate });
    expect(r).toEqual({ status: 409, json: { ok: false, error: "shop_limit", used: 1, limit: 1 } });
    expect(gate).toHaveBeenCalledWith({ region: "tw", uid: "254298659" });
    expect(h.rt.listPollers()).toEqual([]);
  });
  it("the route hands the request to the access step", async () => {
    const h = rig(createShopeeLinkRuntime, LIVE, noBeta);
    const handlers: Record<string, unknown[]> = {};
    const app = { post: (p: string, ...mw: unknown[]) => { handlers[p] = mw; }, get: () => {} };
    const publicGate = vi.fn(async () => ({ ok: false, status: 403, code: "plan_expired" }));
    h.rt.registerRoutes(app, vi.fn(), { requireConnectRate: vi.fn(), publicGate });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req = { ...REQ, body: { shareLink: TW_LINK, sessionId: "b" } };
    await (handlers["/shopee/live/connect"][2] as (q: unknown, s: unknown) => Promise<void>)(req, res);
    expect(publicGate).toHaveBeenCalledWith(req);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "plan_expired" });
  });
});

describe("C — a beta row", () => {
  it("ACTIVE (or an admin): today's connect; neither the database rule nor the plan is asked — even an expired plan connects", async () => {
    const main = rig(createMain as unknown as Create, LIVE);
    const here = rig(createShopeeLinkRuntime, LIVE);                            // betaAllowed → true
    const o = open({ allowed: false, reason: "expired" });
    const rh = await here.rt.connect({ ...base, shareLink: TW_LINK, access: o.access });
    expect(rh).toEqual(await main.rt.connect({ ...base, shareLink: TW_LINK }));
    expect(rh.status).toBe(200);
    expect(here.events).toEqual(main.events);
    expect(o.publicOn).not.toHaveBeenCalled();
    expect(o.planCheck).not.toHaveBeenCalled();
  });
  it("ENDED + Shopee open: follows the plan like everyone else (free connects, an expired paid plan does not)", async () => {
    const ended = { betaAllowed: async () => false };                           // server.js: expires_at in the past → false
    const free = rig(createShopeeLinkRuntime, LIVE, ended);
    expect((await free.rt.connect({ ...base, shareLink: TW_LINK, access: open({ allowed: true, plan: "free" }).access })).status).toBe(200);
    const exp = rig(createShopeeLinkRuntime, LIVE, ended);
    expect(await exp.rt.connect({ ...base, shareLink: TW_LINK, access: open({ allowed: false, reason: "past_expiry" }).access })).toEqual({ status: 403, json: { ok: false, error: "plan_expired" } });
  });
  it("ENDED + Shopee not open: main's 403 no_beta", async () => {
    const h = rig(createShopeeLinkRuntime, LIVE, { betaAllowed: async () => false });
    expect(await h.rt.connect({ ...base, shareLink: TW_LINK, access: NOT_OPEN[1][1]! })).toEqual(NO_BETA);
  });
});

const server = readFileSync("server.js", "utf8");

describe("D — the plan rule is the TikTok connect's own (server.js checkPlanActive, lifted from the file)", () => {
  const from = server.indexOf("async function checkPlanActive(email, authUserId, token) {");
  const src = server.slice(from, server.indexOf("\nasync function requirePlanActive(", from));
  const real = (row: unknown, error: unknown = null) => new Function("sb", "SUPABASE_URL", "SUPABASE_KEY", "createClient", "PLAN_ENFORCEMENT_ENABLED", "console", `${src}; return checkPlanActive;`)(
    {}, "https://x", "k",
    () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }) }),
    true, { log: () => {} },
  ) as (e: string, u: string, t: string) => Promise<{ allowed: boolean; reason?: string }>;
  const day = 86_400_000;
  const gateFor = (row: unknown, error: unknown = null) => createShopeePublicGate({
    publicOn: async () => ({ data: true, error: null }),
    planCheck: (req: { userEmail: string; authUserId: string; authToken: string }) => real(row, error)(req.userEmail, req.authUserId, req.authToken),
  })(REQ);

  it("found in server.js, and /connect/tiktok goes through it with the same three arguments", () => {
    expect(from).toBeGreaterThan(0);
    expect(server).toContain("const result = await checkPlanActive(req.userEmail, req.authUserId, req.authToken);");
    expect(server).toMatch(/app\.post\("\/connect\/tiktok", requireAuth, requireConnectRate, requirePlanActive,/);
    expect(server).toContain("planCheck: (req) => checkPlanActive(req.userEmail, req.authUserId, req.authToken),");
  });
  for (const [name, row, want] of [
    ["free plan", { plan: "free", plan_status: "active", plan_expiry: null, role: "seller" }, { ok: true }],
    ["free plan with an old date", { plan: "free", plan_status: "active", plan_expiry: new Date(Date.now() - 40 * day).toISOString(), role: "seller" }, { ok: true }],
    ["basic, active, 10 days left", { plan: "basic", plan_status: "active", plan_expiry: new Date(Date.now() + 10 * day).toISOString(), role: "seller" }, { ok: true }],
    ["master, no date", { plan: "master", plan_status: "active", plan_expiry: null, role: "seller" }, { ok: true }],
    ["basic, status expired", { plan: "basic", plan_status: "expired", plan_expiry: new Date(Date.now() + 10 * day).toISOString(), role: "seller" }, { ok: false, status: 403, code: "plan_expired" }],
    ["pro, a day past its date", { plan: "pro", plan_status: "active", plan_expiry: new Date(Date.now() - day).toISOString(), role: "seller" }, { ok: false, status: 403, code: "plan_expired" }],
    ["no profile row", null, { ok: false, status: 403, code: "no_profile" }],
  ] as const) {
    it(`${name} → ${JSON.stringify(want)}`, async () => { expect(await gateFor(row)).toEqual(want); });
  }
  it("the profile read failing → allowed (as for TikTok)", async () => {
    expect(await gateFor(null, { message: "rls" })).toEqual({ ok: true });
  });
});

describe("E — the wiring in server.js", () => {
  it("the access step asks the database function with the seller's id and is handed to the Shopee routes", () => {
    expect(server).toContain('import { createShopeePublicGate } from "./server/shopeePublic.js";');
    expect(server).toContain('publicOn: (userId) => serviceSb.rpc("shopee_public_on", { p_user: String(userId || "") }),');
    expect(server).toContain("shopeeLinkRuntime.registerRoutes(app, requireAuth, { requireConnectRate, accountGate, publicGate });");
  });
  it("the beta rule (admin, or a beta row that has not ended) is main's, word for word", () => {
    expect(server).toContain(`      betaAllowed: async (userId) => {
        const uid = String(userId || "");
        if (!uid) return false;
        const prof = await serviceSb.from("seller_profiles").select("role").eq("auth_user_id", uid).maybeSingle();
        if (!prof.error && prof.data && String(prof.data.role || "").toLowerCase() === "admin") return true;
        const row = await serviceSb.from("shopee_beta").select("expires_at").eq("user_id", uid).maybeSingle();
        if (row.error || !row.data || !row.data.expires_at) return false;
        return new Date(row.data.expires_at).getTime() > Date.now();
      },`);
  });
  it("the reader file: only the connect decision and the route line differ from main (the comment reader is untouched)", () => {
    const strip = (s: string) => s.split("\n");
    const mainLines = strip(readFileSync("src/redesign/adapters/__tests__/fixtures/shopeeLiveLink.main206.js", "utf8")).slice(4).map((l) => l.replace("../../../../../server/shopeeDiag.js", "./shopeeDiag.js"));
    const hereLines = strip(readFileSync("server/shopeeLiveLink.js", "utf8"));
    const onlyHere = hereLines.filter((l) => !mainLines.includes(l));
    const onlyMain = mainLines.filter((l) => !hereLines.includes(l));
    expect(onlyMain).toHaveLength(4);       // the connect signature, the one-line beta refusal, the extra-options line, the connect call
    expect(onlyHere).toHaveLength(10);
    for (const l of [...onlyHere, ...onlyMain]) expect(l).not.toMatch(/pollOnce|startPoller\(|stopPoller|emitComment|seen|cursor|dedupe/i);
    const a = hereLines.indexOf(onlyHere[0]), b = hereLines.indexOf(onlyHere[onlyHere.length - 1]);
    expect(hereLines.slice(0, a)).toEqual(mainLines.slice(0, a));                 // everything above the connect decision
    expect(b - a).toBeLessThan(40);                                               // …and the changed lines sit together, inside connect + the route
    expect(hereLines.slice(a, b + 1).join("\n")).toContain("async function connect(");
  });
});
