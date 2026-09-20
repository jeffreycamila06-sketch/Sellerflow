// Chase-point deadline filter — pure bucketing/sorting over the waiting-pickup list.
// Days-left is a Taipei whole-day diff (daysUntilDate): negative = overdue, null =
// no/unparseable deadline. Buckets: all | exact 5/3/1 days left | overdue (<0).
import { describe, it, expect } from "vitest";
import {
  matchesDeadlineBucket, filterByDeadline, deadlineBucketCounts,
  type ParcelTrackingRow,
} from "../parcelTracking";

const TODAY = "2026-09-20"; // Taipei calendar day

// Minimal fixture: only pickupDeadline (+ a stable id) matter for the deadline logic.
function row(id: string, pickupDeadline: string | null): ParcelTrackingRow {
  return {
    id, trackingNo: id, cmOrderNo: null, buyerUsername: null, recipientName: null,
    storeId: null, recStore: null, status: "at_store", statusMessage: null,
    pickupDeadline, arrivedAt: null, shipType: "C2C", specialType: null, terminal: false,
  };
}

// today = 2026-09-20 → deadline 09-25 = 5 left, 09-23 = 3, 09-21 = 1, 09-20 = 0 (today),
// 09-18 = -2 (overdue), null = no deadline.
const D5 = row("d5", "2026-09-25");
const D3 = row("d3", "2026-09-23");
const D1 = row("d1", "2026-09-21");
const D0 = row("today", "2026-09-20");
const OVER = row("over", "2026-09-18");
const NONE = row("none", null);
const ALL = [D5, D3, D1, D0, OVER, NONE];

describe("matchesDeadlineBucket — exact-day / overdue / all / null", () => {
  it("exact-day buckets match only that day", () => {
    expect(matchesDeadlineBucket(5, "d5")).toBe(true);
    expect(matchesDeadlineBucket(4, "d5")).toBe(false);
    expect(matchesDeadlineBucket(3, "d3")).toBe(true);
    expect(matchesDeadlineBucket(1, "d1")).toBe(true);
    expect(matchesDeadlineBucket(0, "d1")).toBe(false); // due-today is not "1 day"
  });
  it("overdue is strictly < 0 (today/0 is NOT overdue)", () => {
    expect(matchesDeadlineBucket(-1, "overdue")).toBe(true);
    expect(matchesDeadlineBucket(-5, "overdue")).toBe(true);
    expect(matchesDeadlineBucket(0, "overdue")).toBe(false);
    expect(matchesDeadlineBucket(1, "overdue")).toBe(false);
  });
  it("all matches everything; null-deadline matches ONLY all", () => {
    expect(matchesDeadlineBucket(5, "all")).toBe(true);
    expect(matchesDeadlineBucket(-3, "all")).toBe(true);
    expect(matchesDeadlineBucket(null, "all")).toBe(true);
    expect(matchesDeadlineBucket(null, "d5")).toBe(false);
    expect(matchesDeadlineBucket(null, "d1")).toBe(false);
    expect(matchesDeadlineBucket(null, "overdue")).toBe(false);
  });
});

describe("filterByDeadline — filter + most-urgent-first sort", () => {
  it("exact-day buckets return only the matching row(s)", () => {
    expect(filterByDeadline(ALL, "d5", TODAY).map((r) => r.id)).toEqual(["d5"]);
    expect(filterByDeadline(ALL, "d3", TODAY).map((r) => r.id)).toEqual(["d3"]);
    expect(filterByDeadline(ALL, "d1", TODAY).map((r) => r.id)).toEqual(["d1"]);
  });
  it("overdue returns only rows past the deadline", () => {
    expect(filterByDeadline(ALL, "overdue", TODAY).map((r) => r.id)).toEqual(["over"]);
  });
  it("all = every waiting parcel, sorted overdue → soonest → up, null-deadline last", () => {
    // input order is deliberately NOT urgency-sorted; output must be.
    expect(filterByDeadline(ALL, "all", TODAY).map((r) => r.id)).toEqual(["over", "today", "d1", "d3", "d5", "none"]);
  });
  it("does not mutate the input array", () => {
    const input = [D5, OVER, D1];
    const before = input.map((r) => r.id);
    filterByDeadline(input, "all", TODAY);
    expect(input.map((r) => r.id)).toEqual(before);
  });
  it("empty bucket → empty array (screen shows the honest note)", () => {
    const noneAt5 = [D3, D1, OVER];
    expect(filterByDeadline(noneAt5, "d5", TODAY)).toEqual([]);
  });
});

describe("deadlineBucketCounts — per-chip badges", () => {
  it("counts each bucket; all = total; null counts only toward all", () => {
    expect(deadlineBucketCounts(ALL, TODAY)).toEqual({ all: 6, d5: 1, d3: 1, d1: 1, overdue: 1 });
  });
  it("multiple in one bucket + empty buckets", () => {
    const rows = [row("a", "2026-09-25"), row("b", "2026-09-25"), row("c", "2026-09-18")];
    expect(deadlineBucketCounts(rows, TODAY)).toEqual({ all: 3, d5: 2, d3: 0, d1: 0, overdue: 1 });
  });
  it("empty list → all zeros", () => {
    expect(deadlineBucketCounts([], TODAY)).toEqual({ all: 0, d5: 0, d3: 0, d1: 0, overdue: 0 });
  });
});
