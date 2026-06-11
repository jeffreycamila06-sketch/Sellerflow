// Deterministic tests for the calendar-day ID helpers. All times are pinned
// with vi.setSystemTime so results never depend on when the suite runs.
//
// NOTE on liveDayId: it formats in the DEVICE-LOCAL timezone. The test
// process timezone is whatever the runner uses (typically UTC in CI), so we
// assert against an expectation computed with the same local-Date getters —
// that keeps the test valid in any runner TZ while still pinning the format
// and the exact instant.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { liveDayId, taipeiDayId } from "../dateHelpers";

const localDayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("liveDayId (device-local calendar day)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns YYYY-MM-DD with zero-padded month and day", () => {
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0)); // Jan 5, local noon
    expect(liveDayId()).toBe("2026-01-05");
    expect(liveDayId()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches the local calendar day for an arbitrary instant", () => {
    const instant = new Date("2026-06-11T15:30:00Z");
    vi.setSystemTime(instant);
    expect(liveDayId()).toBe(localDayOf(instant));
  });

  it("flips exactly at local midnight", () => {
    vi.setSystemTime(new Date(2026, 5, 11, 23, 59, 59)); // Jun 11 23:59:59 local
    expect(liveDayId()).toBe("2026-06-11");
    vi.setSystemTime(new Date(2026, 5, 12, 0, 0, 0)); // Jun 12 00:00:00 local
    expect(liveDayId()).toBe("2026-06-12");
  });

  it("handles year boundary (Dec 31 -> Jan 1)", () => {
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 0));
    expect(liveDayId()).toBe("2026-12-31");
    vi.setSystemTime(new Date(2027, 0, 1, 0, 1, 0));
    expect(liveDayId()).toBe("2027-01-01");
  });
});

describe("taipeiDayId (Asia/Taipei calendar day, UTC+8)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns YYYY-MM-DD format", () => {
    vi.setSystemTime(new Date("2026-06-11T04:00:00Z"));
    expect(taipeiDayId()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is the NEXT day when UTC is past 16:00 (Taipei midnight)", () => {
    // 16:00 UTC = 00:00 Taipei the next day (UTC+8, no DST in Taiwan)
    vi.setSystemTime(new Date("2026-06-11T16:00:00Z"));
    expect(taipeiDayId()).toBe("2026-06-12");
  });

  it("is the SAME UTC day just before Taipei midnight", () => {
    // 15:59:59 UTC = 23:59:59 Taipei, still June 11 in Taipei
    vi.setSystemTime(new Date("2026-06-11T15:59:59Z"));
    expect(taipeiDayId()).toBe("2026-06-11");
  });

  it("handles year boundary in Taipei time", () => {
    // Dec 31 16:00 UTC = Jan 1 00:00 Taipei
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    expect(taipeiDayId()).toBe("2027-01-01");
    // Dec 31 15:59 UTC = Dec 31 23:59 Taipei
    vi.setSystemTime(new Date("2026-12-31T15:59:00Z"));
    expect(taipeiDayId()).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    // Mar 3 02:00 UTC = Mar 3 10:00 Taipei
    vi.setSystemTime(new Date("2026-03-03T02:00:00Z"));
    expect(taipeiDayId()).toBe("2026-03-03");
  });
});
