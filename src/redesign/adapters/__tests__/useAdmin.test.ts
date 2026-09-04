// Phase 5h — parity test for the admin plan-approval payload (vs App.tsx
// handleAdminApprove:4254-4259). No Supabase / React.
import { describe, it, expect } from "vitest";
import { approvePlanPatch, planChangePatch, addDaysToExpiry, addDaysIso, makeAdminPatch, type Plan } from "../useAdmin";

// Reference mirror of approvePlanPatch (useAdmin.ts). ⚠️ 31-day month (owner
// 2026-09-04): 1 month = 31 days, N months = N × 31 — diverges from the App.tsx
// rollback twin (still *30, rollback-only, not served in production).
const refPatch = (plan: Plan, months: number, now: Date) => {
  const addDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString(); };
  const addMonths = (n: number) => addDays(Math.max(1, n) * 31);
  const planExpiry = plan === "trial" ? addDays(7) : addMonths(months);
  const trialStartedAt = plan === "trial" ? now.toISOString() : undefined;
  return { plan, planStatus: "active", planExpiry, ...(trialStartedAt ? { trialStartedAt } : {}) };
};

const NOW = new Date("2026-06-26T05:30:00.000Z");

describe("approvePlanPatch — parity with App.tsx handleAdminApprove", () => {
  it("matches reference byte-for-byte across plans/months", () => {
    const cases: [Plan, number][] = [["basic", 1], ["pro", 3], ["master", 12], ["trial", 1], ["free", 1]];
    for (const [plan, months] of cases) {
      expect(JSON.stringify(approvePlanPatch(plan, months, NOW))).toBe(JSON.stringify(refPatch(plan, months, NOW)));
    }
  });
  it("non-trial expiry = now + months*31 days; status active; no trialStartedAt", () => {
    const p = approvePlanPatch("pro", 2, NOW);
    expect(p.planStatus).toBe("active");
    expect(p.planExpiry).toBe(new Date(NOW.getTime() + 62 * 86400000).toISOString()); // +62 days (2 × 31)
    expect("trialStartedAt" in p).toBe(false);
  });
  it("trial = +7 days + trialStartedAt = now; months ignored", () => {
    const p = approvePlanPatch("trial", 9, NOW);
    expect(p.planExpiry).toBe(new Date("2026-07-03T05:30:00.000Z").toISOString()); // +7 days
    expect(p.trialStartedAt).toBe(NOW.toISOString());
  });
  it("months clamps to >=1 (Math.max(1,n))", () => {
    expect(approvePlanPatch("basic", 0, NOW).planExpiry).toBe(refPatch("basic", 0, NOW).planExpiry);
    expect(approvePlanPatch("basic", 0, NOW).planExpiry).toBe(new Date(NOW.getTime() + 31 * 86400000).toISOString()); // +31 days (1 month)
  });
});

describe("planChangePatch — tier switch preserves expiry, activation opens a window", () => {
  const at = (days: number) => new Date(NOW.getTime() + days * 86400000).toISOString();

  it("UPGRADE on an active paid plan preserves plan_expiry (Basic→Pro, 28 days left)", () => {
    const p = planChangePatch("pro", 1, { plan: "Basic", status: "active", expiry: at(28) }, NOW);
    expect(p.plan).toBe("pro");
    expect(p.planStatus).toBe("active");
    expect(p.planExpiry).toBeUndefined(); // omitted → adminUpdatePlan won't touch plan_expiry
  });

  it("DOWNGRADE on an active paid plan preserves plan_expiry (Pro→Basic, 10 days left)", () => {
    const p = planChangePatch("basic", 1, { plan: "Pro", status: "active", expiry: at(10) }, NOW);
    expect(p.plan).toBe("basic");
    expect(p.planExpiry).toBeUndefined();
  });

  it("ACTIVATION from free opens a fresh 31-day window", () => {
    const p = planChangePatch("basic", 1, { plan: "Free", status: "active", expiry: "" }, NOW);
    expect(p.planExpiry).toBe(approvePlanPatch("basic", 1, NOW).planExpiry); // now + 31
  });

  it("ACTIVATION from an expired plan opens a fresh window", () => {
    const p = planChangePatch("pro", 2, { plan: "Pro", status: "expired", expiry: at(-3) }, NOW);
    expect(p.planExpiry).toBe(approvePlanPatch("pro", 2, NOW).planExpiry); // now + 62
  });

  it("ACTIVATION when active but 0 days left (expiry today/past) opens a fresh window", () => {
    const p = planChangePatch("basic", 1, { plan: "Basic", status: "active", expiry: at(0) }, NOW);
    expect(p.planExpiry).toBe(approvePlanPatch("basic", 1, NOW).planExpiry);
  });

  it("granting a TRIAL always opens a fresh 7-day trial window (activation)", () => {
    const p = planChangePatch("trial", 1, { plan: "Pro", status: "active", expiry: at(28) }, NOW);
    expect(p.planExpiry).toBe(approvePlanPatch("trial", 1, NOW).planExpiry); // +7
    expect(p.trialStartedAt).toBe(NOW.toISOString());
  });

  it("switching an active paid seller to Free preserves expiry (free ignores it anyway)", () => {
    const p = planChangePatch("free", 1, { plan: "Pro", status: "active", expiry: at(28) }, NOW);
    expect(p.plan).toBe("free");
    expect(p.planExpiry).toBeUndefined();
  });
});

