// SINGLE SOURCE OF TRUTH for plan-expiry math and the admin subscription
// buckets (Active / Expired / Expiring). Shared by BOTH apps — App.tsx (the
// rollback app) and src/redesign/* (production) — so the two can never drift
// apart again (the 2026-07 "Expiring 0" bug was exactly that: the redesign
// carried its own copy of an older window).
//
// Semantics (decided 2026-07-04):
// • "Expiring" window = 7 days (manual Wise+Telegram renewals need lead time;
//   the old ≤1-day window fired too late to follow up). Trial keeps a tighter
//   3-day monitor window (a 7-day trial would otherwise sit in the monitor
//   from day one).
// • Missing/invalid expiry = NO expiry (Infinity) — a NULL plan_expiry must
//   never read as "expires today".
// • Buckets cover TIME-LIMITED plans only: free is cap-limited (order cap),
//   never time-expired. Pending is excluded from Expired/Expiring — the
//   pending flow sets plan_expiry to now(), which would otherwise read as
//   "expired today"; pending has its own Pending Approvals surface.

export const EXPIRING_WINDOW_DAYS = 7;
export const TRIAL_MONITOR_WINDOW_DAYS = 3;

// Days left until expiry, clamped at 0 (ceil: a partial day counts as 1).
// Missing/invalid expiry → Infinity (no expiry).
export function planDaysLeft(expiry: string | null | undefined, nowMs: number): number {
  const ms = expiry ? new Date(expiry).getTime() : NaN;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil((ms - nowMs) / 86400000)) : Infinity;
}

// Render guard for day counts — Infinity (no expiry) shows as an em dash.
export const daysDisplay = (days: number): string => (Number.isFinite(days) ? String(days) : "—");

// Plan strings differ per app (App.tsx "free"/"pro" vs redesign labels
// "Free"/"Pro") — normalize case so both sides share the predicates.
export const isTimeLimitedPlan = (plan: string | undefined | null): boolean => String(plan || "").trim().toLowerCase() !== "free";

// Batch E (#12): THE free-plan predicate — the exact complement of
// isTimeLimitedPlan, exported so callers stop growing local copies (useFreeCap
// had one; sellerExpiry compared plan === "free" directly). Same case-insensitive
// normalization as every other planWindow predicate.
export const isFreePlan = (plan: string | undefined | null): boolean => !isTimeLimitedPlan(plan);

const isTrialPlan = (plan: string): boolean => String(plan || "").trim().toLowerCase() === "trial";

// Plan Monitoring window: trial 3 days, paid 7 days.
export const monitorWindowDays = (plan: string): number =>
  isTrialPlan(plan) ? TRIAL_MONITOR_WINDOW_DAYS : EXPIRING_WINDOW_DAYS;

export interface PlanState { plan: string; planStatus: string; daysLeft: number }

export const isActivePaid = (p: PlanState): boolean =>
  isTimeLimitedPlan(p.plan) && p.planStatus === "active" && p.daysLeft > 0;

export const isExpiredPaid = (p: PlanState): boolean =>
  isTimeLimitedPlan(p.plan) && p.planStatus !== "pending" && (p.planStatus === "expired" || p.daysLeft === 0);

// Urgency feed / banner / badge: expired or within EXPIRING_WINDOW_DAYS.
export const isExpiringSoon = (p: PlanState): boolean =>
  isTimeLimitedPlan(p.plan) && p.planStatus !== "pending" && (p.planStatus === "expired" || p.daysLeft <= EXPIRING_WINDOW_DAYS);

// Plan Monitoring table: same shape, per-plan window (trial 3 / paid 7).
export const isInMonitorWindow = (p: PlanState): boolean =>
  isTimeLimitedPlan(p.plan) && p.planStatus !== "pending" && (p.planStatus === "expired" || p.daysLeft <= monitorWindowDays(p.plan));
