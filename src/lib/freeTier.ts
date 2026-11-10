// Free plan order limit — the ONE place the app keeps these numbers (Jeff, 2026-11-10).
// The database is the real gate (sql/148: free_tier_cap() = 150, free_tier_near_cap() = 130;
// the order trigger blocks the next order at the limit). The app reads the live numbers from
// the free_tier_status_for_user RPC; these constants are only the fallback when an answer
// has no number, plus the help text. Keep them equal to sql/148.
//
// One time: the 150 orders never reset. The warning shows when 20 are left (order 130).
export const FREE_TIER_CAP = 150;
export const FREE_TIER_NEAR_CAP = 130;

/** Orders still left on the free plan (never below 0). Missing numbers → the defaults above. */
export function freeOrdersLeft(fs: { cap?: number | null; count?: number | null } | null | undefined): number {
  const cap = fs?.cap ?? FREE_TIER_CAP;
  const count = fs?.count ?? 0;
  return Math.max(0, cap - count);
}
