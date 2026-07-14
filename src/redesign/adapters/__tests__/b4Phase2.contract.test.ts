// B4 PHASE 2 SOURCE CONTRACT (server.js has no vitest harness — same
// convention as the SQL/iosCjkEncoding contract tests: pin the STRUCTURE so
// the enforcement's load-bearing properties can't silently regress).
//
// Pins (each maps to an audit condition):
//   • 409 BYTE-PARITY (Jeff condition #2): the reuse-branch not_live 409 body
//     is LITERALLY IDENTICAL to the fresh-path 409 body — the existing client
//     toast+gray handling works with ZERO client change.
//   • 3b SEAM: the not_live teardown RETURNS BEFORE the ring re-emit and the
//     A4 platform_viewers re-emit — no stale history/count accompanies a 409.
//   • R2 OWNERSHIP GUARD: after the await, tiktokConnections.get(key) is
//     compared against the stale reference before ANY action.
//   • C1: verify defaults to the single-GET Euler source; the legacy 3-tier
//     HTML walk is RETAINED behind REUSE_VERIFY_SOURCE=tiers (not deleted);
//     strict-boolean is_live acceptance (anything else → ambiguous → fail-open).
//   • WATCH MARKERS (Jeff condition #1): [REUSE-VERIFY] logging survives the
//     flip with enforced-outcome markers — BLOCKED / allowed / fail-open.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");

// The reuse branch region: from the reuse decision to the fresh-path lock.
// (The lock check also appears earlier in the reconnect scheduler — anchor the
// end search AFTER the region start.)
const reuseStart = server.indexOf("if (!shouldForceFreshConnect(existing.lastEventAt");
const reuse = server.slice(reuseStart, server.indexOf("tiktokConnectLocks.has(key)", reuseStart));

describe("409 byte-parity — reuse-branch not_live ≡ fresh-path not_live", () => {
  it("both 409 bodies are literally identical (client needs zero change)", () => {
    const bodies = [...server.matchAll(/res\.status\(409\)\.json\(\{[\s\S]*?\}\);/g)]
      .map((m) => m[0].replace(/\s+/g, " "))
      .filter((b) => b.includes("notLive: true"));
    expect(bodies).toHaveLength(2); // reuse branch + fresh path — no third drift copy
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).toContain('"Account is not live right now. Start your TikTok LIVE first."');
  });
});

describe("3b seam — the not_live teardown returns before every reuse emit", () => {
  it("409 return < ring re-emit < viewer re-emit, all inside the reuse branch", () => {
    const i409 = reuse.indexOf("notLive: true");
    const iRing = reuse.indexOf("[INITIAL] reuse re-emit");
    const iViewers = reuse.indexOf('emit("platform_viewers"');
    expect(i409).toBeGreaterThan(-1);
    expect(iRing).toBeGreaterThan(-1);
    expect(iViewers).toBeGreaterThan(-1);
    expect(i409).toBeLessThan(iRing);      // teardown+return BEFORE history
    expect(i409).toBeLessThan(iViewers);   // …and BEFORE the stale count
  });

  it("the teardown mirrors the fresh-path 409: timer, map, reconnect, attempt record, terminal status", () => {
    const block = reuse.slice(reuse.indexOf('verdict === "not_live"'), reuse.indexOf("notLive: true"));
    for (const step of [
      "clearTikTokHealthTimer(existing)",
      "tiktokConnections.delete(key)",
      "clearTikTokReconnect(key)",
      "tiktokReconnectAttempts.delete(key)",
      'recordTikTokAttempt("not_live", "reuse-verify")',
      'reason: "not_live"',
    ]) expect(block).toContain(step);
  });
});

describe("R2 ownership guard — never act on a stale reference after the await", () => {
  it("the verify is awaited, then the map is re-read and compared before any action", () => {
    const iAwait = reuse.indexOf("await verifyReuse(key");
    const iGuard = reuse.indexOf("tiktokConnections.get(key)");
    expect(iAwait).toBeGreaterThan(-1);
    expect(iGuard).toBeGreaterThan(iAwait); // re-read AFTER the yield
    expect(reuse).toMatch(/owned && owned === existing && verdict === "not_live"/);
    expect(reuse).toMatch(/owned && owned === existing/); // reuse flow gated too
    // The mismatch path falls through to the fresh connect (idempotent).
    expect(reuse).toContain("ownership moved mid-verify");
  });
});

describe("C1 retired to option (W1: direct room_id is Business-plan paywalled) — tiers default, euler behind the flag", () => {
  it("defaults to the free-tier tiers walk (no dead 401 GET per verify); strict-boolean acceptance kept", () => {
    // W1 production capture: euler-direct returned 401 "This endpoint
    // requires a Business plan." on every call — the tiers walk carried the
    // whole trilogy validation, so it is the default now.
    expect(server).toMatch(/REUSE_VERIFY_SOURCE = process\.env\.REUSE_VERIFY_SOURCE \|\| "tiers"/);
    expect(server).toMatch(/d\.code === 200 && typeof d\.is_live === "boolean"/);
  });
  it("the euler direct route is RETAINED behind the env flag (Business-plan unlock, zero code change)", () => {
    expect(server).toContain("fetchRoomIdFromEuler({ uniqueId: cleanUsername })");
    expect(server).toMatch(/REUSE_VERIFY_SOURCE === "tiers"\s*\n?\s*\? probe\.fetchIsLive\(\)/);
  });
});

describe("watch markers — the 48hr post-flip kill-signal logging", () => {
  it("[REUSE-VERIFY] logs the enforced outcome: BLOCKED / allowed / fail-open", () => {
    expect(server).toMatch(/verdict === "not_live" \? "BLOCKED" : verdict === "live" \? "allowed" : "allowed \(fail-open\)"/);
    // The Phase-1 "(log-only)" marker is gone from the LOG LINE (comments may
    // still mention the phase history).
    expect(server).not.toMatch(/\$\{.*\}ms \(log-only\)/);
  });
});
