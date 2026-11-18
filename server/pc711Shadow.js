// 7-11 server checker SHADOW (Jeff 2026-11-14; like the extension 2026-11-15). Proves the server can do
// the Chrome extension's whole-day job, on REAL parcels, without changing anything a seller sees:
// every parcel the extension checked (store_full_at / phone_check_at / frozen_store_checked_at) is
// checked again by the server with the SAME inputs and the saved 7-11 login, and ONE pc711_shadow row
// compares the two answers. Same RULES and TIMING as chrome-extension/background.js (1.18.2), numbers
// mirrored below and pinned to that file by a test:
//   • one pass every 5 s, at most 5 parcels per pass, 2 s between parcels, one check at a time;
//   • the last 6 h, OLDEST unchecked first (an outage / a busy hour is caught up, never skipped);
//   • 01:00–05:00 Taipei (7-ELEVEN maintenance): a failure is not counted, retry in 10 min;
//   • per-parcel failure ladder — store / frozen 15 s · 30 s · 60 s · 2 min, phone 5 s · 10 s · 20 s ·
//     60 s · 2 min; one failure past the ladder → the error row (fail_step / fail_http / fail_reason /
//     steps) and the parcel is done;
//   • safety brake: 5 refusals in a row (HTTP 429 / 403 / 5xx / timeout) → 15 min pause + ONE row
//     (fail_reason paused_http);
//   • needs_login → one row and stop until the next connect (no re-login loop).
// No daily cap. Only COMPARES: never writes parcel_scans (the db adapter has no way to); never POSTs
// /cart/finish (the probe's URL allowlist refuses it). The queue comes from ONE small service-role
// RPC (sql/162 pc711_shadow_pending) — an empty pass costs a few bytes.
// Log, one line per check: [PC711_SHADOW] kind=… match=1|0|err step=… http=… ms=… gap=… — no data.
import { randomUUID } from "node:crypto";
import { SELF_STOP_EVERY_MS, SELF_STOP_WINDOW_MS, selfStopDecision, MIRROR_SWITCH, EVIDENCE_SAVE_TRIES, EVIDENCE_SAVE_RETRY_MS, evidenceJobs, evidenceRow, pairPatch, oldRowFromPair, reaskWord, nextReaskAt } from "./pc711Evidence.js";

// ── mirrored from chrome-extension/background.js (test-pinned) ─────────────────
export const SHADOW_POLL_MS = 5000;                      // PC_POLL_MS
export const SHADOW_LIMIT = 5;                           // PC_LIMIT
export const SHADOW_FETCH_LIMIT = 25;                    // PC_FETCH_LIMIT (look past parcels in backoff)
export const SHADOW_ROW_GAP_MS = 2000;                   // PC_ROW_GAP_MS
export const SHADOW_LOOKBACK_MS = 6 * 60 * 60 * 1000;    // PC_REQUEUE_SINCE_MS
export const SHADOW_MAINT_RETRY_MS = 10 * 60 * 1000;     // PC_MAINT_RETRY_MS
export const SHADOW_MAINT_START_H = 1, SHADOW_MAINT_END_H = 5; // PC_MAINT_START_H / PC_MAINT_END_H (Taipei, [1, 5))
export const SHADOW_STORE_BACKOFF_MS = [15 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000];               // PC_BACKOFF_MS
export const SHADOW_PHONE_BACKOFF_MS = [5 * 1000, 10 * 1000, 20 * 1000, 60 * 1000, 2 * 60 * 1000];     // PC_PHONE_FAST_BACKOFF_MS
// ── with the kept E-Map session (server/pc711Emap.js): the rest of the extension's row loop ─────────
export const SHADOW_PHONE_TOKEN_MS = 5000;               // myship-711.js TOKEN_TIMEOUT_MS
export const SHADOW_PHONE_TOKEN_RETRY_FAILS = 2;         // PC_PHONE_TOKEN_RETRY_FAILS
export const SHADOW_FROZEN_STORE_GAP_MS = 10 * 60 * 1000; // frozen-check.js STORE_GAP_MS
export const SHADOW_FROZEN_SLOW_PAUSE_MS = 10 * 60 * 1000; // frozen-check.js SLOW_PAUSE_MS
// ── the shadow's own (Jeff 2026-11-15) ─────────────────────────────────────────
export const SHADOW_BRAKE_ERRORS = 5;                    // refusals in a row → pause
export const SHADOW_BRAKE_PAUSE_MS = 15 * 60 * 1000;
export const SHADOW_KEEP_DAYS = 30;
export const SHADOW_PAGE = 20;
export const SHADOW_SWITCH = "pc711_shadow_enabled";
const TAG = "[PC711_SHADOW]";
const DAY_MS = 86400 * 1000;

// The extension's words (parcel_scans.store_full_status / phone_check_status).
export const STORE_WORDS = ["open", "full", "company", "not_found", "unknown"];
export const PHONE_WORDS = ["ok", "restricted", "unknown"];
export const FROZEN_WORDS = ["ok", "no_frozen", "unknown"]; // parcel_scans.frozen_store_status (extension 1.18.2)
export const KINDS = ["store", "phone", "frozen"];
/** The server's answer → the extension's word for that kind; anything else → "unknown". */
export function toExtWord(kind, verdict) {
  const words = kind === "store" ? STORE_WORDS : kind === "phone" ? PHONE_WORDS : kind === "frozen" ? FROZEN_WORDS : [];
  const v = String(verdict ?? "").trim();
  return words.includes(v) ? v : "unknown";
}
/** One short word (^[a-z0-9_]{0,32}$), never data. */
export function noteWord(w) {
  const s = String(w ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
  return s || null;
}
export const STEP_NAMES = ["phone.config", "phone.token", "phone.validate", "store.skip", "store.config", "store.relogin", "store.cart", "store.detail", "store.map", "store.emap", "store.byid", "frozen.byid"];
export const RAW_WORDS = ["enable", "disable", "close", "NO2", "other", "Status:true", "Status:false-restricted", "Status:false-other"];

// The probe's part kind → one fail_reason word.
const REASON = {
  timeout: "timeout", network: "network", http: "http", redirect: "redirect", html: "html", bad_json: "bad_json",
  too_big: "too_big", parse_too_slow: "parse_too_slow", refused: "refused", cart_action_refused: "refused", emap_host_refused: "refused",
  cart_form_missing: "no_form", detail_form_missing: "no_form", map_form_missing: "no_form", guid_missing: "no_guid",
  fee_missing: "no_fee", cart_field_missing: "no_field", unexpected_answer: "unexpected_answer", bad_input: "bad_input",
  config_missing: "config_missing", login_not_accepted: "needs_login", no_session: "needs_login", needs_login: "needs_login",
  error: "threw", threw: "threw", budget: "budget", too_many_redirects: "redirect", bad_redirect: "redirect",
};
export const failReasonOf = (kind) => REASON[String(kind ?? "")] || noteWord(kind);

/** The server check did not reach a real answer: its word is "unknown" WITH a reason. A 7-11
 *  "Status:false" with another message (kind rejected) IS an answer (the extension says unknown too). */
export function isServerError(srvWord, kind) {
  const k = String(kind ?? "").trim();
  return srvWord === "unknown" && k !== "" && k !== "rejected";
}

/** Every step of ONE check, word-safe: {s, http, ms, ok[, w]} — w = the step's own kind word when it
 *  failed. Never a phone, name, store id, cookie, guid, URL or page text (the probe's note is
 *  reduced to its "kind=<word>"). */
export function safeSteps(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 20).map((x) => {
    const s = STEP_NAMES.includes(x && x.step) ? x.step : "other";
    const m = /(?:^|\s)kind=([a-z0-9_]+)/.exec(String((x && x.note) || ""));
    // a bare note counts only when it is a KNOWN reason word (a bare number could be a phone)
    const bare = Object.prototype.hasOwnProperty.call(REASON, String((x && x.note) || "")) ? String(x.note) : "";
    const kindWord = m && m[1] && !/\d{4,}/.test(m[1]) ? m[1] : "";
    const w = x && x.ok === false ? noteWord(kindWord || bare) : null;
    return { s, http: Number(x && x.http) || 0, ms: Math.max(0, Math.round(Number(x && x.ms) || 0)), ok: Boolean(x && x.ok), ...(w ? { w } : {}) };
  });
}

