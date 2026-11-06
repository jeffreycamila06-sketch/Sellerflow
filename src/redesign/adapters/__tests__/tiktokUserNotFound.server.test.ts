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
import { execSync } from "node:child_process";
import * as health from "../../../../server/connectionHealth.js";
const { isTikTokUserNotFound, isTikTokLookupFailed, nestedRateLimitError, rateLimitLabel, isDailyRoomsLabel, isKnownRateLimitShape, NOT_FOUND_FINAL_STREAK } = health;

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
  it("a FetchIsLiveError (empty message) whose errors[] carry TikTok's 'API Error 19881007 …' → true", () => {
    const e = notFound();
    expect(e.message).toBe("");
    expect(isTikTokUserNotFound(e)).toBe(true);
    expect(isTikTokUserNotFound(new FetchIsLiveError([new Error("x"), new Error("API Error 19881007 (Unknown Error)")]))).toBe(true);
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
    expect(isTikTokUserNotFound(new Error("(user_not_found)"))).toBe(false);                 // round 3: only "API Error 19881007" at the START
    expect(isTikTokUserNotFound(new Error("oops API Error 19881007 (user_not_found)"))).toBe(false);
  });
  it("3. a BIO can never match: 'Invalid response from API: <profile json>' is skipped by both matchers whatever it says", () => {
    for (const bio of ["(daily_rooms) Too many connections started", "rate limit", "API Error 19881007", "(user_not_found)", "[Rate Limited] (daily_rooms) Too many connections", "Failed to retrieve Room ID from Euler due to an error: (daily_rooms) Too many connections"]) {
      const msg = `Invalid response from API: ${JSON.stringify({ statusCode: 0, data: { user: { uniqueId: "shop", signature: bio } } })}`;
      const inner = new InvalidResponseError(msg);
      const wrapped = new FetchIsLiveError([new Error("Failed to fetch room info from HTML"), inner]);
      expect(isTikTokUserNotFound(wrapped), bio).toBe(false);
      expect(nestedRateLimitError(wrapped), bio).toBeNull();
      expect(isKnownRateLimitShape(inner), bio).toBe(false);
      expect(isTikTokUserNotFound(inner), bio).toBe(false);
      expect(nestedRateLimitError(inner), bio).toBeNull();
      // the server's top-level check ignores it too (pinned in server.js)
    }
    const fn = between("function isTikTokRateLimitError(", "function rememberTikTokRateLimit(");
    expect(fn).toContain("return isKnownRateLimitShape(error);");               // round 4: the top-level check is the same strict one
  });
  it("4. nestedRateLimitError: a rate limit wrapped inside the lookup error is found (with its daily_rooms label); a plain lookup failure is not", () => {
    const inner = new Error("Failed to retrieve Room ID from Euler due to an error: (daily_rooms) Too many connections started, try again later.");
    const wrapped = new FetchIsLiveError([new Error("Failed to fetch room info from HTML"), inner]);
    expect(nestedRateLimitError(wrapped)).toBe(inner);
    expect(isDailyRoomsLabel(rateLimitLabel(nestedRateLimitError(wrapped)))).toBe(true);
    // known shapes only: a bare "Rate limit exceeded" text is not one; the connector's own shapes are
    expect(nestedRateLimitError(new FetchIsLiveError([new Error("Rate limit exceeded")]))).toBeNull();
    const signed = new Error("[Rate Limited] (daily_rooms) Too many connections started");
    expect(nestedRateLimitError(new FetchIsLiveError([signed]))).toBe(signed);
    expect(nestedRateLimitError(new FetchIsLiveError([new Error("Failed to retrieve Room ID from Euler due to an error: This endpoint requires a Business plan.")]))).toBeNull(); // the Euler prefix alone is not a rate limit
    const sig = new SignatureRateLimitError("Too many connections started", "[Rate Limited] (daily_rooms) %s", { headers: {}, status: 429, data: {} });
    expect(isKnownRateLimitShape(sig)).toBe(true);
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
    expect(c).toContain("const rlErr = nestedRateLimitError(error);");
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
  it("7. the scheduled reconnect stops only after 2 'not found' answers IN A ROW (one more normal try after the first); no cooldown", () => {
    expect(NOT_FOUND_FINAL_STREAK).toBe(2);
    const sch = between("function scheduleTikTokReconnect(", "function handleTikTokDisconnected(");
    const block = sch.slice(sch.indexOf("if (isTikTokUserNotFound(error)) {"), sch.indexOf("const rlErr ="));
    const first = block.slice(0, block.indexOf("tiktokNotFoundStreak.delete(key);"));
    expect(first).toContain("const streak = (tiktokNotFoundStreak.get(key) || 0) + 1;");
    expect(first).toContain("if (streak < NOT_FOUND_FINAL_STREAK) {");
    expect(first).toContain('scheduleTikTokReconnect(key, username, sellerId, sessionId, "retry_failed");');
    const final = block.slice(block.indexOf("tiktokNotFoundStreak.delete(key);"));
    expect(final).toContain("clearTikTokReconnect(key);");
    expect(final).toContain("tiktokReconnectAttempts.delete(key);");
    expect(final).not.toContain("scheduleTikTokReconnect(");
    expect(block).not.toContain("rememberTikTokRateLimit");
    // "in a row": a different error resets the streak; ANY successful connect resets it too (a
    // reconnect OR the seller's own tap — both go through startTikTokConnection)
    expect(sch).toContain("if (!isTikTokUserNotFound(error)) tiktokNotFoundStreak.delete(key);");
    const start = server.slice(server.indexOf("async function startTikTokConnection("), server.indexOf("async function connectTikTok("));
    expect(start.indexOf("tiktokNotFoundStreak.delete(key);")).toBeGreaterThan(start.indexOf('recordTikTokAttempt("ok");'));
  });
  it("the TikTok success path and the Facebook / Instagram / Shopee connect routes do not reference the new matchers", () => {
    expect(server.match(/isTikTokUserNotFound\(/g)?.length).toBe(3);   // connect catch + reconnect catch (+ its streak reset) only
    expect(server.match(/isTikTokLookupFailed\(/g)?.length).toBe(1);
    expect(server.match(/nestedRateLimitError\(/g)?.length).toBe(3);   // connect catch (+ its forcedFresh gray guard) + reconnect catch
  });
  it("8. a null error never crashes the reconnect log", () => {
    expect(server).toContain("console.log(`TikTok reconnect failed for ${username}: ${error?.message || error}`);");
    expect(server).not.toContain("console.log(`TikTok reconnect failed for ${username}: ${error.message}`);");
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

// ── ROUND 4: daily_rooms is a PER-ACCOUNT cooldown — no shared pause, a live is never touched ──
// Behaviour: the REAL rememberTikTokRateLimit / getTikTokCooldownMs source from server.js, run on
// fresh maps with the real connectionHealth helpers (everything else stubbed).
function cooldownHarness(now: { t: number }) {
  const fnSrc = (name: string) => {
    const i = server.indexOf(`function ${name}(`);
    return server.slice(i, server.indexOf("\n}\n", i) + 2);
  };
  const deps = {
    tiktokRateLimitCooldowns: new Map<string, number>(), tiktokDailyCooldownKeys: new Set<string>(),
    tiktokReconnectAttempts: new Map<string, number>(), emitted: [] as unknown[],
  };
  const factory = new Function("deps", "h", "Date", `
    const { tiktokRateLimitCooldowns, tiktokDailyCooldownKeys, tiktokReconnectAttempts } = deps;
    const { rateLimitLabel, isDailyRoomsLabel, dailyCooldownMs, resolveRateLimitCooldownMs, noteRateLimit, EMPTY_RATE_LIMIT_STATS } = h;
    let eulerRateLimitStats = EMPTY_RATE_LIMIT_STATS;
    const clearTikTokReconnect = () => {};
    const emitTikTokStatus = (x) => deps.emitted.push(x);
    const console = { log() {} };
    ${fnSrc("rememberTikTokRateLimit")}
    ${fnSrc("getTikTokCooldownMs")}
    return { rememberTikTokRateLimit, getTikTokCooldownMs };`);
  const api = factory(deps, health, Object.assign(function () { return new Date(now.t); }, { now: () => now.t }) as unknown as DateConstructor) as {
    rememberTikTokRateLimit: (key: string, sellerId: string, username: string, sessionId: string, error: unknown) => number;
    getTikTokCooldownMs: (key: string) => number;
  };
  return { ...api, deps };
}
const dailyErr = () => new Error("[Rate Limited] (daily_rooms) Too many connections started, try again later.");
const A = "seller@x.com:TikTok:shop_a", B = "seller@x.com:TikTok:shop_b", C = "other@x.com:TikTok:shop_c";

describe("round 4 — daily_rooms on account A touches ONLY A", () => {
  it("A gets a 10-min cooldown marked daily (→ daily: true, no client retry); B and another seller's C have none", () => {
    const now = { t: Date.UTC(2026, 10, 6, 4) };
    const h = cooldownHarness(now);
    expect(h.rememberTikTokRateLimit(A, "seller@x.com", "shop_a", "s1", dailyErr())).toBe(10 * 60_000);
    expect(h.getTikTokCooldownMs(A)).toBe(10 * 60_000);
    expect(h.deps.tiktokDailyCooldownKeys.has(A)).toBe(true);
    for (const k of [B, C]) {
      expect(h.getTikTokCooldownMs(k), k).toBe(0);                // B connects normally: no cooldown → no 429
      expect(h.deps.tiktokDailyCooldownKeys.has(k), k).toBe(false);
    }
    expect([...h.deps.tiktokRateLimitCooldowns.keys()]).toEqual([A]);
  });
  it("Euler's reset time wins when SOONER; a plain rate limit is the 2-min default and NOT daily; expiry clears the daily mark", () => {
    const now = { t: Date.UTC(2026, 10, 6, 4) };
    const h = cooldownHarness(now);
    const soon = Object.assign(dailyErr(), { resetTime: now.t + 3 * 60_000 });
    expect(h.rememberTikTokRateLimit(A, "s", "a", "", soon)).toBe(3 * 60_000);
    expect(h.rememberTikTokRateLimit(B, "s", "b", "", new Error("[Rate Limited] (minute_connections) Too many connections started"))).toBe(2 * 60_000);
    expect(h.deps.tiktokDailyCooldownKeys.has(B)).toBe(false);
    now.t += 3 * 60_000;
    expect(h.getTikTokCooldownMs(A)).toBe(0);
    expect(h.deps.tiktokDailyCooldownKeys.has(A)).toBe(false);       // the mark ends with the cooldown
  });
  it("a reconnect after a rate limit (any kind) waits for THAT account's cooldown, then tries normally — nothing else waits", () => {
    const sch = between("function scheduleTikTokReconnect(", "function handleTikTokDisconnected(");
    expect(sch).toContain("const retryMs = Math.max(backoffMs, cooldownMs) + jitterMs;");
    expect(sch).not.toMatch(/reconnecting: false,\s*reason: "rate_limited"/);          // no give-up on the account's own cooldown
    const rl = sch.slice(sch.indexOf("const rlErr = nestedRateLimitError(error);"));
    expect(rl.indexOf("rememberTikTokRateLimit(key, sellerId, username, sessionId, rlErr);")).toBeLessThan(rl.indexOf('scheduleTikTokReconnect(key, username, sellerId, sessionId, "rate_limited");'));
  });
});

describe("round 4 — a live connection is never closed or blocked by anything in this branch", () => {
  const main = (() => {
    try { return execSync("git show origin/main:server.js", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
    catch { execSync("git fetch --depth=1 origin main", { stdio: "pipe" }); return execSync("git show FETCH_HEAD:server.js", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
  })();
  const fnOf = (src: string, name: string) => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf("\n}\n", i) + 2); };
  it("the health timer and the queue drain are byte-identical to main (runQueuedTikTokReconnect: one skip line only — tiktokReconnectStops.server.test)", () => {
    for (const name of ["startTikTokHealthTimer", "drainTikTokReconnectQueue", "clearTikTokHealthTimer", "touchTikTokConnection"]) {
      expect(fnOf(server, name), name).toBe(fnOf(main, name));
    }
  });
  it("the reuse of a healthy connection is main's rule (no daily exception); no gate stands before a fresh connect except the account's own cooldown", () => {
    const fn = between("async function connectTikTok(", "// M5 (security audit 2026-09-26)");
    expect(fn).toContain("if (!shouldForceFreshConnect(existing.lastEventAt, Date.now())) {");
    expect(fn).not.toMatch(/daily(Gate|Rooms|Ms)/);
  });
});
