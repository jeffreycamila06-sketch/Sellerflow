// The handler of POST /admin/fm-store-check (server.js mounts it behind requireAuth +
// requirePlanActive). Its own file so a test can really run it. 6 digits only; a per-seller
// limit; { fresh: true } = the seller tapped Re-check (the cache is not read).
// Log = store #, verdict, closed; a short piece of FamilyMart's page only on 'unknown'.
// No buyer name or phone ever reaches this route.
export function createFmStoreCheckHandler({ check, allowed, log = console.log }) {
  return async function fmStoreCheckHandler(req, res) {
    const sent = req.body ? req.body.storeId : undefined;
    const storeId = typeof sent === "string" ? sent.trim() : "";
    if (!/^\d{6}$/.test(storeId)) { // a string of 6 digits only; any other type is refused
      return res.status(400).json({ success: false, error: "bad_store_id" });
    }
    if (!allowed(req.sellerId)) {
      return res.status(429).json({ success: false, error: "rate_limited", message: "Too many store checks. Please wait a minute and try again." });
    }
    const fresh = !!(req.body && req.body.fresh === true);
    const startedAt = Date.now();
    const result = await check(storeId, { fresh });
    log(`[FM_STORE_CHECK] store=${storeId} result=${result.status} closed=${result.closed === true}${result.cached ? " cached" : ""}${fresh ? " fresh" : ""}${result.retried ? " retried" : ""} ms=${Date.now() - startedAt}`);
    if (result.canaryFailed) log(`[FM_STORE_CHECK] canary_failed store=${result.canaryFailed.store} got=${result.canaryFailed.got}`);
    if (result.status === "unknown" && result.raw) log(`[FM_STORE_CHECK] RAW store=${storeId} ${JSON.stringify(String(result.raw))}`);
    return res.json({ success: true, storeId: result.storeId, status: result.status });
  };
}