/** Where a failed check stopped: the step name (or "login" / "input"). */
export function failStepOf(kind, steps) {
  const reason = failReasonOf(kind);
  if (reason === "needs_login") return "login";
  if (reason === "bad_input" || reason === "config_missing") return "input";
  const bad = [...(steps || [])].reverse().find((x) => !x.ok);
  const last = (steps || [])[(steps || []).length - 1];
  return (bad || last || {}).s || null;
}

const pad = (n) => String(n).padStart(2, "0");
/** Asia/Taipei (UTC+8, no DST) day key and that day's 00:00 as an ISO instant. */
export function taipeiDay(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600 * 1000;
  return { key, startMs, startIso: new Date(startMs).toISOString() };
}

/** 7-ELEVEN maintenance (Asia/Taipei 01:00–05:00, the extension's hours). */
export function inShadowMaint(nowMs) {
  const h = Math.floor((((nowMs + 8 * 3600 * 1000) % DAY_MS) + DAY_MS) % DAY_MS / (3600 * 1000));
  return h >= SHADOW_MAINT_START_H && h < SHADOW_MAINT_END_H;
}
/** The failure ladder of a kind (frozen = the store chain). */
export const ladderFor = (kind) => (kind === "phone" ? SHADOW_PHONE_BACKOFF_MS : SHADOW_STORE_BACKOFF_MS);
/** 7-11 refused us (counts for the safety brake): HTTP 429 / 403 / 5xx, or a timeout. */
export function isRefusal(row) {
  const http = Number(row && row.fail_http) || 0;
  return http === 429 || http === 403 || http >= 500 || (row && row.fail_reason) === "timeout";
}

/** pcPhoneFastKind: the token GET got no answer (timeout / network) — not the POST. */
export function phoneFastKind(r) {
  const kind = String((r && r.kind) || "");
  const posted = (Array.isArray(r && r.steps) ? r.steps : []).some((x) => x && x.step === "phone.validate");
  return (kind === "timeout" || kind === "network") && !posted;
}
/** pcPhoneNoAnswer: no answer at all, token GET or POST (timeout / network). */
export function phoneNoAnswer(r) {
  const kind = String((r && r.kind) || "");
  return kind === "timeout" || kind === "network";
}
/** pcPhoneBackoffDelay: the fast ladder for a token GET with no answer, else pcBackoffDelay (the store ladder). */
export function phoneBackoffDelay(fails, r) {
  const ladder = phoneFastKind(r) ? SHADOW_PHONE_BACKOFF_MS : SHADOW_STORE_BACKOFF_MS;
  return ladder[Math.min(Math.max(1, fails), ladder.length) - 1];
}
/** pcBackoffDelay: the store ladder 15 s · 30 s · 60 s · 2 min (2 min after that). */
export function storeBackoffDelay(fails) {
  return SHADOW_STORE_BACKOFF_MS[Math.min(Math.max(1, fails), SHADOW_STORE_BACKOFF_MS.length) - 1];
}
/** The extension's rows (pcPollMulti): one parcel = its store half + its phone half, in queue order.
 *  A frozen job is its own row (the extension's frozen lane is separate). Pure. */
export function rowsOf(entries) {
  const rows = []; const at = new Map();
  for (const x of entries || []) {
    const j = x.job;
    const key = j.kind === "frozen" ? `${j.mode}:${j.scanId}:frozen` : `${j.mode}:${j.scanId}`;
    let row = at.get(key);
    if (!row) { row = { key, store: null, phone: null }; at.set(key, row); rows.push(row); }
    if (j.kind === "phone") { if (!row.phone) row.phone = x; }
    else if (!row.store) row.store = x;
  }
  return rows;
}

/** The RPC's rows (oldest first) → jobs [{ scanId, kind, ext, at, input }]. Pure. */
export function jobsFromPending(rows) {
  const jobs = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.scan_id || !KINDS.includes(r.kind)) continue;
    const at = Date.parse(r.at || "");
    const input = r.kind === "phone"
      ? { kind: "phone", phone: String(r.phone ?? ""), name: String(r.customer_name ?? ""), storeId: String(r.store_id ?? "") }
      : { kind: r.kind, storeId: String(r.store_id ?? "") };
    jobs.push({ scanId: r.scan_id, kind: r.kind, ext: toExtWord(r.kind, r.ext), at: Number.isFinite(at) ? at : NaN, input });
  }
  return jobs;
}
/** In the given (oldest-first) order, the jobs whose backoff wait is over, at most `limit`. Pure. */
export function selectJobs(jobs, backoff, nowMs, limit = SHADOW_LIMIT) {
  const out = [];
  for (const j of jobs || []) {
    if (out.length >= limit) break;
    const b = backoff && backoff.get(`${j.scanId}:${j.kind}`);
    if (b && nowMs < b.nextAt) continue;
    out.push(j);
  }
  return out;
}

/** ONE check's result → the pc711_shadow row (no ids but scan_id; no phone / name / store). */
export function shadowRow(job, r, serverStartMs) {
  const srv = toExtWord(job.kind, r && r.verdict);
  const steps = safeSteps(r && r.steps);
  const kind = (r && r.kind) || "";
  const loggedOut = Boolean(r && r.loggedOut);
  const err = loggedOut || isServerError(srv, kind);
  // frozen: the extension itself had no answer (night no-answer / close / NO2) → checked, not counted
  const extUnknown = !err && job.kind === "frozen" && job.ext === "unknown";
  const reason = err ? (loggedOut ? "needs_login" : failReasonOf(kind)) : null;
  const failStep = err ? (loggedOut ? "login" : failStepOf(kind, steps)) : null;
  const bad = err ? [...steps].reverse().find((x) => !x.ok) : null;
  const raw = RAW_WORDS.includes(r && r.raw) ? r.raw : null;
  return {
    scan_id: job.scanId, kind: job.kind, ext_verdict: job.ext, srv_verdict: srv,
    srv_ms: Math.max(0, Math.round(Number(r && r.ms) || 0)), srv_http: Number(r && r.http) || 0,
    match: err || extUnknown ? null : srv === job.ext,
    note: noteWord(err ? reason : extUnknown ? "ext_unknown" : kind),
    fail_step: failStep, fail_http: err ? (bad ? bad.http : Number(r && r.http) || 0) : null, fail_reason: reason,
    steps, gap_s: Number.isFinite(job.at) ? Math.max(0, Math.round((serverStartMs - job.at) / 1000)) : null, raw,
  };
}

