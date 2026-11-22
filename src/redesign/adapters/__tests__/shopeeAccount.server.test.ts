// Shopee shop = one account (sql/199): the server's account step (server/shopeeAccount.js) and the reader's use of
// it (server/shopeeLiveLink.js — gate after the host check, POST /shopee/live/remove).
// PARITY: a seller outside the preview gets "off" → the branch reader answers, requests, emits and logs EXACTLY
// like main's (frozen copy fixtures/shopeeLiveLink.main199.js) — with the gate and without it.
import { describe, it, expect, vi } from "vitest";
import { createShopeeLinkRuntime } from "../../../../server/shopeeLiveLink.js";
import { createShopeeLinkRuntime as createMain } from "./fixtures/shopeeLiveLink.main199.js";
import { createShopeeAccountGate, isMissingFunctionError } from "../../../../server/shopeeAccount.js";

const TW_LINK = "https://live.shopee.tw/share?from=live&session=8092367&share_user_id=254298659";
const PH_LINK = "https://live.shopee.ph/share?from=live&session=777&share_user_id=42";
const hostBody = (over: Record<string, unknown> = {}) => ({ err_code: 0, data: { session: { session_id: 8092367, uid: 254298659, title: "sale", status: 1, chatroom_id: "SPIM-X", ...over } } });
const mkRes = (status: number, body: unknown, location?: string) => ({ status, json: async () => body, headers: { get: (k: string) => (k === "location" ? location || null : null) } });
const fetchByUrl = (map: Record<string, (u: string) => unknown>) => vi.fn(async (u: string) => { for (const [k, f] of Object.entries(map)) if (u.includes(k)) return f(u); return mkRes(404, { error: "error_not_found" }); });

function rig(create: typeof createShopeeLinkRuntime, fetchMap: Record<string, (u: string) => unknown>, over: Record<string, unknown> = {}) {
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

const SCENARIOS: Array<[string, Record<string, (u: string) => unknown>, string, Record<string, unknown>?]> = [
  ["TW own live", { "host_session?uid=254298659": () => mkRes(200, hostBody()) }, TW_LINK],
  ["PH own live", { "host_session?uid=42": () => mkRes(200, hostBody({ uid: 42, session_id: 777 })) }, PH_LINK],
  ["short link", { "tw.shp.ee/": () => mkRes(301, null, TW_LINK), "host_session?uid=254298659": () => mkRes(200, hostBody()) }, "https://tw.shp.ee/jBv7BMm9"],
  ["someone else's live", { "host_session": () => mkRes(200, hostBody({ session_id: 1 })) }, TW_LINK],
  ["ended", { "host_session": () => mkRes(200, hostBody({ status: 2 })) }, TW_LINK],
  ["bad link", {}, "https://www.tiktok.com/@x/live"],
  ["unreachable", { "host_session": () => mkRes(500, null) }, TW_LINK],
  ["blocked", { "host_session": () => mkRes(403, null) }, TW_LINK],
  ["switch off", { "host_session": () => mkRes(200, hostBody()) }, TW_LINK, { enabled: async () => false }],
  ["no beta", { "host_session": () => mkRes(200, hostBody()) }, TW_LINK, { betaAllowed: async () => false }],
];
const base = { sellerId: "seller-1", userId: "u1", email: "s@x", sessionId: "browser-abc" };
// each request: url + headers + redirect mode (the abort signal is a new object per call)
const reqs = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([u, o]: [string, { headers?: unknown; redirect?: unknown }]) => [u, o && o.headers, o && o.redirect]);

