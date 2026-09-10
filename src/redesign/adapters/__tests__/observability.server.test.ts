// Crash safety + memory observability — pure helpers (server.js has no vitest
// harness; same convention as sanitize/connectionHealth). The process-level
// handlers (uncaughtException/unhandledRejection/SIGTERM) + the setInterval are
// wired in server.js and are NOT unit-tested — driving real process signals /
// exits in vitest would be a brittle no-value test. We pin the formatting and
// threshold logic those handlers depend on.
import { describe, it, expect } from "vitest";
import {
  memoryPct, isMemoryWarn, memorySnapshot, formatMemoryLine, crashLogLine,
  shutdownLogLine, MEMORY_LIMIT_MB, MEMORY_WARN_PCT, MEMORY_LOG_INTERVAL_MS,
} from "../../../../server/observability.js";

const MB = 1024 * 1024;

describe("constants", () => {
  it("512 MB plan, 75% warn, 5-min interval", () => {
    expect(MEMORY_LIMIT_MB).toBe(512);
    expect(MEMORY_WARN_PCT).toBe(0.75);
    expect(MEMORY_LOG_INTERVAL_MS).toBe(300000);
  });
});

describe("memoryPct", () => {
  it("rss/limit fraction", () => {
    expect(memoryPct(256 * MB, 512)).toBeCloseTo(0.5, 5);
    expect(memoryPct(512 * MB, 512)).toBeCloseTo(1, 5);
  });
  it("guards a zero/bad limit → 0 (never divide-by-zero)", () => {
    expect(memoryPct(100 * MB, 0)).toBe(0);
    expect(memoryPct(100 * MB, NaN)).toBe(0);
  });
  it("bad rss → 0", () => {
    expect(memoryPct(undefined, 512)).toBe(0);
  });
});

describe("isMemoryWarn — threshold at 75% of 512 (~384 MB)", () => {
  it("below → false, at/above → true", () => {
    expect(isMemoryWarn(383 * MB)).toBe(false);
    expect(isMemoryWarn(384 * MB)).toBe(true);   // 384/512 = 0.75 exactly
    expect(isMemoryWarn(450 * MB)).toBe(true);
  });
});

describe("memorySnapshot (for /health/tiktok)", () => {
  it("rounds MB + percent + warn flag", () => {
    expect(memorySnapshot({ rss: 400 * MB, heapUsed: 120 * MB })).toEqual({
      rssMb: 400, heapUsedMb: 120, limitMb: 512, pctOfLimit: 78, warn: true,
    });
  });
  it("healthy snapshot → warn false", () => {
    const s = memorySnapshot({ rss: 150 * MB, heapUsed: 60 * MB });
    expect(s).toMatchObject({ rssMb: 150, heapUsedMb: 60, pctOfLimit: 29, warn: false });
  });
  it("empty input is safe (all zero, not NaN)", () => {
    expect(memorySnapshot()).toEqual({ rssMb: 0, heapUsedMb: 0, limitMb: 512, pctOfLimit: 0, warn: false });
  });
});

describe("formatMemoryLine", () => {
  it("[MEM] below threshold, includes relay count + percent", () => {
    const line = formatMemoryLine({ rss: 200 * MB, heapUsed: 80 * MB }, 12);
    expect(line).toBe("[MEM] rss=200MB heapUsed=80MB relays=12 (39% of 512MB)");
  });
  it("[MEM-WARN] at/above 75% so it's greppable", () => {
    const line = formatMemoryLine({ rss: 400 * MB, heapUsed: 300 * MB }, 40);
    expect(line.startsWith("[MEM-WARN]")).toBe(true);
    expect(line).toContain("relays=40");
    expect(line).toContain("(78% of 512MB)");
  });
});

describe("crashLogLine", () => {
  const at = new Date("2026-09-10T00:00:00.000Z");
  it("captures kind, timestamp, relays lost, and the stack", () => {
    const err = new Error("boom");
    const line = crashLogLine("uncaughtException", err, 8, at);
    expect(line).toContain("[CRASH] uncaughtException");
    expect(line).toContain("2026-09-10T00:00:00.000Z");
    expect(line).toContain("8 live relay(s) lost");
    expect(line).toContain("boom"); // the stack (includes the message)
  });
  it("survives a non-Error thrown value (string/undefined)", () => {
    expect(crashLogLine("unhandledRejection", "weird", 3, at)).toContain("weird");
    expect(crashLogLine("unhandledRejection", undefined, 0, at)).toContain("0 live relay(s) lost");
  });
});

describe("shutdownLogLine", () => {
  it("notes SIGTERM + relay drop + the re-Connect consequence", () => {
    const line = shutdownLogLine(15, new Date("2026-09-10T00:00:00.000Z"));
    expect(line).toContain("[SHUTDOWN] SIGTERM");
    expect(line).toContain("15 live relay(s)");
    expect(line).toContain("re-Connect");
  });
});
