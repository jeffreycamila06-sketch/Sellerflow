// FACEBOOK LIVE — Phase 3 client adapter (fb.ts). Mocks the Supabase singleton +
// global fetch. Pins: fail-closed flag; listFbPages NEVER selects the token column;
// remove; auth-start; connect (ok+live_video_id / not_live / 403 / unreachable);
// disconnect; the pure ?fb= return parser; and the active-paid eligibility gate.
// Mirror of shopee.test.ts.
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
  loadFbEnabled, listFbPages, removeFbPage, startFbAuth,
  fbConnect, fbDisconnect, parseFbReturn, isFbEligible,
} from "../fb";

const mkRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  state.listResult = { data: [], error: null };
  state.deleteResult = { error: null };
  state.single = { data: null, error: null };
  state.lastTable = null; state.lastSelect = null; state.eqVal = null;
  vi.restoreAllMocks();
});

describe("loadFbEnabled — fail-closed", () => {
  it('only the literal "true" opens it', async () => {
    state.single = { data: { value: "true", updated_at: null }, error: null };
    expect(await loadFbEnabled()).toBe(true);
  });
  it.each(["false", "1", "TRUE", "", null])('value %s → false', async (v) => {
    state.single = { data: { value: v, updated_at: null }, error: null };
    expect(await loadFbEnabled()).toBe(false);
  });
  it("missing row → false", async () => {
    state.single = { data: null, error: null };
    expect(await loadFbEnabled()).toBe(false);
  });
});

describe("listFbPages", () => {
  it("maps rows and NEVER selects the token column", async () => {
    state.listResult = { data: [{ id: "r1", page_id: "P1", page_name: "My Page", page_username: "mypage", active: true }], error: null };
    const out = await listFbPages();
    expect(out).toEqual([{ id: "r1", pageId: "P1", name: "My Page", username: "mypage", active: true }]);
    expect(state.lastTable).toBe("fb_pages");
    expect(state.lastSelect).toBe("id,page_id,page_name,page_username,active");
    expect(state.lastSelect).not.toMatch(/token/);
  });
  it("error → [] (never throws)", async () => {
    state.listResult = { data: null, error: { message: "boom" } };
    expect(await listFbPages()).toEqual([]);
  });
});

describe("removeFbPage", () => {
  it("deletes by id → ok", async () => {
    const r = await removeFbPage("r1");
    expect(r.ok).toBe(true);
    expect(state.eqVal).toBe("r1");
  });
  it("db error → { ok:false }", async () => {
    state.deleteResult = { error: { message: "denied" } };
    const r = await removeFbPage("r1");
    expect(r).toEqual({ ok: false, error: "denied" });
  });
});

describe("startFbAuth", () => {
  it("returns the signed url + attaches the JWT bearer", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(200, { url: "https://www.facebook.com/v25.0/dialog/oauth?x=1" }));
    vi.stubGlobal("fetch", f);
    const r = await startFbAuth();
    expect(r).toEqual({ ok: true, url: "https://www.facebook.com/v25.0/dialog/oauth?x=1" });
    const [url, opts] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/fb\/oauth\/start$/);
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer JWT123");
  });
  it("non-2xx → { ok:false }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(500, { error: "x" })));
    expect((await startFbAuth()).ok).toBe(false);
  });
  it("fetch throws → { ok:false, error:'unreachable' }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await startFbAuth()).toEqual({ ok: false, error: "unreachable" });
  });
});

