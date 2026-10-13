// M5 (security audit 2026-09-26) — shared-secret hygiene. /test-comment is DELETED
// (it injected fake comments into arbitrary sellers' rooms behind a query-string
// secret and bypassed the sanitizer; zero production callers). The parcel-tracking
// poll endpoint now takes its secret via the X-Poll-Token HEADER only, compares it
// constant-time, and locks out after repeated bad tokens. Behavioral tests for the
// pure module + source-contract pins for the server.js wiring.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { timingSafeTokenEqual, makeFailureThrottle, checkPollToken } from "../../../../server/pollAuth.js";

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

  it("every token route goes through checkPollToken (correct token first), before any work", () => {
    const route = server.slice(server.indexOf('app.post("/admin/parcel-tracking-poll"'), server.indexOf('app.post("/admin/parcel-tracking-poll"') + 1500);
    const iCheck = route.indexOf('checkPollToken(parcelPollAuthThrottle, req.headers["x-poll-token"], PARCEL_POLL_TOKEN');
    expect(iCheck).toBeGreaterThan(-1);
    expect(route.indexOf('"locked"')).toBeGreaterThan(iCheck);
    expect(route.indexOf("serviceSb")).toBeGreaterThan(iCheck);
    expect(server).toContain('checkPollToken(productImagesSweepAuthThrottle, req.headers["x-poll-token"], PRODUCT_IMAGES_SWEEP_TOKEN');
    expect(server).not.toMatch(/AuthThrottle\.blocked\(\)/);             // no route checks the lockout before the token
    expect(readFileSync("server/healthRoutes.js", "utf8")).toContain("checkPollToken(throttle, sent, token");
    expect(server).toContain("makeFailureThrottle({ max: 5, windowMs: 15 * 60 * 1000 })");
  });
});

describe("checkPollToken — the correct token is never locked out (audit Oct 14)", () => {
  const SECRET = "cron-secret";
  it("5+ bad tokens lock out WRONG tokens (429), the correct token still passes and clears the counter", () => {
    const t = makeFailureThrottle({ max: 5, windowMs: 15 * 60 * 1000 });
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(checkPollToken(t, "guess" + i, SECRET, { now, log })).toBe("bad");
    expect(logs).toHaveLength(1);                                   // one line when the lockout starts
    expect(logs[0]).not.toContain(SECRET);
    expect(logs[0]).not.toContain("guess");
    expect(checkPollToken(t, "guess9", SECRET, { now, log })).toBe("locked");
    expect(checkPollToken(t, SECRET, SECRET, { now, log })).toBe("ok"); // the real cron call
    expect(checkPollToken(t, "guess10", SECRET, { now, log })).toBe("bad"); // counter was cleared
    expect(logs).toHaveLength(1);
  });
  it("bad tokens while locked keep 429 and do not log again; the lock ends with the window", () => {
    const t = makeFailureThrottle({ max: 2, windowMs: 1000 });
    const log = vi.fn();
    expect(checkPollToken(t, "a", SECRET, { now: 0, log })).toBe("bad");
    expect(checkPollToken(t, "b", SECRET, { now: 1, log })).toBe("bad");
    expect(checkPollToken(t, "c", SECRET, { now: 2, log })).toBe("locked");
    expect(checkPollToken(t, "d", SECRET, { now: 3, log })).toBe("locked");
    expect(log).toHaveBeenCalledTimes(1);
    expect(checkPollToken(t, "e", SECRET, { now: 1100, log })).toBe("bad");
  });
  it("missing / empty token or secret never passes", () => {
    const t = makeFailureThrottle();
    expect(checkPollToken(t, undefined, SECRET, { log: () => {} })).toBe("bad");
    expect(checkPollToken(t, "", "", { log: () => {} })).toBe("bad");
  });
});
