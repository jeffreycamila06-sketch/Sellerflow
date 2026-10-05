// GET /fb/oauth/start runs the same plan checks as POST /fb/connect: requirePlanActive (preview
// accounts skip it on start only) → requireFbPlan. Refused → the same 403s as connect and no auth
// URL. FAKE data only; requirePlanActive is a fake that behaves like checkPlanActive.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbPlanCheck } from "../../../../server/fbAccess.js";
import { createFbRuntime } from "../../../../server/fbLive.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
type Profile = { plan: string; plan_status: string; role: string; past_expiry?: boolean };

// Like checkPlanActive: plan "free" passes whatever its status; a paid plan with status "expired"
// or a past expiry is refused (403 plan_expired); attaches req.sellerPlan / req.sellerRole.
function fakeRequirePlanActive(profile: Profile) {
  return vi.fn((req: Record<string, unknown>, res: { status: (c: number) => { json: (b: unknown) => unknown } }, next: () => void) => {
    if (profile.plan !== "free" && (profile.plan_status === "expired" || profile.past_expiry)) {
      return res.status(403).json({ success: false, error: "plan_expired", message: "Your plan has expired. Please upgrade." });
    }
    req.sellerPlan = profile.plan; req.sellerRole = profile.role;
    return next();
  });
}

function start(profile: Profile, opts: { email?: string; receiptAccess?: boolean } = {}) {
  const store = {
    async hasReceiptAccess() { return opts.receiptAccess === true; },
    async getPage() { return null; }, async getPlan() { return profile.plan; }, async countPages() { return 0; }, async listPages() { return []; },
    async upsertPage() {}, async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {},
  };
  const rt = createFbRuntime({ config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (s: string, p: string, x: string) => `${s}:${p}:${x}`,
    renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl: vi.fn(), now: () => 1, setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} });
  const requirePlanActive = fakeRequirePlanActive(profile);
  const readProfile = vi.fn(async () => profile);
  const routes: Record<string, ((q: unknown, s: unknown, n: () => void) => unknown)[]> = {};
  const app = { get: (p: string, ...h: never[]) => { routes[`GET ${p}`] = h; }, post: (p: string, ...h: never[]) => { routes[`POST ${p}`] = h; } };
  rt.registerRoutes(app as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never, { requirePlanActive, requireFbPlan: createFbPlanCheck({ readProfile }) });
  return {
    routes, requirePlanActive,
    async run() {
      let status = 200; let json: Record<string, unknown> = {};
      const res = { status(c: number) { status = c; return this; }, json(b: Record<string, unknown>) { json = b; return this; } };
      const req = { authUserId: "user-1", sellerId: "user-1", userEmail: opts.email ?? "seller@example.com", query: {}, body: {} };
      for (const h of routes["GET /fb/oauth/start"]) { let go = false; await h(req, res, () => { go = true; }); if (!go) break; }
      return { status, json };
    },
  };
}
const scopes = (url: string) => String(new URLSearchParams(url.split("?")[1]).get("scope")).split(",");

describe("Authorize refused like connect — no auth URL", () => {
  it("free + expired → 403 plan_expired, no URL", async () => {
    const r = await start({ plan: "free", plan_status: "expired", role: "seller" }).run();
    expect(r).toEqual({ status: 403, json: { ok: false, error: "plan_expired" } });
  });
  it("paid + expired (status or past expiry) → 403 plan_expired from requirePlanActive, no URL", async () => {
    for (const p of [{ plan: "pro", plan_status: "expired", role: "seller" }, { plan: "basic", plan_status: "active", role: "seller", past_expiry: true }]) {
      const r = await start(p).run();
      expect(r.status).toBe(403);
      expect(r.json.error).toBe("plan_expired");
      expect(r.json.url).toBeUndefined();
    }
  });
});

describe("Authorize allowed as today", () => {
  it("free + active and paid + active → URL with the normal 3 scopes", async () => {
    for (const p of [{ plan: "free", plan_status: "active", role: "seller" }, { plan: "pro", plan_status: "active", role: "seller" }]) {
      const r = await start(p).run();
      expect(r.status).toBe(200);
      expect(scopes(String(r.json.url))).toEqual(["pages_show_list", "pages_read_engagement", "pages_read_user_content"]);
    }
  });
  it("each preview account → URL even on an expired paid or free plan; messaging scope with receipt access", async () => {
    for (const email of ["camilajeffrey1@gmail.com", "GoogleTest@gmail.com", " test@gmail.com "]) {
      for (const p of [{ plan: "plus", plan_status: "expired", role: "seller" }, { plan: "free", plan_status: "pending", role: "seller" }]) {
        const s = start(p, { email, receiptAccess: true });
        const r = await s.run();
        expect(r.status, `${email} ${p.plan}`).toBe(200);
        expect(scopes(String(r.json.url))).toContain("pages_messaging");
        expect(s.requirePlanActive).not.toHaveBeenCalled();
      }
      expect(scopes(String((await start({ plan: "plus", plan_status: "active", role: "seller" }, { email }).run()).json.url))).toHaveLength(3);
    }
  });
  it("admin → URL (with the messaging scope when it has receipt access)", async () => {
    const r = await start({ plan: "master", plan_status: "active", role: "admin" }, { receiptAccess: true }).run();
    expect(r.status).toBe(200);
    expect(scopes(String(r.json.url))).toContain("pages_messaging");
    const free = await start({ plan: "free", plan_status: "expired", role: "Admin" }).run();
    expect(free.status).toBe(200);                       // requireFbPlan passes admins
  });
});

describe("callback and connect unchanged", () => {
  it("route chains: start gets the plan checks; callback and connect are as before", () => {
    const s = start({ plan: "pro", plan_status: "active", role: "seller" });
    expect(s.routes["GET /fb/oauth/start"]).toHaveLength(5);      // auth, lock, startPlanActive, requireFbPlan, handler
    expect(s.routes["GET /fb/oauth/callback"]).toHaveLength(1);
    expect(s.routes["POST /fb/connect"]).toHaveLength(6);         // auth, lock, rate, plan, fbPlan, handler
    const src = readFileSync("server/fbLive.js", "utf8");
    expect(src).toContain('app.get("/fb/oauth/start", requireAuth, requireFbAvailable, startPlanActive, requireFbPlan, async');
    expect(src).toContain('app.get("/fb/oauth/callback", async (req, res) => {');
    expect(src).toContain('app.post("/fb/connect", requireAuth, requireFbAvailable, requireConnectRate, requirePlanActive, requireFbPlan, async');
    expect(src).toContain("const startPlanActive = (req, res, next) => (fbPreviewEmail(req.userEmail) ? next() : requirePlanActive(req, res, next));");
  });
});