describe("parity — a seller outside the preview gets today's connect (frozen main copy)", () => {
  for (const [name, map, link, over] of SCENARIOS) {
    it(`${name}: same answer, requests, statuses, account write and log lines`, async () => {
      const main = rig(createMain as unknown as typeof createShopeeLinkRuntime, map, over);
      const noGate = rig(createShopeeLinkRuntime, map, over);
      const offGate = rig(createShopeeLinkRuntime, map, over);
      const gateCalls: unknown[] = [];
      const rm = await main.rt.connect({ ...base, shareLink: link });
      const rn = await noGate.rt.connect({ ...base, shareLink: link });
      const ro = await offGate.rt.connect({ ...base, shareLink: link, gate: async (a: unknown) => { gateCalls.push(a); return { ok: true }; } });
      expect(rn).toEqual(rm); expect(ro).toEqual(rm);
      expect(noGate.events).toEqual(main.events); expect(offGate.events).toEqual(main.events);
      expect(reqs(noGate.fetchImpl)).toEqual(reqs(main.fetchImpl));
      expect(reqs(offGate.fetchImpl)).toEqual(reqs(main.fetchImpl));
      expect(noGate.rt.listPollers()).toEqual(main.rt.listPollers());
      expect(offGate.rt.listPollers()).toEqual(main.rt.listPollers());
      // the gate is asked only for a verified own live, with the region and the host uid
      expect(gateCalls.length).toBe(rm.status === 200 ? 1 : 0);
    });
  }
  it("main has no remove route, and the branch adds one only when removeShop is given", () => {
    const handlers: string[] = [];
    const app = { post: (p: string) => { handlers.push(p); }, get: () => {} };
    rig(createShopeeLinkRuntime, {}).rt.registerRoutes(app, vi.fn(), {});
    expect(handlers).toEqual(["/shopee/live/connect"]);
  });
});

describe("the reader with a refusing account step", () => {
  const live = { "host_session?uid=254298659": () => mkRes(200, hostBody()) };
  it("shop_limit → 409 with the numbers; no reader, no 'connected', no account write", async () => {
    const h = rig(createShopeeLinkRuntime, live);
    const r = await h.rt.connect({ ...base, shareLink: TW_LINK, gate: async () => ({ ok: false, status: 409, code: "shop_limit", info: { used: 1, limit: 1 } }) });
    expect(r).toEqual({ status: 409, json: { ok: false, error: "shop_limit", used: 1, limit: 1 } });
    expect(h.rt.listPollers()).toEqual([]);
    expect(h.events.some((e) => e.startsWith("status") || e.startsWith("remember"))).toBe(false);
    expect(h.events).toContain("log [SHOPEE-ACCT] refuse seller=seller-1 code=shop_limit");
  });
  it("a gate that throws → 503 try_again (a database error refuses)", async () => {
    const h = rig(createShopeeLinkRuntime, live);
    expect(await h.rt.connect({ ...base, shareLink: TW_LINK, gate: async () => { throw new Error("db"); } })).toEqual({ status: 503, json: { ok: false, error: "try_again" } });
    expect(h.rt.listPollers()).toEqual([]);
  });
  it("the gate gets the region and the host uid of the verified live", async () => {
    const h = rig(createShopeeLinkRuntime, live);
    const gate = vi.fn(async () => ({ ok: true }));
    await h.rt.connect({ ...base, shareLink: TW_LINK, gate });
    expect(gate).toHaveBeenCalledWith({ region: "tw", uid: "254298659" });
    expect(h.rt.listPollers()).toHaveLength(1);
  });
  it("the route passes the request to the account step (the seller's own login for the live rule)", async () => {
    const h = rig(createShopeeLinkRuntime, live);
    const handlers: Record<string, unknown[]> = {};
    const app = { post: (p: string, ...mw: unknown[]) => { handlers[p] = mw; }, get: () => {} };
    const accountGate = vi.fn(async () => ({ ok: false, status: 409, code: "not_covered" }));
    h.rt.registerRoutes(app, vi.fn(), { requireConnectRate: vi.fn(), accountGate });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req = { sellerId: "seller-1", authUserId: "u1", userEmail: "s@x", authToken: "jwt", body: { shareLink: TW_LINK, sessionId: "b" } };
    await (handlers["/shopee/live/connect"][2] as (q: unknown, s: unknown) => Promise<void>)(req, res);
    expect(accountGate).toHaveBeenCalledWith(req, { region: "tw", uid: "254298659" });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "not_covered" });
  });
});

