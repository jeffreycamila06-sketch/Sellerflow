// H2 (security audit 2026-09-26) — MISSING seller_profiles ROW = HARD DENY, never a
// free ride. A bare supabase.auth.signUp account with no profile row used to pass
// the plan check (fail-open), the account cap (!plan → allow) AND the concurrency
// cap (!plan → no cap): unlimited free concurrent lives burning the shared Euler
// quota. Now: a clean "no row" is BLOCKED at the plan check (HTTP /connect* AND the
// socket handshake share checkPlanActive), while the four genuine-infra paths keep
// failing OPEN so a Supabase outage never locks out paying sellers. The cap modules
// treat an unknown plan as the most restrictive tier (1), never unlimited.
// server.js has no vitest harness — source-contract pins + pure-module behavior.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { concurrencyCap, capDecision } from "../../../../server/concurrencyCap.js";
import { accountCapVerdict } from "../../../../server/accountCap.js";

const server = readFileSync("server.js", "utf8");

describe("H2 — checkPlanActive hard-denies a clean missing profile row", () => {
  it("the !data branch BLOCKS with reason no_profile (the old FAIL-OPEN is gone)", () => {
    expect(server).toContain('return { allowed: false, reason: "no_profile" };');
    expect(server).toContain("[PLAN_CHECK] BLOCK ${ctx} reason=no_profile");
    expect(server).not.toContain("err=no_profile_row -> FAIL-OPEN");
  });

  it("the four genuine-infra paths still FAIL OPEN (outage never locks out paying sellers)", () => {
    expect(server).toContain("err=no_supabase_client -> FAIL-OPEN (allowing)");
    expect(server).toContain("err=missing_auth_context -> FAIL-OPEN (allowing)");
    // query error + thrown error both keep the fail-open log shape:
    expect(server.match(/-> FAIL-OPEN \(allowing\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("requirePlanActive returns a DISTINCT 403 for no_profile (setup message, not 'plan expired')", () => {
    expect(server).toContain('error: "no_profile",');
    expect(server).toContain("Your account setup is incomplete");
    expect(server).toContain('error: "plan_expired",'); // the expiry body is still there for real expiries
  });

  it("the socket handshake denies no_profile too (no socket, no room, no comments)", () => {
    expect(server).toContain('next(new Error(planResult.reason === "no_profile" ? "no_profile" : "plan_expired"))');
  });
});

describe("H2 — the cap modules never grant unlimited on an empty plan", () => {
  it("concurrencyCap: unknown plan → 1 (admin stays uncapped)", () => {
    expect(concurrencyCap("", "seller")).toBe(1);
    expect(concurrencyCap(undefined, "seller")).toBe(1);
    expect(concurrencyCap("master", "seller")).toBe(5);
    expect(concurrencyCap("", "admin")).toBeNull();
  });

  it("cap 1 actually kicks/blocks a second concurrent live for an unknown plan", () => {
    const max = concurrencyCap(undefined, "seller");
    expect(capDecision({ realFresh: [{ key: "A", startedAt: 1 }], max })).toEqual({ action: "kick", keys: ["A"] });
    expect(capDecision({ realFresh: [], reservedCount: 1, max })).toEqual({ action: "block", keys: [] });
  });

  it("accountCapVerdict: unknown plan behaves as Basic (slot 1 of the registered list only)", () => {
    const base = { plan: undefined, role: "seller", tiktok: "myshop,second", facebook: "", platform: "TikTok" as const };
    expect(accountCapVerdict({ ...base, username: "myshop" }).allowed).toBe(true);
    expect(accountCapVerdict({ ...base, username: "second" }).allowed).toBe(false); // beyond cap 1
    expect(accountCapVerdict({ ...base, username: "anything" }).allowed).toBe(false);
  });
});
