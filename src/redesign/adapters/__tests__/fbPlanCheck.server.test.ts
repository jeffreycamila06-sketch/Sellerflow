// Facebook-only plan check on POST /fb/connect (server/fbAccess.js createFbPlanCheck) — mirrors
// the client's isFbEligible: a FREE plan must be "active"; admin and preview accounts pass; a
// paid plan keeps requirePlanActive's decision. TikTok / Shopee and checkPlanActive unchanged.
// FAKE data only.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbPlanCheck, fbPlanAllowed, isFreePlanName } from "../../../../server/fbAccess.js";
import { createFbRuntime } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import { isFbEligible } from "../fb";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const PAGE = { user_id: "user-1", page_id: "P1", page_name: "Mine", page_username: "mine", active: true, access_token: encryptToken("PAGETOK", "tk") };
type Profile = { plan: string; plan_status: string; role: string } | null;

function connect(opts: { profile?: Profile; readError?: boolean; sellerPlan?: string; sellerRole?: string; email?: string } = {}) {
  const readProfile = vi.fn(async () => { if (opts.readError) throw new Error("db"); return opts.profile ?? null; });
  const graph = vi.fn(async () => ({ status: 200, json: async () => ({ data: [{ id: "LV1", status: "LIVE" }] }) }));
  const store = {
    async getPage(uid: string, pid: string) { return uid === PAGE.user_id && pid === PAGE.page_id ? { ...PAGE } : null; },
    async getPlan() { return "pro"; }, async countPages() { return 1; }, async listPages() { return [PAGE]; },
    async upsertPage() {}, async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {},
  };
  const rt = createFbRuntime({ config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (s: string, p: string, x: string) => `${s}:${p}:${x}`,
    renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl: graph, now: () => 1, setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} });
  const routes: Record<string, ((q: unknown, s: unknown, n: () => void) => unknown)[]> = {};
  const app = { get: (p: string, ...h: never[]) => { routes[`GET ${p}`] = h; }, post: (p: string, ...h: never[]) => { routes[`POST ${p}`] = h; } };
  rt.registerRoutes(app as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never, { requireFbPlan: createFbPlanCheck({ readProfile }) });
  return {
    rt, graph, readProfile,
    async run() {
      let status = 200; let json: unknown = null;
      const res = { status(c: number) { status = c; return this; }, json(b: unknown) { json = b; return this; } };
      const req: Record<string, unknown> = { authUserId: "user-1", sellerId: "user-1", userEmail: opts.email ?? "seller@example.com", body: { page_id: "P1" } };
      if (opts.sellerPlan !== undefined) req.sellerPlan = opts.sellerPlan;   // attached by requirePlanActive
      if (opts.sellerRole !== undefined) req.sellerRole = opts.sellerRole;
      for (const h of routes["POST /fb/connect"]) { let go = false; await h(req, res, () => { go = true; }); if (!go) break; }
      return { status, json };
    },
  };
}
const OK = { status: 200, json: { ok: true, live_video_id: "LV1" } };
const REFUSED = { status: 403, json: { ok: false, error: "plan_expired" } };

describe("free plan on /fb/connect", () => {
  it("free + active → allowed (poller starts)", async () => {
    const c = connect({ sellerPlan: "free", sellerRole: "seller", profile: { plan: "free", plan_status: "active", role: "seller" } });
    expect(await c.run()).toEqual(OK);
    expect(c.rt._pollers.size).toBe(1);
  });
  for (const status of ["expired", "pending", "", "ACTIVE", " active"]) {
    it(`free + status ${JSON.stringify(status)} → 403 plan_expired; no Graph call, no poller`, async () => {
      const c = connect({ sellerPlan: "free", sellerRole: "seller", profile: { plan: "free", plan_status: status, role: "seller" } });
      expect(await c.run()).toEqual(REFUSED);
      expect(c.graph).not.toHaveBeenCalled();
      expect(c.rt._pollers.size).toBe(0);
    });
  }
  it('"FREE" / "Free" / " free " are treated as free (letter case ignored, like the client)', async () => {
    for (const plan of ["FREE", "Free", " free "]) {
      expect(isFreePlanName(plan)).toBe(true);
      expect(await connect({ sellerPlan: plan, sellerRole: "seller", profile: { plan, plan_status: "expired", role: "seller" } }).run(), plan).toEqual(REFUSED);
      expect(await connect({ sellerPlan: plan, sellerRole: "seller", profile: { plan, plan_status: "active", role: "seller" } }).run(), plan).toEqual(OK);
    }
  });
});

