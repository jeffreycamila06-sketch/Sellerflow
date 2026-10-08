// Account total, Build 2 — WHO MAY GO LIVE (server side, PURE; unit-tested by vitest —
// server.js has no harness). The decision itself lives in the database function
// account_live_check (sql/85); this turns its answer into allow / refuse.
//
// FAIL-OPEN: a timeout (~1.5 s), a database error, a missing function or a junk answer
// ALLOWS the connect exactly as today, with one console line and no names.

export const ACCOUNT_LIVE_TIMEOUT_MS = 1500;

const FAIL_OPEN = Object.freeze({ allow: true, failOpen: true, ignoreListOrder: false, refuseUnregistered: false });

// result = the jsonb account_live_check returned. Only a well-formed, ENFORCED
// "registered but not covered" answer refuses. Unregistered names are left to
// accountCapVerdict (refuseUnregistered follows the second switch).
export function liveCoverageVerdict(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.error != null) return FAIL_OPEN;
  if (typeof result.allowed !== "boolean") return FAIL_OPEN;
  const enforce = result.enforce === true;
  const refuseUnregistered = result.unregistered_enforce === true && result.registered === false;
  const notCovered = result.registered === true && result.covered === false;
  if (enforce && notCovered && result.allowed === false) {
    return { allow: false, failOpen: false, ignoreListOrder: true, refuseUnregistered, rank: result.rank, limit: result.limit };
  }
  return { allow: true, failOpen: false, ignoreListOrder: enforce, refuseUnregistered };
}

// call() → a supabase rpc promise ({ data, error }). Never throws.
export async function checkAccountLive(call, { timeoutMs = ACCOUNT_LIVE_TIMEOUT_MS, log = console.log } = {}) {
  let timer;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: { message: "timeout" } }), timeoutMs); });
    const r = await Promise.race([Promise.resolve().then(call), timeout]);
    const v = r && !r.error ? liveCoverageVerdict(r.data) : FAIL_OPEN;
    if (v.failOpen) log("[ACCOUNT-LIVE] ERROR → FAIL-OPEN");
    return v;
  } catch {
    log("[ACCOUNT-LIVE] ERROR → FAIL-OPEN");
    return FAIL_OPEN;
  } finally {
    clearTimeout(timer);
  }
}
