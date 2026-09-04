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
import { adminUpdatePlan, adminUpdateContactNote, saveAuditLog, upsertUser, type Role, type AccountUser } from "../../accountDb";
import { hardDeleteUser } from "./adminDelete";
import { readEdgeError } from "./edgeError";
import { maxAcc, accountList, accountText } from "./connect";
import { planDaysLeft, isTimeLimitedPlan } from "../../lib/planWindow";

export type Plan = "free" | "trial" | "basic" | "plus" | "pro" | "master";
export interface AdminResult { ok: boolean; error?: string }
export interface PlanPatch { plan: Plan; planStatus: "active"; planExpiry: string; trialStartedAt?: string }

// PURE — activation/renewal expiry window. Takes `now` for testability. Parity-tested.
// ⚠️ INTENTIONAL DIVERGENCE from the App.tsx rollback twin (addMonths *30 @ 230-231):
// owner decision 2026-09-04 — ONE MONTH = 31 DAYS (was 30), regardless of calendar
// month, applied to NEW activations/renewals only (no retroactive change to existing
// plan_expiry). N months = N × 31. The App.tsx rollback still uses *30 (rollback-only,
// not served in production).
export function approvePlanPatch(plan: Plan, months: number, now: Date): PlanPatch {
  const addDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString(); };
  const addMonths = (n: number) => addDays(Math.max(1, n) * 31);
  const planExpiry = plan === "trial" ? addDays(7) : addMonths(months);
  const trialStartedAt = plan === "trial" ? now.toISOString() : undefined;
  return { plan, planStatus: "active", planExpiry, ...(trialStartedAt ? { trialStartedAt } : {}) };
}

// PURE — the patch for an admin PLAN-TIER change. A tier switch on an already-
// active, time-limited plan must NOT reset plan_expiry (the paid time is theirs
// regardless of tier — the Jul-2026 bug: Basic→Pro reset a seller with 28 days
// left to now+30). Only a real ACTIVATION (free / expired / no window) opens a
// fresh window. Omitting planExpiry preserves the DB value — adminUpdatePlan only
// writes plan_expiry when the patch includes it (no DB/RPC change needed).
export interface PlanChangePatch { plan: Plan; planStatus: "active"; planExpiry?: string; trialStartedAt?: string }
export function planChangePatch(
  plan: Plan, months: number,
  current: { plan: string; status: string; expiry: string },
  now: Date,
): PlanChangePatch {
  // Granting a trial always opens a fresh 7-day trial window (activation).
  if (plan === "trial") return approvePlanPatch(plan, months, now);
  const daysLeft = planDaysLeft(current.expiry, now.getTime());
  const activeWindow = isTimeLimitedPlan(current.plan) && current.status === "active"
    && Number.isFinite(daysLeft) && daysLeft > 0;
  // TIER SWITCH — change ONLY the tier; PRESERVE plan_expiry (omit it).
  if (activeWindow) return { plan, planStatus: "active" };
  // ACTIVATION — open a fresh window (verbatim approvePlanPatch behavior).
  return approvePlanPatch(plan, months, now);
}

// PURE — extend a plan's expiry by `days`, mirroring App.tsx addMonthsToExpiry
// (239-241): continue from the CURRENT expiry while the plan is still active
// (cumulative), else from `now`. Takes `now` for testability. Parity-tested.
export function addDaysToExpiry(planExpiry: string, planStatus: string, days: number, now: Date): string {
  const exp = new Date(planExpiry).getTime();
  const valid = !isNaN(exp);
  // C1 — days-left via the shared planWindow source (identical max/ceil math for
  // valid dates); the `valid` guard covers its Infinity-on-invalid semantics.
  const daysLeft = valid ? planDaysLeft(planExpiry, now.getTime()) : 0;
  const active = planStatus === "active" && daysLeft > 0;
  const base = active && valid ? exp : now.getTime();
  return new Date(base + Math.max(1, days) * 86400000).toISOString();
}

// PURE — App.tsx addDays (230): setDate-based, takes `now` for tests.
export function addDaysIso(now: Date, n: number): string { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString(); }

// PURE — make-admin payload, verbatim from App.tsx makeAdmin (3303): promotes to
// admin AND grants master/active/+120mo (addMonths(120) = addDays(3600)). Parity-tested.
export function makeAdminPatch(now: Date): { role: Role; plan: Plan; planStatus: "active"; planExpiry: string } {
  return { role: "admin", plan: "master", planStatus: "active", planExpiry: addDaysIso(now, 120 * 30) };
}

export interface AdminActions {
  // `current` = the seller's plan/status/expiry NOW, so a tier switch on an active
  // paid plan preserves plan_expiry (only activation opens a fresh window).
  changePlan: (email: string, plan: Plan, current: { plan: string; status: string; expiry: string }, months?: number) => Promise<AdminResult>;
  setRole: (email: string, role: Role) => Promise<AdminResult>;
  expire: (email: string) => Promise<AdminResult>;
  setPassword: (email: string, newPassword: string) => Promise<AdminResult>;
  removeUser: (email: string) => Promise<AdminResult>;
  // Extends planExpiry by `days` (cumulative) and reactivates — same adminUpdatePlan
  // path production uses for "Add Months". Returns the new expiry on success.
  addDays: (email: string, planExpiry: string, planStatus: string, days: number) => Promise<AdminResult & { planExpiry?: string }>;
  // Edit a seller's locked TikTok/Facebook usernames — mirrors App.tsx saveEditSeller.
  // Writes ONLY profile fields via upsertUser (NO includePlan) → plan/role untouched.
  editAccounts: (rawUser: AccountUser, ttText: string, fbText: string) => Promise<AdminResult>;
  // Set the admin contact note (seller_profiles.admin_contact_note) — mirrors
  // App.tsx saveContactNote (3170-3180). "<platform>:<name>" or "" to clear.
  setContactNote: (email: string, note: string) => Promise<AdminResult>;
}

