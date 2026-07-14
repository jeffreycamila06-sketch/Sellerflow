// #6 SERVER-SIDE ACCOUNT-CAP - shared, PURE per-plan account limit imported by
// server.js AND unit-tested by vitest (server.js has no test harness; same
// convention as server/connectionHealth.js / sanitize.js).
//
// THE GAP: the per-plan cap on simultaneous live accounts (free/trial/basic:1,
// pro:3, master:5) was CLIENT-ONLY (src/redesign/adapters/connect.ts). The
// /connect endpoint passed req.body.username straight through and never verified
// it was one the seller registered - so a Basic seller calling the API directly
// could run multiple simultaneous streams (the Pro/Master paid differentiator).
// CWE-602 (client-side enforcement of server-side security) / OWASP API5 (BFLA).
//
// THE FIX (Option B - registered-account verification, edge-free): the requested
// account must be in the seller's REGISTERED list for that platform, capped to
// maxAccountsForPlan. This closes the actual finding ("connects arbitrary
// usernames it never verifies are registered") AND has no stale-connection edge
// (a client-local Disconnect + switch works instantly, unlike counting live
// connections). FAIL-OPEN on unknown plan (infra fail-open upstream), admin, or a
// broken/empty registered list (old/just-created row - Jeff Addition 1) so a
// legit seller is never blocked and the check never crashes.

// VERBATIM parity with the client cap (connect.ts:22 maxAcc). Unknown plan -> 1.
export function maxAccountsForPlan(plan) {
  const map = { free: 1, trial: 1, basic: 1, pro: 3, master: 5 };
  return map[String(plan == null ? "" : plan).trim().toLowerCase()] ?? 1;
}

// Mirror of cleanLiveAccount (connect.ts:21): trim, strip leading @, lowercase -
// so "@JuanDelaCruz" registered matches "juandelacruz" requested (Jeff Addition 2).
export function normalizeAccount(value) {
  return String(value == null ? "" : value).trim().replace(/^@+/, "").toLowerCase();
}

// Parse a registered-accounts field (comma/newline separated) -> normalized,
// deduped list. Non-string / null -> [] (-> fail-open upstream). Mirror of
// accountList (connect.ts:23) + normalization.
export function parseRegisteredList(raw) {
  if (typeof raw !== "string") return [];
  return Array.from(new Set(raw.split(/[,\n]/).map(normalizeAccount).filter(Boolean)));
}

// PURE verdict. FAIL-OPEN (allowed:true) on: unknown plan, admin, empty requested,
// unparseable/empty registered list (Addition 1). Otherwise the requested account
// must be in the registered list for that platform, capped to maxAccountsForPlan
// (mirrors the client accountSlots cap). Blocked -> { allowed:false, reason, max, plan }.
export function accountCapVerdict({ plan, role, tiktok, facebook, platform, username }) {
  if (!plan) return { allowed: true };                                   // infra fail-open (no plan resolved)
  if (String(role == null ? "" : role).trim().toLowerCase() === "admin") return { allowed: true };
  const req = normalizeAccount(username);
  if (!req) return { allowed: true };                                    // empty requested -> let downstream 400
  const registered = parseRegisteredList(platform === "Facebook" ? facebook : tiktok);
  if (!registered.length) return { allowed: true };                      // Addition 1: broken/new/empty row -> fail-open
  const max = maxAccountsForPlan(plan);
  if (new Set(registered.slice(0, max)).has(req)) return { allowed: true };
  return { allowed: false, reason: "account_limit", max, plan: String(plan) };
}
