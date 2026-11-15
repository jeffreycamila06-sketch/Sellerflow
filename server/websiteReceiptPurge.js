// Seller Website (sql/163) — the daily cleanup of the private bucket "website-receipts".
// Deletes a buyer's receipt picture when its order no longer exists (the 90-day order purge
// removed it) or the order ended (shipped / cancelled) more than 90 days ago. The list comes from
// the database (website_receipts_to_purge, service role only); the delete goes through the Storage
// API (Supabase blocks deleting storage rows by SQL). Its OWN file and timer: no existing job is
// changed. Logs counts only — never a file name (the folder is the buyer's order token).
export const WEBSITE_RECEIPT_PURGE_FIRST_MS = 15 * 60 * 1000;      // 15 minutes after the server starts
export const WEBSITE_RECEIPT_PURGE_EVERY_MS = 24 * 60 * 60 * 1000; // then once a day
export const WEBSITE_RECEIPT_PURGE_PAGE = 100;
export const WEBSITE_RECEIPT_PURGE_MAX = 2000;                     // per run

/** One run: list → remove, page by page, until nothing is left or the cap. Never throws. */
export async function purgeWebsiteReceipts({ store, log = () => {} }) {
  let deleted = 0;
  let failed = false;
  try {
    while (deleted < WEBSITE_RECEIPT_PURGE_MAX) {
      const want = Math.min(WEBSITE_RECEIPT_PURGE_PAGE, WEBSITE_RECEIPT_PURGE_MAX - deleted);
      const paths = ((await store.listPurgeable(want)) || []).filter((p) => typeof p === "string" && p.includes("/")).slice(0, want);
      if (paths.length === 0) break;
      const removed = Number(await store.remove(paths)) || 0;
      deleted += removed;
      if (removed < paths.length || paths.length < want) break; // partial remove / last page → stop (no busy loop)
    }
  } catch { failed = true; /* the next run tries again */ }
  log(`[WEBSITE] receipt purge deleted=${deleted}${failed ? " (stopped on an error)" : ""}`);
  return deleted;
}

/** Starts the daily cleanup (+ one run 15 minutes after start). Timers are unref'd; stop() clears both. */
export function startWebsiteReceiptPurge({ store, log = () => {}, setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (h) => clearInterval(h), setOnce = (fn, ms) => setTimeout(fn, ms), clearOnce = (h) => clearTimeout(h) }) {
  const run = () => { void purgeWebsiteReceipts({ store, log }); };
  const first = setOnce(run, WEBSITE_RECEIPT_PURGE_FIRST_MS);
  const every = setTimer(run, WEBSITE_RECEIPT_PURGE_EVERY_MS);
  for (const h of [first, every]) if (h && typeof h.unref === "function") h.unref();
  return function stop() { clearOnce(first); clearTimer(every); };
}

/** The store over the service-role Supabase client. */
export function makeWebsiteReceiptStore(serviceSb) {
  return {
    async listPurgeable(limit) {
      const { data, error } = await serviceSb.rpc("website_receipts_to_purge", { p_limit: limit });
      if (error) throw new Error("list_failed");
      return (data || []).map((r) => (typeof r === "string" ? r : r && r.website_receipts_to_purge)).filter(Boolean);
    },
    async remove(paths) {
      const { data, error } = await serviceSb.storage.from("website-receipts").remove(paths);
      if (error) throw new Error("remove_failed");
      return Array.isArray(data) ? data.length : 0;
    },
  };
}