/** The one log line for a check. */
export function shadowLogLine(row, maint, stop = false) {
  const m = row.match === null ? (row.fail_reason ? "err" : "skip") : row.match ? "1" : "0";
  return `${TAG} kind=${row.kind} match=${m} step=${row.fail_step || "-"} http=${row.match === null ? row.fail_http ?? 0 : row.srv_http} ms=${row.srv_ms} gap=${row.gap_s ?? "-"} maint=${maint ? 1 : 0}${stop ? " stop=needs_login" : ""}`;
}

// The db the job uses (server.js builds it on the service-role client). It READS parcel_scans only
// through the pending RPC (sql/162) and reads/writes pc711_shadow + pc711_shadow_days — nothing else.
const HISTORY_COLS = "at,kind,ext_verdict,srv_verdict,raw,gap_s,match,note,fail_step,fail_http,fail_reason,srv_ms,steps";
export function createShadowDb(sb) {
  return {
    // ONE small RPC (sql/162): the oldest parcels not checked yet + how many are waiting.
    async pending(sinceIso, limit) {
      const { data, error } = await sb.rpc("pc711_shadow_pending", { p_since: sinceIso, p_limit: limit });
      if (error) throw error;
      const o = data && typeof data === "object" ? data : {};
      return { waiting: Math.max(0, Number(o.waiting) || 0), jobs: Array.isArray(o.jobs) ? o.jobs : [] };
    },
    async dayMax(days) {
      if (!days.length) return {};
      const { data, error } = await sb.from("pc711_shadow_days").select("day,max_waiting").in("day", days);
      if (error) throw error;
      const out = {};
      for (const r of data || []) out[String(r.day).slice(0, 10)] = Math.max(0, Number(r.max_waiting) || 0);
      return out;
    },
    async saveDayMax(day, maxWaiting) {
      const { error } = await sb.from("pc711_shadow_days").upsert({ day, max_waiting: maxWaiting, updated_at: new Date().toISOString() }, { onConflict: "day" });
      if (error) throw error;
    },
    async insert(row) {
      const { error } = await sb.from("pc711_shadow").upsert(row, { onConflict: "scan_id,kind", ignoreDuplicates: true });
      if (error) throw error;
    },
    async purgeBefore(beforeIso) {
      const { error } = await sb.from("pc711_shadow").delete().lt("at", beforeIso);
      if (error) throw error;
      const d = await sb.from("pc711_shadow_days").delete().lt("day", beforeIso.slice(0, 10));
      if (d.error) throw d.error;
    },
    // rows in [fromIso, toIso) for totals (small columns only)
    async rowsBetween(fromIso, toIso) {
      const { data, error } = await sb.from("pc711_shadow").select("at,kind,match,srv_ms,fail_step,fail_reason").gte("at", fromIso).lt("at", toIso).limit(10000);
      if (error) throw error;
      return data || [];
    },
    // one page of history, newest first; filter all | mismatch | error; kind all | store | phone | frozen
    async history(fromIso, toIso, filter, page, kind = "all") {
      let q = sb.from("pc711_shadow").select(HISTORY_COLS).gte("at", fromIso).lt("at", toIso);
      if (KINDS.includes(kind)) q = q.eq("kind", kind);
      if (filter === "mismatch") q = q.eq("match", false);
      else if (filter === "error") q = q.not("fail_reason", "is", null);
      const from = Math.max(0, page) * SHADOW_PAGE;
      const { data, error } = await q.order("at", { ascending: false }).range(from, from + SHADOW_PAGE);
      if (error) throw error;
      return data || [];
    },
  };
}

