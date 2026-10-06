// Staged release of the session-numbering fix (buyer numbers restarting mid-session). ALL of
// the fix's behaviour sits behind this gate; every other account runs today's code path.
// Decided from the signed-in email ONLY (no database read that could race). Email not known
// yet → "wait" (the session hooks stay off) — never the old path for a listed account.
// Going public = one line: SESSION_NUMBERING_FIX_PUBLIC = true.
export const SESSION_NUMBERING_FIX_PUBLIC = false;
export const SESSION_NUMBERING_FIX_EMAILS = [
  "camilajeffrey1@gmail.com",
  "googletest@gmail.com",
  "googletest@sellerflowlive.com",
  "cristycabanas34@gmail.com",
  "tincabanas13@gmail.com",
  "ronaldgantiga77@gmail.com",
];

export type SessionNumberingGate = "on" | "off" | "wait";

// authed=false → "off" (the session hooks are disabled anyway — today's behaviour).
// authed + no email yet → "wait". Otherwise on for the list (or everyone once public).
export function sessionNumberingGate(authed: boolean, email: string | null | undefined): SessionNumberingGate {
  if (!authed) return "off";
  if (SESSION_NUMBERING_FIX_PUBLIC) return "on";
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "wait";
  return SESSION_NUMBERING_FIX_EMAILS.includes(e) ? "on" : "off";
}
