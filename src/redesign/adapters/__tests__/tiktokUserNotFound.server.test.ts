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
import { isTikTokUserNotFound, isTikTokLookupFailed, nestedRateLimitError, rateLimitLabel, isDailyRoomsLabel, isKnownRateLimitShape, reconnectWait, healthShouldReconnect, dailyGateBlocks, DAILY_WAIT_CHUNK_MS, NOT_FOUND_FINAL_STREAK, RECENT_CONNECTION_MS } from "../../../../server/connectionHealth.js";

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
    expect(fn).toContain('if (raw.startsWith("Invalid response from API:")) return false;');
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
    // "in a row": any other outcome resets the streak (a success, or a different error)
    expect(sch).toContain("if (!isTikTokUserNotFound(error)) tiktokNotFoundStreak.delete(key);");
    expect(sch.indexOf("tiktokNotFoundStreak.delete(key);")).toBeLessThan(sch.indexOf("} catch (error) {"));   // after a successful reconnect
  });
  it("the TikTok success path and the Facebook / Instagram / Shopee connect routes do not reference the new matchers", () => {
    expect(server.match(/isTikTokUserNotFound\(/g)?.length).toBe(3);   // connect catch + reconnect catch (+ its streak reset) only
    expect(server.match(/isTikTokLookupFailed\(/g)?.length).toBe(1);
    expect(server.match(/nestedRateLimitError\(/g)?.length).toBe(3);   // connect catch (+ its forcedFresh gray guard) + reconnect catch
  });
  it("1 + 6. only a reconnect whose OWN attempt got a daily 429 waits ('daily_pause'); its own bench is dropped only when that 429 WAS the daily limit", () => {
    const sch = between("function scheduleTikTokReconnect(", "function handleTikTokDisconnected(");
    const b = sch.slice(sch.indexOf("const rlErr ="), sch.lastIndexOf('scheduleTikTokReconnect(key, username, sellerId, sessionId, "retry_failed");'));
    expect(b).toContain("rememberTikTokRateLimit(key, sellerId, username, sessionId, rlErr);");
    const d = b.indexOf("if (dailyRoomsRemainingMs() > 0) {");
    expect(d).toBeGreaterThan(b.indexOf("rememberTikTokRateLimit("));
    expect(b.slice(d)).toContain("if (isDailyRoomsLabel(rateLimitLabel(rlErr))) tiktokRateLimitCooldowns.delete(key);");
    expect(b.slice(d)).toContain('scheduleTikTokReconnect(key, username, sellerId, sessionId, "daily_pause");');
    expect(b.indexOf("tiktokRateLimitCooldowns.delete(key);")).toBeLessThan(b.indexOf('scheduleTikTokReconnect(key, username, sellerId, sessionId, "daily_pause");'));
    // 1: the delay has NO daily-pause term, and the queued job waits only in "daily_pause" mode
    expect(sch).not.toContain("Math.max(backoffMs, dailyRoomsRemainingMs())");
    expect(sch).toContain("const plan = reconnectWait({ reason, perKeyMs: cooldownMs, dailyMs: dailyRoomsRemainingMs(), rand: Math.random() });");
    expect(sch).toContain('if (reason === "daily_pause" && reconnectWait(');
    expect(sch).not.toContain("if (dailyRoomsRemainingMs() > 0) { scheduleTikTokReconnect(key, username, sellerId, sessionId, reason); return; }");
  });
  it("4. a full reconnect queue reschedules the dropped reconnect instead of losing it", () => {
    const q = between("function runQueuedTikTokReconnect(", "function drainTikTokReconnectQueue(");
    expect(q).toContain('if (dropped && typeof dropped.onDrop === "function") { try { dropped.onDrop(); } catch { /* best-effort */ } }');
    const sch = between("function scheduleTikTokReconnect(", "function handleTikTokDisconnected(");
    expect(sch).toContain("job.onDrop = () => scheduleTikTokReconnect(key, username, sellerId, sessionId, reason);");
  });
  it("8. a null error never crashes the reconnect log", () => {
    expect(server).toContain("console.log(`TikTok reconnect failed for ${username}: ${error?.message || error}`);");
    expect(server).not.toContain("console.log(`TikTok reconnect failed for ${username}: ${error.message}`);");
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

// ── RULES (fix round 3): the daily pause stops ONLY brand-new connects — behaviour of the decisions ──
describe("daily pause — a healthy live is NEVER blocked or closed", () => {
  const H = 60 * 60 * 1000, M = 60 * 1000;
  it("(a) a live seller drops during the pause → the reconnect is attempted right away with its normal backoff (no pause wait)", () => {
    for (const reason of ["disconnected", "chat_stale", "silent_timeout", "retry_failed", "stream_error"]) {
      expect(reconnectWait({ reason, perKeyMs: 0, dailyMs: H, rand: 0.5 }), reason).toEqual({ giveUp: false, waitMs: null });
    }
    expect(reconnectWait({ reason: "disconnected", perKeyMs: 2 * M, dailyMs: H, rand: 0 })).toEqual({ giveUp: true, waitMs: null }); // own bench: unchanged rule
  });
  it("(b) a quiet connection during the pause is NOT closed; outside the pause the health rule is unchanged", () => {
    expect(healthShouldReconnect({ eventIsFresh: false, chatLooksStale: true, dailyMs: H })).toBe(false);
    expect(healthShouldReconnect({ eventIsFresh: false, chatLooksStale: false, dailyMs: 1 })).toBe(false);
    expect(healthShouldReconnect({ eventIsFresh: false, chatLooksStale: true, dailyMs: 0 })).toBe(true);
    expect(healthShouldReconnect({ eventIsFresh: true, chatLooksStale: true, dailyMs: 0 })).toBe(true);
    expect(healthShouldReconnect({ eventIsFresh: true, chatLooksStale: false, dailyMs: 0 })).toBe(false);
    const timer = between("function startTikTokHealthTimer(", "async function disconnectTikTokConnection(");
    const gate = timer.indexOf("if (!healthShouldReconnect({ eventIsFresh, chatLooksStale, dailyMs: dailyRoomsRemainingMs() })) return;");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(timer.indexOf("tiktokConnections.delete(key);"));   // before anything is closed
    expect(gate).toBeLessThan(timer.indexOf("current.connection.disconnect();"));
  });
  it("(c) a brand-new account during the pause → the daily 429; a key live now or in the last 24 h → a normal attempt", () => {
    const now = Date.UTC(2026, 10, 6, 4);
    expect(dailyGateBlocks({ dailyMs: H, isNewKey: true, lastConnectedAt: undefined, now })).toBe(true);
    expect(dailyGateBlocks({ dailyMs: H, isNewKey: false, lastConnectedAt: undefined, now })).toBe(false);
    expect(dailyGateBlocks({ dailyMs: H, isNewKey: true, lastConnectedAt: now - 3 * H, now })).toBe(false);
    expect(dailyGateBlocks({ dailyMs: H, isNewKey: true, lastConnectedAt: now - RECENT_CONNECTION_MS, now })).toBe(true);
    expect(dailyGateBlocks({ dailyMs: 0, isNewKey: true, lastConnectedAt: undefined, now })).toBe(false);
    const fn = between("async function connectTikTok(", "// M5 (security audit 2026-09-26)");
    expect(fn).toContain("if (dailyGateBlocks({ dailyMs, isNewKey, lastConnectedAt: tiktokLastConnectedAt.get(key), now: Date.now() })) {");
    expect(server).toContain("tiktokLastConnectedAt.set(key, Date.now());");
    const start = between("async function startTikTokConnection(", "function connectTikTok") || server;
    expect(start.indexOf("tiktokLastConnectedAt.set(key, Date.now());")).toBeGreaterThan(start.indexOf('recordTikTokAttempt("ok");'));
  });
  it("4 + 5. a reconnect WAITING for the pause: chunks of at most 5 min (a 'Clear daily limit' wakes it within 5 min) with a 0–5 min spread; the longer of its own bench and the pause", () => {
    expect(DAILY_WAIT_CHUNK_MS).toBe(5 * M);
    expect(reconnectWait({ reason: "daily_pause", perKeyMs: 0, dailyMs: H, rand: 0.9 })).toEqual({ giveUp: false, waitMs: 5 * M });
    const short = [0, 0.25, 0.5, 0.99].map((rand) => reconnectWait({ reason: "daily_pause", perKeyMs: 0, dailyMs: 30_000, rand }).waitMs!);
    expect(short[0]).toBe(30_000);                                   // no spread → exactly when the pause ends
    expect(new Set(short).size).toBe(4);                              // spread apart…
    for (const w of short) { expect(w).toBeGreaterThanOrEqual(30_000); expect(w).toBeLessThanOrEqual(5 * M); } // …never before the end, never past a chunk
    expect(reconnectWait({ reason: "daily_pause", perKeyMs: 8 * M, dailyMs: 2 * M, rand: 0 }).waitMs).toBe(5 * M); // the longer of the two (chunked)
    expect(reconnectWait({ reason: "daily_pause", perKeyMs: 0, dailyMs: 0, rand: 0.5 })).toEqual({ giveUp: false, waitMs: null }); // cleared / ended → a normal attempt
  });
});
