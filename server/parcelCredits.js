// Parcel Scan credit orchestration — the debit → scan → refund flow, extracted
// PURE over injected deps so vitest can drive it (server.js has no test harness;
// this is the broadcastTranslate.js convention). server.js's /admin/parcel-scan
// route builds the JWT-scoped Supabase client + the cheap input rejects, then
// hands the three thunks here.
//
// REAL MONEY: the credit is debited BEFORE the (paid) Anthropic call — bypass-
// proof because ANTHROPIC_API_KEY is server-only, so every scan traverses the
// route. On a TECHNICAL failure (not the seller's fault) the credit is refunded
// (best-effort; a failed refund is money owed → a distinct log line). On a
// BAD-PHOTO failure (the model couldn't read the seller's own slip) the debit
// STANDS — the seller consumed a real scan.

export const CREDIT_DEBIT_AMOUNT = 1;

// Technical failure = NOT the seller's fault (transport / provider / a provider
// envelope we couldn't parse / server misconfig) → REFUND. Everything else,
// notably the bad-photo codes (no_json_in_response, bad_json_in_response,
// model_refused, truncated), is the seller's own photo → the debit STANDS.
//   • network_error        — couldn't reach Anthropic
//   • anthropic_http_*      — any provider HTTP error (429 / 5xx / …)
//   • anthropic_bad_json    — provider returned a non-JSON HTTP envelope
//   • scan_not_configured   — server has no API key (our misconfig, never the
//                             seller's fault; empty_image/bad_media_type can't
//                             reach here — they're rejected before the debit)
export function isTechnicalFailure(errorCode) {
  const c = String(errorCode || "");
  return (
    c === "network_error" ||
    c.startsWith("anthropic_http_") ||
    c === "anthropic_bad_json" ||
    c === "scan_not_configured"
  );
}

// Deps (all injected — no direct supabase/anthropic import here):
//   uid            → the caller's id, for the log lines (display only)
//   debit()        → resolves check_and_debit_credit's json { ok, balance, debit_id, error }, or throws
//   scan()         → resolves scanParcelImage's result { ok, fields?, confidence?, error?, ... }
//   refund(debitId)→ resolves refund_parcel_credit's json { ok, balance }, best-effort (may throw).
//                    Passed the debit's debit_id so the GATED RPC can match it to
//                    the real, unrefunded scan_debit (no id → no refund).
//   log(msg)       → optional logger (defaults to no-op)
//
// Returns { status, body, scanned, refunded } where:
//   status/body = the exact HTTP status + JSON body the route should send
//                 (success + insufficient + bad-photo carry the wallet `balance`
//                 so the client can update its display without a re-fetch)
//   scanned     = whether the Anthropic scan was actually invoked
//   refunded    = 'ok' | 'failed' | null  (null = no refund attempted: success,
//                 a pre-scan stop, or a bad-photo failure where the debit stands)
//
// setOutcome(debitId, outcome) → injected; best-effort stamp of the per-scan
// outcome ('success' | 'technical' | 'bad_photo') on the just-created scan_debit
// (sql/30 set_scan_outcome RPC). A failed stamp NEVER breaks the scan/debit/refund
// — it's logged and swallowed. Defaults to a no-op so tests that don't care can
// omit it. The atomic debit itself is untouched (this is a follow-up UPDATE keyed
// by debit_id).
export async function runScanWithCredit({ uid = "", debit, scan, refund, setOutcome = async () => {}, log = () => {} }) {
  const stamp = async (debitId, outcome) => {
    if (!debitId) return;
    try {
      const r = await setOutcome(debitId, outcome);
      if (r && r.ok === false) log(`[CREDIT] outcome stamp not applied user=${uid} outcome=${outcome} err=${r.error}`);
    } catch (e) {
      log(`[CREDIT] outcome stamp failed user=${uid} outcome=${outcome} err=${(e && e.message) || String(e)}`);
    }
  };
  // ── (a) DEBIT (before the paid call) ────────────────────────────────────────
  let d;
  try {
    d = (await debit()) || {};
  } catch (e) {
    // Ledger unreachable → fail CLOSED (never a free scan on a paid feature).
    log(`[CREDIT] debit error user=${uid} err=${(e && e.message) || String(e)} -> failing closed`);
    return { status: 503, body: { success: false, error: "credit_unavailable" }, scanned: false, refunded: null };
  }
  if (!d.ok) {
    // insufficient_credits / not_signed_in / bad_amount — NO Anthropic cost.
    log(`[CREDIT] debit denied user=${uid} reason=${d.error} balance=${d.balance ?? "-"}`);
    return {
      status: 402,
      body: { success: false, error: d.error || "insufficient_credits", balance: d.balance ?? 0 },
      scanned: false,
      refunded: null,
    };
  }
  const postDebitBalance = d.balance;
  log(`[CREDIT] debit user=${uid} balance=${postDebitBalance}`);

  // ── (b) SCAN ────────────────────────────────────────────────────────────────
  const result = await scan();
  if (result && result.ok) {
    await stamp(d.debit_id, "success"); // best-effort outcome record
    return {
      status: 200,
      body: { success: true, fields: result.fields, confidence: result.confidence, balance: postDebitBalance },
      scanned: true,
      refunded: null,
    };
  }

  const code = result ? result.error : "scan_failed";

  // ── (c) REFUND only on a TECHNICAL failure; bad-photo debit STANDS ──────────
  let refunded = null;
  let balance = postDebitBalance; // bad-photo / failed-refund → debit stands
  if (isTechnicalFailure(code)) {
    await stamp(d.debit_id, "technical"); // outcome record (this debit also gets refunded)
    refunded = "failed";
    try {
      const rf = await refund(d.debit_id);          // GATED RPC matches this debit
      if (rf && typeof rf.balance === "number") balance = rf.balance;
      log(`[CREDIT] refund user=${uid} balance=${(rf && rf.balance) ?? "-"} reason=${code}`);
      refunded = "ok";
    } catch (e) {
      log(`[CREDIT] refund failed user=${uid} reason=${code} err=${(e && e.message) || String(e)} (money owed)`);
    }
  } else {
    // Bad photo (model couldn't read the seller's slip / refused / truncated) —
    // a real scan was consumed, the debit is kept.
    await stamp(d.debit_id, "bad_photo"); // outcome record — the abuse/waste signal
    log(`[CREDIT] no-refund (bad photo) user=${uid} code=${code}`);
  }

  const status = code === "empty_image" || code === "bad_media_type" ? 400 : 502;
  const body = { success: false, error: code };
  if (typeof balance === "number") body.balance = balance;
  return { status, body, scanned: true, refunded };
}
