// sql/86 — Session-RPC v2 hardening, client half.
//  1. connectIsSwitch: a known server platform decides (H1); NULL → today's in-app check.
//  2. startSession maps the server's "session_switch_needed" to SESSION_SWITCH_NEEDED and
//     changes nothing locally; every other answer is handled exactly as before.
//  3. A TikTok-only seller is byte-identical to the pre-sql/86 client in every input.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { connectIsSwitch, isPlatformSwitch, livePlatformOf, type SourcePlatform } from "../liveSource";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { current_session_id: "sid-old" }, error: null }) }) }) }),
    rpc: rpcMock,
  },
}));
import { useSessionInstance, SESSION_SWITCH_NEEDED, isSwitchNeeded } from "../useSessionInstance";

// The rule BEFORE sql/86 (verbatim copy of isServerPlatformSwitch's body) — the reference
// a TikTok-only seller must match.
const before = (server: string | null | undefined, next: SourcePlatform) => !!server && server !== next;

beforeEach(() => { vi.clearAllMocks(); });

describe("connectIsSwitch — TikTok-only seller is byte-identical to before", () => {
  // TikTok-only: the server platform is only ever 'TikTok' or unknown, no Shopee shop
  // (shopeeEff false), every connect targets TikTok; ttEff can be anything.
  for (const server of ["TikTok", null, undefined, ""] as const) {
    for (const ttEff of [true, false]) {
      it(`server=${JSON.stringify(server)} ttEff=${ttEff} → continue (same as before)`, () => {
        const got = connectIsSwitch(server, "TikTok", { ttEff, shopeeEff: false });
        expect(got).toBe(before(server, "TikTok"));
        expect(got).toBe(false);
      });
    }
  }
});

describe("connectIsSwitch — H1: the server platform decides, not the live flags", () => {
  it("outgoing TikTok locally Disconnected (ttEff false) → Facebook connect is still a switch", () => {
    expect(connectIsSwitch("TikTok", "Facebook", { ttEff: false, shopeeEff: false })).toBe(true);
    // the old in-app check alone would have missed it
    expect(isPlatformSwitch(livePlatformOf({ ttEff: false, shopeeEff: false }), "Facebook")).toBe(false);
  });
  it("outgoing TikTok in the 60 s recovering window (not effective) → Shopee connect is still a switch", () => {
    expect(connectIsSwitch("TikTok", "Shopee", { ttEff: false, shopeeEff: false })).toBe(true);
  });
  it("outgoing Facebook, TikTok connect → switch, whatever the TikTok flag says", () => {
    expect(connectIsSwitch("Facebook", "TikTok", { ttEff: true, shopeeEff: false })).toBe(true);
    expect(connectIsSwitch("Facebook", "TikTok", { ttEff: false, shopeeEff: false })).toBe(true);
  });
  it("a stale flag never forces a reset when the server platform matches", () => {
    expect(connectIsSwitch("Facebook", "Facebook", { ttEff: true, shopeeEff: true })).toBe(false);
  });
});

describe("connectIsSwitch — NULL server platform → today's in-app check (sql/86 item d1)", () => {
  it("Shopee live in the app, TikTok connect → switch (the in-app check catches it)", () => {
    expect(connectIsSwitch(null, "TikTok", { ttEff: false, shopeeEff: true })).toBe(true);
    expect(before(null, "TikTok")).toBe(false); // sql/46 client continued here
  });
  it("nothing live in the app → continue", () => {
    expect(connectIsSwitch(null, "Facebook", { ttEff: false, shopeeEff: false })).toBe(false);
  });
  it("same platform live in the app → continue", () => {
    expect(connectIsSwitch(undefined, "TikTok", { ttEff: true, shopeeEff: false })).toBe(false);
  });
});

describe("startSession — switch needed (sql/86 item d2)", () => {
  async function mounted() {
    const h = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(h.result.current.loaded).toBe(true));
    return h;
  }
  it("server raises session_switch_needed → SESSION_SWITCH_NEEDED, current id untouched", async () => {
    const { result } = await mounted();
    expect(result.current.currentSessionId).toBe("sid-old");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "session_switch_needed", code: "P0001" } });
    let r: string | null = "x";
    await act(async () => { r = await result.current.startSession(1, "Facebook", false); });
    expect(r).toBe(SESSION_SWITCH_NEEDED);
    expect(result.current.currentSessionId).toBe("sid-old");
  });
  it("any other error → null, exactly as before", async () => {
    const { result } = await mounted();
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "invalid session length: 9" } });
    let r: string | null = "x";
    await act(async () => { r = await result.current.startSession(9, "TikTok", false); });
    expect(r).toBeNull();
  });
  it("success → the id, exactly as before (TikTok-only always lands here or on reuse)", async () => {
    const { result } = await mounted();
    rpcMock.mockResolvedValueOnce({ data: "sid-new", error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
    let r: string | null = null;
    await act(async () => { r = await result.current.startSession(1, "TikTok", false); });
    expect(r).toBe("sid-new");
    expect(rpcMock).toHaveBeenCalledWith("start_session", { p_days: 1, p_platform: "TikTok", p_force: false });
  });
  it("isSwitchNeeded matches only that message", () => {
    expect(isSwitchNeeded({ message: "session_switch_needed" })).toBe(true);
    expect(isSwitchNeeded({ message: "boom" })).toBe(false);
    expect(isSwitchNeeded(null)).toBe(false);
  });
});

// sql/86 text contract (CI cannot run Postgres; scripts/sql46-behaviour.mjs runs it for real).
import { readFileSync } from "node:fs";
describe("sql/86 file contract", () => {
  const fwd = readFileSync("sql/86_session_rpc_v2.sql", "utf8");
  const back = readFileSync("sql/86_session_rpc_v2_rollback.sql", "utf8");
  it("raises exactly the message the client looks for", () => {
    expect(fwd).toContain(`raise exception '${SESSION_SWITCH_NEEDED}'`);
  });
  it("same signature via create or replace — no drop, SECURITY INVOKER, own row", () => {
    for (const f of [fwd, back]) {
      expect(f).toContain("create or replace function public.start_session(p_days smallint, p_platform text default null, p_force boolean default false)");
      expect(f).toContain("security invoker");
      expect(f).toContain("v_uid      uuid := (select auth.uid());");
      expect(f.replace(/--.*$/gm, "")).not.toMatch(/drop\s+function/i);
    }
  });
  it("reuse is kept for same platform and for either side unknown; force path untouched", () => {
    expect(fwd).toContain("if v_platform is null or p_platform is null or v_platform = p_platform then");
    expect(fwd).toContain("if not p_force then");
  });
});
