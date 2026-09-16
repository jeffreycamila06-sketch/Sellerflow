// SHOPEE LIVE — Phase 3 client adapter (shopee.ts). Mocks the Supabase singleton +
// global fetch. Pins: fail-closed flag; listShopeeShops NEVER selects token columns;
// remove; auth-start; connect (ok / not_live / 403 / unreachable); disconnect; the
// pure ?shopee= return parser; and the active-paid eligibility gate.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  listResult: { data: unknown; error: unknown };
  deleteResult: { error: unknown };
  single: { data: unknown; error: unknown };
  lastTable: string | null;
  lastSelect: string | null;
  eqVal: string | null;
} = { listResult: { data: [], error: null }, deleteResult: { error: null }, single: { data: null, error: null }, lastTable: null, lastSelect: null, eqVal: null };

class FakeQuery {
  private deleting = false;
  constructor(table: string) { state.lastTable = table; }
  select(cols: string) { state.lastSelect = cols; return this; }
  order() { return Promise.resolve(state.listResult); }
  delete() { this.deleting = true; return this; }
  eq(_col: string, val: string) { state.eqVal = val; return this.deleting ? Promise.resolve(state.deleteResult) : this; }
  maybeSingle() { return Promise.resolve(state.single); }
}

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((t: string) => new FakeQuery(t)),
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "JWT123" } } })) },
  },
}));

import {
  loadShopeeEnabled, listShopeeShops, removeShopeeShop, startShopeeAuth,
  shopeeConnect, shopeeDisconnect, parseShopeeReturn, isShopeeEligible,
} from "../shopee";

const mkRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  state.listResult = { data: [], error: null };
  state.deleteResult = { error: null };
  state.single = { data: null, error: null };
  state.lastTable = null; state.lastSelect = null; state.eqVal = null;
  vi.restoreAllMocks();
});

describe("loadShopeeEnabled — fail-closed", () => {
  it('only the literal "true" opens it', async () => {
    state.single = { data: { value: "true", updated_at: null }, error: null };
    expect(await loadShopeeEnabled()).toBe(true);
  });
  it.each(["false", "1", "TRUE", "", null])('value %s → false', async (v) => {
    state.single = { data: { value: v, updated_at: null }, error: null };
    expect(await loadShopeeEnabled()).toBe(false);
  });
  it("missing row → false", async () => {
    state.single = { data: null, error: null };
    expect(await loadShopeeEnabled()).toBe(false);
  });
});

describe("listShopeeShops", () => {
  it("maps rows and NEVER selects token columns", async () => {
    state.listResult = { data: [{ id: "r1", shop_id: 555, shop_name: "My Shop", active: true }], error: null };
    const out = await listShopeeShops();
    expect(out).toEqual([{ id: "r1", shopId: 555, shopName: "My Shop", active: true }]);
    expect(state.lastTable).toBe("shopee_shops");
    // the select list must be exactly the 4 non-secret columns
    expect(state.lastSelect).toBe("id,shop_id,shop_name,active");
    expect(state.lastSelect).not.toMatch(/token/);
  });
  it("error → [] (never throws)", async () => {
    state.listResult = { data: null, error: { message: "boom" } };
    expect(await listShopeeShops()).toEqual([]);
  });
});

describe("removeShopeeShop", () => {
  it("deletes by id → ok", async () => {
    const r = await removeShopeeShop("r1");
    expect(r.ok).toBe(true);
    expect(state.eqVal).toBe("r1");
  });
  it("db error → { ok:false }", async () => {
    state.deleteResult = { error: { message: "denied" } };
    const r = await removeShopeeShop("r1");
    expect(r).toEqual({ ok: false, error: "denied" });
  });
});

describe("startShopeeAuth", () => {
  it("returns the signed url + attaches the JWT bearer", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(200, { url: "https://partner.shopee/auth?x=1" }));
    vi.stubGlobal("fetch", f);
    const r = await startShopeeAuth();
    expect(r).toEqual({ ok: true, url: "https://partner.shopee/auth?x=1" });
    const [url, opts] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/shopee\/oauth\/start$/);
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer JWT123");
  });
  it("non-2xx → { ok:false }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(500, { error: "x" })));
    expect((await startShopeeAuth()).ok).toBe(false);
  });
  it("fetch throws → { ok:false, error:'unreachable' }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await startShopeeAuth()).toEqual({ ok: false, error: "unreachable" });
  });
});

describe("shopeeConnect", () => {
  it("posts { shop_id, session_id } and returns ok", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(200, { ok: true, session_id: "S9" }));
    vi.stubGlobal("fetch", f);
    const r = await shopeeConnect(555, "S9");
    expect(r).toEqual({ ok: true, sessionId: "S9" });
    const [url, opts] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/shopee\/connect$/);
    expect(JSON.parse((opts as { body: string }).body)).toEqual({ shop_id: "555", session_id: "S9" });
  });
  it("{ ok:false, reason:'not_live' } passes through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(200, { ok: false, reason: "not_live" })));
    expect(await shopeeConnect(555, "")).toEqual({ ok: false, reason: "not_live", error: undefined });
  });
  it("403 (expired plan) → { ok:false, error }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(403, { error: "plan_expired" })));
    expect(await shopeeConnect(555, "S")).toEqual({ ok: false, error: "plan_expired" });
  });
  it("fetch throws → unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const r = await shopeeConnect(555, "S");
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBe(true);
  });
});

describe("shopeeDisconnect", () => {
  it("posts { shop_id } → ok", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(200, { ok: true }));
    vi.stubGlobal("fetch", f);
    expect((await shopeeDisconnect(555)).ok).toBe(true);
    expect(String(f.mock.calls[0][0])).toMatch(/\/shopee\/disconnect$/);
  });
});

describe("parseShopeeReturn — pure", () => {
  it("?shopee=connected", () => { expect(parseShopeeReturn("?shopee=connected")).toEqual({ status: "connected" }); });
  it("?shopee=error&code=cap", () => { expect(parseShopeeReturn("?shopee=error&code=cap")).toEqual({ status: "error", code: "cap" }); });
  it("no shopee param → null", () => { expect(parseShopeeReturn("?foo=1")).toBeNull(); expect(parseShopeeReturn("")).toBeNull(); });
});

describe("isShopeeEligible — active-paid gate (item 7)", () => {
  const future = new Date(Date.now() + 30 * 864e5).toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  it("active paid → true", () => { expect(isShopeeEligible({ plan: "pro", planStatus: "active", planExpiry: future, role: "seller" })).toBe(true); });
  it("expired paid → false", () => { expect(isShopeeEligible({ plan: "pro", planStatus: "active", planExpiry: past, role: "seller" })).toBe(false); });
  it("free → false", () => { expect(isShopeeEligible({ plan: "free", planStatus: "active", planExpiry: future, role: "seller" })).toBe(false); });
  it("admin → true regardless of plan", () => { expect(isShopeeEligible({ plan: "free", planStatus: "expired", planExpiry: past, role: "admin" })).toBe(true); });
  it("null → false", () => { expect(isShopeeEligible(null)).toBe(false); });
});
