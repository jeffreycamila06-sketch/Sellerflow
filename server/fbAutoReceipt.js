// AUTOMATIC MESSENGER RECEIPT AFTER A FACEBOOK LIVE (B1, sql/100).
// When the Facebook poller stops for session_end / idle / max_session, server/fbLive.js asks the
// store to insert a job due 10 minutes later (the store inserts only when the switch
// fb_auto_receipt_enabled is on). A 60-second timer in server.js calls tick(): it claims due jobs
// (claim_auto_receipt_jobs: 'due' → 'running', attempts + 1, stale 'running' back to 'due') and
// runs them one after another.
//
// A job sends, to every Facebook buyer of that live, ONE receipt picture through the existing
// manual path (fbReceipt.autoSend: same buyer lock, claim → upload → one Graph call, one private
// reply per comment). Before each send the comment's can_reply_privately is read; false → the
// buyer is skipped for good. Gates checked per job, in order: switch, plan (plus / pro / master,
// plan_status active), fb_receipt_access, the seller's own toggle. At most 10 sends per minute
// per seller: when the minute is full the job goes back to 'due' a minute later without using
// an attempt. Notes hold counts only (no names, handles, ids or tokens).
import { GRAPH_VERSION } from "./fbConfig.js";
import { GRAPH_HOST } from "./fbLive.js";
import { checkReceiptRate } from "./fbReceipt.js";
import { drawReceiptPng } from "./receiptDraw.js";

export const AUTO_RECEIPT_DELAY_MS = 10 * 60 * 1000;
export const AUTO_RECEIPT_TICK_MS = 60 * 1000;
export const AUTO_RECEIPT_RATE_MAX = 10;
export const AUTO_RECEIPT_RATE_WINDOW_MS = 60 * 1000;
export const AUTO_RECEIPT_MAX_ATTEMPTS = 3;
export const AUTO_RECEIPT_RETRY_MS = 5 * 60 * 1000;
export const AUTO_RECEIPT_PLANS = new Set(["plus", "pro", "master"]);
export const AUTO_RECEIPT_STOP_REASONS = new Set(["session_end", "idle", "max_session"]);
const PREFLIGHT_TIMEOUT_MS = 10 * 1000;

export function planAllowsAutoReceipt(profile) {
  const plan = String(profile?.plan || "").trim().toLowerCase();
  const status = String(profile?.plan_status || "").trim().toLowerCase();
  return AUTO_RECEIPT_PLANS.has(plan) && status === "active";
}

// The session's Facebook rows → one group per (session_id, buyer_number), lowest number first.
// Rows without a session_id (older orders) are left out: the receipt send needs the session.
export function groupBuyers(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const sessionId = String(r?.session_id || "");
    const buyerNumber = Number(r?.buyer_number);
    if (!sessionId || !Number.isInteger(buyerNumber) || buyerNumber <= 0) continue;
    const key = `${sessionId}|${buyerNumber}`;
    if (!map.has(key)) map.set(key, { sessionId, buyerNumber, rows: [] });
    map.get(key).rows.push(r);
  }
  return [...map.values()].sort((a, b) => a.buyerNumber - b.buyerNumber || (a.sessionId < b.sessionId ? -1 : 1));
}

