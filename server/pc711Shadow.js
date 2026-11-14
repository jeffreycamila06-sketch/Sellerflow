// 7-11 server checker SHADOW (Jeff 2026-11-14). Proves the server gives the SAME answer as the
// Chrome extension, on REAL parcels, without changing anything a seller sees:
//   every 20 s, up to 3 parcels the extension checked in the last 30 min (store_full_at /
//   phone_check_at) and not compared yet for that kind → the server checks them with the SAME
//   inputs (store id → the store chain; phone + name + store → the phone check) using the saved
//   7-11 login, maps its answer to the extension's words and writes ONE pc711_shadow row.
// Every error and every mismatch says EXACTLY where it happened (fail_step / fail_http /
// fail_reason, every step with http + ms + ok, the raw answer word, the gap since the extension's
// check) so nothing has to be guessed later. A server error is NOT a mismatch (match NULL).
// Never writes parcel_scans (the db adapter has no way to). Never POSTs /cart/finish (the probe's
// URL allowlist refuses it). One check at a time, ≥ 3 s between checks, ≤ 300 checks a Taipei day;
// 01–05 Taipei keeps running (only a maint marker in the log). On needs_login it stops until the
// next connect (no re-login loop: the probe's ONE quick re-login and pc711Login's limits apply).
// Log, one line per check: [PC711_SHADOW] kind=… match=1|0|err step=… http=… ms=… gap=… — no data.
import { isMaintWindow } from "./pcServerProbe.js";

export const SHADOW_TICK_MS = 20_000;
export const SHADOW_BATCH = 3;
export const SHADOW_GAP_MS = 3_000;
export const SHADOW_DAY_MAX = 300;
export const SHADOW_LOOKBACK_MS = 30 * 60 * 1000;
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

