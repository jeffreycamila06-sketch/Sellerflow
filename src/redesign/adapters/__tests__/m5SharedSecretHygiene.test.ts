// M5 (security audit 2026-09-26) — shared-secret hygiene. /test-comment is DELETED
// (it injected fake comments into arbitrary sellers' rooms behind a query-string
// secret and bypassed the sanitizer; zero production callers). The parcel-tracking
// poll endpoint now takes its secret via the X-Poll-Token HEADER only, compares it
// constant-time, and locks out after repeated bad tokens. Behavioral tests for the
// pure module + source-contract pins for the server.js wiring.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { timingSafeTokenEqual, makeFailureThrottle } from "../../../../server/pollAuth.js";

const server = readFileSync("server.js", "utf8");

describe("timingSafeTokenEqual — constant-time, never matches empties", () => {
  it("equal tokens match; unequal (incl. same-length + prefixes) don't", () => {
    expect(timingSafeTokenEqual("s3cret-token", "s3cret-token")).toBe(true);
    expect(timingSafeTokenEqual("s3cret-tokeN", "s3cret-token")).toBe(false); // same length
    expect(timingSafeTokenEqual("s3cret", "s3cret-token")).toBe(false);       // prefix
    expect(timingSafeTokenEqual("s3cret-token-x", "s3cret-token")).toBe(false);
  });
  it("empty/missing candidate or secret → false (an unset secret can never be 'matched')", () => {
    expect(timingSafeTokenEqual("", "x")).toBe(false);
    expect(timingSafeTokenEqual("x", "")).toBe(false);
    expect(timingSafeTokenEqual(undefined, "x")).toBe(false);
    expect(timingSafeTokenEqual("", "")).toBe(false);
  });
});

describe("makeFailureThrottle — lockout after max failures inside the window", () => {
  it("blocks on the (max)th failure, unblocks when the window expires, clears on success", () => {
    const t = makeFailureThrottle({ max: 3, windowMs: 1000 });
    const t0 = 1_000_000;
    expect(t.blocked(t0)).toBe(false);
    t.fail(t0); t.fail(t0 + 1);
    expect(t.blocked(t0 + 2)).toBe(false);   // 2 failures < max
    t.fail(t0 + 3);
    expect(t.blocked(t0 + 4)).toBe(true);    // 3rd failure → locked
    expect(t.blocked(t0 + 999)).toBe(true);  // still inside the window
    expect(t.blocked(t0 + 1004)).toBe(false); // window expired → open again
    t.fail(t0 + 1005); t.fail(t0 + 1006); t.fail(t0 + 1007);
    expect(t.blocked(t0 + 1008)).toBe(true);
    t.ok();                                   // successful auth clears everything
    expect(t.blocked(t0 + 1009)).toBe(false);
  });
});

describe("server.js wiring (source contract)", () => {
  it("/test-comment and TEST_COMMENT_TOKEN are gone", () => {
    expect(server).not.toContain('app.get("/test-comment"');
    expect(server).not.toContain("process.env.TEST_COMMENT_TOKEN");
  });

  it("the poll route reads the HEADER only — no query-string secret anywhere", () => {
    expect(server).not.toContain("req.query.token");
    const route = server.slice(server.indexOf('app.post("/admin/parcel-tracking-poll"'));
    expect(route.slice(0, 1200)).toContain('req.headers["x-poll-token"]');
  });

  it("throttle → constant-time compare → fail() on mismatch → ok() on success, all BEFORE the run", () => {
    const route = server.slice(server.indexOf('app.post("/admin/parcel-tracking-poll"'), server.indexOf("runParcelPollOnce();", server.indexOf('app.post("/admin/parcel-tracking-poll"')));
    const iBlocked = route.indexOf("parcelPollAuthThrottle.blocked()");
    const iCompare = route.indexOf("timingSafeTokenEqual(token, PARCEL_POLL_TOKEN)");
    const iFail = route.indexOf("parcelPollAuthThrottle.fail()");
    const iOk = route.indexOf("parcelPollAuthThrottle.ok()");
    expect(iBlocked).toBeGreaterThan(-1);
    expect(iCompare).toBeGreaterThan(iBlocked);
    expect(iFail).toBeGreaterThan(iCompare);
    expect(iOk).toBeGreaterThan(iFail);
    expect(server).toContain("makeFailureThrottle({ max: 5, windowMs: 15 * 60 * 1000 })");
  });
});
