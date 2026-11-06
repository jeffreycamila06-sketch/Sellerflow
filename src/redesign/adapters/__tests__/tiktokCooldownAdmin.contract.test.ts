// Nov 3, 2026 — server contract for the connection-limit changes (server.js has no vitest
// harness; structure pinned here, same convention as b4Phase2.contract / freshVerify.contract):
//   1. the cooldown recorder reads Euler's limit_label, tallies today's 429s and logs both;
//   2. the admin routes exist, both behind requireAuth + requireAdmin (server-side is_admin);
//   3. the clear route touches ONLY the cooldown map (never a live connection) and names
//      the account by username; the status route reports today + usage + the cooldown list;
//   4. plan usage: every successful connect notes its room; limits come from env; the
//      health detail carries both tallies and a usage warning.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
const between = (a: string, b: string) => server.slice(server.indexOf(a), server.indexOf(b, server.indexOf(a)));

describe("cooldown recorder", () => {
  const fn = between("function rememberTikTokRateLimit(", "function getTikTokCooldownMs(");
  it("reads the limit label, tallies today's 429s, logs limit= and today=", () => {
    expect(fn).toContain("const limitLabel = rateLimitLabel(error);");
    expect(fn).toContain("eulerRateLimitStats = noteRateLimit(eulerRateLimitStats, limitLabel, Date.now());");
    expect(fn).toMatch(/limit=\$\{limitLabel \|\| "unknown"\} today=\$\{eulerRateLimitStats\.count\}/);
  });
});

describe("daily_rooms — round 4: a PER-ACCOUNT cooldown only, the shared pause is gone", () => {
  it("the recorder gives a daily_rooms 429 the 10-min daily length on THIS key only, and marks the key daily", () => {
    const fn = between("function rememberTikTokRateLimit(", "function getTikTokCooldownMs(");
    expect(fn).toContain("const daily = isDailyRoomsLabel(limitLabel);");
    expect(fn).toContain("const cooldownMs = daily ? dailyCooldownMs(error, Date.now()) : resolveRateLimitCooldownMs(error, Date.now());");
    expect(fn).toContain("tiktokRateLimitCooldowns.set(key, retryAt);");
    expect(fn).toContain("if (daily) tiktokDailyCooldownKeys.add(key); else tiktokDailyCooldownKeys.delete(key);");
    expect(fn).toContain("return cooldownMs;");
  });
  it("NOTHING shared is left: no all-accounts pause, gate, waiting reconnect, health exception or queue reschedule", () => {
    for (const gone of ["dailyRoomsCooldownUntil", "dailyRoomsRemainingMs", "dailyGateBlocks", "tiktokLastConnectedAt", "daily_pause", "reconnectWait", "healthShouldReconnect", "onDrop", "[DAILY-ROOMS]", "clearedDaily", "dailyActive"]) {
      expect(server, gone).not.toContain(gone);
    }
  });
  it("the daily flag follows the KEY: the per-account 429 and the rate-limit 429 send daily: true only for a key whose cooldown came from daily_rooms", () => {
    expect(server).not.toMatch(/limit: DAILY_ROOMS_LABEL/);
    expect(server.match(/\.\.\.\(tiktokDailyCooldownKeys\.has\(key\) \? \{ daily: true \} : \{\}\),/g)?.length).toBe(2);
    const g = between("function getTikTokCooldownMs(", "function clearTikTokReconnect(");
    expect(g).toContain("tiktokDailyCooldownKeys.delete(key);");                                   // expired → no longer daily
    const clear = between('app.post("/admin/tiktok-cooldown/clear"', 'app.post("/admin/broadcast-translate"');
    expect(clear).toContain("tiktokDailyCooldownKeys.delete(key);");                               // cleared → no longer daily
  });
  it("connectTikTok: before the reuse branch the ONLY 429 is the account's own cooldown; nothing daily-wide anywhere", () => {
    const fn = between("async function connectTikTok(", "// M5 (security audit 2026-09-26)");
    const top = fn.indexOf("const cooldownMs = getTikTokCooldownMs(key);");
    const reuse = fn.indexOf('reason: "already_connected",');
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(reuse);
    expect(fn.slice(top, reuse).match(/res\.status\(429\)/g)?.length).toBe(1);
    expect(fn).toContain("if (!shouldForceFreshConnect(existing.lastEventAt, Date.now())) {");      // the reuse rule exactly as main
  });
  it("status + clear: no daily fields; clear needs a username", () => {
    const status = between('app.get("/admin/tiktok-cooldown/status"', 'app.post("/admin/tiktok-cooldown/clear"');
    expect(status).not.toContain("daily");
    const clear = between('app.post("/admin/tiktok-cooldown/clear"', 'app.post("/admin/broadcast-translate"');
    expect(clear).not.toContain("req.body || {}).daily");
    expect(clear).toContain('if (!username) return res.status(400).json({ success: false, error: "username_required" });');
  });
});

