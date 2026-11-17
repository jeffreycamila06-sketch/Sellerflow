// Parcel tracking — the on-demand job worker (Stage 2, sql/63). Replaces the 4-hourly
// sweep: a seller presses "Check now" (parcel_tracking_request_check) or a Sync upload
// inserts new rows (trigger) → a row lands in parcel_tracking_jobs → this worker claims
// ONE job at a time (SKIP LOCKED) and checks only that seller's parcels.
//
// Kept from Stage 1: kill switch + breaker cooldown (readPollGate, read every tick),
// the global DAILY_REQUEST_CAP (shared parcel_tracking_daily counter), the circuit
// breaker (inside checkRows), one health row per job, service-role queries always
// scoped by explicit user_id. Logs carry user_id + counts only — never codes/names.
//
// 7-11 rules (Jeff, 2026-11-17 — server/pickupRules.js): no check at Sync (a 'new_parcels' job
// checks no 7-11 parcel; it still runs the 全家 part); a 7-11 parcel is checkable from the 2nd
// Taipei day after its sync (at a store: always); "Check now" checks EVERY checkable parcel,
// at-store first, then least recently checked first — no parcel cap.
// Limits per job: a per-seller daily REQUEST budget (manual 1,100; urgent / auto / health the
// plan numbers), the global daily cap, a 30-min hard stop, and a 10-min rest after 30 min of
// back-to-back work. Urgent keeps its plan parcel cap (Plus 300 / Pro·Master·admin 600).
import {
  checkRows, readPollGate, readDailyRequests, writePollHealth, purgeRetention,
  selectLiveRows, taipeiDay, underRequestCap, MAX_REQUESTS_PER_BATCH, DAILY_REQUEST_CAP, activePollIds,
} from "./parcelTrackingRunner.js";
import { splitCheckable, orderForCheck } from "./pickupRules.js";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { MEMORY_LIMIT_MB } from "./observability.js";
import { AUTO_SETTING_KEYS, autoSettingsFrom, autoTier, autoScope, overMemoryLimit, clampSetting } from "./parcelTrackingAuto.js";
import { planFmForJob, runFmPlan, FM_PARCELS_PER_JOB, FM_JOB_MAX_MS } from "./fmTrackingRunner.js";

export const WORKER_TICK_MS = 20 * 1000;
export const JOB_MAX_MS = 30 * 60 * 1000;
export const REST_MS = 10 * 60 * 1000;
export const HEALTH_HOUR = 9;                          // Taipei — daily health job after 09:00
export const NEW_PARCEL_SLACK_MS = 5 * 60 * 1000;      // new_parcels scope reaches 5 min before the request
export const IN_TRANSIT_FRESH_MS = 24 * 60 * 60 * 1000; // 全家 part only (scopeForJob): manual skips in_transit rows checked < 24h ago
export const AUTO_STALE_MS = 60 * 60 * 1000;           // an auto job queued > 1h ago (e.g. worker was off) is dropped
export const HEALTH_FALLBACK_SCAN = 200;               // rows read to find one checkable health probe
const TAG = "[PARCEL-JOB]";

// PURE — per-job parcel cap and per-seller daily request budget by plan. Used by urgent / auto /
// health jobs and by the 全家 part; a manual 7-11 check has no parcel cap and the budget below.
export function planCaps(plan, isAdmin = false) {
  const p = String(plan || "").trim().toLowerCase();
  const big = isAdmin || p === "pro" || p === "master";
  return { parcels: big ? 600 : 300, requests: big ? 600 : 300 };
}

// Per-seller daily request budget for a MANUAL check ("Check now", any plan): enough for two
// 30-minute presses (~520 requests each at 0.5 request per parcel) plus captcha retries.
export const MANUAL_REQUEST_BUDGET = 1100;

// PURE — today's request budget for this job kind (before subtracting what was already used).
export function sellerRequestBudget(kind, caps) {
  return kind === "manual" ? MANUAL_REQUEST_BUDGET : caps.requests;
}

