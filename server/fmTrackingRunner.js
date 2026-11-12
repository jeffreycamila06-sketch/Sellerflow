// FamilyMart (全家) tracking — the IMPURE runner: real HTTP, OCR and service-role database for the
// pure core (server/fmTracking.js). Called by the job worker (server/parcelTrackingWorker.js)
// AFTER the 7-11 check of a job, inside its own try/catch and time limit.
// The 7-11 files (parcelTracking.js, parcelTrackingRunner.js) are not edited for this.
//
// ⚠️ SERVICE ROLE: every parcel_tracking read / write carries an EXPLICIT user_id and
// carrier = 'fm'. The check never writes tracking_no.
//
// Safety, all separate from 7-11:
//   • kill switch  app_settings fm_check_enabled — exactly 'true' to run (missing row = off)
//   • who          fm_pickup_enabled = 'true', OR the seller is on the fm_pickup preview list
//                  (RPC fm_check_open_for, sql/151)
//   • breaker      3 sessions in a row that the SITE failed (HTML, http error, bad JSON, captcha never
//                  solved, timeout, another shape) — counted ACROSS jobs in app_settings
//                  fm_check_fail_streak, back to 0 at the first good session — → stop +
//                  fm_check_cooldown_until (4 hours), and the count goes back to 0.
//                  NOT counted: one parcel's unusable answer, a broken OCR, a job that was cut off.
//   • daily cap    fm_tracking_daily (sql/151), per Taipei day, checked BEFORE each session
//   • pace         one request at a time, a pause between requests and between sessions, backoff
//   • health       one parcel_tracking_health row per job, kind 'fm'
// Logs carry the user id and COUNTS only — never a parcel number, a name or a phone.
//
// ⚠️ TESSERACT RAM: the OCR worker is created only when a session is sent and terminated at the end.
import {
  runFmSession, fmUrl, fmRowChange, parseFmAnswer, isFmTrackingNo, safeWord, safeKeys, fmError,
  FM_PATHS, FM_ORIGIN, FM_EMBED_REFERER, FM_PARCELS_PER_SESSION, FM_MAX_CAPTCHA_TRIES,
} from "./fmTracking.js";
import { captchaToBmp, imageSettingsFrom, FM_CAPTCHA_IMAGE, FM_CAPTCHA_MAX_BYTES } from "./fmCaptchaImage.js";
import { writePollHealth, taipeiDay } from "./parcelTrackingRunner.js";

export const FM_TAG = "[FM-CHECK]";
export const FM_SETTING_ENABLED = "fm_check_enabled";            // the kill switch
export const FM_SETTING_COOLDOWN = "fm_check_cooldown_until";    // written by the breaker
export const FM_SETTING_PICKUP = "fm_pickup_enabled";            // 全家 open for every seller (sql/119)
export const FM_SETTING_CAPTCHA = "fm_check_captcha";            // optional JSON: picture settings without a deploy
export const FM_SETTING_STREAK = "fm_check_fail_streak";         // failed sessions in a row, across jobs

// Limits (owner, 2026-11-12).
export const FM_DAILY_REQUEST_CAP = 1500;        // every request to the 全家 site, per Taipei day
export const FM_PARCELS_PER_JOB = 60;
export const FM_JOB_MAX_MS = 8 * 60 * 1000;
export const FM_SESSION_MAX_MS = 2 * 60 * 1000;  // the longest ONE session may take (captcha + its parcels)
export const FM_BREAKER_FAILURES = 3;
export const FM_BREAKER_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const FM_REQUEST_GAP_MS = 1000;           // between two requests of one session (+ jitter)
export const FM_REQUEST_JITTER_MS = 1000;
export const FM_SESSION_GAP_MS = 4000;           // between two sessions (+ jitter, + backoff)
export const FM_SESSION_JITTER_MS = 3000;
export const FM_BASE_BACKOFF_MS = 4000;
export const FM_MAX_BACKOFF_MS = 60000;
export const FM_FETCH_TIMEOUT_MS = 15000;         // one request, from sending it to the LAST byte of its answer
export const FM_JSON_MAX_BYTES = 1024 * 1024;    // a JSON answer bigger than this is not read
export const FM_OCR_START_TIMEOUT_MS = 60000;    // starting the OCR worker
export const FM_OCR_SOLVE_TIMEOUT_MS = 20000;    // reading one captcha
export const FM_OCR_PSM = "7";                   // tesseract page mode: one text line
export const FM_PAGE_SIZE = 1000;
// The most one session can send: index + (code, picture, check) per captcha try + list + 2 per parcel.
export const fmMaxRequestsPerSession = (perSession = FM_PARCELS_PER_SESSION) => 2 + 3 * FM_MAX_CAPTCHA_TRIES + 2 * perSession;