describe("admin routes", () => {
  it("status + clear, both requireAuth + requireAdmin", () => {
    expect(server).toContain('app.get("/admin/tiktok-cooldown/status", requireAuth, requireAdmin, ');
    expect(server).toContain('app.post("/admin/tiktok-cooldown/clear", requireAuth, requireAdmin, ');
  });
  it("clear: username via cleanAccountKey, deletes matching keys from the cooldown map only, logs, returns the count", () => {
    const route = between('app.post("/admin/tiktok-cooldown/clear"', 'app.post("/admin/broadcast-translate"');
    expect(route).toContain("const username = cleanAccountKey((req.body || {}).username);");
    expect(route).toContain('return res.status(400).json({ success: false, error: "username_required" });');
    expect(route).toContain("if (cooldownKeyMatches(key, username)) { tiktokRateLimitCooldowns.delete(key); tiktokDailyCooldownKeys.delete(key); cleared += 1; }");
    expect(route).not.toContain("tiktokConnections.");          // never touches a live connection
    expect(route).not.toContain("disconnect");
    expect(route).toContain("[COOLDOWN-CLEAR]");
    expect(route).toContain("return res.json({ success: true, cleared });");
  });
  it("status: today's tally + plan usage + the running cooldowns", () => {
    const route = between('app.get("/admin/tiktok-cooldown/status"', 'app.post("/admin/tiktok-cooldown/clear"');
    expect(route).toContain("today: rateLimitStatsFor(eulerRateLimitStats, now),");
    expect(route).toContain("usage: eulerUsageNow(now),");
    expect(route).toContain("listCooldowns(tiktokRateLimitCooldowns, now)");
  });
});

describe("plan usage", () => {
  it("every successful connect notes its room (id, else the account key); limits from env with the plan defaults", () => {
    expect(server).toContain("eulerRoomStats = noteRoom(eulerRoomStats, state?.roomId || key, Date.now());");
    expect(server).toContain("dailyRooms: readLimit(process.env.EULER_DAILY_ROOMS_LIMIT, EULER_DAILY_ROOMS_DEFAULT),");
    expect(server).toContain("concurrent: readLimit(process.env.EULER_CONCURRENT_LIMIT, EULER_CONCURRENT_DEFAULT),");
    expect(server).toContain("const eulerUsageNow = (now) => eulerUsage(roomsTodayCount(eulerRoomStats, now), tiktokConnections.size, EULER_LIMITS);");
  });
  it("health detail carries both tallies and warns on usage", () => {
    const detail = between("function tiktokHealthDetail(", "registerHealthRoutes(app,");
    expect(detail).toContain("eulerRateLimitsToday,");
    expect(detail).toContain("eulerUsage: eulerUsageToday,");
    expect(detail).toContain("for (const w of eulerUsageToday.warnings) warnings.push(`Euler plan usage near the limit: ${w}`);");
  });
});