describe("paid, admin, preview", () => {
  it("paid plan → requirePlanActive's decision stands; no extra read", async () => {
    for (const plan of ["basic", "plus", "pro", "master"]) {
      const c = connect({ sellerPlan: plan, sellerRole: "seller" });
      expect(await c.run(), plan).toEqual(OK);
      expect(c.readProfile).not.toHaveBeenCalled();
    }
  });
  it("admin → allowed even on an expired free plan; no extra read", async () => {
    const c = connect({ sellerPlan: "free", sellerRole: "Admin", profile: { plan: "free", plan_status: "expired", role: "admin" } });
    expect(await c.run()).toEqual(OK);
    expect(c.readProfile).not.toHaveBeenCalled();
  });
  it("each preview account → allowed even on an expired free plan", async () => {
    for (const email of ["camilajeffrey1@gmail.com", "GoogleTest@gmail.com", " test@gmail.com "]) {
      expect(await connect({ email, sellerPlan: "free", sellerRole: "seller", profile: { plan: "free", plan_status: "expired", role: "seller" } }).run(), email).toEqual(OK);
    }
  });
});

describe("plan not on the request / read failures", () => {
  it("requirePlanActive failed open (no sellerPlan) → decided from the fresh row", async () => {
    expect(await connect({ profile: { plan: "free", plan_status: "pending", role: "seller" } }).run()).toEqual(REFUSED);
    expect(await connect({ profile: { plan: "pro", plan_status: "active", role: "seller" } }).run()).toEqual(OK);
  });
  it("read fails: unknown plan → allowed (consistent with requirePlanActive's fail-open); known free → refused", async () => {
    expect(await connect({ readError: true }).run()).toEqual(OK);
    expect(await connect({ readError: true, sellerPlan: "free", sellerRole: "seller" }).run()).toEqual(REFUSED);
  });
  it("no profile row → refused", async () => {
    expect(await connect({ sellerPlan: "free", profile: null }).run()).toEqual(REFUSED);
  });
});

describe("mirrors the client's isFbEligible for free plans", () => {
  it("same answer for every free status and role", () => {
    for (const plan of ["free", "FREE", "Free"]) for (const planStatus of ["active", "expired", "pending", ""]) for (const role of ["seller", "admin"]) {
      expect(fbPlanAllowed({ email: "x@y.com", role, plan, planStatus }), `${plan}/${planStatus}/${role}`)
        .toBe(isFbEligible({ email: "x@y.com", role, plan, planStatus }));
    }
  });
});

describe("only Facebook connect changes", () => {
  const src = readFileSync("server.js", "utf8");
  it("checkPlanActive still lets plan 'free' through before the status (TikTok/Shopee unchanged)", () => {
    expect(src).toContain('if (plan === "free") {');
    expect(src).toMatch(/app\.post\("\/connect\/tiktok", requireAuth, requireConnectRate, requirePlanActive, async/);
    expect(src).toContain("shopeeRuntime.registerRoutes(app, requireAuth, { requireConnectRate, requirePlanActive });");
    expect(src.match(/requireFbPlan/g)!.length).toBe(2); // defined + passed to the FB runtime only
  });
  it("server.js reads plan, plan_status and role with the service role for the check", () => {
    expect(src).toContain('serviceSb.from("seller_profiles").select("plan, plan_status, role").eq("auth_user_id", String(userId || "")).maybeSingle()');
    expect(src).toContain("fbRuntime.registerRoutes(app, requireAuth, { requireConnectRate, requirePlanActive, requireFbAvailable, requireFbPlan });");
  });
  it("/fb/connect runs the plan check after requirePlanActive", () => {
    const live = readFileSync("server/fbLive.js", "utf8");
    expect(live).toContain('app.post("/fb/connect", requireAuth, requireFbAvailable, requireConnectRate, requirePlanActive, requireFbPlan, async');
  });
});
