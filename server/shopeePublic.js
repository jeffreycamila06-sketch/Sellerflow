// Shopee Live for every seller (sql/206, Jeff 2026-11-23). PURE (injected deps), unit-tested by vitest;
// server.js wires it as the Shopee paste-link reader's access step (server/shopeeLiveLink.js `access`).
// It is asked ONLY for a seller the beta rule refused (no active shopee_beta row, not an admin) — a seller
// with an active beta row never reaches it and keeps today's connect until the row's expires_at.
//
// publicOn(userId) → { data, error } of the database function shopee_public_on (sql/206):
//   true              → Shopee is open for this seller: the switch shopee_public_enabled is 'true', or the
//                       login is on the 'shopee_public' preview list
//   anything else     → null = NOT open: the caller answers today's 403 no_beta. A database error, a thrown
//                       call and the function missing (sql/206 not applied yet) are all "not open".
// planCheck(req) → the SAME plan read as POST /connect/tiktok (server.js checkPlanActive): a free plan is
//   allowed, a paid plan that is expired / past its date is refused, no profile row is refused, a read that
//   fails allows (as TikTok does).
//   refused           → 403 plan_expired / no_profile (the two codes /connect/tiktok answers)
// Log lines carry the result word only — never an email, a name or a link.

export function createShopeePublicGate({ publicOn, planCheck, log = () => {} }) {
  return async function gate(req) {
    let r;
    try { r = await publicOn(req && req.authUserId); } catch { return null; }
    if (!r || r.error || r.data !== true) return null;
    let p;
    try { p = await planCheck(req); } catch { p = null; }
    if (p && p.allowed === false) {
      const code = p.reason === "no_profile" ? "no_profile" : "plan_expired";
      log(`[SHOPEE-PUBLIC] refuse code=${code}`);
      return { ok: false, status: 403, code };
    }
    return { ok: true };
  };
}