describe("POST /shopee/live/remove", () => {
  async function setup(removeShop: (u: string, k: string) => Promise<boolean>) {
    const h = rig(createShopeeLinkRuntime, {}, { removeShop });
    h.rt.startPoller({ sellerId: "seller-1", userId: "u1", region: "ph", uid: "42", liveSessionId: "777", chatroomId: "c", sessionId: "b" });
    h.rt.startPoller({ sellerId: "seller-2", userId: "u2", region: "ph", uid: "55", liveSessionId: "9", chatroomId: "c", sessionId: "b" });
    const handlers: Record<string, unknown[]> = {};
    const app = { post: (p: string, ...mw: unknown[]) => { handlers[p] = mw; }, get: () => {} };
    const requireAuth = vi.fn();
    h.rt.registerRoutes(app, requireAuth, {});
    const call = async (sellerId: string, authUserId: string, key: unknown) => {
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await (handlers["/shopee/live/remove"][1] as (q: unknown, s: unknown) => Promise<void>)({ sellerId, authUserId, body: { key } }, res);
      return res;
    };
    return { h, call, chain: handlers["/shopee/live/remove"], requireAuth };
  }
  it("requires sign-in; stops only this seller's read of that shop, then removes it", async () => {
    const removeShop = vi.fn(async () => true);
    const { h, call, chain, requireAuth } = await setup(removeShop);
    expect(chain[0]).toBe(requireAuth);
    const res = await call("seller-1", "u1", "ph:42");
    expect(res.json).toHaveBeenCalledWith({ ok: true, stopped: true });
    expect(removeShop).toHaveBeenCalledWith("u1", "ph:42");
    expect(h.rt.listPollers().map((p) => p.sellerId)).toEqual(["seller-2"]);
    expect(h.events.some((e) => e.includes("reason") && e.includes("removed"))).toBe(true);
  });
  it("another seller's same shop key never stops the other reader", async () => {
    const { h, call } = await setup(vi.fn(async () => true));
    await call("seller-1", "u1", "ph:55");
    expect(h.rt.listPollers().map((p) => p.sellerId).sort()).toEqual(["seller-1", "seller-2"]);
  });
  it("bad key → 400; nothing removed → 404; a database error → 503 try_again", async () => {
    const a = await setup(vi.fn(async () => true));
    for (const k of ["", "x", "ph:", "id:42", "ph:4 2", 42]) expect((await a.call("seller-1", "u1", k)).status).toHaveBeenCalledWith(400);
    const b = await setup(vi.fn(async () => false));
    expect((await b.call("seller-1", "u1", "ph:9")).status).toHaveBeenCalledWith(404);
    const c = await setup(vi.fn(async () => { throw new Error("db"); }));
    const r = await c.call("seller-1", "u1", "ph:9");
    expect(r.status).toHaveBeenCalledWith(503);
    expect(r.json).toHaveBeenCalledWith({ ok: false, error: "try_again" });
  });
});

