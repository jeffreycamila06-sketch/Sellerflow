// PURE guard logic for the admin-delete-user edge function — no Deno/Supabase
// deps, so it is imported by BOTH the edge function (index.ts) AND a vitest unit
// test (src/redesign/adapters/__tests__/adminDelete.guards.test.ts). Keeping the
// hard-delete guards pure is the only way to test them without a live Supabase.
//
// Phase 2 (owner decision: OPTION B — FULL WIPE): the admin delete removes the
// auth account + profile + ALL data incl. the billing orders ledger, no undo.
// These guards are the "don't shoot your own foot" protection: an admin can
// never delete THEMSELF, and can never delete a fellow admin/master account.

export interface DeleteTarget {
  authUserId: string | null;   // resolved from seller_profiles.auth_user_id (null = ghost / not found)
  email: string;
  role: string | null;         // seller_profiles.role
  plan: string | null;         // seller_profiles.plan
}

export interface GuardResult {
  allowed: boolean;
  code?: string;   // machine code for the client
  error?: string;  // human message
}

// The hard-delete guard. callerUserId = the authenticated admin's auth uid.
// Order matters: resolve-failure first, then self, then admin/master.
export function checkDeleteAllowed(callerUserId: string, target: DeleteTarget): GuardResult {
  const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

  if (!target.authUserId) {
    return { allowed: false, code: "not_found", error: "No account found for that email. Use ghost cleanup for profile-less accounts." };
  }
  // HARD GUARD 1 — never delete yourself.
  if (target.authUserId === callerUserId) {
    return { allowed: false, code: "self_delete", error: "You cannot delete your own account." };
  }
  // HARD GUARD 2 — never delete a fellow admin or a master account. Protects the
  // owner + any co-admin from an accidental (or malicious-admin) wipe.
  if (norm(target.role) === "admin") {
    return { allowed: false, code: "protected_admin", error: "Cannot delete an admin account." };
  }
  if (norm(target.plan) === "master") {
    return { allowed: false, code: "protected_master", error: "Cannot delete a master-plan account." };
  }
  return { allowed: true };
}
