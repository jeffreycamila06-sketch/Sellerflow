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

describe("daily_rooms — the shared bench (audit item 4)", () => {
  it("the recorder arms the shared bench on a daily_rooms label and the answer carries the longer bench", () => {
    const fn = between("function rememberTikTokRateLimit(", "function getTikTokCooldownMs(");
    expect(fn).toContain("if (isDailyRoomsLabel(limitLabel)) {");
    expect(fn).toContain("dailyRoomsCooldownUntil = Math.max(dailyRoomsCooldownUntil, Date.now() + dailyMs);");
    expect(fn).toContain("[DAILY-ROOMS]");
    expect(fn).toContain("return Math.max(cooldownMs, dailyRoomsRemainingMs());");
  });
  it("the connect gate applies the shared bench to EVERY TikTok account", () => {
    const fn = between("function getTikTokCooldownMs(", "function clearTikTokReconnect(");
    expect(fn).toContain("return Math.max(perKeyMs, dailyRoomsRemainingMs());");
  });
  it("both 429 bodies name the daily limit so the client skips its auto-retry", () => {
    expect(server.match(/\.\.\.\(dailyRoomsRemainingMs\(\) > 0 \? \{ limit: DAILY_ROOMS_LABEL \} : \{\}\),/g)?.length).toBe(2);
  });
  it("status reports it; clear accepts { daily: true }", () => {
    const status = between('app.get("/admin/tiktok-cooldown/status"', 'app.post("/admin/tiktok-cooldown/clear"');
    expect(status).toContain("daily: dailyRoomsRemainingMs() > 0 ? { remainingMs: dailyRoomsRemainingMs(), until: dailyRoomsCooldownUntil } : null,");
    const clear = between('app.post("/admin/tiktok-cooldown/clear"', 'app.post("/admin/broadcast-translate"');
    expect(clear).toContain('const daily = (req.body || {}).daily === true;');
    expect(clear).toContain("if (daily) dailyRoomsCooldownUntil = 0;");
    expect(clear).toContain("if (!username && !daily) return res.status(400)");
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
    expect(route).toContain("if (username && cooldownKeyMatches(key, username)) { tiktokRateLimitCooldowns.delete(key); cleared += 1; }");
    expect(route).not.toContain("tiktokConnections.");          // never touches a live connection
    expect(route).not.toContain("disconnect");
    expect(route).toContain("[COOLDOWN-CLEAR]");
    expect(route).toContain("return res.json({ success: true, cleared, clearedDaily });");
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