// PURE — which of the seller's CHECKABLE 7-11 rows (2-day rule already applied) this job checks.
//   manual      → all of them, in check order (at-store first), never capped
//   new_parcels → none (no 7-11 check at Sync; the job still runs its 全家 part)
//   urgent      → as before (at-store due today or tomorrow, plan cap)
//   health      → the first one in check order
// Returns { rows, capped }.
export function sevenScopeForJob(job, rows, nowDate, caps) {
  if (job.kind === "manual") return { rows: orderForCheck(rows), capped: false };
  if (job.kind === "new_parcels") return { rows: [], capped: false };
  if (job.kind === "health") return { rows: orderForCheck(rows).slice(0, 1), capped: false };
  if (job.kind === "urgent") return scopeForJob(job, rows, nowDate, caps);
  return { rows: [], capped: false };
}

// PURE — which of the seller's non-terminal rows (already stalest-first) this job checks.
// Since 2026-11-17 this is the 全家 part's scope only (unchanged); the 7-11 part uses
// sevenScopeForJob. Returns { rows, capped }.
export function scopeForJob(job, rows, nowDate, caps) {
  const now = nowDate.getTime();
  const polledAt = (r) => (r.last_polled_at ? Date.parse(r.last_polled_at) : NaN);
  let pick;
  if (job.kind === "manual") {
    pick = rows.filter((r) => !(r.status === "in_transit" && now - polledAt(r) < IN_TRANSIT_FRESH_MS));
  } else if (job.kind === "new_parcels") {
    const from = Date.parse(job.requested_at) - NEW_PARCEL_SLACK_MS;
    pick = rows.filter((r) => !r.last_polled_at && Date.parse(r.created_at) >= from);
  } else if (job.kind === "urgent") {
    const tomorrow = taipeiDay(new Date(now + 24 * 60 * 60 * 1000));
    pick = rows.filter((r) => r.status === "at_store" && r.pickup_deadline && String(r.pickup_deadline).slice(0, 10) <= tomorrow);
  } else if (job.kind === "health") {
    pick = rows.slice(0, 1);
  } else {
    pick = [];
  }
  const limit = job.kind === "new_parcels" ? Math.min(300, caps.parcels) : caps.parcels;
  return { rows: pick.slice(0, limit), capped: pick.length > limit };
}

// PURE — the job row's final status/error from a checkRows result.
export function jobOutcome({ stopReason, tripped, checked, capped }) {
  if (tripped) return { status: "failed", error: "circuit_open" };
  if (stopReason === "daily_cap" || stopReason === "seller_cap") {
    return checked > 0 ? { status: "done", error: "partial" } : { status: "skipped", error: "daily_cap" };
  }
  if (stopReason) return { status: "done", error: "partial" }; // time_limit / run_cap
  return { status: "done", error: capped ? "capped" : null };
}

// PURE — refund the seller's daily press? Only for a seller-pressed manual job that
// checked nothing (0 parcels in scope) or failed. Admin/cron manual, new_parcels,
// urgent and health jobs never consumed a press.
export function shouldRefundPress(job, status, total) {
  if (job.kind !== "manual" || job.created_by !== "seller") return false;
  return status === "failed" || (status === "done" && total === 0);
}

// 全家 (FamilyMart) part of a job — see server/fmTrackingRunner.js.
//   • The worker first asks whether the 全家 part WILL run for this job (switch on, seller allowed,
//     a 全家 parcel to check). When it will not, the job is finished by finishJob — the code of
//     before, untouched; the only extra work is one small settings read.
//   • When it will: the 7-11 numbers (health row, duration, memory figures) are taken first, the job
//     row stays 'running' while the 全家 parcels are checked, and then ONE final job row, ONE press
//     decision (the 7-11 rule; never given back when 全家 answered) and ONE message to the app are
//     written (finishJobWithFm).
const FM_KINDS = new Set(["manual", "auto", "urgent", "new_parcels"]); // never the daily health job
// The 全家 part can never hold the worker longer than this; after it the job is finished with what
// the 全家 part had written so far, and the left-behind work is told to stop.
export const FM_PART_MAX_MS = FM_JOB_MAX_MS + 2 * 60 * 1000;
export const FM_PLAN_MAX_MS = 20 * 1000; // the "will it run?" question may not hold a job either

// PURE — is "last checked" stamped? As before when the 7-11 part checked a parcel; also when the
// 7-11 part had nothing to check and the 全家 part answered at least one. Manual and automatic jobs only.
export function fmStampsLastChecked(job, sevenChecked, sevenTotal, fm) {
  if (job.kind !== "manual" && job.kind !== "auto") return false;
  return sevenChecked > 0 || (sevenTotal === 0 && !!fm && fm.checked > 0);
}

