// Shopee shop = one account (sql/199, 2026-11-22). PURE (injected deps), unit-tested by vitest;
// server.js wires it as the Shopee paste-link reader's account step (server/shopeeLiveLink.js `gate`).
//
// register(userId, region, uid) → { data, error } of the database function shopee_link_register:
//   off                → {ok:true}: the seller is not in the preview and the switch is off — today's connect
//   existing / added   → the live rule (account_live_check, the seller's own login): not covered → 409 not_covered
//   full               → 409 shop_limit   {used, limit}
//   locked             → 409 shop_locked  {used, limit, next_free_at, now}  (a removed account's 4 hours)
//   anything else      → 503 try_again    (a database error refuses — Jeff, 2026-11-22)
// The database function missing (sql/199 not applied yet) = "off": nobody is refused before the SQL is applied.
// Log lines carry the result word only — never the shop's uid, a name or a token.

export function isMissingFunctionError(err) {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || "");
  return code === "PGRST202" || code === "42883" || /could not find the function/i.test(msg);
}

export function createShopeeAccountGate({ register, liveCheck, log = () => {} }) {
  return async function gate(req, { region, uid }) {
    let r;
    try { r = await register(req.authUserId, region, uid); }
    catch { log("[SHOPEE-ACCT] register failed → try_again"); return { ok: false, status: 503, code: "try_again" }; }
    if (r && r.error) {
      if (isMissingFunctionError(r.error)) return { ok: true };
      log("[SHOPEE-ACCT] register error → try_again");
      return { ok: false, status: 503, code: "try_again" };
    }
    const d = (r && r.data) || {};
    const result = String(d.result || "");
    if (result === "off") return { ok: true };
    if (result === "existing" || result === "added") {
      log(`[SHOPEE-ACCT] shop ${result}`);
      let v = null;
      try { v = await liveCheck(req, "shopee", String(d.key || "")); } catch { v = null; }
      if (v && v.allow === false) return { ok: false, status: 409, code: "not_covered" };
      return { ok: true };
    }
    const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
    if (result === "full") return { ok: false, status: 409, code: "shop_limit", info: { used: n(d.used), limit: n(d.limit) } };
    if (result === "locked") {
      return { ok: false, status: 409, code: "shop_locked", info: { used: n(d.used), limit: n(d.limit), next_free_at: d.next_free_at ? String(d.next_free_at) : null, now: d.now ? String(d.now) : null } };
    }
    log(`[SHOPEE-ACCT] unexpected result=${result.slice(0, 20) || "none"} → try_again`);
    return { ok: false, status: 503, code: "try_again" };
  };
}