// PURE — parse + plan-cap split, copied VERBATIM from App.tsx saveEditSeller
// (3227-3229): TikTok fills the budget first, Facebook gets the remainder. Reuses
// accountList/accountText/maxAcc (the same helpers production uses). Parity-tested.
export function fitEditAccounts(plan: string, ttText: string, fbText: string): { tiktok: string; facebook: string } {
  const limit = maxAcc(plan);
  const tt = accountList(ttText).slice(0, limit);
  const fb = accountList(fbText).slice(0, Math.max(0, limit - tt.length));
  return { tiktok: accountText(tt), facebook: accountText(fb) };
}

export function useAdmin(adminEmail: string | undefined): AdminActions {
  const audit = useCallback((action: string, target: string, details: string) => {
    void saveAuditLog({ actorEmail: adminEmail || "admin", action, targetEmail: target, details });
  }, [adminEmail]);

  const changePlan = useCallback(async (email: string, plan: Plan, current: { plan: string; status: string; expiry: string }, months = 1): Promise<AdminResult> => {
    try {
      const patch = planChangePatch(plan, months, current, new Date());
      await adminUpdatePlan(email, patch);
      // Tier switch (expiry preserved) → patch omits planExpiry; activation sets a window.
      const detail = plan === "trial" ? "→ trial"
        : patch.planExpiry === undefined ? `→ ${plan} (tier change, expiry kept)`
          : `→ ${plan} (${months}mo, activated)`;
      audit("changed plan", email, detail);
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  const setRole = useCallback(async (email: string, role: Role): Promise<AdminResult> => {
    // Self-guard — App.tsx removeAdmin (3314): you cannot remove your own admin.
    if (role === "seller" && adminEmail && email.trim().toLowerCase() === adminEmail.trim().toLowerCase()) {
      return { ok: false, error: "You cannot remove your own admin access." };
    }
    try {
      if (role === "admin") { await adminUpdatePlan(email, makeAdminPatch(new Date())); audit("made admin", email, "Seller promoted to admin"); }
      else { await adminUpdatePlan(email, { role: "seller" }); audit("removed admin", email, "Admin access removed"); }
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit, adminEmail]);

  const expire = useCallback(async (email: string): Promise<AdminResult> => {
    // App.tsx setPlan(status="expired") (3086): status expired + expiry backdated to yesterday.
    try { await adminUpdatePlan(email, { planStatus: "expired", planExpiry: addDaysIso(new Date(), -1) }); audit("expired seller", email, ""); return { ok: true }; }
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
      // Same real-error surfacing as the delete path (error.context, not the wrapper).
      if (error || result?.error) { const e = await readEdgeError(error, result); return { ok: false, error: e.message }; }
      audit("set password", email, "via admin-set-password Edge Function");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Edge function call failed" };
    }
  }, [audit]);

  // Phase 2 FULL WIPE — the admin-delete-user edge function removes the auth
  // account + ALL data (incl. billing orders), server-gated on is_admin() + the
  // self/admin-master guards. Replaces the old profile-row-only deleteUser().
  // The edge function writes its own authoritative audit_logs row.
  const removeUser = useCallback(async (email: string): Promise<AdminResult> => {
    const r = await hardDeleteUser(email);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }, []);

  const addDays = useCallback(async (email: string, planExpiry: string, planStatus: string, days: number): Promise<AdminResult & { planExpiry?: string }> => {
    try {
      const next = addDaysToExpiry(planExpiry, planStatus, days, new Date());
      await adminUpdatePlan(email, { planStatus: "active", planExpiry: next }); // same path as Add Months
      audit("added days", email, `+${days}d → ${next.slice(0, 10)}`);
      return { ok: true, planExpiry: next };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  // Edit locked accounts — same DB path as App.tsx saveEditSeller: reconstruct the
  // AccountUser with the parsed/capped usernames and upsertUser WITHOUT includePlan,
  // so the UPDATE payload carries only profile fields (full_name/store_name/phone/
  // tiktok/facebook/connected_accounts/updated_at). plan/role/status/expiry are NEVER
  // sent; and the admin session bypasses the seller_profiles_on_update revert anyway.
  const editAccounts = useCallback(async (rawUser: AccountUser, ttText: string, fbText: string): Promise<AdminResult> => {
    try {
      const { tiktok, facebook } = fitEditAccounts(rawUser.plan, ttText, fbText);
      const updated: AccountUser = { ...rawUser, profile: { ...rawUser.profile, tiktok, facebook } };
      await upsertUser(updated); // NO includePlan → plan/role omitted from the UPDATE
      audit("edited seller accounts", rawUser.email, `TikTok ${accountList(tiktok).length}, Facebook ${accountList(facebook).length}`);
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  // Admin contact note write (App.tsx saveContactNote 3170-3180). admin_contact_note
  // is a plain profile field — adminUpdateContactNote UPDATEs only that column,
  // admin-gated by RLS. No plan/role touched.
  const setContactNote = useCallback(async (email: string, note: string): Promise<AdminResult> => {
    try {
      const trimmed = note.trim();
      await adminUpdateContactNote(email, trimmed);
      audit("edited contact", email, trimmed || "(cleared)");
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "error" }; }
  }, [audit]);

  return { changePlan, setRole, expire, setPassword, removeUser, addDays, editAccounts, setContactNote };
}