// A realistic desktop browser — never a bot-looking agent.
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP ───────────────────────────────────────────────────────────────────────
// One request INCLUDING reading its answer: `read(res)` runs inside the same time limit, so a
// server that sends the headers and then stalls the body cannot hold the job. The limit also
// works when the transport ignores the abort signal.
async function requestWithin(fetchImpl, url, opts, read, timeoutMs = FM_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  let timer = null;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(fmError("timeout")); }, timeoutMs);
  });
  const work = (async () => {
    const res = await fetchImpl(url, { ...opts, signal: ctrl.signal });
    return read(res);
  })();
  work.catch(() => {}); // a late failure after the limit is not an unhandled rejection
  try { return await Promise.race([work, late]); } finally { clearTimeout(timer); }
}
// The body, at most `maxBytes` — more is an error and the rest is not read.
export async function readCapped(res, maxBytes, step = "answer") {
  const tooLarge = () => fmError(`${step}_too_large`);
  const declared = Number(res && res.headers && typeof res.headers.get === "function" ? res.headers.get("content-length") : NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const reader = res && res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) {
    const all = new Uint8Array(await res.arrayBuffer());
    if (all.length > maxBytes) throw tooLarge();
    return all;
  }
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { try { await reader.cancel(); } catch { /* already closed */ } throw tooLarge(); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return out;
}
function rawSetCookies(res) {
  const h = res && res.headers;
  if (h && typeof h.getSetCookie === "function") { try { return h.getSetCookie() || []; } catch { /* fall through */ } }
  if (h && typeof h.get === "function") { const sc = h.get("set-cookie"); return sc ? [sc] : []; }
  return [];
}
// ONE jar from the first request of a session to the last (ASP.NET_SessionId, cookie_*, TS*).
export function makeFmCookieJar() {
  const jar = new Map();
  return {
    absorb(res) {
      for (const c of rawSetCookies(res)) {
        const pair = String(c).split(";")[0].trim();
        const eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    },
    header() { return Array.from(jar, ([k, v]) => `${k}=${v}`).join("; "); },
    get size() { return jar.size; },
  };
}
const isHttpFailure = (status) => status != null && (Number(status) < 200 || Number(status) >= 300);
const httpFail = (step, status) => fmError(`${step}_http_${safeWord(status, 3)}`);

// The steps of one session against the real site. `send` = the (counting) fetch; `pause` runs
// before every request but the first, so requests never go out back to back.
export function fmSessionSteps({ send, jar, pause = async () => {}, solve, timeoutMs = FM_FETCH_TIMEOUT_MS }) {
  let sent = 0;
  // `read(res)` turns the answer into the value the step needs — inside the request's time limit.
  const call = async (step, url, opts, read) => {
    if (sent > 0) await pause();
    sent += 1;
    const headers = { "User-Agent": DESKTOP_UA, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8", ...opts.headers };
    const cookie = jar.header();
    if (cookie) headers.Cookie = cookie;
    return requestWithin(send, url, { redirect: "follow", ...opts, headers }, async (res) => {
      jar.absorb(res);
      if (isHttpFailure(res.status)) throw httpFail(step, res.status);
      return read(res);
    }, timeoutMs);
  };
  // A page is opened for its cookies only; its body is not needed and is dropped unread.
  const page = (step, path, referer) => call(step, fmUrl(path), { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8", Referer: referer } },
    async (res) => { try { if (res.body && typeof res.body.cancel === "function") await res.body.cancel(); } catch { /* nothing to drop */ } });
  const post = (step, path, body, refererPath) => call(step, fmUrl(path), {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01", "Content-Type": "application/json; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest", Origin: FM_ORIGIN, Referer: fmUrl(refererPath),
    },
    body: JSON.stringify(body),
  }, async (res) => {
    const txt = new TextDecoder().decode(await readCapped(res, FM_JSON_MAX_BYTES, step));
    try { return parseFmAnswer(txt); } catch (e) { throw fmError(`${step}_bad_answer`, e.detail || ""); }
  });
  return {
    openIndex: () => page("index", FM_PATHS.index, FM_EMBED_REFERER),
    getCode: async () => {
      const a = await post("code", FM_PATHS.getCode, {}, FM_PATHS.index);
      const code = typeof a.Code === "string" ? a.Code : "";
      if (!code) throw fmError("code_shape", `keys=${safeKeys(a)}`);
      return code;
    },
    getImage: (code) => call("image", `${fmUrl(FM_PATHS.codeImage)}?Code=${encodeURIComponent(code)}`,
      { headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", Referer: fmUrl(FM_PATHS.index) } },
      (res) => readCapped(res, FM_CAPTCHA_MAX_BYTES, "image")),
    solve,
    checkCode: async (digits, code) => {
      const a = await post("check", FM_PATHS.checkCode, { P_CODE: digits, P_VCODE: code }, FM_PATHS.index);
      if (!("success" in a)) throw fmError("check_shape", `keys=${safeKeys(a)}`);
      return String(a.success) === "1";
    },
    openList: () => page("list", FM_PATHS.list, fmUrl(FM_PATHS.index)),
    inquiry: (no) => post("inquiry", FM_PATHS.inquiry, { ListEC_ORDER_NO: String(no) }, FM_PATHS.list),
    detail: (no, orderNo) => post("detail", FM_PATHS.detail, { EC_ORDER_NO: String(no), RCV_USER_NAME: null, ORDER_NO: String(orderNo) }, FM_PATHS.list),
  };
}

// ── OCR (tesseract.js) — created for one job, terminated after it ──────────────
// Within `ms`, or reject with the given code. The timer never keeps the process alive.
function within(promise, ms, code) {
  Promise.resolve(promise).catch(() => {}); // a failure AFTER the limit must never be an unhandled rejection
  let timer = null;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(fmError(code)), ms); timer.unref?.(); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
// opts: { image?, psm?, logger?, createWorkerImpl?, startTimeoutMs?, solveTimeoutMs? }
//   • a picture that is not a readable captcha GIF (or is too big) is answered "" — the bytes are
//     NEVER handed to tesseract as they are
//   • the worker is created with an errorHandler, so a worker fault rejects a promise here and
//     never throws out of the library into the server
//   • starting the worker and every single read have a time limit
//   • a worker fault, a read that failed, or a read over its time limit → `dead` is true from then
//     on (every later read answers ""): the caller stops its job, this is NOT a failure of the site
export async function createFmOcr({
  image = FM_CAPTCHA_IMAGE, psm = FM_OCR_PSM, logger = console, createWorkerImpl = null,
  startTimeoutMs = FM_OCR_START_TIMEOUT_MS, solveTimeoutMs = FM_OCR_SOLVE_TIMEOUT_MS,
} = {}) {
  let create = createWorkerImpl;
  if (!create) {
    // Lazy + Vite-opaque, exactly like the 7-11 worker: tests inject createWorkerImpl and never get here.
    const pkg = "tesseract.js";
    ({ createWorker: create } = await import(/* @vite-ignore */ pkg));
  }
  let faults = 0, dead = false;
  const errorHandler = (e) => { faults += 1; dead = true; if (faults === 1) logger.warn(`${FM_TAG} OCR worker fault:`, safeWord(String((e && e.message) || e || "error").slice(0, 40), 40)); };
  const starting = (async () => {
    const w = await create("eng", 1, { errorHandler });
    await w.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: psm });
    return w;
  })();
  let worker;
  try { worker = await within(starting, startTimeoutMs, "ocr_start_timeout"); } catch (e) {
    starting.then((w) => w.terminate(), () => {}).catch(() => {}); // a late worker is not left running
    throw fmError((e && e.code) === "ocr_start_timeout" ? "ocr_start_timeout" : "ocr_start_failed");
  }
  let warned = false;
  const note = (why) => { if (!warned) { warned = true; logger.warn(`${FM_TAG} captcha picture not read (${safeWord(why)}) — answered empty, not given to OCR`); } };
  return {
    get dead() { return dead; },
    solve: async (bytes) => {
      if (dead) return "";
      let bmp;
      try { bmp = captchaToBmp(bytes, image).bmp; } catch (e) { note((e && e.code) || "error"); return ""; }
      try {
        const { data } = await within(worker.recognize(Buffer.from(bmp)), solveTimeoutMs, "ocr_solve_timeout");
        return (data && data.text) || "";
      } catch (e) {
        dead = true;
        if ((e && e.code) === "ocr_solve_timeout") logger.warn(`${FM_TAG} OCR read took over ${Math.round(solveTimeoutMs / 1000)} s — OCR given up for this job`);
        return "";
      }
    },
    terminate: async () => { try { await within(Promise.resolve(worker.terminate()), 5000, "ocr_stop_timeout"); } catch { /* gone, or stuck — nothing more to do */ } },
  };
}

// ── Gate: kill switch, breaker pause, who ──────────────────────────────────────
// PURE — the two switch values → may the 全家 check run at all?
export function fmGateFrom({ enabled, cooldownUntil }, nowDate) {
  if (String(enabled ?? "").trim().toLowerCase() !== "true") return { run: false, reason: "disabled" };
  const until = cooldownUntil ? Date.parse(cooldownUntil) : NaN;
  if (Number.isFinite(until) && until > nowDate.getTime()) return { run: false, reason: "cooldown" };
  return { run: true, reason: null };
}

// One small app_settings read; a second call (the preview list) only when the kill switch is on
// and 全家 is not open for everyone. Any read error → do not run.
export async function readFmGate(serviceSb, userId, nowDate) {
  const { data, error } = await serviceSb.from("app_settings").select("key,value")
    .in("key", [FM_SETTING_ENABLED, FM_SETTING_COOLDOWN, FM_SETTING_PICKUP, FM_SETTING_CAPTCHA, FM_SETTING_STREAK]);
  if (error) return { run: false, reason: "settings_read_failed" };
  const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const gate = fmGateFrom({ enabled: map[FM_SETTING_ENABLED], cooldownUntil: map[FM_SETTING_COOLDOWN] }, nowDate);
  if (!gate.run) return gate;
  if (String(map[FM_SETTING_PICKUP] ?? "").trim().toLowerCase() !== "true") {
    const { data: open, error: oErr } = await serviceSb.rpc("fm_check_open_for", { p_user_id: userId });
    if (oErr) return { run: false, reason: "access_read_failed" };
    if (open !== true) return { run: false, reason: "not_allowed" };
  }
  return { run: true, reason: null, image: imageSettingsFrom(map[FM_SETTING_CAPTCHA]), failStreak: fmStreakFrom(map[FM_SETTING_STREAK]) };
}

// PURE — the stored count of failed sessions in a row: a whole number 0–99, anything else 0.
export function fmStreakFrom(raw) {
  const s = String(raw ?? "").trim();
  return /^\d{1,2}$/.test(s) ? Number(s) : 0;
}
async function writeFmStreak(serviceSb, n, nowDate, logger) {
  const { error } = await serviceSb.from("app_settings")
    .upsert({ key: FM_SETTING_STREAK, value: String(n), updated_at: nowDate.toISOString() }, { onConflict: "key" });
  if (error) logger.error(`${FM_TAG} failure count write failed:`, error.code || "error");
}

// ── Daily counter (sql/151 fm_tracking_daily), per Taipei day ──────────────────
export async function readFmDaily(serviceSb, day) {
  const { data, error } = await serviceSb.from("fm_tracking_daily").select("requests,captcha_tries,captcha_hits,parcels").eq("day", day).maybeSingle();
  if (error) return { error };
  return { requests: Number(data?.requests) || 0, captchaTries: Number(data?.captcha_tries) || 0, captchaHits: Number(data?.captcha_hits) || 0, parcels: Number(data?.parcels) || 0 };
}
async function writeFmDaily(serviceSb, daily, logger) {
  const { error } = await serviceSb.from("fm_tracking_daily").upsert({
    day: daily.day, requests: daily.requests, captcha_tries: daily.captchaTries, captcha_hits: daily.captchaHits,
    parcels: daily.parcels, updated_at: new Date().toISOString(),
  }, { onConflict: "day" });
  if (error) logger.error(`${FM_TAG} daily counter write failed:`, error.code || "error");
}
// PURE — may another session start without passing the cap?
export function underFmCap(requestsSoFar, cap = FM_DAILY_REQUEST_CAP, perSession = FM_PARCELS_PER_SESSION) {
  return requestsSoFar + fmMaxRequestsPerSession(perSession) <= cap;
}

// ── Rows ───────────────────────────────────────────────────────────────────────
// The seller's 全家 rows that can be asked: not finished, with an 11-digit 寄件編號. Stalest first.
// Any page error → error (never a partial set).
export async function selectFmRows(serviceSb, userId, pageSize = FM_PAGE_SIZE) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await serviceSb.from("parcel_tracking")
      .select("id,user_id,carrier,tracking_no,arrived_at,rec_store,status,terminal,created_at,last_polled_at,pickup_deadline")
      .eq("user_id", userId).eq("carrier", "fm").eq("terminal", false)
      .order("last_polled_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { error };
    const page = data || [];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows: out.filter((r) => r && String(r.user_id) === String(userId) && r.carrier === "fm" && !r.terminal && isFmTrackingNo(r.tracking_no)) };
}

// ── The session loop ───────────────────────────────────────────────────────────
// PURE — what a finished session means for the job.
//   "ok"        no error
//   "limit"     the site stopped answering after some parcels (an inquiry error after ≥ 1 answer): that
//               is how many one captcha buys — not a failure; the rest is asked in a new session
//   "parcel"    the site KNOWS the parcel but sent steps we cannot use (detail_empty / detail_mismatch):
//               a fault of that ONE parcel — not a failure of the site, never counted by the breaker
//   "ocr"       our own OCR is broken or too slow — the job stops, not a failure of the site
//   "cancelled" the worker gave this job up (its time limit) — nothing more is sent or written
//   "failed"    the SITE failed: captcha never solved, HTML / http error, bad JSON, timeout, another shape
export function fmSessionOutcome(res) {
  if (!res.error) return "ok";
  if (res.error === "cancelled") return "cancelled";
  if (res.error === "ocr_unavailable") return "ocr";
  if (res.error === "detail_empty" || res.error === "detail_mismatch") return "parcel";
  if (res.results.length > 0 && (res.error === "inquiry_shape" || res.error === "inquiry_error")) return "limit";
  return "failed";
}

// Asks `rows` (one seller's 全家 rows, already in the order to check) session by session and
// writes each answer back by id + user_id + carrier + not-finished. Never throws for a row /
// database fault. `failStreak` = failed sessions in a row BEFORE this job (app_settings).
//   control    { cancelled, checked } — the worker sets `cancelled` when it gives the job up: checked
//              before every session, every request and every write. `checked` is kept up to date.
//   hardStopAt no session starts unless a whole session (limits.sessionMaxMs) still fits before it
export async function checkFmRows({
  serviceSb, rows, userId, daily, fetchImpl = fetch, ocr: givenOcr = null, makeOcr = null, image = FM_CAPTCHA_IMAGE,
  now = () => new Date(), logger = console, limits = {}, deadlineAt = null, sessionImpl = runFmSession, failStreak = 0,
  control = null, hardStopAt = null,
}) {
  const {
    dailyRequestCap = FM_DAILY_REQUEST_CAP, perSession: perSessionStart = FM_PARCELS_PER_SESSION,
    requestGapMs = FM_REQUEST_GAP_MS, requestJitterMs = FM_REQUEST_JITTER_MS,
    sessionGapMs = FM_SESSION_GAP_MS, sessionJitterMs = FM_SESSION_JITTER_MS,
    baseBackoffMs = FM_BASE_BACKOFF_MS, maxBackoffMs = FM_MAX_BACKOFF_MS, maxSessions = 60,
    requestTimeoutMs = FM_FETCH_TIMEOUT_MS, sessionMaxMs = FM_SESSION_MAX_MS, solveTimeoutMs = FM_OCR_SOLVE_TIMEOUT_MS,
  } = limits;
  const stats = {
    sessions: 0, checked: 0, removed: 0, notFound: 0, notShipped: 0, unknowns: 0, failures: 0, parcelFaults: 0,
    captchaTries: 0, captchaHits: 0, tripped: false, stopReason: null, sent: 0,
  };
  const cancelled = () => !!(control && control.cancelled);
  let sessionEndsAt = null; // the running session must be over by then
  const sessionFits = (ms) => sessionEndsAt == null || now().getTime() + ms <= sessionEndsAt;
  const countingFetch = (...args) => {
    if (cancelled()) throw fmError("cancelled");
    if (!sessionFits(requestTimeoutMs)) throw fmError("session_timeout");
    daily.requests += 1; stats.sent += 1;
    return fetchImpl(...args);
  };

  const byCode = new Map();
  for (const r of rows || []) {
    if (!r || String(r.user_id) !== String(userId) || !isFmTrackingNo(r.tracking_no)) continue;
    const k = String(r.tracking_no).trim();
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(r);
  }
  const queue = [...byCode.keys()];
  const retried = new Set();
  let perSession = Math.max(1, perSessionStart), consecutive = Math.max(0, Number(failStreak) || 0), backoff = 0;
  let ocr = givenOcr;
  const pause = () => sleep(requestGapMs + Math.floor(Math.random() * requestJitterMs));
  // A broken / too slow OCR ends the session at once (no more captchas are fetched for nothing).
  const solve = async (bytes) => {
    if (cancelled()) throw fmError("cancelled");
    if (ocr.dead) throw fmError("ocr_unavailable");
    if (!sessionFits(solveTimeoutMs)) throw fmError("session_timeout");
    let read;
    try { read = await ocr.solve(bytes); } catch { throw fmError("ocr_unavailable"); }
    if (ocr.dead) throw fmError("ocr_unavailable");
    return read;
  };
  // Every write of the check: this row, this seller, 全家, and still not finished.
  const mine = (q, row) => q.eq("id", row.id).eq("user_id", userId).eq("carrier", "fm").eq("terminal", false);
  const requeueOnce = (codes) => { const again = codes.filter((c) => !retried.has(c)); again.forEach((c) => retried.add(c)); queue.unshift(...again); };
  // The check time only — the status is not touched. Stops at once when the job was given up.
  const stampOnly = async (codes, nowIso) => {
    for (const code of codes) {
      for (const row of byCode.get(code) || []) {
        if (cancelled()) return;
        await mine(serviceSb.from("parcel_tracking").update({ last_polled_at: nowIso }), row);
      }
    }
  };

  try {
    job: while (queue.length) {
      if (cancelled()) { stats.stopReason = "cancelled"; break; }
      if (stats.sessions >= maxSessions) { stats.stopReason = "run_cap"; break; }
      if (deadlineAt != null && now().getTime() >= deadlineAt) { logger.warn(`${FM_TAG} time limit hit — stopping`); stats.stopReason = "time_limit"; break; }
      // Never start a session that could still be running when the worker gives the job up.
      if (hardStopAt != null && now().getTime() + sessionMaxMs > hardStopAt) { logger.warn(`${FM_TAG} not enough time left for one more session — stopping`); stats.stopReason = "time_limit"; break; }
      const today = taipeiDay(now());
      if (today !== daily.day) { // the job crossed 00:00 Taipei → the new day's counter
        await writeFmDaily(serviceSb, daily, logger);
        const r = await readFmDaily(serviceSb, today);
        Object.assign(daily, { day: today, requests: 0, captchaTries: 0, captchaHits: 0, parcels: 0 }, r.error ? {} : r);
      }
      if (!underFmCap(daily.requests, dailyRequestCap, perSession)) { logger.warn(`${FM_TAG} daily request cap hit (${daily.requests}/${dailyRequestCap}) — stopping`); stats.stopReason = "daily_cap"; break; }
      if (stats.sessions > 0) await sleep(sessionGapMs + Math.floor(Math.random() * sessionJitterMs) + backoff);
      if (cancelled()) { stats.stopReason = "cancelled"; break; }
      if (!ocr && makeOcr) {
        try { ocr = await makeOcr({ image, logger }); } catch (e) {
          logger.error(`${FM_TAG} OCR could not start (${safeWord((e && e.code) || "error", 40)}) — nothing is sent`);
          stats.stopReason = "ocr_unavailable";
          break;
        }
      }

      const group = queue.splice(0, perSession);
      const jar = makeFmCookieJar(); // one jar for the whole session
      sessionEndsAt = now().getTime() + sessionMaxMs;
      const res = await sessionImpl(group, fmSessionSteps({ send: countingFetch, jar, pause, solve, timeoutMs: requestTimeoutMs }));
      sessionEndsAt = null;
      stats.sessions += 1;
      stats.captchaTries += res.captchaTries; stats.captchaHits += res.captchaHits;
      daily.captchaTries += res.captchaTries; daily.captchaHits += res.captchaHits;
      const answered = res.results.length;
      logger.log(`${FM_TAG} session user=${userId} captcha=${res.captchaHits}/${res.captchaTries} parcels=${answered}/${group.length}${res.error ? ` error=${safeWord(res.error, 40)}${res.detail ? ` (${String(res.detail).replace(/[^A-Za-z0-9_=,.# -]/g, "").slice(0, 80)})` : ""}` : ""}`);
      if (cancelled()) { stats.stopReason = "cancelled"; break; } // given up: nothing more is written

      const nowIso = now().toISOString();
      for (const { tracking_no, result } of res.results) {
        if (result.kind === "unknown") { stats.unknowns += 1; logger.warn(`${FM_TAG} UNKNOWN step code=${safeWord(result.unknownCode, 8)} — the parcel keeps its status, add the code to FM_CODES`); }
        if (result.kind === "void_unclear") { stats.unknowns += 1; logger.warn(`${FM_TAG} step 40 together with other steps — the parcel is NOT removed and keeps its status`); }
        for (const row of byCode.get(String(tracking_no)) || []) {
          if (cancelled()) { stats.stopReason = "cancelled"; break job; }
          const change = fmRowChange(result, row, nowIso);
          const q = change.action === "delete"
            ? mine(serviceSb.from("parcel_tracking").delete(), row)
            : mine(serviceSb.from("parcel_tracking").update(change.patch), row);
          const { data, error } = await q.select("id");
          if (error) { logger.error(`${FM_TAG} row write failed:`, error.code || "error"); continue; }
          if (!(data || []).length) continue; // finished by an upload meanwhile → nothing was written
          stats.checked += 1;
          if (control) control.checked = stats.checked;
          if (change.action === "delete") { stats.removed += 1; logger.log(`${FM_TAG} removed row id=${row.id} user=${userId} (order void: only steps 01 / 40)`); }
          else if (result.kind === "not_found") stats.notFound += 1;
          else if (result.kind === "not_shipped") stats.notShipped += 1;
        }
      }
      if (cancelled()) { stats.stopReason = "cancelled"; break; }
      daily.parcels += answered;
      await writeFmDaily(serviceSb, daily, logger);

      const outcome = fmSessionOutcome(res);
      const left = group.slice(answered);
      // A broken OCR — also one that broke while its session ended another way — stops the job.
      if (outcome === "ocr" || (ocr && ocr.dead)) {
        logger.error(`${FM_TAG} OCR is not working — the 全家 check of this job stops (not counted as a failure of the site)`);
        stats.stopReason = "ocr_unavailable";
        break;
      }
      const siteWorked = async () => { // a session the site answered: failures in a row go back to 0 (also in app_settings)
        if (consecutive > 0 && !cancelled()) { consecutive = 0; await writeFmStreak(serviceSb, 0, now(), logger); }
        backoff = 0;
      };
      if (outcome === "ok" || outcome === "limit") {
        await siteWorked();
        if (outcome === "limit") {
          if (answered < perSession) { perSession = answered; logger.warn(`${FM_TAG} the site answered ${answered} parcel(s) per captcha — FM_PARCELS_PER_SESSION is too high, using ${answered} for this job`); }
          requeueOnce(left);
        }
        continue;
      }
      if (outcome === "parcel") {
        // ONE parcel's answer could not be used. Its status is left alone — only the check time is
        // written, so it does not lead every later job. Not a failure of the site: not counted.
        stats.parcelFaults += 1;
        logger.warn(`${FM_TAG} one parcel's answer could not be used (${safeWord(res.error, 20)}) — status untouched, the rest is asked again`);
        await stampOnly(left.slice(0, 1), nowIso);
        if (answered > 0) await siteWorked();
        queue.unshift(...left.slice(1)); // every parcel after it, however often this happens (the queue gets shorter each time)
        continue;
      }
      // The SITE failed: back off, count it (across jobs), stop after FM_BREAKER_FAILURES in a row.
      stats.failures += 1; consecutive += 1;
      backoff = Math.min(maxBackoffMs, backoff ? backoff * 2 : baseBackoffMs);
      const tripped = consecutive >= FM_BREAKER_FAILURES;
      if (!tripped && !cancelled()) await writeFmStreak(serviceSb, consecutive, now(), logger);
      // Nothing answered: stamp the attempt so these rows do not lead the next job. Status untouched.
      if (answered > 0) requeueOnce(left); else await stampOnly(left, nowIso);
      if (tripped) {
        stats.tripped = true; stats.stopReason = "circuit_open";
        if (cancelled()) break;
        const until = new Date(now().getTime() + FM_BREAKER_COOLDOWN_MS).toISOString();
        const { error: cErr } = await serviceSb.from("app_settings")
          .upsert({ key: FM_SETTING_COOLDOWN, value: until, updated_at: now().toISOString() }, { onConflict: "key" });
        await writeFmStreak(serviceSb, 0, now(), logger); // the pause starts a fresh count
        logger.error(`${FM_TAG} 🔴 CIRCUIT OPEN — ${consecutive} failed sessions in a row — 全家 check paused until ${until}${cErr ? " (pause write FAILED)" : ""}`);
        break;
      }
    }
  } finally {
    if (!givenOcr && ocr) { try { await ocr.terminate(); } catch { /* already gone */ } }
  }
  return stats;
}

// ── The 全家 part of ONE job ────────────────────────────────────────────────────
// Step 1 — WILL the 全家 part run for this job? One small settings read when the switch is off.
// opts: { serviceSb, job, scopeOf(rows) → { rows, capped }, now?, logger?, limits? }
// Returns { run: false, reason } or { run: true, rows, capped, image, failStreak }. NEVER throws.
export async function planFmForJob(opts) {
  const { serviceSb, job, scopeOf, now = () => new Date(), logger = console, limits = {} } = opts;
  const no = (reason) => ({ run: false, reason, rows: [], capped: false });
  try {
    const gate = await readFmGate(serviceSb, job.user_id, now());
    if (!gate.run) {
      if (gate.reason !== "disabled" && gate.reason !== "not_allowed") logger.warn(`${FM_TAG} not running user=${job.user_id}: ${gate.reason}`);
      return no(gate.reason);
    }
    const sel = await selectFmRows(serviceSb, job.user_id);
    if (sel.error) { logger.error(`${FM_TAG} select failed:`, sel.error.code || "error"); return no("select_failed"); }
    const scope = scopeOf(sel.rows);
    const rows = scope.rows.slice(0, limits.parcelsPerJob ?? FM_PARCELS_PER_JOB);
    if (!rows.length) return no("nothing_due");
    return { run: true, reason: null, rows, capped: !!scope.capped || scope.rows.length > rows.length, image: gate.image, failStreak: gate.failStreak };
  } catch (e) {
    logger.error(`${FM_TAG} plan threw job=${job.id} user=${job.user_id}:`, safeWord((e && e.code) || "threw", 40));
    return no("threw");
  }
}

// Step 2 — check the planned rows.
// opts: { serviceSb, job, plan, fetchImpl?, makeOcr?, ocr?, now?, logger?, limits?, deadlineAt?,
//         hardStopAt?, control?, checkImpl? }
// Returns { ran, reason, total, checked, failed, requests }. NEVER throws.
//   total  = 全家 parcels this job set out to ask        checked = rows that got an answer
//   failed = there was something to ask and nothing was answered
export async function runFmPlan(opts) {
  const {
    serviceSb, job, plan, fetchImpl = fetch, makeOcr = createFmOcr, ocr = null, control = null,
    now = () => new Date(), logger = console, limits = {}, deadlineAt = null, hardStopAt = null, checkImpl = checkFmRows,
  } = opts;
  const startedMs = now().getTime();
  const rows = (plan && plan.rows) || [];
  const total = rows.length;
  const cancelled = () => !!(control && control.cancelled);
  try {
    const day = taipeiDay(now());
    const d = await readFmDaily(serviceSb, day);
    let stats;
    if (d.error) {
      logger.error(`${FM_TAG} daily counter read failed:`, d.error.code || "error");
      stats = { sessions: 0, checked: 0, removed: 0, notFound: 0, notShipped: 0, unknowns: 0, failures: 0, parcelFaults: 0, captchaTries: 0, captchaHits: 0, tripped: false, stopReason: "daily_read_failed", sent: 0 };
    } else {
      const fmDeadline = startedMs + (limits.jobMaxMs ?? FM_JOB_MAX_MS);
      stats = await checkImpl({
        serviceSb, rows, userId: job.user_id, daily: { day, ...d }, fetchImpl, ocr, makeOcr, image: plan.image, failStreak: plan.failStreak,
        now, logger, limits, deadlineAt: deadlineAt == null ? fmDeadline : Math.min(deadlineAt, fmDeadline), hardStopAt, control,
      });
    }
    const failed = stats.checked === 0;
    const reason = stats.stopReason || (plan.capped ? "capped" : null);
    if (!cancelled()) {
      await writePollHealth(serviceSb, {
        ran_at: new Date(startedMs).toISOString(), ok: !stats.tripped && !failed, reason, queries: stats.sessions,
        updated: stats.checked, errors: stats.failures, duration_ms: now().getTime() - startedMs, sellers: 1,
        skipped_cap: plan.capped ? 1 : 0, retired: stats.removed, requests: stats.sent, kind: "fm", job_id: job.id,
      }, logger);
    }
    logger.log(`${FM_TAG} done job=${job.id} user=${job.user_id} kind=${job.kind} checked=${stats.checked}/${total} not_found=${stats.notFound} not_shipped=${stats.notShipped} unknown=${stats.unknowns} parcel_faults=${stats.parcelFaults || 0} removed=${stats.removed} sessions=${stats.sessions} failed_sessions=${stats.failures} captcha=${stats.captchaHits}/${stats.captchaTries} requests=${stats.sent}${reason ? ` reason=${reason}` : ""}`);
    return { ran: true, reason, total, checked: stats.checked, failed, requests: stats.sent };
  } catch (e) {
    logger.error(`${FM_TAG} threw job=${job.id} user=${job.user_id}:`, safeWord((e && e.code) || "threw", 40));
    const checked = (control && Number(control.checked)) || 0;
    return { ran: true, reason: "threw", total, checked, failed: checked === 0, requests: 0 };
  }
}

// Both steps in one call (the worker calls them separately: it has to know BEFORE it finishes the
// job whether the 全家 part will run).
export async function runFmForJob(opts) {
  const plan = await planFmForJob(opts);
  if (!plan.run) return { ran: false, reason: plan.reason, total: 0, checked: 0, failed: false, requests: 0 };
  return runFmPlan({ ...opts, plan });
}
