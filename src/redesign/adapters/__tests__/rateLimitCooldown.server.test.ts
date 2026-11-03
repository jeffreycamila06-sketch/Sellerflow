// Rate-limit cooldown resolver + the Nov 3, 2026 additions (server.js has no vitest harness;
// the pure core lives in server/connectionHealth.js). Euler's 429s that day were the free
// plan's daily_rooms limit; the old 30-min bench locked sellers out of a live. Now: 2 min
// default, Euler's own Retry-After / X-RateLimit-Reset when present, capped at 10 min; the
// limit_label is read back; today's 429s and plan usage are tallied for the admin card.
import { describe, it, expect } from "vitest";
import {
  resolveRateLimitCooldownMs, RATE_LIMIT_DEFAULT_MS, RATE_LIMIT_MIN_MS, RATE_LIMIT_MAX_MS,
  rateLimitLabel, taipeiDayKey, rateLimitStatsFor, noteRateLimit, EMPTY_RATE_LIMIT_STATS,
  cooldownKeyMatches, listCooldowns,
  EMPTY_ROOM_STATS, noteRoom, roomsTodayCount, eulerUsage, readLimit, USAGE_WARN_RATIO,
} from "../../../../server/connectionHealth.js";

const NOW = 1_760_000_000_000;

describe("resolveRateLimitCooldownMs", () => {
  it("no headers → 2-min default (was 30 min)", () => {
    expect(resolveRateLimitCooldownMs({}, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(resolveRateLimitCooldownMs({ retryAfter: 0, resetTime: undefined }, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(resolveRateLimitCooldownMs(null, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(RATE_LIMIT_DEFAULT_MS).toBe(2 * 60 * 1000);
  });
  it("honors Retry-After (ms) when present", () => {
    expect(resolveRateLimitCooldownMs({ retryAfter: 5 * 60 * 1000 }, NOW)).toBe(5 * 60 * 1000);
  });
  it("prefers the absolute reset time over Retry-After", () => {
    const reset = NOW + 8 * 60 * 1000; // 8 min out
    expect(resolveRateLimitCooldownMs({ retryAfter: 5 * 60 * 1000, resetTime: reset }, NOW)).toBe(8 * 60 * 1000);
  });
  it("ignores a reset time already in the past → falls to Retry-After / default", () => {
    expect(resolveRateLimitCooldownMs({ resetTime: NOW - 1000 }, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(resolveRateLimitCooldownMs({ resetTime: NOW - 1000, retryAfter: 3 * 60 * 1000 }, NOW)).toBe(3 * 60 * 1000);
  });
  it("clamps: floor 1 min, ceiling 10 min (a header can never bench longer)", () => {
    expect(resolveRateLimitCooldownMs({ retryAfter: 500 }, NOW)).toBe(RATE_LIMIT_MIN_MS);                  // 0.5s → 1 min
    expect(resolveRateLimitCooldownMs({ retryAfter: 30 * 60 * 1000 }, NOW)).toBe(RATE_LIMIT_MAX_MS);       // 30 min → 10 min
    expect(resolveRateLimitCooldownMs({ resetTime: NOW + 24 * 60 * 60 * 1000 }, NOW)).toBe(RATE_LIMIT_MAX_MS); // tomorrow → 10 min
    expect(RATE_LIMIT_MIN_MS).toBe(60 * 1000);
    expect(RATE_LIMIT_MAX_MS).toBe(10 * 60 * 1000);
  });
  it("defensive: a wrapped error that lost the fields → default", () => {
    expect(resolveRateLimitCooldownMs({ message: "rate_limit" }, NOW)).toBe(RATE_LIMIT_DEFAULT_MS);
  });
});

describe("rateLimitLabel — Euler's limit_label from the connector's message", () => {
  it("reads the label the connector puts in front of the message", () => {
    expect(rateLimitLabel({ message: "(daily_rooms) Too many connections started, try again later." })).toBe("daily_rooms");
    expect(rateLimitLabel({ message: "(concurrent_rooms) Too many connections started, try again later. Sign server: limit" })).toBe("concurrent_rooms");
    expect(rateLimitLabel("(per_minute) Too many connections started, try again later.")).toBe("per_minute");
  });
  it("no label → null", () => {
    expect(rateLimitLabel({ message: "Too many connections started, try again later." })).toBeNull();
    expect(rateLimitLabel({ message: "rate_limit" })).toBeNull();
    expect(rateLimitLabel(null)).toBeNull();
    expect(rateLimitLabel({})).toBeNull();
  });
});

describe("today's 429 tally (Taipei day)", () => {
  it("counts within the day, keeps the last label, and starts over on a new Taipei day", () => {
    const day1 = Date.UTC(2026, 10, 3, 12, 0, 0); // 20:00 Taipei Nov 3
    let s = noteRateLimit(EMPTY_RATE_LIMIT_STATS, "daily_rooms", day1);
    expect(s).toEqual({ dayKey: "2026-11-03", count: 1, lastLabel: "daily_rooms", lastAt: day1 });
    s = noteRateLimit(s, null, day1 + 60_000);           // no label → keeps the last one
    expect(s.count).toBe(2);
    expect(s.lastLabel).toBe("daily_rooms");
    expect(rateLimitStatsFor(s, day1 + 120_000).count).toBe(2);
    const day2 = Date.UTC(2026, 10, 3, 16, 30, 0);       // 00:30 Taipei Nov 4
    expect(taipeiDayKey(day2)).toBe("2026-11-04");
    expect(rateLimitStatsFor(s, day2)).toEqual({ dayKey: "2026-11-04", count: 0, lastLabel: null, lastAt: null });
    expect(noteRateLimit(s, "concurrent", day2).count).toBe(1);
  });
});

describe("cooldown keys — admin clear by username, status list", () => {
  it("matches `${seller}:TikTok:${username}` case-insensitively, never another account", () => {
    expect(cooldownKeyMatches("jacq@x.com:TikTok:thrifts.studio", "thrifts.studio")).toBe(true);
    expect(cooldownKeyMatches("jacq@x.com:TikTok:thrifts.studio", "Thrifts.Studio")).toBe(true);
    expect(cooldownKeyMatches("jacq@x.com:TikTok:thrifts.studio2", "thrifts.studio")).toBe(false);
    expect(cooldownKeyMatches("jacq@x.com:Facebook:thrifts.studio", "thrifts.studio")).toBe(false);
    expect(cooldownKeyMatches("jacq@x.com:TikTok:thrifts.studio", "")).toBe(false);
  });
  it("lists only cooldowns still running, parsed back into seller + username", () => {
    const m = new Map([["a@x.com:TikTok:shop1", NOW + 90_000], ["b@x.com:TikTok:shop2", NOW - 1], ["c@x.com:TikTok:shop3", NOW + 5_000]]);
    expect(listCooldowns(m, NOW)).toEqual([
      { key: "a@x.com:TikTok:shop1", sellerId: "a@x.com", username: "shop1", remainingMs: 90_000 },
      { key: "c@x.com:TikTok:shop3", sellerId: "c@x.com", username: "shop3", remainingMs: 5_000 },
    ]);
    expect(listCooldowns(new Map(), NOW)).toEqual([]);
  });
});

describe("Euler plan usage — rooms/day + concurrent vs the env limits, warning from 70%", () => {
  it("distinct rooms per Taipei day; a new day starts at 0", () => {
    const d1 = Date.UTC(2026, 10, 3, 12, 0, 0);
    let s = noteRoom(EMPTY_ROOM_STATS, "room-1", d1);
    s = noteRoom(s, "room-1", d1 + 1000);                // same room twice = 1
    s = noteRoom(s, "room-2", d1 + 2000);
    s = noteRoom(s, "", d1 + 3000);                      // unknown id ignored
    expect(roomsTodayCount(s, d1 + 4000)).toBe(2);
    const d2 = Date.UTC(2026, 10, 3, 16, 30, 0);         // next Taipei day
    expect(roomsTodayCount(s, d2)).toBe(0);
    expect(roomsTodayCount(noteRoom(s, "room-9", d2), d2)).toBe(1);
  });
  it("readLimit: env value or the plan default (1000 rooms/day, 100 concurrent)", () => {
    expect(readLimit("1000", 5)).toBe(1000);
    expect(readLimit(undefined, 1000)).toBe(1000);
    expect(readLimit("abc", 100)).toBe(100);
    expect(readLimit("0", 100)).toBe(100);
    expect(eulerUsage(0, 0, {})).toMatchObject({ dailyLimit: 1000, concurrentLimit: 100, warn: false });
  });
  it("warns at 70% of either limit, names which", () => {
    expect(USAGE_WARN_RATIO).toBe(0.7);
    const lim = { dailyRooms: 1000, concurrent: 100 };
    expect(eulerUsage(699, 69, lim)).toMatchObject({ warn: false, warnings: [] });
    expect(eulerUsage(700, 0, lim)).toMatchObject({ warn: true, warnings: ["daily_rooms 700/1000"] });
    expect(eulerUsage(0, 70, lim)).toMatchObject({ warn: true, warnings: ["concurrent 70/100"] });
    expect(eulerUsage(950, 80, lim).warnings).toHaveLength(2);
    expect(eulerUsage(10, 2, lim)).toEqual({ roomsToday: 10, concurrent: 2, dailyLimit: 1000, concurrentLimit: 100, warn: false, warnings: [] });
  });
});
