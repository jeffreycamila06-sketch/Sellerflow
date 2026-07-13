// Multi-day live session — PURE window-math tests (no Supabase / React).
import { describe, it, expect } from "vitest";
import { clampWindowDays, daysBetween, addDays, computeWindowState, chooseSessionLoad, shouldOpenWindow, shouldResetOnDayChange } from "../useSessionWindow";

describe("clampWindowDays", () => {
  it("keeps 1/2/3/4 (4-day added 2026-07-13), defaults everything else to 1", () => {
    expect(clampWindowDays(1)).toBe(1);
    expect(clampWindowDays(2)).toBe(2);
    expect(clampWindowDays(3)).toBe(3);
    expect(clampWindowDays(4)).toBe(4);
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(5)).toBe(1); // ceiling stays HARD — 5+ must never pass (the 7-day purge is the physical limit)
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

describe("computeWindowState — 4-day window (start 2026-07-13)", () => {
  const start = "2026-07-13";
  it("days 1–4 → active with continuous dayOfWindow; loadStart pinned to the window start", () => {
    expect(computeWindowState("2026-07-13", start, 4)).toMatchObject({ n: 4, active: true, dayOfWindow: 1, loadStart: start, windowEnd: "2026-07-16" });
    expect(computeWindowState("2026-07-14", start, 4)).toMatchObject({ active: true, dayOfWindow: 2, loadStart: start });
    expect(computeWindowState("2026-07-15", start, 4)).toMatchObject({ active: true, dayOfWindow: 3, loadStart: start });
    expect(computeWindowState("2026-07-16", start, 4)).toMatchObject({ active: true, dayOfWindow: 4, windowEnd: "2026-07-16" });
  });
  it("day 5 (N+1) → EXPIRED → reset (loadStart null → buyers empty → #1)", () => {
    expect(computeWindowState("2026-07-17", start, 4)).toMatchObject({ active: false, expired: true, loadStart: null });
  });
  it("month crossing inside a 4-day window (start Jul 30 → active through Aug 2, expired Aug 3)", () => {
    expect(computeWindowState("2026-08-02", "2026-07-30", 4)).toMatchObject({ active: true, dayOfWindow: 4 });
    expect(computeWindowState("2026-08-03", "2026-07-30", 4)).toMatchObject({ expired: true });
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

describe("chooseSessionLoad — single-day vs window-range", () => {
  it("N=1 → ALWAYS single-day (byte-identical to 5c), regardless of window_start", () => {
    expect(chooseSessionLoad("2026-06-23", "2026-06-22", 1)).toEqual({ mode: "day", start: "2026-06-23", end: "2026-06-23" });
    expect(chooseSessionLoad("2026-06-23", null, 1)).toEqual({ mode: "day", start: "2026-06-23", end: "2026-06-23" });
  });
  it("N=3 day 1 (start==today) → single-day (today only)", () => {
    expect(chooseSessionLoad("2026-06-22", "2026-06-22", 3)).toEqual({ mode: "day", start: "2026-06-22", end: "2026-06-22" });
  });
  it("N=3 day 2/3 (active, start<today) → RANGE [window_start, today]", () => {
    expect(chooseSessionLoad("2026-06-23", "2026-06-22", 3)).toEqual({ mode: "range", start: "2026-06-22", end: "2026-06-23" });
    expect(chooseSessionLoad("2026-06-24", "2026-06-22", 3)).toEqual({ mode: "range", start: "2026-06-22", end: "2026-06-24" });
  });
  it("N=3 expired (day 4+) → single-day today (fresh window resets to #1)", () => {
    expect(chooseSessionLoad("2026-06-25", "2026-06-22", 3)).toEqual({ mode: "day", start: "2026-06-25", end: "2026-06-25" });
  });
  it("N=3 fresh (null start) → single-day today", () => {
    expect(chooseSessionLoad("2026-06-22", null, 3)).toEqual({ mode: "day", start: "2026-06-22", end: "2026-06-22" });
  });
  it("N=4 ranged load: day 1 single-day; days 2–4 → RANGE [start, today] (day 4 spans the full window); day 5 expired → single-day fresh", () => {
    const start = "2026-07-13";
    expect(chooseSessionLoad("2026-07-13", start, 4)).toEqual({ mode: "day", start, end: start });
    expect(chooseSessionLoad("2026-07-14", start, 4)).toEqual({ mode: "range", start, end: "2026-07-14" });
    expect(chooseSessionLoad("2026-07-15", start, 4)).toEqual({ mode: "range", start, end: "2026-07-15" });
    expect(chooseSessionLoad("2026-07-16", start, 4)).toEqual({ mode: "range", start, end: "2026-07-16" }); // full 4-day span — ang worst-case ~3.1k-row read (S1 pager handles it)
    expect(chooseSessionLoad("2026-07-17", start, 4)).toEqual({ mode: "day", start: "2026-07-17", end: "2026-07-17" });
  });
});

describe("shouldOpenWindow — when an order writes window_start", () => {
  it("N=1 → NEVER writes config (byte-identical 1-day; zero new writes)", () => {
    expect(shouldOpenWindow("2026-06-22", null, 1)).toBe(false);
    expect(shouldOpenWindow("2026-06-23", "2026-06-22", 1)).toBe(false);
  });
  it("N=3 fresh (null) → open (write once)", () => {
    expect(shouldOpenWindow("2026-06-22", null, 3)).toBe(true);
  });
  it("N=3 active window → do NOT write (continue) — proves once-per-window", () => {
    expect(shouldOpenWindow("2026-06-22", "2026-06-22", 3)).toBe(false); // day 1
    expect(shouldOpenWindow("2026-06-23", "2026-06-22", 3)).toBe(false); // day 2
    expect(shouldOpenWindow("2026-06-24", "2026-06-22", 3)).toBe(false); // day 3
  });
  it("N=3 expired (day 4) → open a fresh window (write once)", () => {
    expect(shouldOpenWindow("2026-06-25", "2026-06-22", 3)).toBe(true);
  });
  it("N=4: fresh → open once; days 1–4 active → no write; day 5 expired → open again", () => {
    expect(shouldOpenWindow("2026-07-13", null, 4)).toBe(true);
    for (const day of ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"]) {
      expect(shouldOpenWindow(day, "2026-07-13", 4)).toBe(false); // once-per-window holds at N=4
    }
    expect(shouldOpenWindow("2026-07-17", "2026-07-13", 4)).toBe(true);
  });
});

describe("shouldResetOnDayChange — window-aware live reset on Taipei day rollover", () => {
  it("no actual day change → never resets (no-op guard)", () => {
    expect(shouldResetOnDayChange("2026-06-30", "2026-06-30", null, 1)).toBe(false);
    expect(shouldResetOnDayChange("2026-06-30", "", null, 1)).toBe(false); // empty newDay
  });
  it("(a) 1-day: EVERY Taipei midnight resets (window_start stays null)", () => {
    expect(shouldResetOnDayChange("2026-06-30", "2026-07-01", null, 1)).toBe(true);
    expect(shouldResetOnDayChange("2026-07-01", "2026-07-02", null, 1)).toBe(true);
  });
  it("(b) 2-day: intermediate midnight INSIDE the window → NO reset", () => {
    // window_start 06-30, N=2 → days 06-30 & 07-01 are in-window.
    expect(shouldResetOnDayChange("2026-06-30", "2026-07-01", "2026-06-30", 2)).toBe(false);
  });
  it("(c) 2-day: window EXPIRY (day past N) → reset", () => {
    // 07-02 is daysIn=2 ≥ N=2 → expired.
    expect(shouldResetOnDayChange("2026-07-01", "2026-07-02", "2026-06-30", 2)).toBe(true);
  });
  it("(d) 3-day: two intermediate midnights → NO reset, then expiry on day 4 → reset", () => {
    expect(shouldResetOnDayChange("2026-06-22", "2026-06-23", "2026-06-22", 3)).toBe(false); // → day 2
    expect(shouldResetOnDayChange("2026-06-23", "2026-06-24", "2026-06-22", 3)).toBe(false); // → day 3
    expect(shouldResetOnDayChange("2026-06-24", "2026-06-25", "2026-06-22", 3)).toBe(true);  // → day 4 (expired)
  });
  it("(e) 4-day: three intermediate midnights → NO reset, then expiry on day 5 → reset", () => {
    expect(shouldResetOnDayChange("2026-07-13", "2026-07-14", "2026-07-13", 4)).toBe(false); // → day 2
    expect(shouldResetOnDayChange("2026-07-14", "2026-07-15", "2026-07-13", 4)).toBe(false); // → day 3
    expect(shouldResetOnDayChange("2026-07-15", "2026-07-16", "2026-07-13", 4)).toBe(false); // → day 4
    expect(shouldResetOnDayChange("2026-07-16", "2026-07-17", "2026-07-13", 4)).toBe(true);  // → day 5 (expired)
  });
});

// ── S1: paged session loads (the 1,000-row PostgREST cap fix) ────────────────
// fetchAllSessionPages accumulates injected pages until a short page; ANY page
// error (null) → null = load FAILED (Batch D #8 — was [], indistinguishable from
// a fresh day). NEVER partial — partial would recreate the duplicate-buyer# bug.
import { fetchAllSessionPages, SESSION_PAGE_SIZE } from "../useSessionWindow";
import type { LiveSessionRow } from "../../../db";

const mkRows = (start: number, n: number): LiveSessionRow[] =>
  Array.from({ length: n }, (_, i) => ({
    buyer_number: start + i, handle: `h${start + i}`, customer_name: `n${start + i}`,
    platform: "TikTok", product: "P", price: 100,
    created_at: new Date(1780000000000 + (start + i) * 1000).toISOString(),
    session_date: "2026-07-05",
  } as LiveSessionRow));

describe("fetchAllSessionPages (S1 — >1,000-row window)", () => {
  it("heavy-seller scenario: 1,200 rows across 2 pages, order preserved, nothing dropped", async () => {
    const pages = [mkRows(1, SESSION_PAGE_SIZE), mkRows(SESSION_PAGE_SIZE + 1, 200)];
    const calls: number[] = [];
    const rows = await fetchAllSessionPages(async (p) => { calls.push(p); return pages[p] ?? []; });
    expect(rows).toHaveLength(1200);                       // the old un-paged path capped at 1,000
    expect(calls).toEqual([0, 1]);
    expect(rows[0].buyer_number).toBe(1);
    expect(rows[999].buyer_number).toBe(1000);
    expect(rows[1199].buyer_number).toBe(1200);            // NEWEST rows retained (were the ones dropped)
  });
  it("exactly one full page → fetches the next (empty) page to confirm completeness", async () => {
    const pages = [mkRows(1, SESSION_PAGE_SIZE), []];
    const calls: number[] = [];
    const rows = await fetchAllSessionPages(async (p) => { calls.push(p); return pages[p] ?? []; });
    expect(rows).toHaveLength(SESSION_PAGE_SIZE);
    expect(calls).toEqual([0, 1]);
  });
  it("short first page (normal seller) → single fetch", async () => {
    const calls: number[] = [];
    const rows = await fetchAllSessionPages(async (p) => { calls.push(p); return mkRows(1, 5); });
    expect(rows).toHaveLength(5);
    expect(calls).toEqual([0]);
  });
  it("error on a LATER page → null = FAILED (never a partial set — partial = wrong buyer#; Batch D #8: null ≠ [] so a broken read is no longer mistaken for an empty day)", async () => {
    const rows = await fetchAllSessionPages(async (p) => (p === 0 ? mkRows(1, SESSION_PAGE_SIZE) : null));
    expect(rows).toBeNull();
  });
});
