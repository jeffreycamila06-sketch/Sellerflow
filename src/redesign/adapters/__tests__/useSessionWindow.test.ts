// Multi-day live session — PURE window-math tests (no Supabase / React).
import { describe, it, expect } from "vitest";
import { clampWindowDays, daysBetween, addDays, computeWindowState } from "../useSessionWindow";

describe("clampWindowDays", () => {
  it("keeps 1/2/3, defaults everything else to 1", () => {
    expect(clampWindowDays(1)).toBe(1);
    expect(clampWindowDays(2)).toBe(2);
    expect(clampWindowDays(3)).toBe(3);
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(5)).toBe(1);
    expect(clampWindowDays(NaN)).toBe(1);
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days, incl. month/year crossings", () => {
    expect(daysBetween("2026-06-22", "2026-06-22")).toBe(0);
    expect(daysBetween("2026-06-22", "2026-06-25")).toBe(3);
    expect(daysBetween("2026-06-30", "2026-07-02")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-06-25", "2026-06-22")).toBe(-3);
  });
});

describe("addDays", () => {
  it("adds days across month/year boundaries", () => {
    expect(addDays("2026-06-22", 2)).toBe("2026-06-24");
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-06-22", 0)).toBe("2026-06-22");
  });
});

describe("computeWindowState — 3-day window (start 2026-06-22)", () => {
  const start = "2026-06-22";
  it("day 1 (start day) → active", () => {
    expect(computeWindowState("2026-06-22", start, 3)).toEqual({ n: 3, active: true, expired: false, dayOfWindow: 1, loadStart: "2026-06-22", windowEnd: "2026-06-24" });
  });
  it("day 2 → active, continues (loadStart still the window start)", () => {
    const s = computeWindowState("2026-06-23", start, 3);
    expect(s.active).toBe(true); expect(s.dayOfWindow).toBe(2); expect(s.loadStart).toBe("2026-06-22");
  });
  it("day 3 → active (last day)", () => {
    const s = computeWindowState("2026-06-24", start, 3);
    expect(s.active).toBe(true); expect(s.dayOfWindow).toBe(3); expect(s.windowEnd).toBe("2026-06-24");
  });
  it("day 4 (N+1) → EXPIRED → reset (loadStart null → buyers empty → #1)", () => {
    const s = computeWindowState("2026-06-25", start, 3);
    expect(s.active).toBe(false); expect(s.expired).toBe(true); expect(s.loadStart).toBeNull();
  });
  it("far future day → still expired/reset", () => {
    expect(computeWindowState("2026-07-10", start, 3).expired).toBe(true);
  });
});

describe("computeWindowState — N=1 (must match current daily reset)", () => {
  it("start day active; next day expired → reset", () => {
    expect(computeWindowState("2026-06-22", "2026-06-22", 1)).toMatchObject({ active: true, dayOfWindow: 1, loadStart: "2026-06-22" });
    expect(computeWindowState("2026-06-23", "2026-06-22", 1)).toMatchObject({ active: false, expired: true, loadStart: null });
  });
});

describe("computeWindowState — 2-day window", () => {
  it("day1 active, day2 active, day3 expired", () => {
    expect(computeWindowState("2026-06-22", "2026-06-22", 2).active).toBe(true);
    expect(computeWindowState("2026-06-23", "2026-06-22", 2)).toMatchObject({ active: true, dayOfWindow: 2 });
    expect(computeWindowState("2026-06-24", "2026-06-22", 2)).toMatchObject({ active: false, expired: true });
  });
});

describe("computeWindowState — fresh / edge", () => {
  it("window_start null → fresh (not active, not expired, no load)", () => {
    expect(computeWindowState("2026-06-22", null, 3)).toEqual({ n: 3, active: false, expired: false, dayOfWindow: 0, loadStart: null, windowEnd: null });
  });
  it("N-switch = fresh window from today → today is day 1 (start == today)", () => {
    // setWindowDays sets window_start = today; computeWindowState(today, today, n) proves day 1.
    expect(computeWindowState("2026-06-26", "2026-06-26", 3)).toMatchObject({ active: true, dayOfWindow: 1, loadStart: "2026-06-26" });
    expect(computeWindowState("2026-06-26", "2026-06-26", 1)).toMatchObject({ active: true, dayOfWindow: 1 });
  });
  it("window_start in the future → treated as fresh (defensive)", () => {
    expect(computeWindowState("2026-06-22", "2026-06-25", 3)).toMatchObject({ active: false, expired: false, loadStart: null });
  });
});