// PURE — is the seller's press given back at the end of a job whose 全家 part ran? The 7-11 rule
// of before decides (shouldRefundPress on the 7-11 status and total) — except that a press is never
// given back when the 全家 part answered a parcel.
export function fmRefundsPress(job, sevenStatus, sevenTotal, fm) {
  return shouldRefundPress(job, sevenStatus, sevenTotal) && !(fm && fm.checked > 0);
}

// PURE — Taipei hour (0–23).
export function taipeiHour(nowDate) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23" }).format(nowDate));
}

const taipeiMidnightIso = (nowDate) => new Date(`${taipeiDay(nowDate)}T00:00:00+08:00`).toISOString();

// Event-loop delay over one job (ms, p99/max) — numbers only, for the auto "done" line.
function startLoopDelay() {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  return () => { h.disable(); return { p99: Math.round(h.percentile(99) / 1e6), max: Math.round(h.max / 1e6) }; };
}

// opts: { serviceSb, fetchImpl?, makeOcr?, now?, logger?, emit?(userId, payload), planFmImpl?, runFmImpl?, makeFmOcr?, fmLimits?,
//         fmPartMaxMs?, fmPlanMaxMs?, healthUserId?, limits?, checkRowsImpl?, memoryUsage?, loopDelay? }
export function createWorker(opts) {
  const {
    serviceSb, fetchImpl = fetch, makeOcr = null, now = () => new Date(), logger = console,
    emit = () => {}, healthUserId = "", limits = {}, checkRowsImpl = checkRows,
    memoryUsage = () => process.memoryUsage(), loopDelay = startLoopDelay,
    planFmImpl = planFmForJob, runFmImpl = runFmPlan, makeFmOcr = undefined, fmLimits = {},
    fmPartMaxMs = FM_PART_MAX_MS, fmPlanMaxMs = FM_PLAN_MAX_MS,
  } = opts;
  let running = false, busyMs = 0, restUntil = 0, healthDay = "", timer = null;
  let fmInFlight = false; // a 全家 part that was left behind at its time limit and has not come back yet

  async function maybeEnqueueHealth(t) {
    const day = taipeiDay(t);
    if (!healthUserId || healthDay === day || taipeiHour(t) < HEALTH_HOUR) return;
    const { data, error } = await serviceSb.from("parcel_tracking_jobs").select("id")
      .eq("user_id", healthUserId).eq("kind", "health").gte("requested_at", taipeiMidnightIso(t)).limit(1);
    if (error) return;
    if (!(data || []).length) {
      const { error: eErr } = await serviceSb.rpc("parcel_tracking_enqueue_job", { p_user_id: healthUserId, p_kind: "health", p_created_by: "worker" });
      if (eErr) return;
      logger.log(`${TAG} health job queued user=${healthUserId}`);
    }
    healthDay = day;
  }

  async function finishJob(job, { status, error = null, checked = 0, total = 0, requests = 0, batches = 0, failures = 0, retired = 0, startedMs, stats = "", purge = true }) {
    const t = now();
    const durationMs = t.getTime() - startedMs;
    const { error: jErr } = await serviceSb.from("parcel_tracking_jobs").update({
      status, error, finished_at: t.toISOString(), parcels_total: total, parcels_checked: checked, requests_used: requests,
    }).eq("id", job.id);
    if (jErr) logger.error(`${TAG} job update failed job=${job.id}:`, jErr.code || "error");
    // Give the daily press back when a seller's check did nothing or crashed (sql/64 also
    // checks kind/created_by itself). A skipped daily_cap job keeps the press.
    if (shouldRefundPress(job, status, total)) {
      const { error: rErr } = await serviceSb.rpc("parcel_tracking_refund_press", { p_job_id: job.id });
      if (rErr) logger.error(`${TAG} press refund failed user=${job.user_id}:`, rErr.code || "error");
      else logger.log(`${TAG} press refunded user=${job.user_id}`);
    }
    // "Last checked" = a FINISHED manual or automatic check that actually checked
    // something (the manual press bookkeeping is separate, so auto never uses it up).
    if ((job.kind === "manual" || job.kind === "auto") && checked > 0) {
      const { error: aErr } = await serviceSb.from("parcel_tracking_access").update({ last_completed_at: t.toISOString() }).eq("user_id", job.user_id);
      if (aErr) logger.error(`${TAG} last_completed_at write failed user=${job.user_id}:`, aErr.code || "error");
    }
    await writePollHealth(serviceSb, {
      ran_at: new Date(startedMs).toISOString(), ok: status !== "failed", reason: error, queries: batches, updated: checked,
      errors: failures, duration_ms: durationMs, sellers: 1, skipped_cap: 0, retired, requests, kind: job.kind, job_id: job.id,
    }, logger);
    if (job.kind !== "health" && purge) { // purge=false: an expired seller's rows stay untouched
      await purgeRetention(serviceSb, [job.user_id], t, logger, TAG);
      // (No follow-up new_parcels job any more: a 7-11 parcel is not checked at Sync — 2026-11-17.)
    }
    try { emit(job.user_id, { user_id: job.user_id, job_id: job.id, kind: job.kind, checked, total }); } catch { /* socket down — the client polls */ }
    logger.log(`${TAG} done job=${job.id} user=${job.user_id} kind=${job.kind} status=${status}${error ? ` error=${error}` : ""} checked=${checked}/${total} requests=${requests} ${durationMs}ms${stats}`);
    return { job: job.id, status, error, checked, total, durationMs };
  }

  // Will the 全家 part run for this job? Returns the plan ({ rows, … }) or null. Never throws, never
  // holds the job longer than fmPlanMaxMs.
  async function fmPlanFor(job, { auto, tier, caps }) {
    if (!FM_KINDS.has(job.kind)) return null;
    if (fmInFlight) { // only ONE 全家 part at a time
      logger.warn(`${TAG} FamilyMart part skipped job=${job.id} user=${job.user_id}: an earlier one is still running`);
      return null;
    }
    let planTimer = null;
    try {
      if (auto && overMemoryLimit(memoryUsage().rss, MEMORY_LIMIT_MB, auto.memPct)) return null;
      const fmScope = (list) => (auto
        ? autoScope(list, now(), { ...auto, maxParcels: Math.min(auto.maxParcels, FM_PARCELS_PER_JOB) }, tier)
        : scopeForJob(job, list, now(), { ...caps, parcels: FM_PARCELS_PER_JOB }));
      const asked = Promise.resolve().then(() => planFmImpl({ serviceSb, job, scopeOf: fmScope, now, logger, limits: fmLimits }));
      asked.catch(() => {}); // a late failure after the limit is not an unhandled rejection
      const late = new Promise((resolve) => { planTimer = setTimeout(() => resolve(null), fmPlanMaxMs); planTimer.unref?.(); });
      const plan = await Promise.race([asked, late]);
      return plan && plan.run && Array.isArray(plan.rows) && plan.rows.length ? plan : null;
    } catch (e) {
      logger.error(`${TAG} FamilyMart plan threw job=${job.id} user=${job.user_id}:`, (e && e.code) || "threw");
      return null;
    } finally {
      if (planTimer) clearTimeout(planTimer);
    }
  }

  // The 全家 part itself, inside its time limit. Always answers { reason, total, checked, requests }.
  // At the limit the left-behind work is told to stop (control.cancelled) and the count so far is used.
  async function runFmPart(job, plan, startedMs, fmStartMs) {
    const total = plan.rows.length;
    const control = { cancelled: false, checked: 0 };
    const soFar = (reason) => ({ reason, total, checked: Number(control.checked) || 0, requests: 0 });
    let raceTimer = null;
    fmInFlight = true;
    const work = Promise.resolve().then(() => runFmImpl({
      serviceSb, job, plan, fetchImpl, now, logger, limits: fmLimits, control,
      deadlineAt: startedMs + JOB_MAX_MS, hardStopAt: fmStartMs + fmPartMaxMs, ...(makeFmOcr ? { makeOcr: makeFmOcr } : {}),
    })).then((f) => ({ reason: (f && f.reason) || null, total, checked: Number(f && f.checked) || 0, requests: Number(f && f.requests) || 0 }), (e) => {
      logger.error(`${TAG} FamilyMart part threw job=${job.id} user=${job.user_id}:`, (e && e.code) || "threw");
      return soFar("threw");
    }).finally(() => { fmInFlight = false; });
    const giveUp = new Promise((resolve) => {
      raceTimer = setTimeout(() => {
        control.cancelled = true;
        logger.error(`${TAG} FamilyMart part still running after ${Math.round(fmPartMaxMs / 60000)} min — told to stop, job=${job.id} user=${job.user_id} finished without waiting for it`);
        resolve(soFar("timeout"));
      }, fmPartMaxMs);
      raceTimer.unref?.();
    });
    try { return await Promise.race([work, giveUp]); } finally { clearTimeout(raceTimer); }
  }

  // A job whose 全家 part RUNS (plan from fmPlanFor). Same writes as finishJob, in this order:
  //   1. the 7-11 part's own numbers — duration and health row — BEFORE the 全家 part starts
  //   2. the 全家 part (the job row is still 'running')
  //   3. ONE final job row (status / error of the 7-11 part, counts = 7-11 + 全家), ONE press decision,
  //      "last checked", purge, follow-up, ONE message to the app, ONE log line
  async function finishJobWithFm(job, { status, error = null, checked = 0, total = 0, requests = 0, batches = 0, failures = 0, retired = 0, startedMs, stats = "" }, plan) {
    const durationMs = now().getTime() - startedMs;
    await writePollHealth(serviceSb, {
      ran_at: new Date(startedMs).toISOString(), ok: status !== "failed", reason: error, queries: batches, updated: checked,
      errors: failures, duration_ms: durationMs, sellers: 1, skipped_cap: 0, retired, requests, kind: job.kind, job_id: job.id,
    }, logger);

    const fmStartMs = now().getTime();
    const fm = await runFmPart(job, plan, startedMs, fmStartMs);
    const fmMs = now().getTime() - fmStartMs;

    const t = now();
    const allChecked = checked + fm.checked, allTotal = total + fm.total;
    const { error: jErr } = await serviceSb.from("parcel_tracking_jobs").update({
      status, error, finished_at: t.toISOString(), parcels_total: allTotal, parcels_checked: allChecked, requests_used: requests,
    }).eq("id", job.id);
    if (jErr) logger.error(`${TAG} job update failed job=${job.id}:`, jErr.code || "error");
    if (fmRefundsPress(job, status, total, fm)) {
      const { error: rErr } = await serviceSb.rpc("parcel_tracking_refund_press", { p_job_id: job.id });
      if (rErr) logger.error(`${TAG} press refund failed user=${job.user_id}:`, rErr.code || "error");
      else logger.log(`${TAG} press refunded user=${job.user_id}`);
    }
    if (fmStampsLastChecked(job, checked, total, fm)) {
      const { error: aErr } = await serviceSb.from("parcel_tracking_access").update({ last_completed_at: t.toISOString() }).eq("user_id", job.user_id);
      if (aErr) logger.error(`${TAG} last_completed_at write failed user=${job.user_id}:`, aErr.code || "error");
    }
    await purgeRetention(serviceSb, [job.user_id], t, logger, TAG);
    try { emit(job.user_id, { user_id: job.user_id, job_id: job.id, kind: job.kind, checked: allChecked, total: allTotal }); } catch { /* socket down — the client polls */ }
    logger.log(`${TAG} done job=${job.id} user=${job.user_id} kind=${job.kind} status=${status}${error ? ` error=${error}` : ""} checked=${allChecked}/${allTotal} requests=${requests} ${durationMs}ms${stats} familymart=${fm.checked}/${fm.total}${fm.reason ? ` (${fm.reason})` : ""} ${fmMs}ms`);
    // The worker's rest counts the 全家 time too — also when the 全家 part was cut off at its limit.
    return { job: job.id, status, error, checked: allChecked, total: allTotal, durationMs: durationMs + fmMs };
  }

  // The normal end of a job: with the 全家 part when it will run, otherwise exactly as before.
  async function finishNormal(job, res, fmCtx) {
    const plan = await fmPlanFor(job, fmCtx);
    return plan ? finishJobWithFm(job, res, plan) : finishJob(job, res);
  }

  // One checkable 7-11 row of any active seller (enabled access, plan not expired), for the health
  // probe. Any read error → none (the job then finishes 0/0, as before).
  async function healthFallbackRows() {
    try {
      const { data: acc, error } = await serviceSb.from("parcel_tracking_access").select("user_id").eq("enabled", true);
      if (error) return [];
      let ids = (acc || []).map((r) => String(r.user_id)).filter(Boolean);
      if (!ids.length) return [];
      const { data: profs, error: pErr } = await serviceSb.from("seller_profiles")
        .select("auth_user_id, role, plan_status, plan_expiry").in("auth_user_id", ids);
      if (pErr) return [];
      ids = activePollIds(ids, profs || [], now());
      if (!ids.length) return [];
      const { data, error: rErr } = await serviceSb.from("parcel_tracking")
        .select("id,user_id,tracking_no,arrived_at,status,unchanged_polls,created_at,last_polled_at,pickup_deadline")
        .eq("terminal", false).eq("carrier", "711").in("user_id", ids)
        .order("last_polled_at", { ascending: true, nullsFirst: true }).order("id", { ascending: true })
        .limit(HEALTH_FALLBACK_SCAN);
      if (rErr) return [];
      const pick = orderForCheck(splitCheckable((data || []).filter((r) => r && r.tracking_no), now()).rows);
      return pick.slice(0, 1);
    } catch {
      return [];
    }
  }

  async function runJob(job) {
    const startedMs = now().getTime();
    logger.log(`${TAG} start job=${job.id} user=${job.user_id} kind=${job.kind}`);
    const isAuto = job.kind === "auto";
    let stopDelay = null;
    const autoStats = () => {
      if (!isAuto) return "";
      const d = stopDelay ? stopDelay() : null;
      stopDelay = null;
      const rssMb = Math.round((Number(memoryUsage().rss) || 0) / (1024 * 1024));
      return ` rss=${rssMb}MB${d ? ` loop_p99=${d.p99}ms loop_max=${d.max}ms` : ""}`;
    };
    try {
      // Automatic check: settings, staleness and the memory guard come before any work.
      let auto = null;
      if (isAuto) {
        if (startedMs - Date.parse(job.requested_at) > AUTO_STALE_MS) return finishJob(job, { status: "skipped", error: "auto_stale", startedMs });
        const { data: sets, error: sErr } = await serviceSb.from("app_settings").select("key,value").in("key", AUTO_SETTING_KEYS);
        if (sErr) return finishJob(job, { status: "failed", error: "settings_read_failed", startedMs });
        auto = autoSettingsFrom(Object.fromEntries((sets || []).map((r) => [r.key, r.value])));
        if (auto.mode === "off") return finishJob(job, { status: "skipped", error: "auto_off", startedMs });
        if (overMemoryLimit(memoryUsage().rss, MEMORY_LIMIT_MB, auto.memPct)) {
          return finishJob(job, { status: "skipped", error: "memory", startedMs, stats: autoStats() });
        }
      }

      const { data: prof } = await serviceSb.from("seller_profiles").select("plan,role,plan_status,plan_expiry").eq("auth_user_id", job.user_id).maybeSingle();
      const caps = planCaps(prof?.plan, String(prof?.role || "").toLowerCase() === "admin");
      // Expired plan (same rule as the scheduled poll, activePollIds): skip the job, rows untouched
      // (no check, no retention delete). Admins and a missing profile row are never skipped.
      if (prof && !activePollIds([job.user_id], [{ ...prof, auth_user_id: job.user_id }], now()).length) {
        logger.log(`${TAG} skipped job=${job.id} user=${job.user_id}: plan expired (rows untouched)`);
        return finishJob(job, { status: "skipped", error: "plan_expired", startedMs, purge: false });
      }

      // Per-seller daily request budget, from today's (Taipei) job rows.
      const { data: todays, error: tErr } = await serviceSb.from("parcel_tracking_jobs").select("requests_used")
        .eq("user_id", job.user_id).gte("requested_at", taipeiMidnightIso(now()));
      if (tErr) return finishJob(job, { status: "failed", error: "select_failed", startedMs });
      const budget = sellerRequestBudget(job.kind, caps) - (todays || []).reduce((n, j) => n + (Number(j.requests_used) || 0), 0);
      if (budget < MAX_REQUESTS_PER_BATCH) return finishJob(job, { status: "skipped", error: "daily_cap", startedMs });

      const daily = { day: taipeiDay(now()), requests: 0, sentThisRun: 0 };
      const d = await readDailyRequests(serviceSb, daily.day);
      if (d.error) return finishJob(job, { status: "failed", error: "daily_read_failed", startedMs });
      daily.requests = d.requests;
      let dailyCap = limits.dailyRequestCap ?? DAILY_REQUEST_CAP;
      let tier = "normal";
      if (auto) {
        tier = autoTier(daily.requests, auto);
        if (tier === "skip") return finishJob(job, { status: "skipped", error: "auto_budget", startedMs });
        dailyCap = Math.min(dailyCap, auto.budgetUrgent); // an auto job never pushes the day past the urgent tier
      }
      if (!underRequestCap(daily.requests, dailyCap)) return finishJob(job, { status: "skipped", error: isAuto ? "auto_budget" : "daily_cap", startedMs });

      const sel = await selectLiveRows(serviceSb, [job.user_id]);
      if (sel.error) return finishJob(job, { status: "failed", error: "select_failed", startedMs });
      const live = sel.rows.filter((r) => r && r.tracking_no);
      // 2-day rule: a 7-11 parcel synced today or yesterday (Taipei) and not at a store is left
      // out of every job — nothing is written for it.
      const split = splitCheckable(live, now());
      const scopeOf = (list) => (auto
        ? autoScope(list, now(), { ...auto, maxParcels: Math.min(auto.maxParcels, caps.parcels) }, tier)
        : sevenScopeForJob(job, list, now(), caps));
      let scope = scopeOf(split.rows);
      // The daily health probe always needs ONE row: when its own seller has none, the stalest
      // checkable row of any active seller (a normal check of that parcel).
      if (job.kind === "health" && !scope.rows.length) scope = { rows: await healthFallbackRows(), capped: false };
      const skipStat = split.young.length && (job.kind === "manual" || isAuto) ? ` young_skipped=${split.young.length}` : "";
      const fmCtx = { auto, tier, caps };
      if (!scope.rows.length) return finishNormal(job, { status: "done", error: null, startedMs, stats: autoStats() + skipStat }, fmCtx);

      if (isAuto) stopDelay = loopDelay();
      const r = await checkRowsImpl({
        serviceSb, rows: scope.rows, daily, fetchImpl, makeOcr, now, logger, limits: { ...limits, dailyRequestCap: dailyCap }, tag: TAG,
        deadlineAt: startedMs + JOB_MAX_MS, requestBudget: budget,
      });
      const out = jobOutcome({ stopReason: r.stopReason, tripped: r.tripped, checked: r.updated, capped: scope.capped });
      return finishNormal(job, {
        ...out, checked: r.updated, total: scope.rows.length, requests: r.sent, batches: r.batchesRun,
        failures: r.failures, retired: r.retired, startedMs, stats: autoStats() + skipStat,
      }, fmCtx);
    } catch (e) {
      logger.error(`${TAG} job threw job=${job.id} user=${job.user_id}:`, (e && e.code) || "threw");
      return finishJob(job, { status: "failed", error: "threw", startedMs, stats: autoStats() });
    }
  }

  async function tick() {
    if (running) return { skipped: "busy" };
    running = true;
    try {
      const t = now();
      if (restUntil > t.getTime()) return { skipped: "resting" };
      const gate = await readPollGate(serviceSb, t);
      if (!gate.run) return { skipped: gate.reason };
      await maybeEnqueueHealth(t);
      const { data, error } = await serviceSb.rpc("parcel_tracking_claim_job");
      if (error) {
        // e.g. sql/63 not applied yet — back off a minute instead of logging every tick.
        restUntil = now().getTime() + 60 * 1000;
        logger.error(`${TAG} claim failed:`, error.code || "error");
        return { skipped: "claim_failed" };
      }
      const job = Array.isArray(data) ? data[0] : data;
      if (!job) { busyMs = 0; return { idle: true }; }
      const out = await runJob(job);
      busyMs += out.durationMs;
      if (busyMs >= JOB_MAX_MS) {
        restUntil = now().getTime() + REST_MS;
        busyMs = 0;
        logger.log(`${TAG} resting ${REST_MS / 60000} min after ${JOB_MAX_MS / 60000} min of work`);
      }
      return out;
    } catch (e) {
      logger.error(`${TAG} tick threw:`, (e && e.code) || "threw");
      return { skipped: "threw" };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => { void tick(); }, WORKER_TICK_MS);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
