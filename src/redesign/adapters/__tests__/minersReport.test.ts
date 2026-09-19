import { describe, it, expect } from "vitest";
import {
  addDaysISO, monthStartISO, minersRangeBounds, mapMinersReport,
  MINERS_TOP_ALL,
} from "../minersReport";

describe("addDaysISO / monthStartISO — pure Taipei-day arithmetic", () => {
  it("adds/subtracts days across month + year boundaries", () => {
    expect(addDaysISO("2026-09-19", -6)).toBe("2026-09-13");
    expect(addDaysISO("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysISO("2026-09-19", 0)).toBe("2026-09-19");
  });
  it("monthStart = first of the month", () => {
    expect(monthStartISO("2026-09-19")).toBe("2026-09-01");
    expect(monthStartISO("2026-12-31")).toBe("2026-12-01");
  });
  it("malformed input → '' (never throws)", () => {
    expect(addDaysISO("nope", -1)).toBe("");
    expect(monthStartISO("")).toBe("");
  });
});

describe("minersRangeBounds — preset → inclusive [start,end]", () => {
  const today = "2026-09-19", sess = "2026-09-15";
  it("today", () => expect(minersRangeBounds("today", today, sess, "", "")).toEqual({ start: "2026-09-19", end: "2026-09-19" }));
  it("7days = last 7 inclusive of today", () => expect(minersRangeBounds("7days", today, sess, "", "")).toEqual({ start: "2026-09-13", end: "2026-09-19" }));
  it("month = month-start..today", () => expect(minersRangeBounds("month", today, sess, "", "")).toEqual({ start: "2026-09-01", end: "2026-09-19" }));
  it("session = sessionStart..today", () => expect(minersRangeBounds("session", today, sess, "", "")).toEqual({ start: "2026-09-15", end: "2026-09-19" }));
  it("session with no session start → falls back to today..today", () => expect(minersRangeBounds("session", today, "", "", "")).toEqual({ start: today, end: today }));
  it("custom uses picker values", () => expect(minersRangeBounds("custom", today, sess, "2026-09-05", "2026-09-10")).toEqual({ start: "2026-09-05", end: "2026-09-10" }));
  it("custom swaps a reversed range", () => expect(minersRangeBounds("custom", today, sess, "2026-09-10", "2026-09-05")).toEqual({ start: "2026-09-05", end: "2026-09-10" }));
  it("custom blank bound → today (never inverted)", () => expect(minersRangeBounds("custom", today, sess, "", "")).toEqual({ start: today, end: today }));
});

describe("mapMinersReport — RPC jsonb → screen shape (garbage-safe)", () => {
  it("maps totals, AOV, platform %, and top rows", () => {
    const raw = {
      spent: 24500, orders: 62, buyers: 33,
      platform_all_tiktok: 21, platform_all_total: 30,
      top: [
        { name: "Ann", handle: "anncruz", platform: "TikTok", spent: 12000, orders: 9, active_days: 3, repeat: true },
        { name: "Bea", handle: "", platform: "TikTok", spent: 800, orders: 1, active_days: 1, repeat: false },
      ],
      start: "2026-09-01", end: "2026-09-19", limit: 10,
    };
    const d = mapMinersReport(raw);
    expect(d.spent).toBe(24500);
    expect(d.orders).toBe(62);
    expect(d.buyers).toBe(33);
    expect(d.avg).toBe(Math.round(24500 / 62));
    expect(d.tiktokPct).toBe(70);              // 21/30
    expect(d.fbPct).toBe(30);
    expect(d.top[0]).toMatchObject({ name: "Ann", handle: "@anncruz", spent: 12000, orders: 9, activeDays: 3, repeat: true });
    expect(d.top[1]).toMatchObject({ name: "Bea", handle: "", repeat: false }); // no handle stays blank
    expect(d.limit).toBe(10);
  });
  it("recomputes repeat defensively from active_days when the flag is absent", () => {
    const d = mapMinersReport({ top: [{ name: "X", active_days: 2, spent: 5, orders: 2 }] });
    expect(d.top[0].repeat).toBe(true);
    const d1 = mapMinersReport({ top: [{ name: "Y", active_days: 1, spent: 5, orders: 1 }] });
    expect(d1.top[0].repeat).toBe(false);
  });
  it("garbage / missing → clean zeros, empty top, 0% (no NaN, no throw)", () => {
    const d = mapMinersReport(null);
    expect(d).toMatchObject({ spent: 0, orders: 0, buyers: 0, avg: 0, tiktokPct: 0, fbPct: 0, top: [] });
    const d2 = mapMinersReport({ spent: "x", platform_all_total: 0 });
    expect(d2.tiktokPct).toBe(0);
    expect(d2.fbPct).toBe(0); // total 0 → 0, not 100
  });
  it("MINERS_TOP_ALL sentinel is the SQL clamp ceiling (5000)", () => {
    expect(MINERS_TOP_ALL).toBe(5000);
  });
});
