// Phase 5h — parity test for the admin plan-approval payload (vs App.tsx
// handleAdminApprove:4254-4259). No Supabase / React.
import { describe, it, expect } from "vitest";
import { approvePlanPatch, type Plan } from "../useAdmin";

// VERBATIM reference from App.tsx:230-231 (addDays/addMonths) + 4256-4257.
const refPatch = (plan: Plan, months: number, now: Date) => {
  const addDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString(); };
  const addMonths = (n: number) => addDays(Math.max(1, n) * 30);
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
  it("non-trial expiry = now + months*30 days; status active; no trialStartedAt", () => {
    const p = approvePlanPatch("pro", 2, NOW);
    expect(p.planStatus).toBe("active");
    expect(p.planExpiry).toBe(new Date("2026-08-25T05:30:00.000Z").toISOString()); // +60 days
    expect("trialStartedAt" in p).toBe(false);
  });
  it("trial = +7 days + trialStartedAt = now; months ignored", () => {
    const p = approvePlanPatch("trial", 9, NOW);
    expect(p.planExpiry).toBe(new Date("2026-07-03T05:30:00.000Z").toISOString()); // +7 days
    expect(p.trialStartedAt).toBe(NOW.toISOString());
  });
  it("months clamps to >=1 (Math.max(1,n))", () => {
    expect(approvePlanPatch("basic", 0, NOW).planExpiry).toBe(refPatch("basic", 0, NOW).planExpiry);
    expect(approvePlanPatch("basic", 0, NOW).planExpiry).toBe(new Date("2026-07-26T05:30:00.000Z").toISOString()); // +30 days
  });
});