// Parcels to compare: the extension's verdict written in the last 30 min, newest first, with no
// pc711_shadow row for that kind. → [{ scanId, kind, ext, at, input }]. Pure (rows in, jobs out).
export function pickJobs(scans, done, sinceMs, limit = SHADOW_BATCH) {
  const seen = new Set((done || []).map((d) => `${d.scan_id}:${d.kind}`));
  const jobs = [];
  for (const r of scans || []) {
    const storeAt = Date.parse(r.store_full_at || "");
    const phoneAt = Date.parse(r.phone_check_at || "");
    if (r.store_full_status && Number.isFinite(storeAt) && storeAt >= sinceMs && !seen.has(`${r.id}:store`)) {
      jobs.push({ scanId: r.id, kind: "store", ext: toExtWord("store", r.store_full_status), at: storeAt, input: { kind: "store", storeId: String(r.store_id ?? "") } });
    }
    if (r.phone_check_status && Number.isFinite(phoneAt) && phoneAt >= sinceMs && !seen.has(`${r.id}:phone`)) {
      jobs.push({ scanId: r.id, kind: "phone", ext: toExtWord("phone", r.phone_check_status), at: phoneAt, input: { kind: "phone", phone: String(r.phone ?? ""), name: String(r.customer_name ?? ""), storeId: String(r.store_id ?? "") } });
    }
    const frozenAt = Date.parse(r.frozen_store_checked_at || "");
    if (r.frozen_store_status && Number.isFinite(frozenAt) && frozenAt >= sinceMs && !seen.has(`${r.id}:frozen`)) {
      jobs.push({ scanId: r.id, kind: "frozen", ext: toExtWord("frozen", r.frozen_store_status), at: frozenAt, input: { kind: "frozen", storeId: String(r.store_id ?? "") } });
    }
  }
  return jobs.sort((a, b) => b.at - a.at).slice(0, limit);
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

// The db the job uses (server.js builds it on the service-role client). It can READ parcel_scans
// and read/write pc711_shadow — and nothing else.
const HISTORY_COLS = "at,kind,ext_verdict,srv_verdict,raw,gap_s,match,note,fail_step,fail_http,fail_reason,srv_ms,steps";
export function createShadowDb(sb) {
  return {
    // Newest first: one read per kind (store / phone / frozen verdicts in the window, each newest 30),
    // merged by id — so a busy day never hides the latest parcels behind older ones.
    async recentScans(sinceIso) {
      const cols = "id,store_id,phone,customer_name,store_full_status,store_full_at,phone_check_status,phone_check_at,frozen_store_status,frozen_store_checked_at";
      const reads = await Promise.all(["store_full_at", "phone_check_at", "frozen_store_checked_at"].map((col) =>
        sb.from("parcel_scans").select(cols).gte(col, sinceIso).order(col, { ascending: false }).limit(30)));
      for (const r of reads) if (r.error) throw r.error;
      const byId = new Map();
      for (const r of reads.flatMap((x) => x.data || [])) if (r && !byId.has(r.id)) byId.set(r.id, r);
      return [...byId.values()];
    },
    async doneFor(ids) {
      if (!ids.length) return [];
      const { data, error } = await sb.from("pc711_shadow").select("scan_id,kind").in("scan_id", ids);
      if (error) throw error;
      return data || [];
    },
    async insert(row) {
      const { error } = await sb.from("pc711_shadow").upsert(row, { onConflict: "scan_id,kind", ignoreDuplicates: true });
      if (error) throw error;
    },
    async countSince(sinceIso) {
      const { count, error } = await sb.from("pc711_shadow").select("id", { count: "exact", head: true }).gte("at", sinceIso);
      if (error) throw error;
      return Number(count) || 0;
    },
    async purgeBefore(beforeIso) {
      const { error } = await sb.from("pc711_shadow").delete().lt("at", beforeIso);
      if (error) throw error;
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
export function createPc711Shadow({ db, check, pc711, readSetting, now = Date.now, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let running = false;
  let lastEnd = -Infinity;     // when the last 7-11 check finished
  let day = "", used = 0;      // checks made this Taipei day
  let stoppedSince = null;     // the connect (status.since) the job stopped on (needs_login)
  let timer = null;
  const say = (line) => { try { log(line); } catch { /* a log never stops the job */ } };

  async function tick() {
    if (running) return { skipped: "running" };
    running = true;
    try {
      let on = "";
      try { on = String((await readSetting(SHADOW_SWITCH)) ?? ""); } catch { on = ""; }
      if (on !== "true") return { skipped: "off" };
      const st = pc711 && typeof pc711.status === "function" ? pc711.status() : null;
      if (!st || st.state !== "connected") return { skipped: "not_connected" };
      if (stoppedSince !== null && stoppedSince === (st.since ?? null)) return { skipped: "stopped" };
      stoppedSince = null;
      const t = now();
      const d = taipeiDay(t);
      if (d.key !== day) {
        day = d.key;
        try { used = await db.countSince(d.startIso); } catch { used = SHADOW_DAY_MAX; } // unknown → rest today
        try { await db.purgeBefore(new Date(t - SHADOW_KEEP_DAYS * DAY_MS).toISOString()); } catch { /* next day */ }
      }
      if (used >= SHADOW_DAY_MAX) return { skipped: "day_max" };
      const sinceMs = t - SHADOW_LOOKBACK_MS;
      const scans = await db.recentScans(new Date(sinceMs).toISOString());
      const done = await db.doneFor(scans.map((s) => s.id));
      const jobs = pickJobs(scans, done, sinceMs, SHADOW_BATCH);
      let checked = 0;
      for (const job of jobs) {
        if (used >= SHADOW_DAY_MAX) break;
        const wait = SHADOW_GAP_MS - (now() - lastEnd);
        if (wait > 0) await sleep(wait);
        const t0 = now();
        let r;
        try { r = await check(job.input); } catch { r = null; }
        if (!r || typeof r !== "object") r = { verdict: "unknown", http: 0, ms: now() - t0, kind: "threw", steps: [] };
        lastEnd = now();
        used += 1;
        checked += 1;
        const after = pc711 && typeof pc711.status === "function" ? pc711.status() : null;
        const loggedOut = r.kind === "login_not_accepted" || r.kind === "no_session" || Boolean(after && after.state === "needs_login");
        const row = shadowRow(job, { ...r, ms: Number(r.ms) || lastEnd - t0, loggedOut }, t0);
        try { await db.insert(row); } catch { /* the next tick tries again */ }
        say(shadowLogLine(row, isMaintWindow(lastEnd), loggedOut));
        if (loggedOut) { stoppedSince = st.since ?? null; break; }
      }
      return { checked };
    } catch {
      return { skipped: "error" };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(setIntervalImpl = setInterval) {
      if (timer) return timer;
      timer = setIntervalImpl(() => { void tick(); }, SHADOW_TICK_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
      return timer;
    },
    _state: () => ({ used, day, stoppedSince, lastEnd }),
  };
}

// ── Admin reads (behind requireAuth + requireAdmin; service role) ─────────────
/** A server error row (no real answer). A frozen ext_unknown row is match NULL too, but NOT an error. */
const isErrorRow = (x) => (x.match === null || x.match === undefined) && Boolean(x.fail_reason);
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
    errors: rows.filter(isErrorRow).length, store: part("store"), phone: part("phone"), frozen: part("frozen"),
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

export async function shadowSummary(db, readSetting, nowMs = Date.now()) {
  let enabled = false;
  try { enabled = String((await readSetting(SHADOW_SWITCH)) ?? "") === "true"; } catch { enabled = false; }
  const d = taipeiDay(nowMs);
  const today = totalsOf(await db.rowsBetween(d.startIso, new Date(nowMs + 1).toISOString()));
  return { enabled, today };
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
