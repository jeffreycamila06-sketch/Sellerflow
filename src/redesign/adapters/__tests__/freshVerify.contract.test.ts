// FRESH-VERIFY SOURCE CONTRACT (the third and LAST zombie-green door,
// 2026-07-14 — the kimmyukay capture). server.js has no vitest harness, so
// the structure is pinned here (same convention as b4Phase2.contract.test).
//
// Jeff's approved pins:
//   1. TERMINAL-ON-RECONNECT (the zombie-loop kill): a not_live verdict on a
//      health reconnect ends in the terminal path — live_session_ended +
//      return — and can NEVER reach the retry re-schedule.
//   2. FRESH-TAP 409 NON-DRIFT: the pre-verify throw rides the EXISTING
//      notLiveError plumbing — still exactly TWO byte-identical 409 bodies
//      in the whole file (no third drift copy).
//   3. FAIL-OPEN (the chentrendyukay protection): ONLY not_live blocks; a
//      genuinely ambiguous verdict proceeds to connect().
//   Plus: the check sits BEFORE connect() and covers every caller; the 4a
//   status-code rejection is documented in-code so it is never re-proposed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");

// startTikTokConnection region (up to the health-timer start that follows it).
const startFn = server.slice(
  server.indexOf("async function startTikTokConnection"),
  server.indexOf("startTikTokHealthTimer(key, tiktokConnection)"),
);

describe("placement — one gate, before connect(), covering every caller", () => {
  it("FRESH-VERIFY runs inside startTikTokConnection BEFORE the connection is even constructed", () => {
    const iVerify = startFn.indexOf('verifyIsLive(key, cleanUsername, "FRESH-VERIFY")');
    const iNew = startFn.indexOf("new WebcastPushConnection");
    const iConnect = startFn.indexOf("tiktokConnection.connect()");
    expect(iVerify).toBeGreaterThan(-1);
    expect(iNew).toBeGreaterThan(-1);
    expect(iVerify).toBeLessThan(iNew);      // before any connect work
    expect(iVerify).toBeLessThan(iConnect);  // and certainly before connect()
  });

  it("shares the C1 core: same single-flight map, same tagged marker line, REUSE tag preserved", () => {
    expect(server).toContain("async function verifyIsLive(key, cleanUsername, tag)");
    expect(server).toMatch(/return verifyIsLive\(key, cleanUsername, "REUSE-VERIFY"\);/);
    // The 48hr-watch marker line survives, now tag-parameterized.
    expect(server).toMatch(/verdict === "not_live" \? "BLOCKED" : verdict === "live" \? "allowed" : "allowed \(fail-open\)"/);
  });
});

describe("pin 1 — terminal on reconnect: the zombie loop STOPS", () => {
  it("the reconnect catch's notLive branch emits live_session_ended and returns BEFORE any re-schedule", () => {
    // The retry callback region: from the reconnect catch to the retry_failed re-schedule.
    const iCatch = server.indexOf("TikTok reconnect failed for");
    const region = server.slice(iCatch, server.indexOf('scheduleTikTokReconnect(key, username, sellerId, sessionId, "retry_failed")', iCatch));
    expect(region).toContain("error.notLive");
    expect(region).toContain("clearTikTokReconnect(key)");
    expect(region).toContain('emit("live_session_ended"');
    expect(region).toContain("return;"); // terminal — the retry_failed re-schedule below is unreachable for notLive
  });
});

describe("pin 2 — fresh-tap 409 non-drift: existing plumbing, no third copy", () => {
  it("the pre-verify throw sets notLive=true (the plumbing both callers already handle)", () => {
    const block = startFn.slice(startFn.indexOf('preVerdict === "not_live"'), startFn.indexOf("new WebcastPushConnection"));
    expect(block).toContain("notLiveError.notLive = true");
    expect(block).toContain('notLiveError.liveStatus = "euler_is_live_false"');
  });
  it("still exactly TWO byte-identical notLive 409 bodies in the whole file", () => {
    const bodies = [...server.matchAll(/res\.status\(409\)\.json\(\{[\s\S]*?\}\);/g)]
      .map((m) => m[0].replace(/\s+/g, " "))
      .filter((b) => b.includes("notLive: true"));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });
});

describe("pin 3 — fail-open: only not_live blocks (the chentrendyukay protection)", () => {
  it("ambiguous/live proceed — the ONLY pre-verdict gate is the not_live equality", () => {
    const gates = [...startFn.matchAll(/preVerdict === "([a-z_]+)"/g)].map((m) => m[1]);
    expect(gates).toEqual(["not_live"]); // no ambiguous gate, no live gate — everything else falls through to connect()
  });
  it("the post-connect roomInfo gate remains as layer 2 (belt and suspenders)", () => {
    expect(startFn).toContain("[NOT-LIVE] fail-open (ambiguous, allowed)");
  });
  it("the 4a status-code rejection is documented in-code with the chentrendyukay data point", () => {
    expect(startFn).toContain("STATUS-CODE MAPPING DELIBERATELY REJECTED");
    expect(startFn).toContain("chentrendyukay LIVE with status_code 4003110");
  });
});

describe("wire-shape fix (2026-07-14 silent-ambiguous capture) — never silent, never gateless", () => {
  it("a shape mismatch THROWS a diagnostic instead of resolving undefined (the reason= suffix always carries the wire truth)", () => {
    expect(server).toContain("euler_shape code=");
    // The silent form that swallowed the failure must never return:
    expect(server).not.toMatch(/typeof d\.is_live === "boolean"\) \? d\.is_live : undefined/);
  });
  it("a direct-route failure falls back to the Phase-1-PROVEN tiers walk (the gate keeps functioning)", () => {
    expect(server).toContain("[VERIFY-FALLBACK] euler-direct failed");
    expect(server).toMatch(/eulerDirect\(\)\.catch\([\s\S]*?return probe\.fetchIsLive\(\);/);
  });
  it("the whole chain still races the single 4s timeout", () => {
    expect(server).toMatch(/Promise\.race\(\[fetchPromise, timeout\]\)/);
  });
});
