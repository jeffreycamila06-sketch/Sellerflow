// Nov 6, 2026 — a seller who changed their TikTok username. tiktok-live-connector 2.1.1-beta1 throws
// a FetchIsLiveError (empty message, the real failures in error.errors[]) for a username that no
// longer exists; the server must answer 404 { notFound } with NO cooldown (not a rate limit), and a
// lookup failure without the not-found code its own 502 { lookupFailed } — never "make sure you're LIVE".
// server.js has no vitest harness: the matcher is pure (connectionHealth.js); the wiring is pinned
// from the source (same convention as tiktokCooldownAdmin.contract).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { isTikTokUserNotFound, isTikTokLookupFailed } from "../../../../server/connectionHealth.js";

const require = createRequire(import.meta.url);
const errs = require("tiktok-live-connector/dist/types/errors.js") as Record<string, new (...a: unknown[]) => Error>;
const { FetchIsLiveError, UserOfflineError, SignatureRateLimitError, InvalidResponseError } = errs;
const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
const between = (a: string, b: string) => server.slice(server.indexOf(a), server.indexOf(b, server.indexOf(a)));

const notFound = () => new FetchIsLiveError([
  new InvalidResponseError("Failed to fetch room info from HTML", new Error("status 200")),
  new Error('Failed to retrieve room info: {"status_code":19881007,"status_msg":"user_not_found"}'),
]);

describe("isTikTokUserNotFound — the matcher (real connector error classes)", () => {
  it("a FetchIsLiveError (empty message) whose errors[] carry 19881007 / user_not_found → true", () => {
    const e = notFound();
    expect(e.message).toBe("");
    expect(isTikTokUserNotFound(e)).toBe(true);
    expect(isTikTokUserNotFound(new FetchIsLiveError([new Error("x"), new Error("user_not_found")]))).toBe(true);
  });
  it("found in nested exception / requestErr / a numeric code too", () => {
    expect(isTikTokUserNotFound(new FetchIsLiveError([new InvalidResponseError("bad", Object.assign(new Error("API said 19881007"), {}))]))).toBe(true);
    expect(isTikTokUserNotFound({ message: "", exception: { message: "USER_NOT_FOUND" } })).toBe(true);
    expect(isTikTokUserNotFound({ message: "", errors: [{ code: 19881007 }] })).toBe(true);
  });
  it("UserOfflineError → false; SignatureRateLimitError → false; plain / empty / cyclic errors → false (never throws)", () => {
    expect(isTikTokUserNotFound(new UserOfflineError("The requested user isn't online :("))).toBe(false);
    expect(isTikTokUserNotFound(new SignatureRateLimitError("Too many connections started", "[Rate Limited] (daily_rooms) %s", { headers: {}, status: 429, data: {} }))).toBe(false);
    expect(isTikTokUserNotFound(new Error("network down"))).toBe(false);
    expect(isTikTokUserNotFound(null)).toBe(false);
    const cyc: Record<string, unknown> = { message: "" }; cyc.exception = cyc; cyc.errors = [cyc];
    expect(isTikTokUserNotFound(cyc)).toBe(false);
  });
  it("isTikTokLookupFailed: a FetchIsLiveError WITHOUT the code → true; with the code / other classes → false", () => {
    expect(isTikTokLookupFailed(new FetchIsLiveError([new Error("Failed to fetch room info"), new Error("timeout")]))).toBe(true);
    expect(isTikTokLookupFailed(notFound())).toBe(false);
    expect(isTikTokLookupFailed(new UserOfflineError("offline"))).toBe(false);
    expect(isTikTokLookupFailed(new Error(""))).toBe(false);
    expect(isTikTokLookupFailed(null)).toBe(false);
  });
});

describe("connectTikTok catch — wiring", () => {
  const fn = between("async function connectTikTok(", "// M5 (security audit 2026-09-26)");
  const c = fn.slice(fn.lastIndexOf("} catch (error) {"));
  it("not found → 404 { success:false, notFound:true, error:'tiktok_user_not_found' } AFTER the not-live branch and BEFORE the rate-limit branch", () => {
    const nl = c.indexOf("if (error && error.notLive) {");
    const nf = c.indexOf("if (isTikTokUserNotFound(error)) {");
    const lf = c.indexOf("if (isTikTokLookupFailed(error)) {");
    const rl = c.indexOf("if (key && isTikTokRateLimitError(error)) {");
    expect(nl).toBeGreaterThan(0);
    expect(nf).toBeGreaterThan(nl);
    expect(lf).toBeGreaterThan(nf);
    expect(rl).toBeGreaterThan(lf);
    expect(c).toContain('return res.status(404).json({ success: false, notFound: true, error: "tiktok_user_not_found" });');
    expect(c).toContain('return res.status(502).json({ success: false, lookupFailed: true, error: "tiktok_lookup_failed" });');
  });
  it("neither path sets a cooldown (no rememberTikTokRateLimit) nor touches the anti-abuse counter; both are recorded", () => {
    const nf = c.slice(c.indexOf("if (isTikTokUserNotFound(error)) {"), c.indexOf("if (key && isTikTokRateLimitError(error)) {"));
    expect(nf).not.toContain("rememberTikTokRateLimit");
    expect(nf).not.toContain("tiktokRateLimitCooldowns");
    expect(nf).not.toContain("connectAttempts");
    expect(nf).not.toContain("cooldownMs");
    expect(nf).toContain('recordTikTokAttempt("not_found", cleanUsername);');
    expect(nf).toContain('recordTikTokAttempt("lookup_failed", cleanUsername);');
  });
  it("the scheduled reconnect treats not-found as FINAL (no retry, no cooldown)", () => {
    const sch = between("function scheduleTikTokReconnect(", "function handleTikTokDisconnected(");
    const block = sch.slice(sch.indexOf("if (isTikTokUserNotFound(error)) {"), sch.indexOf("if (isTikTokRateLimitError(error)) {"));
    expect(block).toContain("clearTikTokReconnect(key);");
    expect(block).toContain("tiktokReconnectAttempts.delete(key);");
    expect(block).toContain("return;");
    expect(block).not.toContain("scheduleTikTokReconnect(");
    expect(block).not.toContain("rememberTikTokRateLimit");
  });
  it("the TikTok success path and the Facebook / Instagram / Shopee connect routes do not reference the new matchers", () => {
    expect(server.match(/isTikTokUserNotFound\(/g)?.length).toBe(2);   // connect catch + reconnect catch only
    expect(server.match(/isTikTokLookupFailed\(/g)?.length).toBe(1);
  });
});
