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
// Limits per job: parcels (Plus 300 / Pro·Master·admin 600), a per-seller daily REQUEST
// budget (same numbers — a 600-parcel pass needs ~300 requests), a 30-min hard stop,
// and a 10-min rest after 30 min of back-to-back work.
import {
  checkRows, readPollGate, readDailyRequests, writePollHealth, purgeRetention,
  selectLiveRows, taipeiDay, underRequestCap, MAX_REQUESTS_PER_BATCH, DAILY_REQUEST_CAP,
} from "./parcelTrackingRunner.js";

export const WORKER_TICK_MS = 20 * 1000;
export const JOB_MAX_MS = 30 * 60 * 1000;
export const REST_MS = 10 * 60 * 1000;
export const HEALTH_HOUR = 9;                          // Taipei — daily health job after 09:00
export const NEW_PARCEL_SLACK_MS = 5 * 60 * 1000;      // new_parcels scope reaches 5 min before the request
export const IN_TRANSIT_FRESH_MS = 24 * 60 * 60 * 1000; // manual skips in_transit rows checked < 24h ago
const TAG = "[PARCEL-JOB]";

// PURE — per-job parcel cap and per-seller daily request budget by plan.
export function planCaps(plan, isAdmin = false) {
  const p = String(plan || "").trim().toLowerCase();
  const big = isAdmin || p === "pro" || p === "master";
  return { parcels: big ? 600 : 300, requests: big ? 600 : 300 };
}

// PURE — which of the seller's non-terminal rows (already stalest-first) this job checks.
// Returns { rows, capped }.
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

// PURE — Taipei hour (0–23).
export function taipeiHour(nowDate) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23" }).format(nowDate));
}

const taipeiMidnightIso = (nowDate) => new Date(`${taipeiDay(nowDate)}T00:00:00+08:00`).toISOString();

// opts: { serviceSb, fetchImpl?, makeOcr?, now?, logger?, emit?(userId, payload),
//         healthUserId?, limits?, checkRowsImpl? }
export function createWorker(opts) {
  const {
    serviceSb, fetchImpl = fetch, makeOcr = null, now = () => new Date(), logger = console,
    emit = () => {}, healthUserId = "", limits = {}, checkRowsImpl = checkRows,
  } = opts;
  let running = false, busyMs = 0, restUntil = 0, healthDay = "", timer = null;

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

  async function finishJob(job, { status, error = null, checked = 0, total = 0, requests = 0, batches = 0, failures = 0, retired = 0, startedMs }) {
    const t = now();
    const durationMs = t.getTime() - startedMs;
    const { error: jErr } = await serviceSb.from("parcel_tracking_jobs").update({
      status, error, finished_at: t.toISOString(), parcels_total: total, parcels_checked: checked, requests_used: requests,
    }).eq("id", job.id);
    if (jErr) logger.error(`${TAG} job update failed job=${job.id}:`, jErr.code || "error");
    // "Last checked" = a FINISHED manual check that actually checked something.
    if (job.kind === "manual" && checked > 0) {
      const { error: aErr } = await serviceSb.from("parcel_tracking_access").update({ last_completed_at: t.toISOString() }).eq("user_id", job.user_id);
      if (aErr) logger.error(`${TAG} last_completed_at write failed user=${job.user_id}:`, aErr.code || "error");
    }
    await writePollHealth(serviceSb, {
      ran_at: new Date(startedMs).toISOString(), ok: status !== "failed", reason: error, queries: batches, updated: checked,
      errors: failures, duration_ms: durationMs, sellers: 1, skipped_cap: 0, retired, requests, kind: job.kind, job_id: job.id,
    }, logger);
    if (job.kind !== "health") {
      await purgeRetention(serviceSb, [job.user_id], t, logger, TAG);
      // Rows inserted while this job ran were blocked from enqueuing by the one-active
      // lock — queue a follow-up covering them.
      if (job.started_at) {
        const { data: fresh } = await serviceSb.from("parcel_tracking").select("id")
          .eq("user_id", job.user_id).eq("terminal", false).is("last_polled_at", null).gte("created_at", job.started_at).limit(1);
        if ((fresh || []).length) {
          await serviceSb.rpc("parcel_tracking_enqueue_job", { p_user_id: job.user_id, p_kind: "new_parcels", p_created_by: "followup", p_requested_at: job.started_at });
          logger.log(`${TAG} follow-up new_parcels queued user=${job.user_id}`);
        }
      }
    }
    try { emit(job.user_id, { user_id: job.user_id, job_id: job.id, kind: job.kind, checked, total }); } catch { /* socket down — the client polls */ }
    logger.log(`${TAG} done job=${job.id} user=${job.user_id} kind=${job.kind} status=${status}${error ? ` error=${error}` : ""} checked=${checked}/${total} requests=${requests} ${durationMs}ms`);
    return { job: job.id, status, error, checked, total, durationMs };
  }

  async function runJob(job) {
    const startedMs = now().getTime();
    logger.log(`${TAG} start job=${job.id} user=${job.user_id} kind=${job.kind}`);
    try {
      const { data: prof } = await serviceSb.from("seller_profiles").select("plan,role").eq("auth_user_id", job.user_id).maybeSingle();
      const caps = planCaps(prof?.plan, String(prof?.role || "").toLowerCase() === "admin");

      // Per-seller daily request budget, from today's (Taipei) job rows.
      const { data: todays, error: tErr } = await serviceSb.from("parcel_tracking_jobs").select("requests_used")
        .eq("user_id", job.user_id).gte("requested_at", taipeiMidnightIso(now()));
      if (tErr) return finishJob(job, { status: "failed", error: "select_failed", startedMs });
      const budget = caps.requests - (todays || []).reduce((n, j) => n + (Number(j.requests_used) || 0), 0);
      if (budget < MAX_REQUESTS_PER_BATCH) return finishJob(job, { status: "skipped", error: "daily_cap", startedMs });

      const daily = { day: taipeiDay(now()), requests: 0, sentThisRun: 0 };
      const d = await readDailyRequests(serviceSb, daily.day);
      if (d.error) return finishJob(job, { status: "failed", error: "daily_read_failed", startedMs });
      daily.requests = d.requests;
      if (!underRequestCap(daily.requests, limits.dailyRequestCap ?? DAILY_REQUEST_CAP)) return finishJob(job, { status: "skipped", error: "daily_cap", startedMs });

      const sel = await selectLiveRows(serviceSb, [job.user_id]);
      if (sel.error) return finishJob(job, { status: "failed", error: "select_failed", startedMs });
      const scope = scopeForJob(job, sel.rows.filter((r) => r && r.tracking_no), now(), caps);
      if (!scope.rows.length) return finishJob(job, { status: "done", error: null, startedMs });

      const r = await checkRowsImpl({
        serviceSb, rows: scope.rows, daily, fetchImpl, makeOcr, now, logger, limits, tag: TAG,
        deadlineAt: startedMs + JOB_MAX_MS, requestBudget: budget,
      });
      const out = jobOutcome({ stopReason: r.stopReason, tripped: r.tripped, checked: r.updated, capped: scope.capped });
      return finishJob(job, {
        ...out, checked: r.updated, total: scope.rows.length, requests: r.sent, batches: r.batchesRun,
        failures: r.failures, retired: r.retired, startedMs,
      });
    } catch (e) {
      logger.error(`${TAG} job threw job=${job.id} user=${job.user_id}:`, (e && e.code) || "threw");
      return finishJob(job, { status: "failed", error: "threw", startedMs });
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