describe("the account step (server/shopeeAccount.js)", () => {
  const req = { authUserId: "u1", authToken: "jwt" };
  const gateWith = (data: unknown, opts: { error?: unknown; live?: unknown; throws?: boolean } = {}) => {
    const lines: string[] = [];
    const register = vi.fn(async () => { if (opts.throws) throw new Error("x"); return { data, error: opts.error ?? null }; });
    const liveCheck = vi.fn(async () => opts.live ?? { allow: true });
    return { gate: createShopeeAccountGate({ register, liveCheck, log: (l: string) => lines.push(l) }), register, liveCheck, lines };
  };
  it("off → go on, no live check (today's connect)", async () => {
    const g = gateWith({ result: "off" });
    expect(await g.gate(req, { region: "ph", uid: "42" })).toEqual({ ok: true });
    expect(g.register).toHaveBeenCalledWith("u1", "ph", "42");
    expect(g.liveCheck).not.toHaveBeenCalled();
  });
  it("sql/199 not applied yet (function missing) → go on", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function" }, { code: "42883" }]) {
      expect(await gateWith(null, { error }).gate(req, { region: "ph", uid: "42" })).toEqual({ ok: true });
    }
    expect(isMissingFunctionError(null)).toBe(false);
    expect(isMissingFunctionError({ code: "XX000" })).toBe(false);
  });
  it("existing / added → the live rule with the seller's own request: covered → go on, not covered → 409", async () => {
    for (const result of ["existing", "added"]) {
      const g = gateWith({ result, key: "ph:42" });
      expect(await g.gate(req, { region: "ph", uid: "42" })).toEqual({ ok: true });
      expect(g.liveCheck).toHaveBeenCalledWith(req, "shopee", "ph:42");
      expect(await gateWith({ result, key: "ph:42" }, { live: { allow: false, rank: 2, limit: 1 } }).gate(req, { region: "ph", uid: "42" })).toEqual({ ok: false, status: 409, code: "not_covered" });
    }
  });
  it("full → 409 shop_limit; locked → 409 shop_locked with the wait end and the server's now", async () => {
    expect(await gateWith({ result: "full", used: 1, limit: 1 }).gate(req, { region: "ph", uid: "42" })).toEqual({ ok: false, status: 409, code: "shop_limit", info: { used: 1, limit: 1 } });
    expect(await gateWith({ result: "locked", used: 2, limit: 2, next_free_at: "2026-11-22T12:00:00Z", now: "2026-11-22T09:45:00Z" }).gate(req, { region: "ph", uid: "42" }))
      .toEqual({ ok: false, status: 409, code: "shop_locked", info: { used: 2, limit: 2, next_free_at: "2026-11-22T12:00:00Z", now: "2026-11-22T09:45:00Z" } });
  });
  it("a database error, a throw, bad_request or an odd answer → 503 try_again; log lines never carry the uid", async () => {
    for (const g of [gateWith(null, { error: { code: "XX000", message: "boom" } }), gateWith(null, { throws: true }), gateWith({ result: "bad_request" }), gateWith({}), gateWith(null)]) {
      expect(await g.gate(req, { region: "ph", uid: "987654321" })).toEqual({ ok: false, status: 503, code: "try_again" });
      expect(g.lines.join("\n")).not.toContain("987654321");
    }
  });
  it("a live check that throws is treated as allowed (the same fail-open as every live check)", async () => {
    const register = vi.fn(async () => ({ data: { result: "existing", key: "ph:42" }, error: null }));
    const gate = createShopeeAccountGate({ register, liveCheck: async () => { throw new Error("x"); } });
    expect(await gate(req, { region: "ph", uid: "42" })).toEqual({ ok: true });
  });
});

describe("server.js wiring (source pins — server.js has no test harness)", () => {
  it("the account step and the remove route are wired with the service-role register and the seller's live check", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync("server.js", "utf8");
    expect(s).toContain('import { createShopeeAccountGate } from "./server/shopeeAccount.js";');
    expect(s).toContain('register: (userId, region, uid) => serviceSb.rpc("shopee_link_register", { p_user: String(userId || ""), p_region: region, p_uid: String(uid || "") }),');
    expect(s).toContain("liveCheck: accountLiveCheck,");
    expect(s).toContain("shopeeLinkRuntime.registerRoutes(app, requireAuth, { requireConnectRate, accountGate });");
    expect(s).toMatch(/from\("shopee_link_shops"\)\.delete\(\)\.eq\("user_id", String\(userId \|\| ""\)\)\.eq\("account_key", String\(key \|\| ""\)\)/);
    expect(s).toContain('stillConnected: (uid, key) => (String(key).includes(":") ? gone("shopee_link_shops", "account_key", String)(uid, key)');
  });
});
