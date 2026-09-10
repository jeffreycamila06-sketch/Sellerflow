// Global app_settings (key/value) — sql/32_app_settings.sql. RLS lets any
// authenticated user READ and only is_admin() WRITE. These tests exercise the
// generic get/set adapter against a chainable Supabase mock.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable hooks the mock reads so each test can steer the response.
const state: {
  single: { data: unknown; error: unknown };
  upsertError: unknown;
  sessionUid: string | null;
  upsertArg: Record<string, unknown> | null;
  upsertOpts: unknown;
  eqKey: string | null;
} = { single: { data: null, error: null }, upsertError: null, sessionUid: "admin-1", upsertArg: null, upsertOpts: null, eqKey: null };

class FakeQuery {
  select() { return this; }
  eq(_col: string, val: string) { state.eqKey = val; return this; }
  maybeSingle() { return Promise.resolve(state.single); }
  upsert(arg: Record<string, unknown>, opts: unknown) {
    state.upsertArg = arg; state.upsertOpts = opts;
    return Promise.resolve({ error: state.upsertError });
  }
}

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(() => new FakeQuery()),
    auth: { getSession: vi.fn(async () => ({ data: { session: state.sessionUid ? { user: { id: state.sessionUid } } : null } })) },
  },
}));

import { getAppSetting, setAppSetting } from "../appSettings";

beforeEach(() => {
  state.single = { data: null, error: null };
  state.upsertError = null; state.sessionUid = "admin-1";
  state.upsertArg = null; state.upsertOpts = null; state.eqKey = null;
});

describe("getAppSetting", () => {
  it("returns {value, updatedAt} for a present row, keyed by the requested key", async () => {
    state.single = { data: { value: "60", updated_at: "2026-09-10T00:00:00Z" }, error: null };
    expect(await getAppSetting("shipping_default_fee")).toEqual({ value: "60", updatedAt: "2026-09-10T00:00:00Z" });
    expect(state.eqKey).toBe("shipping_default_fee");
  });
  it("null on no row", async () => {
    state.single = { data: null, error: null };
    expect(await getAppSetting("k")).toBeNull();
  });
  it("null on error (caller supplies its own fail-safe)", async () => {
    state.single = { data: null, error: { message: "boom" } };
    expect(await getAppSetting("k")).toBeNull();
  });
  it("coerces non-string value/updated_at to string, null → null", async () => {
    state.single = { data: { value: 60, updated_at: null }, error: null };
    expect(await getAppSetting("k")).toEqual({ value: "60", updatedAt: null });
  });
});

describe("setAppSetting", () => {
  it("upserts the key/value with updated_by from the session, onConflict key", async () => {
    const r = await setAppSetting("shipping_default_fee", "45");
    expect(r).toEqual({ ok: true });
    expect(state.upsertArg).toMatchObject({ key: "shipping_default_fee", value: "45", updated_by: "admin-1" });
    expect(state.upsertArg?.updated_at).toBeTypeOf("string");
    expect(state.upsertOpts).toEqual({ onConflict: "key" });
  });
  it("omits updated_by when there is no session", async () => {
    state.sessionUid = null;
    await setAppSetting("k", "v");
    expect(state.upsertArg).not.toHaveProperty("updated_by");
  });
  it("surfaces a DB error (e.g. RLS reject for a non-admin) as { ok:false }", async () => {
    state.upsertError = { message: "permission denied" };
    expect(await setAppSetting("k", "v")).toEqual({ ok: false, error: "permission denied" });
  });
});