// The job. check(input) → { verdict, http, ms, kind, raw, steps } (one server check; server.js runs
// the probe's target mode). pc711 = the login module (status()). Never throws.
// emap (server/pc711Emap.js, optional): with it, the evidence pass runs the extension's row loop on ONE kept
// E-Map session (pcPollMulti → pcEmapKeepalive → pcRefreshTabStatus); without it, the pass is as before.
// backup (server/pc711Backup.js, optional): asked first on every pass. While it is ON DUTY (the Lenovo stopped,
// sql/179) it does the pass itself and this job does nothing — comparing pauses, and so does the safety brake.
// As a follower everything below is unchanged (the brake included).
// passStart (optional, server/pc711Speed.js): called once at the start of every pass (the settings read in a
// pass are reused for that pass). A throw is ignored.
// Jeff 2026-11-18 — a lost 7-11 login stops nothing while the kept E-Map session still answers: the login is
// only needed to OPEN an E-Map session. Without a kept session that answers, everything is as before.
export function createPc711Shadow({ db, evidence = null, check, pc711, readSetting, emap = null, backup = null, passStart = null, now = Date.now, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let running = false;
  let lastEnd = -Infinity;     // when the last 7-11 check finished (2 s between parcels)
  let day = "";                // the Taipei day the purge last ran for
  let stoppedSince = null;     // the connect (status.since) the job stopped on (needs_login)
  let timer = null, stopped = false;
  const backoff = new Map();   // "scanId:kind" (mirror: "m:scanId:kind") → { fails, nextAt, seenAt } (the extension's pcBackoff)
  let streak = 0;              // refusals in a row (safety brake)
  let pausedUntil = 0;
  let waiting = null, waitingAt = 0;
  const dayMax = new Map();    // Taipei day → highest Waiting seen (loaded from pc711_shadow_days first)
  let lastPendingFail = 0;
  let mirrorOnLast = false;
  let mirrorOnSince = null;    // when this server last saw mirror switch on (the self-stop's window starts here at most)
  let lastHealthAt = 0;        // the last self-stop check
  let silentSince = null;      // the regular checker wrote no answer since … (rule b skipped) — shown on Admin
  let mirrorSwitchLast = false; // the mirror switch as the last pass read it (also during 01:00–05:00)
  let loginStopFailAt = 0;     // the last failed login_lost write (logged at most once a minute)
  const say = (line) => { try { log(line); } catch { /* a log never stops the job */ } };
  // the kept E-Map session still answers (server/pc711Emap.js answering()): then a lost login stops nothing
  const keptSession = () => { try { return Boolean(emap) && typeof emap.answering === "function" && emap.answering() === true; } catch { return false; } };

  async function noteWaiting(n, t) {
    waiting = n; waitingAt = t;
    const key = taipeiDay(t).key;
    if (!dayMax.has(key)) {
      let stored = 0;
      try { stored = (await db.dayMax([key]))[key] || 0; } catch { stored = 0; }
      dayMax.set(key, stored);
    }
    if (n > dayMax.get(key)) {
      dayMax.set(key, n);
      try { await db.saveDayMax(key, n); } catch { /* the next higher count writes again */ }
    }
  }

  // ONE 7-11 check: the 2 s gap, the check, needs_login. Every request to 7-11 goes through here.
  async function ask(input, gap = true) {
    const wait = gap ? SHADOW_ROW_GAP_MS - (now() - lastEnd) : 0;
    if (wait > 0) await sleep(wait);
    const t0 = now();
    let r;
    try { r = await check(input); } catch { r = null; }
    if (!r || typeof r !== "object") r = { verdict: "unknown", http: 0, ms: now() - t0, kind: "threw", steps: [] };
    lastEnd = now();
    const after = pc711 && typeof pc711.status === "function" ? pc711.status() : null;
    const loggedOut = r.kind === "login_not_accepted" || r.kind === "no_session" || Boolean(after && after.state === "needs_login" && !keptSession());
    return { r: { ...r, ms: Number(r.ms) || lastEnd - t0, loggedOut }, t0, end: lastEnd, loggedOut };
  }

  // the safety brake after a server error; true = paused now (ONE paused_http row)
  async function brakeAfter(row, kind) {
    streak = isRefusal(row) ? streak + 1 : 0;
    if (streak < SHADOW_BRAKE_ERRORS) return false;
    pausedUntil = lastEnd + SHADOW_BRAKE_PAUSE_MS;
    streak = 0;
    // ONE row for the pause (its own id — never a parcel's, so no parcel is marked checked)
    const pause = { scan_id: randomUUID(), kind, ext_verdict: null, srv_verdict: "unknown", srv_ms: 0, srv_http: row.fail_http ?? 0,
      match: null, note: "paused_15m", fail_step: row.fail_step, fail_http: row.fail_http ?? 0, fail_reason: "paused_http", steps: [], gap_s: null, raw: null };
    try { await db.insert(pause); } catch { /* the pause still holds */ }
    say(`${TAG} pause ${SHADOW_BRAKE_PAUSE_MS / 60000}m after ${SHADOW_BRAKE_ERRORS} refusals http=${row.fail_http ?? 0} reason=${row.fail_reason}`);
    return true;
  }

  // sql/172: a failed evidence save must not make the queue offer the same value again every pass (nothing
  // else marks it checked): that parcel + kind + value is not asked again for 10 min, at most 3 tries, then left.
  const saveFails = new Map(); // key → { fails, nextAt, seenAt }
  const saveBlocked = (key, t) => { const f = saveFails.get(key); if (f) f.seenAt = t; return Boolean(f && t < f.nextAt); };
  function noteSave(key, ok, kind, mode) {
    if (ok) { saveFails.delete(key); return; }
    const f = saveFails.get(key) || { fails: 0, nextAt: 0, seenAt: now() };
    f.fails += 1; f.seenAt = now();
    f.nextAt = f.fails >= EVIDENCE_SAVE_TRIES ? Infinity : now() + EVIDENCE_SAVE_RETRY_MS;
    saveFails.set(key, f);
    say(`${TAG} evidence save failed kind=${kind} mode=${mode} try=${f.fails}/${EVIDENCE_SAVE_TRIES} ${f.fails >= EVIDENCE_SAVE_TRIES ? "left" : `next=${EVIDENCE_SAVE_RETRY_MS / 1000}s`}`);
  }
  const jobKey = (job) => `${job.scanId}:${job.kind}:${job.value}`;
  const evInsert = async (row) => { if (!evidence) return true; try { await evidence.insert(row); return true; } catch { return false; } };
  const tagOf = (job) => (evidence ? ` mode=${job.mode || "after"} round=${job.round || 1}` : "");

  // one parcel job (after-mode or mirror) → "next" | "stop" | "pause". ext (the extension's row loop):
  // { ask, base(end), delay(fails, r), maint, onAnswer(), onMiss(b, r) } — the ladder's start, waits and
  // the E-Map evidence of that half; without ext the job is as before.
  // later (optional): an array. A real answer's saves (the comparison row + the evidence row) are pushed on it
  // instead of being written now — the caller writes them after the phone check of the same parcel. Every
  // other save (a logged-out row, an error row) is written at once, as before.
  async function runJob(job, st, seenAt, queued, ext = null, later = null) {
    const { r, t0, end, loggedOut } = ext ? await ext.ask() : await ask(job.input);
    const row = shadowRow(job, r, t0);
    const mirror = job.mode === "mirror";
    const key = `${mirror ? "m:" : ""}${job.scanId}:${job.kind}`;
    const maint = ext ? ext.maint : inShadowMaint(end);
    const isErr = row.match === null && Boolean(row.fail_reason);
    const ev = async () => { const ok = await evInsert(evidenceRow(job, row, r, t0, end, queued, seenAt)); if (evidence) noteSave(jobKey(job), ok, job.kind, mirror ? "mirror" : "after"); };
    if (loggedOut) {
      if (!mirror) { try { await db.insert(row); } catch { /* the next pass tries again */ } }
      await ev();
      say(shadowLogLine(row, maint, true) + tagOf(job));
      stoppedSince = st.since ?? null;
      backoff.delete(key);
      return "stop";
    }
    if (!isErr) {
      // a real answer (or the extension's own frozen unknown): the comparison row, the ladder is cleared
      const save = async () => {
        if (!mirror) { try { await db.insert(row); } catch { /* the next pass tries again */ } }
        await ev();
      };
      if (Array.isArray(later)) later.push(save); else await save();
      say(shadowLogLine(mirror ? { ...row, match: null } : row, maint) + tagOf(job)); // mirror: no pair yet (match=skip)
      backoff.delete(key);
      streak = 0;
      if (ext && ext.onAnswer) ext.onAnswer();
      return "next";
    }
    // a server error — the extension's ladder
    const b = backoff.get(key) || { fails: 0, nextAt: 0, seenAt: seenAt };
    b.seenAt = seenAt;
    if (maint) {
      b.nextAt = (ext ? ext.base(end) : lastEnd) + SHADOW_MAINT_RETRY_MS; // maintenance: not counted, slow retry
      backoff.set(key, b);
      say(`${TAG} kind=${job.kind} retry attempt=${b.fails} maint=1 next=${SHADOW_MAINT_RETRY_MS / 1000}s step=${row.fail_step || "-"} http=${row.fail_http ?? 0} reason=${row.fail_reason}`);
      return "next";
    }
    b.fails += 1;
    if (ext && ext.onMiss) ext.onMiss(b, r);
    const ladder = ladderFor(job.kind);
    if (b.fails > ladder.length) {
      if (!mirror) { try { await db.insert(row); } catch { /* the next pass tries again */ } }
      await ev();
      say(shadowLogLine(row, maint) + tagOf(job));
      backoff.delete(key);
    } else {
      const wait = ext ? ext.delay(b.fails, r) : ladder[b.fails - 1];
      b.nextAt = (ext ? ext.base(end) : lastEnd) + wait; // from the END of the failed attempt (ext store: the pass start)
      backoff.set(key, b);
      say(`${TAG} kind=${job.kind} retry attempt=${b.fails} maint=0 next=${wait / 1000}s step=${row.fail_step || "-"} http=${row.fail_http ?? 0} reason=${row.fail_reason}`);
    }
    return (await brakeAfter(row, job.kind)) ? "pause" : "next";
  }

  // sql/172 mirror: pair the server's answers with the extension's (database only, no 7-11 request)
  async function pairMirror(t, rows) {
    for (const x of rows || []) {
      const patch = pairPatch(x, t);
      if (!patch) continue;
      try { await evidence.update(x.id, patch); } catch { continue; }
      if (patch.ext_verdict && Number(x.round) === 1) {
        try { await db.insert(oldRowFromPair(x, patch)); } catch { /* the totals miss one row */ }
      }
      say(patch.ext_verdict
        ? `${TAG} mirror pair kind=${x.kind} match=${patch.match === null ? "err" : patch.match ? "1" : "0"} first=${patch.first || "-"} by=${patch.first_by_ms ?? "-"}ms late=${patch.ext_late ? 1 : 0}`
        : `${TAG} mirror closed kind=${x.kind} why=${patch.flag}`);
    }
  }

  // sql/172 re-asks (a real phone mismatch): ~30 s and ~5 min after the check → "next" | "stop" | "pause"
  async function runReask(x, st, t) {
    let p = null;
    try { p = await evidence.parcelForReask(x.scan_id); } catch { p = undefined; }
    const n = (Number(x.reask_n) || 0) + 1;
    const at = new Date(now()).toISOString();
    if (p === undefined) return "next"; // the read failed: try on the next pass
    if (!p || String(p.phone ?? "") !== String(x.phone ?? "")) {
      // the parcel is gone or its phone changed: nothing to ask; no further re-asks
      let saved = true;
      try { await evidence.update(x.id, { [`reask${n}_at`]: at, [`reask${n}_word`]: p ? "phone_changed" : "parcel_gone", reask_n: n, reask_next_at: null }); } catch { saved = false; }
      noteSave(`reask:${x.id}`, saved, "phone", "reask");
      return "next";
    }
    const input = { kind: "phone", phone: String(p.phone ?? ""), name: String(p.customer_name ?? ""), storeId: String(p.store_id ?? "") };
    const { r, t0, end, loggedOut } = await ask(input);
    const row = shadowRow({ scanId: x.scan_id, kind: "phone", ext: null, at: NaN, input }, r, t0);
    const isErr = loggedOut || (row.match === null && Boolean(row.fail_reason));
    const w = reaskWord(row.srv_verdict, loggedOut ? "needs_login" : isErr ? row.fail_reason : null);
    let saved = true;
    try {
      await evidence.update(x.id, { [`reask${n}_at`]: new Date(end).toISOString(), [`reask${n}_word`]: w, reask_n: n, reask_next_at: nextReaskAt(x, n, end) });
    } catch { saved = false; }
    noteSave(`reask:${x.id}`, saved, "phone", "reask");
    say(`${TAG} reask kind=phone n=${n} word=${w} ms=${row.srv_ms}`);
    if (loggedOut) { stoppedSince = st.since ?? null; return "stop"; }
    if (!isErr) { streak = 0; return "next"; }
    return (await brakeAfter(row, "phone")) ? "pause" : "next";
  }

  // sql/172: the evidence pass — ONE queue call (pc711_shadow_pass) brings everything a pass needs.
  // sql/173: the server lost its 7-11 login (needs_login, or a check saw the logged-out cart page and the
  // job stopped) while the mirror switch was on → switch mirror off ONCE (the existing stop function, rule
  // login_lost; it only ever writes 'false'). A failed write is tried again on the next tick.
  const loginLost = (st) => Boolean(st) && (st.state === "needs_login" || (stoppedSince !== null && stoppedSince === (st.since ?? null)));
  async function stopMirrorOnLoginLoss() {
    if (!mirrorSwitchLast) return; // once: a success sets it false, and no pass reads it again while logged out
    const t = now();
    let stopped;
    try { stopped = await evidence.stopMirror("login_lost", null, mirrorOnSince !== null ? new Date(mirrorOnSince).toISOString() : null, null); }
    catch {
      if (t - loginStopFailAt > 60_000) { loginStopFailAt = t; say(`${TAG} mirror self-stop rule=login_lost write_failed`); }
      return;
    }
    mirrorSwitchLast = false; mirrorOnLast = false; mirrorOnSince = null; lastHealthAt = 0; silentSince = null;
    say(`${TAG} mirror self-stop rule=login_lost ${stopped ? "switched_off" : "already_off"}`);
  }

  async function tickEvidence(floor = 0) {
    // no check request while not connected / stopped / paused (memory only; the one exception: the mirror
    // login_lost stop above, a single write while the mirror switch was on)
    const st = pc711 && typeof pc711.status === "function" ? pc711.status() : null;
    // logged out of 7-11, but the kept E-Map session still answers → the pass runs as when connected (store
    // checks through the kept session, phone checks need no login). Once that session no longer answers,
    // the lines below apply exactly as before (mirror off once, no check until the next connect).
    const kept = Boolean(st) && st.state === "needs_login" && keptSession();
    if (!kept) {
      if (loginLost(st)) await stopMirrorOnLoginLoss();
      if (!st || st.state !== "connected") return { skipped: "not_connected" };
      if (stoppedSince !== null && stoppedSince === (st.since ?? null)) return { skipped: "stopped" };
    }
    stoppedSince = null;
    const t = now();
    if (pausedUntil > t) return { skipped: "paused" };
    // parcels answered before the last hand-back were answered by this server itself: not compared
    const since = new Date(Math.max(t - SHADOW_LOOKBACK_MS, Number(floor) || 0)).toISOString();
    const mirrorAllowed = !inShadowMaint(t);
    // the ONE request of an idle pass: the shadow switch comes back in it (off → nothing else is read or done)
    // the self-stop's numbers ride on the same call, every 10 min of mirror-on time (window: last 60 min of it)
    const healthDue = mirrorOnLast && mirrorOnSince !== null && t - mirrorOnSince >= SELF_STOP_EVERY_MS && t - lastHealthAt >= SELF_STOP_EVERY_MS;
    const healthFrom = healthDue ? new Date(Math.max(t - SELF_STOP_WINDOW_MS, mirrorOnSince)).toISOString() : null;
    let p;
    try { p = await evidence.pass(since, SHADOW_FETCH_LIMIT, SHADOW_LIMIT, mirrorAllowed, healthFrom); }
    catch { if (t - lastPendingFail > 60_000) { lastPendingFail = t; say(`${TAG} pending read failed`); } return { skipped: "error" }; }
    if (!p.shadow) return { skipped: "off" };
    const d = taipeiDay(t);
    if (d.key !== day) {
      day = d.key;
      try { await db.purgeBefore(new Date(t - SHADOW_KEEP_DAYS * DAY_MS).toISOString()); } catch { /* next day */ }
      for (const k of [...dayMax.keys()]) if (k < taipeiDay(t - 3 * DAY_MS).key) dayMax.delete(k);
    }
    mirrorSwitchLast = Boolean(p.mirror);
    let mirrorOn = p.mirror && mirrorAllowed;
    if (mirrorOn !== mirrorOnLast) {
      mirrorOnLast = mirrorOn; say(`${TAG} mirror=${mirrorOn ? 1 : 0}`);
      mirrorOnSince = mirrorOn ? t : null; lastHealthAt = 0; if (!mirrorOn) silentSince = null;
    }
    if (mirrorOn && p.health) {
      lastHealthAt = t;
      const dec = selfStopDecision(p.health, t);
      silentSince = dec.silentSince;
      if (dec.stop) {
        let stopped = false;
        try { stopped = await evidence.stopMirror(dec.rule, dec.value, healthFrom, dec.checked); } catch { stopped = false; }
        say(`${TAG} mirror self-stop rule=${dec.rule} value=${dec.value} parcels=${dec.checked} ${stopped ? "switched_off" : "write_failed"}`);
        if (stopped) { mirrorOn = false; mirrorOnLast = false; mirrorOnSince = null; mirrorSwitchLast = false; }
      }
    }
    await noteWaiting(p.waiting, t);
    for (const [k, b] of backoff) if (t - b.seenAt > SHADOW_LOOKBACK_MS) backoff.delete(k); // gone for 6 h (the extension's rule)
    for (const [k, f] of saveFails) if (t - f.seenAt > SHADOW_LOOKBACK_MS) saveFails.delete(k);
    await pairMirror(t, p.awaiting);
    let checked = 0;
    let budget = SHADOW_LIMIT;
    // 1. re-asks that are due
    for (const x of p.reasks) {
      if (budget <= 0) break;
      if (saveBlocked(`reask:${x.id}`, t)) continue;
      budget -= 1; checked += 1;
      const out = await runReask(x, st, t);
      if (out !== "next") return { checked, waiting: p.waiting, stopped: out };
    }
    // 2 + 3 with the kept E-Map session: the extension's row loop, keepalive and recovery
    if (emap) return { checked: checked + await runRowsExt(st, t, p, mirrorOn, budget), waiting: p.waiting };
    // 2. mirror: parcels still waiting for the extension
    if (mirrorOn && budget > 0 && p.mirrorQueue) {
      const mall = evidenceJobs(p.mirrorQueue.jobs, "mirror");
      for (const j of mall) { const b = backoff.get(`m:${j.scanId}:${j.kind}`); if (b) b.seenAt = t; }
      const mjobs = mall.filter((j) => { const b = backoff.get(`m:${j.scanId}:${j.kind}`); return !(b && t < b.nextAt) && !saveBlocked(jobKey(j), t); }).slice(0, budget);
      for (const job of mjobs) {
        budget -= 1; checked += 1;
        const out = await runJob(job, st, t, p.mirrorQueue.waiting);
        if (out === "stop" || out === "pause") return { checked, waiting: p.waiting };
      }
    }
    // 3. after-mode: parcels the extension already answered
    const all = evidenceJobs(p.jobs, "after").filter((j) => !saveBlocked(jobKey(j), t));
    for (const j of all) { const b = backoff.get(`${j.scanId}:${j.kind}`); if (b) b.seenAt = t; }
    for (const job of selectJobs(all, backoff, t, budget)) {
      checked += 1;
      const out = await runJob(job, st, t, p.waiting);
      if (out === "stop" || out === "pause") break;
    }
    return { checked, waiting: p.waiting };
  }

  // The extension's pass (chrome-extension/background.js pcRunOnce, multi-seller lane): pick the E-Map tab
  // (a session without a guid = one miss), the row loop (pcPollMulti: ≤ 5 parcels, the store half then the
  // phone half, 2 s after each parcel), the frozen kick (frozen-check.js: ≤ 1 frozen request), the keepalive
  // (pcEmapKeepalive), then pcRefreshTabStatus (the recovery GET, the re-open). Returns the checks made.
  const frozenStoreAt = new Map();               // frozen-check.js st.storeAt: store → its last frozen request
  let frozenPauseUntil = 0;                      // frozen-check.js st.pauseUntil
  let loginSince;                                // the saved 7-11 login's `since` this job last saw
  // the open tries (server/pc711Emap.js refresh) go through the safety brake, like every other 7-11 request
  const openHooks = {
    onOpenOk: () => { streak = 0; },
    onOpenFail: async (info) => {
      lastEnd = now();
      const step = STEP_NAMES.includes(info.step) ? info.step : "store.cart";
      return brakeAfter({ fail_http: Number(info.http) || 0, fail_reason: failReasonOf(info.kind), fail_step: step }, "store");
    },
  };
  async function runRowsExt(st, t, p, mirrorOn, budget) {
    if (st.since !== loginSince) { loginSince = st.since; try { emap.onLogin(); } catch { /* never stops the pass */ } }
    const rowsAt = now();                          // the extension's `now` of pcPollMulti (store waits start here)
    const inMaint = inShadowMaint(rowsAt);
    try { emap.pick(inMaint); } catch { /* never stops the pass */ }
    const mall = mirrorOn && p.mirrorQueue ? evidenceJobs(p.mirrorQueue.jobs, "mirror") : [];
    const aall = evidenceJobs(p.jobs, "after");
    // pcEv.lastAnyNeedStore: any pending parcel needs the store half (in backoff or not)
    const anyNeedStore = [...mall, ...aall].some((j) => j.kind === "store");
    const keyOf = (j) => `${j.mode === "mirror" ? "m:" : ""}${j.scanId}:${j.kind}`;
    for (const j of [...mall, ...aall]) { const b = backoff.get(keyOf(j)); if (b) b.seenAt = t; }
    // frozen parcels are NOT rows: the extension's frozen lane is its own kick after the rows
    const rows = rowsOf([
      ...mall.map((job) => ({ job, queued: p.mirrorQueue ? p.mirrorQueue.waiting : 0 })),
      ...aall.filter((job) => job.kind !== "frozen").map((job) => ({ job, queued: p.waiting })),
    ]);
    const frozenJobs = aall.filter((job) => job.kind === "frozen");
    let processed = 0, checked = 0;
    let stalled = false;                           // stalledGms: the server sends every phone check with ONE shop
    const storeExt = (job) => ({
      ask: async () => {
        const t0 = now();
        let r;
        try { r = await emap.checkStore(job.input.storeId); } catch { r = null; }
        if (!r || typeof r !== "object") r = { verdict: "unknown", http: 0, ms: now() - t0, kind: "threw", steps: [], transient: false };
        lastEnd = now();
        return { r: { ...r, ms: Number(r.ms) || lastEnd - t0, loggedOut: false }, t0, end: lastEnd, loggedOut: false };
      },
      maint: inMaint,
      // the store half waits from the pass start (pcPollMulti `now`)
      base: () => rowsAt,
      delay: (fails) => storeBackoffDelay(fails),
      // the store half is E-Map evidence (pcEmapVerdict / pcEmapMiss, once per verdict generation)
      onAnswer: () => emap.verdict(),
      onMiss: (b, r) => {
        if (!r.transient && b.countedGen !== emap.gen()) { emap.miss(`store: ${r.kind || "no_answer"}`, false, inMaint); b.countedGen = emap.gen(); }
      },
    });
    const phoneExt = (job, b) => ({
      ask: () => ask({ ...job.input, tokenMs: SHADOW_PHONE_TOKEN_MS, tokenRetry: !inMaint && (!b || b.fails < SHADOW_PHONE_TOKEN_RETRY_FAILS) }, false),
      maint: inMaint,
      base: (end) => end,                          // from the END of this attempt
      delay: (fails, r) => phoneBackoffDelay(fails, r),
      onAnswer: null, onMiss: null,
    });
    for (const row of rows) {
      if (processed >= budget) break;
      const sj = row.store && row.store.job, pj = row.phone && row.phone.job;
      const sb = sj ? backoff.get(keyOf(sj)) : null;
      const pb = pj ? backoff.get(keyOf(pj)) : null;
      const doStore = Boolean(sj) && emap.usable() && !(sb && rowsAt < sb.nextAt) && !saveBlocked(jobKey(sj), t);
      const doPhone = Boolean(pj) && !stalled && !(pb && now() < pb.nextAt) && !saveBlocked(jobKey(pj), t);
      if (!doStore && !doPhone) continue;
      processed += 1;
      // Jeff 2026-11-18 (speed): with a phone half to do, the store half's answer is saved AFTER the phone
      // check (right after its request, before the phone's own rows) — the phone no longer waits for a save.
      // The checks themselves, their order and the 2 s after the parcel are unchanged.
      const storeSaves = doStore && doPhone ? [] : null;
      const saveStore = async () => { while (storeSaves && storeSaves.length) { const save = storeSaves.shift(); try { await save(); } catch { /* the next pass tries again */ } } };
      if (doStore) {
        checked += 1;
        const out = await runJob(sj, st, t, row.store.queued, storeExt(sj), storeSaves);
        if (out === "stop" || out === "pause") { await saveStore(); return checked; }
      }
      if (doPhone) {
        checked += 1;
        let noAnswer = false;
        const ext = phoneExt(pj, pb);
        const inner = ext.ask;
        ext.ask = async () => {
          let x;
          try { x = await inner(); } finally { await saveStore(); }
          noAnswer = !x.loggedOut && phoneNoAnswer(x.r) && x.r.verdict !== "ok" && x.r.verdict !== "restricted";
          return x;
        };
        let out;
        try { out = await runJob(pj, st, t, row.phone.queued, ext); } finally { await saveStore(); }
        if (noAnswer) stalled = true;
        if (out === "stop" || out === "pause") return checked;
      }
      await sleep(SHADOW_ROW_GAP_MS);              // PC_ROW_GAP_MS after each parcel
      lastEnd = now();
    }
    // the frozen kick (frozen-check.js sendOne): at most ONE frozen request a pass, a store at most once per
    // 10 min (from the request, answered or not), none for 10 min after a slow / missing answer by day
    const fAt = now();
    for (const [k, at] of frozenStoreAt) if (fAt - at >= SHADOW_FROZEN_STORE_GAP_MS) frozenStoreAt.delete(k);
    const fj = emap.usable() && fAt >= frozenPauseUntil ? frozenJobs.find((j) => {
      const b = backoff.get(keyOf(j));
      return !(b && fAt < b.nextAt) && !saveBlocked(jobKey(j), t) && !frozenStoreAt.has(String(j.input.storeId));
    }) : null;
    if (fj) {
      checked += 1;
      const reqAt = now();
      frozenStoreAt.set(String(fj.input.storeId), reqAt);    // the floor starts at the request
      let slow = false;
      const out = await runJob(fj, st, t, p.waiting, {
        ask: async () => {
          const t0 = now();
          let r;
          try { r = await emap.checkFrozen(fj.input.storeId); } catch { r = null; }
          if (!r || typeof r !== "object") r = { verdict: "unknown", http: 0, ms: now() - t0, kind: "threw", steps: [], transient: true };
          slow = Boolean(r.transient);                       // frozen-check.js slowAnswer: no reply / timeout / network / 5xx
          lastEnd = now();
          return { r: { ...r, ms: Number(r.ms) || lastEnd - t0, loggedOut: false }, t0, end: lastEnd, loggedOut: false };
        },
        maint: inMaint,
        base: () => reqAt,
        delay: () => SHADOW_FROZEN_STORE_GAP_MS,             // the parcel comes back when its store may be asked again
        onAnswer: null, onMiss: null,
      });
      if (slow && !inMaint) frozenPauseUntil = now() + SHADOW_FROZEN_SLOW_PAUSE_MS; // the night never pauses (1.18.2)
      if (out === "stop" || out === "pause") return checked;
    }
    try { await emap.keepalive(anyNeedStore, inShadowMaint(now())); } catch { /* never stops the pass */ }
    try { await emap.refresh(inShadowMaint(now()), openHooks); } catch { /* never stops the pass */ }
    return checked;
  }

  async function tick() {
    if (running) return { skipped: "running" };
    running = true;
    try {
      if (typeof passStart === "function") { try { passStart(); } catch { /* never stops the pass */ } }
      let floor = 0;
      if (backup) {
        let d = null;
        try { d = await backup.tick(); } catch { d = null; }
        if (d && d.onDuty) return { duty: true, checked: d.checked ?? 0 };
        floor = (d && Number(d.floor)) || 0;
      }
      if (evidence) return await tickEvidence(floor);
      let on = "";
      try { on = String((await readSetting(SHADOW_SWITCH)) ?? ""); } catch { on = ""; }
      if (on !== "true") return { skipped: "off" };
      const st = pc711 && typeof pc711.status === "function" ? pc711.status() : null;
      if (!st || st.state !== "connected") return { skipped: "not_connected" };
      if (stoppedSince !== null && stoppedSince === (st.since ?? null)) return { skipped: "stopped" };
      stoppedSince = null;
      const t = now();
      if (pausedUntil > t) return { skipped: "paused" };
      const d = taipeiDay(t);
      if (d.key !== day) {
        day = d.key;
        try { await db.purgeBefore(new Date(t - SHADOW_KEEP_DAYS * DAY_MS).toISOString()); } catch { /* next day */ }
        for (const k of [...dayMax.keys()]) if (k < taipeiDay(t - 3 * DAY_MS).key) dayMax.delete(k);
      }
      let q;
      try { q = await db.pending(new Date(t - SHADOW_LOOKBACK_MS).toISOString(), SHADOW_FETCH_LIMIT); }
      catch { if (t - lastPendingFail > 60_000) { lastPendingFail = t; say(`${TAG} pending read failed`); } return { skipped: "error" }; }
      await noteWaiting(q.waiting, t);
      for (const [k, b] of backoff) if (t - b.seenAt > SHADOW_LOOKBACK_MS) backoff.delete(k); // gone for 6 h (the extension's rule)
      const all = jobsFromPending(q.jobs);
      for (const j of all) { const b = backoff.get(`${j.scanId}:${j.kind}`); if (b) b.seenAt = t; }
      const jobs = selectJobs(all, backoff, t, SHADOW_LIMIT);
      let checked = 0;
      for (const job of jobs) {
        checked += 1;
        const out = await runJob(job, st, t, q.waiting);
        if (out === "stop" || out === "pause") break;
      }
      return { checked, waiting: q.waiting };
    } catch {
      return { skipped: "error" };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    // a self-scheduling loop like the extension's: the next pass 5 s after this one finished
    start(setTimeoutImpl = setTimeout) {
      if (timer) return timer;
      stopped = false;
      const loop = () => { timer = setTimeoutImpl(() => { void tick().finally(() => { if (!stopped) loop(); }); }, SHADOW_POLL_MS); if (timer && typeof timer.unref === "function") timer.unref(); };
      loop();
      return timer;
    },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; },
    /** What Admin sees (no data): the brake, the last Waiting, today's max. */
    state: () => ({ pausedUntil: pausedUntil > now() ? pausedUntil : null, waiting, waitingAt: waitingAt || null, dayMax: Object.fromEntries(dayMax),
      selfStop: { silentSince, lastCheckAt: lastHealthAt ? new Date(lastHealthAt).toISOString() : null } }),
    _state: () => ({ day, stoppedSince, lastEnd, streak, pausedUntil, backoff: new Map(backoff) }),
    /** the kept E-Map session's state (words and counts only) */
    emapState: () => (emap ? emap.state() : null),
  };
}

// ── Admin reads (behind requireAuth + requireAdmin; service role) ─────────────
/** The safety brake's pause row (fail_reason paused_http): counted only under "paused", never as an error. */
const isPauseRow = (x) => x.fail_reason === "paused_http";
/** A server error row (no real answer). A frozen ext_unknown row and a pause row are match NULL too, but NOT errors. */
const isErrorRow = (x) => (x.match === null || x.match === undefined) && Boolean(x.fail_reason) && !isPauseRow(x);
/** Totals of a set of rows: compared (match true+false), match % over those, errors per kind,
 *  server avg ms (real answers only), errors by step. Frozen ext_unknown rows are not counted. */
export function totalsOf(rows) {
  const part = (kind) => {
    const r = rows.filter((x) => x.kind === kind);
    const yes = r.filter((x) => x.match === true).length;
    const no = r.filter((x) => x.match === false).length;
    return { n: yes + no, matchPct: yes + no ? Math.round((yes * 100) / (yes + no)) : null, errors: r.filter(isErrorRow).length };
  };
  const real = rows.filter((x) => x.match === true || x.match === false);
  const ms = real.map((x) => Number(x.srv_ms)).filter((x) => Number.isFinite(x) && x >= 0);
  const yes = real.filter((x) => x.match === true).length;
  const byStep = {};
  for (const x of rows) if (isErrorRow(x)) { const k = x.fail_step || "-"; byStep[k] = (byStep[k] || 0) + 1; }
  return {
    n: rows.length, compared: real.length, matchPct: real.length ? Math.round((yes * 100) / real.length) : null,
    errors: rows.filter(isErrorRow).length, paused: rows.filter(isPauseRow).length,
    store: part("store"), phone: part("phone"), frozen: part("frozen"),
    avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null, errorsByStep: byStep,
  };
}

/** The day window: today | yesterday | 2days | 7days | 30days (Taipei days). */
export function dayWindow(which, nowMs) {
  const today = taipeiDay(nowMs).startMs;
  const end = nowMs + 1;
  if (which === "yesterday") return { from: today - DAY_MS, to: today };
  if (which === "2days") return { from: today - 2 * DAY_MS, to: today - DAY_MS };
  if (which === "7days") return { from: today - 6 * DAY_MS, to: end };
  if (which === "30days") return { from: nowMs - SHADOW_KEEP_DAYS * DAY_MS, to: end };
  return { from: today, to: end };
}

/** Admin's Shadow block: today's totals + Waiting (a fresh count, sql/162) + the brake + the last 3
 *  Taipei days (checked · match % · errors · max Waiting). `state` = the running job's state(). */
export async function shadowSummary(db, readSetting, nowMs = Date.now(), state = null) {
  let enabled = false;
  try { enabled = String((await readSetting(SHADOW_SWITCH)) ?? "") === "true"; } catch { enabled = false; }
  const d = taipeiDay(nowMs);
  const from3 = d.startMs - 2 * DAY_MS;
  const rows = await db.rowsBetween(new Date(from3).toISOString(), new Date(nowMs + 1).toISOString());
  const today = totalsOf(rows.filter((x) => Date.parse(x.at) >= d.startMs));
  let waiting = null;
  try { waiting = (await db.pending(new Date(nowMs - SHADOW_LOOKBACK_MS).toISOString(), 0)).waiting; } catch { waiting = state && Number.isFinite(state.waiting) ? state.waiting : null; }
  const keys = [0, 1, 2].map((i) => taipeiDay(d.startMs - i * DAY_MS).key);
  let stored = {};
  try { stored = await db.dayMax(keys); } catch { stored = {}; }
  const mem = (state && state.dayMax) || {};
  const days = keys.map((key, i) => {
    const start = d.startMs - i * DAY_MS;
    const t = totalsOf(rows.filter((x) => { const a = Date.parse(x.at); return a >= start && a < start + DAY_MS; }));
    const max = Math.max(Number(stored[key]) || 0, Number(mem[key]) || 0, i === 0 && Number.isFinite(waiting) ? waiting : 0);
    return { day: key, checked: t.n - t.paused, matchPct: t.matchPct, errors: t.errors, maxWaiting: max };
  });
  const pausedUntil = state && state.pausedUntil && state.pausedUntil > nowMs ? new Date(state.pausedUntil).toISOString() : null;
  return { enabled, today, waiting, pausedUntil, days };
}

/** One page of history (newest first) + the totals of every Taipei day on that page. */
export async function shadowHistory(db, { day = "today", filter = "all", page = 0, kind = "all" } = {}, nowMs = Date.now()) {
  const which = ["today", "yesterday", "2days", "7days", "30days"].includes(day) ? day : "today";
  const f = ["all", "mismatch", "error"].includes(filter) ? filter : "all";
  const k = KINDS.includes(kind) ? kind : "all";
  const p = Math.max(0, Math.min(1000, Math.floor(Number(page) || 0)));
  const w = dayWindow(which, nowMs);
  const got = await db.history(new Date(w.from).toISOString(), new Date(w.to).toISOString(), f, p, k);
  const more = got.length > SHADOW_PAGE;
  const rows = got.slice(0, SHADOW_PAGE).map((x) => ({
    at: x.at, kind: KINDS.includes(x.kind) ? x.kind : "store",
    result: x.match === true ? "match" : x.match === false ? "mismatch" : x.fail_reason ? "error" : "ext_unknown",
    ext: toExtWord(x.kind, x.ext_verdict), srv: toExtWord(x.kind, x.srv_verdict), raw: RAW_WORDS.includes(x.raw) ? x.raw : null,
    gapS: Number.isFinite(Number(x.gap_s)) && x.gap_s !== null ? Number(x.gap_s) : null,
    failStep: x.fail_step ? String(x.fail_step).slice(0, 24) : null, failHttp: x.fail_http ?? null,
    failReason: noteWord(x.fail_reason), ms: Number(x.srv_ms) || 0, steps: safeSteps((x.steps || []).map((y) => ({ step: y.s, http: y.http, ms: y.ms, ok: y.ok, note: y.w || "" }))),
  }));
  // per-day totals (compared · match % · errors) for the Taipei days on this page
  const days = {};
  if (rows.length) {
    const keys = [...new Set(rows.map((r) => taipeiDay(Date.parse(r.at)).key))];
    const oldest = taipeiDay(Math.min(...rows.map((r) => Date.parse(r.at)))).startMs;
    const newest = taipeiDay(Math.max(...rows.map((r) => Date.parse(r.at)))).startMs + DAY_MS;
    const all = await db.rowsBetween(new Date(oldest).toISOString(), new Date(newest).toISOString());
    for (const k of keys) {
      const t = totalsOf(all.filter((x) => taipeiDay(Date.parse(x.at)).key === k));
      days[k] = { compared: t.compared, matchPct: t.matchPct, errors: t.errors };
    }
  }
  return { day: which, filter: f, kind: k, page: p, more, rows, days };
}
