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
import { isTikTokUserNotFound, isTikTokLookupFailed, nestedRateLimitError, rateLimitLabel, isDailyRoomsLabel } from "../../../../server/connectionHealth.js";

const require = createRequire(import.meta.url);
const errs = require("tiktok-live-connector/dist/types/errors.js") as Record<string, new (...a: unknown[]) => Error>;
const { FetchIsLiveError, UserOfflineError, SignatureRateLimitError, InvalidResponseError } = errs;
const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
const between = (a: string, b: string) => server.slice(server.indexOf(a), server.indexOf(b, server.indexOf(a)));

// The connector's own shape (fetch-room-info-api-live.js): `API Error ${statusCode} (${message})`.
const notFound = () => new FetchIsLiveError([
  new InvalidResponseError("Failed to fetch room info from HTML", new Error("status 200")),
  new InvalidResponseError("API Error 19881007 (user_not_found)"),
]);

describe("isTikTokUserNotFound — the matcher (real connector error classes)", () => {
  it("a FetchIsLiveError (empty message) whose errors[] carry 19881007 / user_not_found → true", () => {
    const e = notFound();
    expect(e.message).toBe("");
    expect(isTikTokUserNotFound(e)).toBe(true);
    expect(isTikTokUserNotFound(new FetchIsLiveError([new Error("x"), new Error("(user_not_found)")]))).toBe(true);
  });
  it("found in nested exception / requestErr / a code 19881007 (number or string) too", () => {
    expect(isTikTokUserNotFound(new FetchIsLiveError([new InvalidResponseError("bad", new Error("API Error 19881007 (user_not_found)"))]))).toBe(true);
    expect(isTikTokUserNotFound({ message: "", exception: { message: "API Error 19881007 (Unknown Error)" } })).toBe(true);
    expect(isTikTokUserNotFound({ message: "", errors: [{ code: 19881007 }] })).toBe(true);
    expect(isTikTokUserNotFound({ message: "", errors: [{ code: "19881007" }] })).toBe(true);
  });
  it("3. ONLY TikTok's real error shape: a bio / any text that merely CONTAINS the digits or the word is NOT not-found", () => {
    const bio = new InvalidResponseError(`Invalid response from API: ${JSON.stringify({ statusCode: 0, data: { user: { signature: "born 19881007 ✨ user_not_found lol" } } })}`);
    expect(isTikTokUserNotFound(new FetchIsLiveError([bio]))).toBe(false);
    expect(isTikTokLookupFailed(new FetchIsLiveError([bio]))).toBe(true);           // → the lookup-failed text instead
    expect(isTikTokUserNotFound(new Error("API Error 198810070 (other)"))).toBe(false);   // \b: not a longer number
    expect(isTikTokUserNotFound({ message: "", errors: [{ code: 19881008 }] })).toBe(false);
    expect(isTikTokUserNotFound(new Error("USER_NOT_FOUND"))).toBe(false);
  });
  it("4. nestedRateLimitError: a rate limit wrapped inside the lookup error is found (with its daily_rooms label); a plain lookup failure is not", () => {
    const inner = new Error("Failed to retrieve Room ID from Euler due to an error: (daily_rooms) Too many connections started, try again later.");
    const wrapped = new FetchIsLiveError([new Error("Failed to fetch room info from HTML"), inner]);
    expect(nestedRateLimitError(wrapped)).toBe(inner);
    expect(isDailyRoomsLabel(rateLimitLabel(nestedRateLimitError(wrapped)))).toBe(true);
    expect(nestedRateLimitError(new FetchIsLiveError([new Error("Rate limit exceeded")]))?.message).toBe("Rate limit exceeded");
    expect(nestedRateLimitError(new FetchIsLiveError([new Error("timeout"), new Error("Failed to fetch room info")]))).toBeNull();
    expect(nestedRateLimitError(notFound())).toBeNull();
    expect(nestedRateLimitError(null)).toBeNull();
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
  it("order: not-live → not-found (404) → rate limit incl. one nested in the lookup error → lookup failed (502) → generic", () => {
    const nl = c.indexOf("if (error && error.notLive) {");
    const nf = c.indexOf("if (isTikTokUserNotFound(error)) {");
    const rl = c.indexOf("if (key && rlErr) {");
    const lf = c.indexOf("if (isTikTokLookupFailed(error)) {");
    const gen = c.indexOf('recordTikTokAttempt("fail", error?.message);');
    expect(nl).toBeGreaterThan(0);
    expect(nf).toBeGreaterThan(nl);
    expect(rl).toBeGreaterThan(nf);
    expect(lf).toBeGreaterThan(rl);                          // 4: a wrapped rate limit is never "lookup failed"
    expect(gen).toBeGreaterThan(lf);
    expect(c).toContain("const rlErr = isTikTokRateLimitError(error) ? error : nestedRateLimitError(error);");
    expect(c).toContain("const cooldownMs = rememberTikTokRateLimit(key, sellerId, cleanUsername, sessionId, rlErr);"); // the nested error carries the daily_rooms label
    expect(c).toContain('return res.status(404).json({ success: false, notFound: true, error: "tiktok_user_not_found" });');
    expect(c).toContain('return res.status(502).json({ success: false, lookupFailed: true, error: "tiktok_lookup_failed" });');
  });
  it("neither path sets a cooldown nor touches the anti-abuse counter; 8: both are recorded with a FIXED reason (never a username)", () => {
    const nf = c.slice(c.indexOf("if (isTikTokUserNotFound(error)) {"), c.indexOf("const rlErr ="));
    const lf = c.slice(c.indexOf("if (isTikTokLookupFailed(error)) {"), c.indexOf('recordTikTokAttempt("fail", error?.message);'));
    for (const b of [nf, lf]) {
      expect(b).not.toContain("rememberTikTokRateLimit");
      expect(b).not.toContain("tiktokRateLimitCooldowns");
      expect(b).not.toContain("connectAttempts");
      expect(b).not.toContain("cooldownMs");
      expect(b).not.toMatch(/recordTikTokAttempt\([^)]*(cleanUsername|username)/);
    }
    expect(nf).toContain('recordTikTokAttempt("not_found", "not_found");');
    expect(lf).toContain('recordTikTokAttempt("lookup_failed", "lookup_failed");');
    expect(server).not.toMatch(/recordTikTokAttempt\("(not_found|lookup_failed)", (cleanUsername|username)/);
  });
  it("the scheduled reconnect treats not-found as FINAL (no retry, no cooldown)", () => {
    const sch = between("function scheduleTikTokReconnect(", "function handleTikTokDisconnected(");
    const block = sch.slice(sch.indexOf("if (isTikTokUserNotFound(error)) {"), sch.indexOf("const rlErr ="));
    expect(block).toContain("clearTikTokReconnect(key);");
    expect(block).toContain("tiktokReconnectAttempts.delete(key);");
    expect(block).toContain("return;");
    expect(block).not.toContain("scheduleTikTokReconnect(");
    expect(block).not.toContain("rememberTikTokRateLimit");
  });
  it("the TikTok success path and the Facebook / Instagram / Shopee connect routes do not reference the new matchers", () => {
    expect(server.match(/isTikTokUserNotFound\(/g)?.length).toBe(2);   // connect catch + reconnect catch only
    expect(server.match(/isTikTokLookupFailed\(/g)?.length).toBe(1);
    expect(server.match(/nestedRateLimitError\(/g)?.length).toBe(3);   // connect catch (+ its forcedFresh gray guard) + reconnect catch
  });
  it("1. the reconnect: a daily limit hit DURING the reconnect drops the account's own bench and waits out the daily pause", () => {
    const sch = between("function scheduleTikTokReconnect(", "function handleTikTokDisconnected(");
    const b = sch.slice(sch.indexOf("const rlErr ="), sch.indexOf('scheduleTikTokReconnect(key, username, sellerId, sessionId, "retry_failed");'));
    expect(b).toContain("rememberTikTokRateLimit(key, sellerId, username, sessionId, rlErr);");
    const d = b.indexOf("if (dailyRoomsRemainingMs() > 0) {");
    expect(d).toBeGreaterThan(b.indexOf("rememberTikTokRateLimit("));
    expect(b.slice(d)).toContain("tiktokRateLimitCooldowns.delete(key);");
    expect(b.slice(d)).toContain('scheduleTikTokReconnect(key, username, sellerId, sessionId, "daily_pause");');
    expect(b.indexOf("tiktokRateLimitCooldowns.delete(key);")).toBeLessThan(b.indexOf('"daily_pause"')); // deleted FIRST, else the new schedule gives up on it
  });
  it("2. the per-account cooldown 429 also reads the daily pause: the longer wait + daily: true (→ the daily text, no client retry)", () => {
    const top = fn.slice(fn.indexOf("const cooldownMs = getTikTokCooldownMs(key);"), fn.indexOf("const existing = tiktokConnections.get(key);"));
    expect(top).toContain("const d = dailyRoomsRemainingMs();");
    expect(top).toContain("cooldownMs: waitMs,");
    expect(top).toContain("const waitMs = Math.max(cooldownMs, d);");
    expect(top).toContain("...(d > 0 ? { daily: true } : {}),");
  });
  it("5. during the daily pause a quiet existing connection takes the verify-and-reuse path (not a fresh connect that would get the daily 429)", () => {
    expect(fn).toContain("if (!shouldForceFreshConnect(existing.lastEventAt, Date.now()) || dailyRoomsRemainingMs() > 0) {");
    const reuseIf = fn.indexOf("|| dailyRoomsRemainingMs() > 0) {");
    expect(reuseIf).toBeLessThan(fn.indexOf("const verdict = await verifyReuse(key, cleanUsername);"));
    expect(reuseIf).toBeLessThan(fn.indexOf("const dailyMs = dailyRoomsRemainingMs();"));
  });
  it("8. /health/tiktok: the failure rate counts fail + not_found + lookup_failed", () => {
    const h = between("function tiktokHealthDetail()", "const warnings = [];");
    expect(h).toContain('const isFail = (a) => a.outcome === "fail" || a.outcome === "not_found" || a.outcome === "lookup_failed";');
    expect(h).toContain("const fails = last.filter(isFail).length;");
    expect(h).toContain("const lastFailReason = [...last].reverse().find(isFail)?.reason || null;");
  });
  it("11. admin clear 'username_required' has its own NEW server code (E155), not E0", async () => {
    const { encodeErr, SERVER_ONLY_CODES } = await import("../../../../server/errorCodes.js");
    expect(encodeErr("username_required")).toBe("E155");
    const all = Object.values(SERVER_ONLY_CODES);
    expect(new Set(all).size).toBe(all.length);
  });
});
