// planWindow — the shared plan-expiry / subscription-bucket core (both apps).
import { describe, it, expect } from "vitest";
import {
  EXPIRING_WINDOW_DAYS,
  TRIAL_MONITOR_WINDOW_DAYS,
  planDaysLeft,
  daysDisplay,
  isTimeLimitedPlan,
  monitorWindowDays,
  isActivePaid,
  isExpiredPaid,
  isExpiringSoon,
  isInMonitorWindow,
} from "../planWindow";

const NOW = Date.parse("2026-07-04T00:00:00.000Z");

describe("planDaysLeft", () => {
  it("ceils partial days and floors at 0", () => {
    expect(planDaysLeft("2026-07-14T00:00:00.000Z", NOW)).toBe(10);
    expect(planDaysLeft("2026-07-04T06:00:00.000Z", NOW)).toBe(1); // partial day → 1
    expect(planDaysLeft("2026-06-01T00:00:00.000Z", NOW)).toBe(0); // past → 0
  });
  it("missing/invalid expiry = NO expiry (Infinity), never 'expires today'", () => {
    expect(planDaysLeft("", NOW)).toBe(Infinity);
    expect(planDaysLeft(null, NOW)).toBe(Infinity);
    expect(planDaysLeft(undefined, NOW)).toBe(Infinity);
    expect(planDaysLeft("not-a-date", NOW)).toBe(Infinity);
  });
});

describe("daysDisplay", () => {
  it("finite → string, Infinity → em dash", () => {
    expect(daysDisplay(4)).toBe("4");
    expect(daysDisplay(0)).toBe("0");
    expect(daysDisplay(Infinity)).toBe("—");
  });
});

describe("plan normalization (both apps' plan strings)", () => {
  it("free is cap-limited in either casing; everything else is time-limited", () => {
    expect(isTimeLimitedPlan("free")).toBe(false);
    expect(isTimeLimitedPlan("Free")).toBe(false);
    expect(isTimeLimitedPlan("basic")).toBe(true);
    expect(isTimeLimitedPlan("Pro")).toBe(true);
  });
  it("monitor window: trial 3d (both casings), paid 7d", () => {
    expect(monitorWindowDays("trial")).toBe(TRIAL_MONITOR_WINDOW_DAYS);
    expect(monitorWindowDays("Trial")).toBe(TRIAL_MONITOR_WINDOW_DAYS);
    expect(monitorWindowDays("basic")).toBe(EXPIRING_WINDOW_DAYS);
    expect(monitorWindowDays("Master")).toBe(EXPIRING_WINDOW_DAYS);
  });
});

describe("bucket predicates", () => {
  const p = (plan: string, planStatus: string, daysLeft: number) => ({ plan, planStatus, daysLeft });
  it("active = time-limited, status active, days>0 (Infinity = no expiry counts as active)", () => {
    expect(isActivePaid(p("Pro", "active", 30))).toBe(true);
    expect(isActivePaid(p("pro", "active", Infinity))).toBe(true);
    expect(isActivePaid(p("Pro", "active", 0))).toBe(false);
    expect(isActivePaid(p("Pro", "expired", 30))).toBe(false);
    expect(isActivePaid(p("Free", "active", 30))).toBe(false);
  });
  it("expired = time-limited, non-pending, (status expired or days==0); NULL expiry is NOT expired", () => {
    expect(isExpiredPaid(p("Basic", "expired", 30))).toBe(true);
    expect(isExpiredPaid(p("Basic", "active", 0))).toBe(true);
    expect(isExpiredPaid(p("Basic", "active", Infinity))).toBe(false); // no expiry
    expect(isExpiredPaid(p("Basic", "pending", 0))).toBe(false);       // pending flow sets expiry=now
    expect(isExpiredPaid(p("Free", "expired", 0))).toBe(false);        // cap-limited
  });
  it(`expiring = within ${EXPIRING_WINDOW_DAYS}d (or already expired); free/pending/no-expiry out`, () => {
    expect(isExpiringSoon(p("Basic", "active", 4))).toBe(true);
    expect(isExpiringSoon(p("Basic", "active", 7))).toBe(true);
    expect(isExpiringSoon(p("Basic", "active", 8))).toBe(false);
    expect(isExpiringSoon(p("Basic", "expired", 30))).toBe(true);
    expect(isExpiringSoon(p("Basic", "active", Infinity))).toBe(false);
    expect(isExpiringSoon(p("Free", "active", 1))).toBe(false);
    expect(isExpiringSoon(p("Basic", "pending", 0))).toBe(false);
  });
  it("monitor window: paid ≤7d, trial ≤3d", () => {
    expect(isInMonitorWindow(p("Basic", "active", 7))).toBe(true);
    expect(isInMonitorWindow(p("Basic", "active", 8))).toBe(false);
    expect(isInMonitorWindow(p("Trial", "active", 3))).toBe(true);
    expect(isInMonitorWindow(p("Trial", "active", 4))).toBe(false);
    expect(isInMonitorWindow(p("trial", "expired", 30))).toBe(true);
  });
});
