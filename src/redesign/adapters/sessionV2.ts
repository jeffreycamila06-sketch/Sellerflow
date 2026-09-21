// SESSION V2 (owner-only trial) — the "Start Session (5-day) / End Session" UX that
// replaces the 1–5 day picker for the owner ONLY. Everyone else's Connect/session code
// path is never entered → byte-for-byte unchanged. INSTANT REVERT = empty this array.
//
// Reuses the parcelTracking allowlist pattern (email-based, NOT role — so other admins
// are unaffected; this is literally one account). The underlying session_id model +
// start_session(5) / session_status() are already the shipped production model (59
// sellers run multi-day sessions today); this gate only changes THIS account's UI +
// enables end_session().
export const SESSION_V2_EMAILS = ["camilajeffrey1@gmail.com"];

// Fixed session length for the owner "Start Session" button (no picker). 7 days — the
// owner trial (2026-09-21); start_session's cap is widened 5→7 (sql/43) and the
// live_session_orders retention purge raised 8→10 (sql/44) to keep a 3-day buffer
// (buffer = purge_days − session_length; 10 − 7 = 3).
export const SESSION_V2_DAYS = 7;

export function sessionV2Enabled(email: string | undefined | null): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && SESSION_V2_EMAILS.includes(e);
}
