// Cancel order (sql/234): a cancelled live_session_orders row carries cancelled_at. The server's
// Facebook receipt readers (Send all, the after-live receipt) leave such rows out. Before sql/234 is
// applied the column does not exist: the first refused read (42703 / "cancelled_at does not exist")
// is done again without the filter, and every later read skips it at once — exactly today's read.
let missing = false;

export function cancelledColumnMissing() { return missing; }
export function __resetCancelledColumn() { missing = false; }

export function isMissingCancelledColumn(err) {
  if (!err) return false;
  const msg = String(err.message || "");
  if (!/cancelled_at/.test(msg)) return false;
  return err.code === "42703" || err.code === "PGRST204" || /does not exist|could not find/i.test(msg);
}

/** run(withFilter) → a Supabase answer { data, error }. withFilter(q) adds `.is("cancelled_at", null)`
 *  while the column exists, else returns q as it is. */
export async function readWithoutCancelled(run) {
  if (missing) return run((q) => q);
  const res = await run((q) => q.is("cancelled_at", null));
  if (res && res.error && isMissingCancelledColumn(res.error)) {
    missing = true;
    console.warn("[ORDER-CANCEL] cancelled_at column not there yet — reading without it");
    return run((q) => q);
  }
  return res;
}