// GET /{comment}?fields=can_reply_privately → true | false | null (unknown: the send decides).
export function makePreflight({ fetchImpl = globalThis.fetch, timeoutMs = PREFLIGHT_TIMEOUT_MS } = {}) {
  return async function preflight(commentId, pageToken) {
    const url = `${GRAPH_HOST}/${GRAPH_VERSION}/${encodeURIComponent(commentId)}?fields=can_reply_privately&access_token=${encodeURIComponent(pageToken)}`;
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const r = await fetchImpl(url, ac ? { signal: ac.signal } : {});
      const j = await r.json().catch(() => null);
      if (j && typeof j.can_reply_privately === "boolean") return j.can_reply_privately;
      return null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// deps.store: claimJobs(limit) → jobs; finishJob(id, patch); readProfile(userId) → { plan,
// plan_status } | null; getAutoReceiptSettings(userId) → { enabled, opening, note, qrImage, lang,
// currency }; listLiveRows(userId, liveVideoId) → live_session_orders rows (Facebook, that live).
// deps.flag() → boolean (fb_auto_receipt_enabled); deps.receipt = createFbReceipt(...) (autoSend,
// whose own hasAccess is the fb_receipt_access gate).
export function createAutoReceiptRunner(deps) {
  const {
    store, flag, receipt, hasAccess,
    preflight = makePreflight({ fetchImpl: deps.fetchImpl }),
    draw = drawReceiptPng,
    now = () => Date.now(), log = () => {},
  } = deps;
  const rate = new Map(); // userId → send timestamps (in memory; a restart clears it)
  let busy = false;

  const iso = (ms) => new Date(ms).toISOString();
  const short = (id) => String(id || "").slice(0, 8);

  async function finish(job, status, note, extra = {}) {
    try {
      await store.finishJob(job.id, { status, note: String(note).slice(0, 200), ...(status === "due" ? {} : { finished_at: iso(now()) }), ...extra });
    } catch { /* a stale 'running' job goes back to 'due' after 10 minutes */ }
    log(`[FB] auto-receipt job=${job.id} user=${short(job.user_id)} ${status} ${note}`);
  }

  async function gate(job) {
    if (!(await flag())) return "switch_off";
    if (!planAllowsAutoReceipt(await store.readProfile(job.user_id))) return "plan";
    if (!(await hasAccess(job.user_id))) return "no_access";
    const settings = await store.getAutoReceiptSettings(job.user_id);
    if (!settings || settings.enabled !== true) return "toggle_off";
    return { settings };
  }

  async function runJob(job) {
    let g;
    try { g = await gate(job); } catch { g = "read_failed"; }
    if (g === "read_failed") return retryOrFail(job, "read_failed");
    if (typeof g === "string") return finish(job, "skipped", g);

    let rows;
    try { rows = await store.listLiveRows(job.user_id, job.live_video_id); } catch { return retryOrFail(job, "read_failed"); }
    const buyers = groupBuyers(rows);
    const c = { sent: 0, skipped: 0, failed: 0, unknown: 0, retry: 0 };
    for (let i = 0; i < buyers.length; i++) {
      const b = buyers[i];
      const t = now();
      const r = checkReceiptRate(rate.get(job.user_id), t, AUTO_RECEIPT_RATE_MAX, AUTO_RECEIPT_RATE_WINDOW_MS);
      if (!r.allowed) {
        rate.set(job.user_id, r.kept);
        // Minute full: back to 'due' in a minute, attempt given back (rate is not a failure).
        return finish(job, "due", counts(c, buyers.length - i), { due_at: iso(t + AUTO_RECEIPT_RATE_WINDOW_MS), attempts: Math.max(0, (Number(job.attempts) || 1) - 1) });
      }
      let out;
      try {
        out = await receipt.autoSend(job.user_id, { sessionId: b.sessionId, buyerNumber: b.buyerNumber },
          () => draw(b.rows, g.settings), preflight);
      } catch {
        out = { status: 500, json: { ok: false, error: "draw_or_send_failed" } };
      }
      const kind = outcome(out);
      if (kind === "skipped" || kind === "none") { rate.set(job.user_id, r.kept.slice(0, -1)); c.skipped++; continue; }
      rate.set(job.user_id, r.kept);
      if (kind === "needs_messaging" || kind === "no_access") { c.failed++; return finish(job, "failed", `${kind} ${counts(c, buyers.length - i - 1)}`); }
      c[kind]++;
    }
    if (c.retry > 0) return retryOrFail(job, counts(c, 0));
    return finish(job, "done", counts(c, 0));
  }

  function counts(c, left) {
    return `buyers sent=${c.sent} skipped=${c.skipped} failed=${c.failed} unknown=${c.unknown} retry=${c.retry} left=${left}`;
  }

  function retryOrFail(job, note) {
    if ((Number(job.attempts) || 0) >= AUTO_RECEIPT_MAX_ATTEMPTS) return finish(job, "failed", note);
    return finish(job, "due", note, { due_at: iso(now() + AUTO_RECEIPT_RETRY_MS) });
  }

  // autoSend answer → sent | skipped | none (nothing happened, e.g. busy) | failed (row kept,
  // comment used) | unknown (row left pending) | retry (nothing delivered, try the buyer again)
  // | needs_messaging | no_access.
  function outcome(out) {
    const j = out?.json || {};
    if (j.ok === true) return "sent";
    if (j.skipped || j.error === "cannot_reply_privately" || j.error === "mixed_buyer" || j.error === "none_left") return "skipped";
    if (j.error === "busy") return "none";
    if (j.error === "needs_messaging" || j.error === "no_access") return j.error;
    if (j.error === "send_failed") return "failed";
    if (j.error === "unknown_result") return "unknown";
    return "retry"; // try_later, needs_reauth, upload_failed, claim_failed, draw/send threw
  }

  // One pass: claim due jobs and run them one by one. Never throws, never overlaps itself.
  async function tick() {
    if (busy) return 0;
    busy = true;
    try {
      let jobs = [];
      try { jobs = (await store.claimJobs(5)) || []; } catch { jobs = []; }
      for (const job of jobs) {
        try { await runJob(job); } catch { await retryOrFail(job, "error"); }
      }
      return jobs.length;
    } finally {
      busy = false;
    }
  }

  return { tick, runJob, _rate: rate };
}