// S5 — admin "Add days" persistence. Mirrors App.tsx addMonthsToExpiry (239-241):
// extend from the CURRENT expiry while active (cumulative), else from now.
describe("addDaysToExpiry — cumulative plan extension", () => {
  it("active plan (expiry in the future) → extends from the EXISTING expiry", () => {
    const expiry = new Date("2026-07-10T05:30:00.000Z").toISOString(); // 14 days ahead of NOW
    // +10 days should land on expiry+10, NOT now+10 (cumulative).
    expect(addDaysToExpiry(expiry, "active", 10, NOW)).toBe(new Date("2026-07-20T05:30:00.000Z").toISOString());
  });
  it("repeated calls accumulate (no reset to now)", () => {
    const e1 = addDaysToExpiry(new Date("2026-07-10T05:30:00.000Z").toISOString(), "active", 5, NOW);
    const e2 = addDaysToExpiry(e1, "active", 5, NOW);
    expect(e2).toBe(new Date("2026-07-20T05:30:00.000Z").toISOString()); // 10 → 15 → 20
  });
  it("expired plan → extends from NOW (not the stale past expiry)", () => {
    const past = new Date("2026-06-01T05:30:00.000Z").toISOString(); // before NOW
    expect(addDaysToExpiry(past, "expired", 30, NOW)).toBe(new Date("2026-07-26T05:30:00.000Z").toISOString()); // now+30
  });
  it("active-but-already-lapsed (status active, expiry past) → from now", () => {
    const past = new Date("2026-06-20T05:30:00.000Z").toISOString();
    expect(addDaysToExpiry(past, "active", 7, NOW)).toBe(new Date("2026-07-03T05:30:00.000Z").toISOString()); // now+7
  });
  it("invalid/empty expiry → from now; days clamps to >=1", () => {
    expect(addDaysToExpiry("", "active", 3, NOW)).toBe(new Date("2026-06-29T05:30:00.000Z").toISOString()); // now+3
    expect(addDaysToExpiry("", "active", 0, NOW)).toBe(new Date("2026-06-27T05:30:00.000Z").toISOString()); // clamps to +1
  });
});

// VERBATIM reference for addDays (App.tsx:230, setDate-based).
const refAddDays = (now: Date, n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString(); };

describe("addDaysIso — parity with App.tsx addDays (230)", () => {
  it("setDate-based add (handles month rollover)", () => {
    expect(addDaysIso(NOW, 30)).toBe(refAddDays(NOW, 30));
    expect(addDaysIso(NOW, -1)).toBe(refAddDays(NOW, -1)); // expire backdate
    expect(addDaysIso(NOW, 0)).toBe(NOW.toISOString());
  });
});

describe("makeAdminPatch — parity with App.tsx makeAdmin (3303)", () => {
  it("grants admin + master + active + addMonths(120) expiry", () => {
    const p = makeAdminPatch(NOW);
    expect(p.role).toBe("admin");
    expect(p.plan).toBe("master");
    expect(p.planStatus).toBe("active");
    expect(p.planExpiry).toBe(refAddDays(NOW, 120 * 30)); // addMonths(120) = addDays(3600)
  });
});