describe("fbConnect", () => {
  it("posts { page_id, sessionId } and returns ok + live_video_id", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(200, { ok: true, live_video_id: "LV42" }));
    vi.stubGlobal("fetch", f);
    const r = await fbConnect("P1");
    expect(r).toEqual({ ok: true, liveVideoId: "LV42" });
    const [url, opts] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/fb\/connect$/);
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.page_id).toBe("P1");
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId).not.toBe("");
  });

  // SESSION-ID CONTRACT (client half): the body carries THIS browser's session id — the
  // exact value useLiveFeed filters on and connect.ts sends for TikTok — so the server can
  // stamp it on every FB comment/status. Without it every FB event was dropped client-side.
  it("sends THIS browser's session id (== browserSessionId(), the value useLiveFeed filters on)", async () => {
    const ls = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => { ls.set(k, v); },
    });
    const { browserSessionId } = await import("../serverIdentity");
    const mine = browserSessionId();                       // persisted → stable for this browser
    const f = vi.fn().mockResolvedValue(mkRes(200, { ok: true, live_video_id: "LV42" }));
    vi.stubGlobal("fetch", f);
    await fbConnect("P1");
    const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(body.sessionId).toBe(mine);
    expect(body.sessionId).toMatch(/^sf-/);                // browser-session shape, never a live-video id
    vi.unstubAllGlobals();
  });
  it("{ ok:false, reason:'not_live' } passes through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(200, { ok: false, reason: "not_live" })));
    expect(await fbConnect("P1")).toEqual({ ok: false, reason: "not_live", error: undefined });
  });
  it("403 (expired plan) → { ok:false, error }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(403, { error: "plan_expired" })));
    expect(await fbConnect("P1")).toEqual({ ok: false, error: "plan_expired" });
  });
  it("fetch throws → unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const r = await fbConnect("P1");
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBe(true);
  });
});

describe("fbDisconnect", () => {
  it("posts { page_id } → ok", async () => {
    const f = vi.fn().mockResolvedValue(mkRes(200, { ok: true }));
    vi.stubGlobal("fetch", f);
    expect((await fbDisconnect("P1")).ok).toBe(true);
    expect(String(f.mock.calls[0][0])).toMatch(/\/fb\/disconnect$/);
    expect(JSON.parse((f.mock.calls[0][1] as { body: string }).body)).toEqual({ page_id: "P1" });
  });
});

describe("parseFbReturn — pure", () => {
  it("?fb=connected", () => { expect(parseFbReturn("?fb=connected")).toEqual({ status: "connected" }); });
  it("?fb=error&code=cap", () => { expect(parseFbReturn("?fb=error&code=cap")).toEqual({ status: "error", code: "cap" }); });
  it("no fb param → null", () => { expect(parseFbReturn("?foo=1")).toBeNull(); expect(parseFbReturn("")).toBeNull(); });
  it("does NOT match the shopee param (no cross-parse)", () => { expect(parseFbReturn("?shopee=connected")).toBeNull(); });
});

describe("isFbEligible — active-paid gate", () => {
  const future = new Date(Date.now() + 30 * 864e5).toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  it("active paid → true", () => { expect(isFbEligible({ plan: "pro", planStatus: "active", planExpiry: future, role: "seller" })).toBe(true); });
  it("expired paid → false", () => { expect(isFbEligible({ plan: "pro", planStatus: "active", planExpiry: past, role: "seller" })).toBe(false); });
  it("free → false", () => { expect(isFbEligible({ plan: "free", planStatus: "active", planExpiry: future, role: "seller" })).toBe(false); });
  it("admin → true regardless of plan", () => { expect(isFbEligible({ plan: "free", planStatus: "expired", planExpiry: past, role: "admin" })).toBe(true); });
  it("null → false", () => { expect(isFbEligible(null)).toBe(false); });
  it("allowlisted Meta App Review account on the FREE plan → true (permanent bypass)", () => {
    expect(isFbEligible({ email: "test@gmail.com", plan: "free", planStatus: "active", role: "seller" })).toBe(true);
    expect(isFbEligible({ email: "  TEST@gmail.com ", plan: "free", planStatus: "active", role: "seller" })).toBe(true);
  });
  it("allowlisted account with an EXPIRED paid plan → still true (bypass can't lapse)", () => {
    expect(isFbEligible({ email: "googletest@gmail.com", plan: "plus", planStatus: "active", planExpiry: past, role: "seller" })).toBe(true);
  });
  it("NON-allowlisted free seller → still false (fleet unchanged)", () => {
    expect(isFbEligible({ email: "random@seller.com", plan: "free", planStatus: "active", planExpiry: future, role: "seller" })).toBe(false);
  });
});
