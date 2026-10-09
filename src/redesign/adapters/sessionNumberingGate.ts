import { featureAccessLoaded, hasFeature } from "./featureAccess";
// Staged release of the session-numbering fix (buyer numbers restarting mid-session). ALL of
// the fix's behaviour sits behind this gate; every other account runs today's code path.
// Decided from the signed-in email ONLY (no database read that could race). Email not known
// yet → "wait" (the session hooks stay off) — never the old path for a listed account.
// PUBLIC since 2026-10-07 — every signed-in seller gets the fix (the email list below only
// matters when this is false). ⚠️ REVERT = flip this one line back to false: then only the
// email list keeps the fix and every other account runs the old path again.
export const SESSION_NUMBERING_FIX_PUBLIC = true;
// Build 10b: the staged list lives in the database (sql/112 feature "session_numbering_fix").

export type SessionNumberingGate = "on" | "off" | "wait";

// authed=false → "off" (the session hooks are disabled anyway — today's behaviour).
// authed + no email yet → "wait". Otherwise on for the list (or everyone once public).
// publicFlag: defaults to the constant; tests pass false to cover the email-list (staged) path.
export function sessionNumberingGate(authed: boolean, email: string | null | undefined, publicFlag: boolean = SESSION_NUMBERING_FIX_PUBLIC): SessionNumberingGate {
  if (!authed) return "off";
  if (publicFlag) return "on";
  const e = String(email || "").trim().toLowerCase();
  if (!e || !featureAccessLoaded()) return "wait";
  return hasFeature("session_numbering_fix") ? "on" : "off";
}
