// Phase 5h — ADMIN WRITES. Composes the EXISTING exported admin functions the
// production AdminPage uses (accountDb.ts: adminUpdatePlan, deleteUser,
// saveAuditLog) + the admin-set-password Edge Function. Imports only — no App.tsx
// / accountDb.ts / edge-fn touch.
//
// ⚠️ Admin writes are NOT RLS-protected: the seller_profiles_on_update trigger
// honours these column changes ONLY when the caller's session is an admin
// (is_admin()), exactly like production. We never bypass that — we call the same
// exported functions, which issue the same UPDATE the trigger gates. The UI layer
// adds a window.confirm() per action so a wrong target can't be hit by accident.
import { useCallback } from "react";
import { supabase } from "../../supabase";
import { adminUpdatePlan, deleteUser, saveAuditLog, type Role } from "../../accountDb";

export type Plan = "free" | "trial" | "basic" | "pro" | "master";
export interface AdminResult { ok: boolean; error?: string }
export interface PlanPatch { plan: Plan; planStatus: "active"; planExpiry: string; trialStartedAt?: string }

// PURE — copied VERBATIM from App.tsx handleAdminApprove (4254-4259) + the
// addDays/addMonths helpers (230-231). Takes `now` for testability. Parity-tested.
export function approvePlanPatch(plan: Plan, months: number, now: Date): PlanPatch {
  const addDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString(); };
  const addMonths = (n: number) => addDays(Math.max(1, n) * 30);
  const planExpiry = plan === "trial" ? addDays(7) : addMonths(months);
  const trialStartedAt = plan === "trial" ? now.toISOString() : undefined;
  return { plan, planStatus: "active", planExpiry, ...(trialStartedAt ? { trialStartedAt } : {}) };
}

// PURE — extend a plan's expiry by `days`, mirroring App.tsx addMonthsToExpiry
// (239-241): continue from the CURRENT expiry while the plan is still active
// (cumulative), else from `now`. Takes `now` for testability. Parity-tested.
export function addDaysToExpiry(planExpiry: string, planStatus: string, days: number, now: Date): string {
  const exp = new Date(planExpiry).getTime();
  const valid = !isNaN(exp);
  const daysLeft = valid ? Math.max(0, Math.ceil((exp - now.getTime()) / 86400000)) : 0;
  const active = planStatus === "active" && daysLeft > 0;
  const base = active && valid ? exp : now.getTime();
  return new Date(base + Math.max(1, days) * 86400000).toISOString();
}

export interface AdminActions {
  changePlan: (email: string, plan: Plan, months?: number) => Promise<AdminResult>;
  setRole: (email: string, role: Role) => Promise<AdminResult>;
  expire: (email: string) => Promise<AdminResult>;
  setPassword: (email: string, newPassword: string) => Promise<AdminResult>;
  removeUser: (email: string) => Promise<AdminResult>;
  // Extends planExpiry by `days` (cumulative) and reactivates — same adminUpdatePlan
  // path production uses for "Add Months". Returns the new expiry on success.
  addDays: (email: string, planExpiry: string, planStatus: string, days: number) => Promise<AdminResult & { planExpiry?: string }>;
}

export function useAdmin(adminEmail: string | undefined): AdminActions {
  const audit = useCallback((action: string, target: string, details: string) => {
    void saveAuditLog({ actorEmail: adminEmail || "admin", action, targetEmail: target, details });
  }, [adminEmail]);

  const changePlan = useCallback(async (email: string, plan: Plan, months = 1): Promise<AdminResult> => {
    try {
      await adminUpdatePlan(email, approvePlanPatch(plan, months, new Date())); // same payload as handleAdminApprove
      audit("changed plan", email, `→ ${plan}${plan === "trial" ? "" : ` (${months}mo)`}`);
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  const setRole = useCallback(async (email: string, role: Role): Promise<AdminResult> => {
    try { await adminUpdatePlan(email, { role }); audit(role === "admin" ? "made admin" : "removed admin", email, ""); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  const expire = useCallback(async (email: string): Promise<AdminResult> => {
    try { await adminUpdatePlan(email, { planStatus: "expired" }); audit("expired plan", email, ""); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  // Same Edge Function + invoke shape as App.tsx saveEditSeller (3252-3260).
  const setPassword = useCallback(async (email: string, newPassword: string): Promise<AdminResult> => {
    if (!supabase) return { ok: false, error: "Password service unavailable" };
    if (newPassword.trim().length < 6) return { ok: false, error: "Password must be at least 6 characters" };
    try {
      const { data, error } = await supabase.functions.invoke("admin-set-password", {
        body: { targetEmail: email.trim().toLowerCase(), newPassword: newPassword.trim() },
      });
      const result = data as { success?: boolean; error?: string } | null;
      if (error || result?.error) return { ok: false, error: result?.error || error?.message || "Unknown error" };
      audit("set password", email, "via admin-set-password Edge Function");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Edge function call failed" };
    }
  }, [audit]);

  const removeUser = useCallback(async (email: string): Promise<AdminResult> => {
    try { await deleteUser(email); audit("deleted seller", email, ""); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  const addDays = useCallback(async (email: string, planExpiry: string, planStatus: string, days: number): Promise<AdminResult & { planExpiry?: string }> => {
    try {
      const next = addDaysToExpiry(planExpiry, planStatus, days, new Date());
      await adminUpdatePlan(email, { planStatus: "active", planExpiry: next }); // same path as Add Months
      audit("added days", email, `+${days}d → ${next.slice(0, 10)}`);
      return { ok: true, planExpiry: next };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  return { changePlan, setRole, expire, setPassword, removeUser, addDays };
}
