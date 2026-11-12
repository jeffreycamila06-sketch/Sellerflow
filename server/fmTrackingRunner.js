// FamilyMart (全家) tracking — the IMPURE runner: real HTTP, OCR and service-role database for the
// pure core (server/fmTracking.js). Called by the job worker (server/parcelTrackingWorker.js)
// AFTER the 7-11 part of a job, inside its own try/catch: nothing here can change a 7-11 result.
// The 7-11 files (parcelTracking.js, parcelTrackingRunner.js) are not edited for this.
//
// ⚠️ SERVICE ROLE: every parcel_tracking read / write carries an EXPLICIT user_id and
// carrier = 'fm'. The check never writes tracking_no.
//
// Safety, all separate from 7-11:
//   • kill switch  app_settings fm_check_enabled — exactly 'true' to run (missing row = off)
//   • who          fm_pickup_enabled = 'true', OR the seller is on the fm_pickup preview list
//                  (RPC fm_check_open_for, sql/151)
//   • breaker      3 failed sessions in a row → stop + fm_check_cooldown_until (4 hours)
//   • daily cap    fm_tracking_daily (sql/151), per Taipei day, checked BEFORE each session
//   • pace         one request at a time, a pause between requests and between sessions, backoff
//   • health       one parcel_tracking_health row per job, kind 'fm'
// Logs carry the user id and COUNTS only — never a parcel number, a name or a phone.
//
// ⚠️ TESSERACT RAM: the OCR worker is created only when a session is sent and terminated at the end.
import {
  runFmSession, fmUrl, fmRowChange, parseFmAnswer, isFmTrackingNo, safeWord, fmError,
  FM_PATHS, FM_ORIGIN, FM_EMBED_REFERER, FM_PARCELS_PER_SESSION, FM_MAX_CAPTCHA_TRIES,
} from "./fmTracking.js";
import { captchaToBmp, imageSettingsFrom, FM_CAPTCHA_IMAGE } from "./fmCaptchaImage.js";
import { writePollHealth, taipeiDay } from "./parcelTrackingRunner.js";

export const FM_TAG = "[FM-CHECK]";
export const FM_SETTING_ENABLED = "fm_check_enabled";            // the kill switch
export const FM_SETTING_COOLDOWN = "fm_check_cooldown_until";    // written by the breaker
export const FM_SETTING_PICKUP = "fm_pickup_enabled";            // 全家 open for every seller (sql/119)
export const FM_SETTING_CAPTCHA = "fm_check_captcha";            // optional JSON: picture settings without a deploy

// Limits (owner, 2026-11-12).
export const FM_DAILY_REQUEST_CAP = 1500;        // every request to the 全家 site, per Taipei day
export const FM_PARCELS_PER_JOB = 60;
export const FM_JOB_MAX_MS = 8 * 60 * 1000;
export const FM_BREAKER_FAILURES = 3;
export const FM_BREAKER_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const FM_REQUEST_GAP_MS = 1000;           // between two requests of one session (+ jitter)
export const FM_REQUEST_JITTER_MS = 1000;
export const FM_SESSION_GAP_MS = 4000;           // between two sessions (+ jitter, + backoff)
export const FM_SESSION_JITTER_MS = 3000;
export const FM_BASE_BACKOFF_MS = 4000;
export const FM_MAX_BACKOFF_MS = 60000;
export const FM_FETCH_TIMEOUT_MS = 15000;
export const FM_OCR_PSM = "7";                   // tesseract page mode: one text line
export const FM_PAGE_SIZE = 1000;
// The most one session can send: index + (code, picture, check) per captcha try + list + 2 per parcel.
export const fmMaxRequestsPerSession = (perSession = FM_PARCELS_PER_SESSION) => 2 + 3 * FM_MAX_CAPTCHA_TRIES + 2 * perSession;

// A realistic desktop browser — never a bot-looking agent.
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP ───────────────────────────────────────────────────────────────────────
async function fetchWithTimeout(fetchImpl, url, opts, timeoutMs = FM_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
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
export function fmSessionSteps({ send, jar, pause = async () => {}, solve }) {
  let sent = 0;
  const call = async (step, url, opts) => {
    if (sent > 0) await pause();
    sent += 1;
    const headers = { "User-Agent": DESKTOP_UA, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8", ...opts.headers };
    const cookie = jar.header();
    if (cookie) headers.Cookie = cookie;
    const res = await fetchWithTimeout(send, url, { redirect: "follow", ...opts, headers });
    jar.absorb(res);
    if (isHttpFailure(res.status)) throw httpFail(step, res.status);
    return res;
  };
  const page = (step, path, referer) => call(step, fmUrl(path), { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8", Referer: referer } })
    .then(async (res) => { await res.text(); });
  const post = async (step, path, body, refererPath) => {
    const res = await call(step, fmUrl(path), {
      method: "POST",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01", "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest", Origin: FM_ORIGIN, Referer: fmUrl(refererPath),
      },
      body: JSON.stringify(body),
    });
    let txt;
    try { txt = await res.text(); } catch { throw fmError(`${step}_unreadable`); }
    try { return parseFmAnswer(txt); } catch (e) { throw fmError(`${step}_bad_answer`, e.detail || ""); }
  };
  return {
    openIndex: () => page("index", FM_PATHS.index, FM_EMBED_REFERER),
    getCode: async () => {
      const a = await post("code", FM_PATHS.getCode, {}, FM_PATHS.index);
      const code = typeof a.Code === "string" ? a.Code : "";
      if (!code) throw fmError("code_shape", `keys=${Object.keys(a).slice(0, 8).map((k) => safeWord(k)).join(",")}`);
      return code;
    },
    getImage: async (code) => {
      const res = await call("image", `${fmUrl(FM_PATHS.codeImage)}?Code=${encodeURIComponent(code)}`, { headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", Referer: fmUrl(FM_PATHS.index) } });
      return new Uint8Array(await res.arrayBuffer());
    },
    solve,
    checkCode: async (digits, code) => {
      const a = await post("check", FM_PATHS.checkCode, { P_CODE: digits, P_VCODE: code }, FM_PATHS.index);
      if (!("success" in a)) throw fmError("check_shape", `keys=${Object.keys(a).slice(0, 8).map((k) => safeWord(k)).join(",")}`);
      return String(a.success) === "1";
    },
    openList: () => page("list", FM_PATHS.list, fmUrl(FM_PATHS.index)),
    inquiry: (no) => post("inquiry", FM_PATHS.inquiry, { ListEC_ORDER_NO: String(no) }, FM_PATHS.list),
    detail: (no, orderNo) => post("detail", FM_PATHS.detail, { EC_ORDER_NO: String(no), RCV_USER_NAME: null, ORDER_NO: String(orderNo) }, FM_PATHS.list),
  };
}

// ── OCR (tesseract.js) — created for one job, terminated after it ──────────────
export async function createFmOcr({ image = FM_CAPTCHA_IMAGE, psm = FM_OCR_PSM, logger = console } = {}) {
  // Lazy + Vite-opaque, exactly like the 7-11 worker: tests inject a fake and never get here.
  const pkg = "tesseract.js";
  const { createWorker } = await import(/* @vite-ignore */ pkg);
  const worker = await createWorker("eng");
  await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: psm });
  let warned = false;
  return {
    solve: async (bytes) => {
      let input;
      try { input = Buffer.from(captchaToBmp(bytes, image).bmp); } catch (e) {
        if (!warned) { warned = true; logger.warn(`${FM_TAG} captcha picture not read as a GIF (${safeWord(e && e.code)}) — given to OCR as it is`); }
        input = Buffer.from(bytes);
      }
      const { data } = await worker.recognize(input);
      return (data && data.text) || "";
    },
    terminate: () => worker.terminate(),
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
    .in("key", [FM_SETTING_ENABLED, FM_SETTING_COOLDOWN, FM_SETTING_PICKUP, FM_SETTING_CAPTCHA]);
  if (error) return { run: false, reason: "settings_read_failed" };
  const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const gate = fmGateFrom({ enabled: map[FM_SETTING_ENABLED], cooldownUntil: map[FM_SETTING_COOLDOWN] }, nowDate);
  if (!gate.run) return gate;
  if (String(map[FM_SETTING_PICKUP] ?? "").trim().toLowerCase() !== "true") {
    const { data: open, error: oErr } = await serviceSb.rpc("fm_check_open_for", { p_user_id: userId });
    if (oErr) return { run: false, reason: "access_read_failed" };
    if (open !== true) return { run: false, reason: "not_allowed" };
  }
  return { run: true, reason: null, image: imageSettingsFrom(map[FM_SETTING_CAPTCHA]) };
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
// Asks `rows` (one seller's 全家 rows, already in the order to check) session by session and
// writes each answer back by id + user_id + carrier. Never throws for a row / database fault.
export async function checkFmRows({
  serviceSb, rows, userId, daily, fetchImpl = fetch, ocr: givenOcr = null, makeOcr = null, image = FM_CAPTCHA_IMAGE,
  now = () => new Date(), logger = console, limits = {}, deadlineAt = null, sessionImpl = runFmSession,
}) {
  const {
    dailyRequestCap = FM_DAILY_REQUEST_CAP, perSession: perSessionStart = FM_PARCELS_PER_SESSION,
    requestGapMs = FM_REQUEST_GAP_MS, requestJitterMs = FM_REQUEST_JITTER_MS,
    sessionGapMs = FM_SESSION_GAP_MS, sessionJitterMs = FM_SESSION_JITTER_MS,
    baseBackoffMs = FM_BASE_BACKOFF_MS, maxBackoffMs = FM_MAX_BACKOFF_MS, maxSessions = 60,
  } = limits;
  const stats = {
    sessions: 0, checked: 0, removed: 0, notFound: 0, notShipped: 0, unknowns: 0, failures: 0,
    captchaTries: 0, captchaHits: 0, tripped: false, stopReason: null, sent: 0,
  };
  const countingFetch = (...args) => { daily.requests += 1; stats.sent += 1; return fetchImpl(...args); };

  const byCode = new Map();
  for (const r of rows || []) {
    if (!r || String(r.user_id) !== String(userId) || !isFmTrackingNo(r.tracking_no)) continue;
    const k = String(r.tracking_no).trim();
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(r);
  }
  const queue = [...byCode.keys()];
  const retried = new Set();
  let perSession = Math.max(1, perSessionStart), consecutive = 0, backoff = 0;
  let ocr = givenOcr;
  const pause = () => sleep(requestGapMs + Math.floor(Math.random() * requestJitterMs));
  const solve = async (bytes) => { try { return await ocr.solve(bytes); } catch { return ""; } };

  try {
    while (queue.length) {
      if (stats.sessions >= maxSessions) { stats.stopReason = "run_cap"; break; }
      if (deadlineAt != null && now().getTime() >= deadlineAt) { logger.warn(`${FM_TAG} time limit hit — stopping`); stats.stopReason = "time_limit"; break; }
      const today = taipeiDay(now());
      if (today !== daily.day) { // the job crossed 00:00 Taipei → the new day's counter
        await writeFmDaily(serviceSb, daily, logger);
        const r = await readFmDaily(serviceSb, today);
        Object.assign(daily, { day: today, requests: 0, captchaTries: 0, captchaHits: 0, parcels: 0 }, r.error ? {} : r);
      }
      if (!underFmCap(daily.requests, dailyRequestCap, perSession)) { logger.warn(`${FM_TAG} daily request cap hit (${daily.requests}/${dailyRequestCap}) — stopping`); stats.stopReason = "daily_cap"; break; }
      if (stats.sessions > 0) await sleep(sessionGapMs + Math.floor(Math.random() * sessionJitterMs) + backoff);
      if (!ocr && makeOcr) ocr = await makeOcr({ image, logger });

      const group = queue.splice(0, perSession);
      const jar = makeFmCookieJar(); // one jar for the whole session
      const res = await sessionImpl(group, fmSessionSteps({ send: countingFetch, jar, pause, solve }));
      stats.sessions += 1;
      stats.captchaTries += res.captchaTries; stats.captchaHits += res.captchaHits;
      daily.captchaTries += res.captchaTries; daily.captchaHits += res.captchaHits;
      const answered = res.results.length;
      logger.log(`${FM_TAG} session user=${userId} captcha=${res.captchaHits}/${res.captchaTries} parcels=${answered}/${group.length}${res.error ? ` error=${safeWord(res.error, 40)}${res.detail ? ` (${String(res.detail).replace(/[^A-Za-z0-9_=,. -]/g, "").slice(0, 80)})` : ""}` : ""}`);

      const nowIso = now().toISOString();
      for (const { tracking_no, result } of res.results) {
        if (result.kind === "unknown") { stats.unknowns += 1; logger.warn(`${FM_TAG} UNKNOWN step code=${safeWord(result.unknownCode, 8)} — the parcel is marked unknown, add the code to FM_CODES`); }
        for (const row of byCode.get(String(tracking_no)) || []) {
          const change = fmRowChange(result, row, nowIso);
          const q = change.action === "delete"
            ? serviceSb.from("parcel_tracking").delete().eq("id", row.id).eq("user_id", userId).eq("carrier", "fm")
            : serviceSb.from("parcel_tracking").update(change.patch).eq("id", row.id).eq("user_id", userId).eq("carrier", "fm");
          const { error } = await q;
          if (error) { logger.error(`${FM_TAG} row write failed:`, error.code || "error"); continue; }
          stats.checked += 1;
          if (change.action === "delete") stats.removed += 1;
          else if (result.kind === "not_found") stats.notFound += 1;
          else if (result.kind === "not_shipped") stats.notShipped += 1;
        }
      }
      daily.parcels += answered;
      await writeFmDaily(serviceSb, daily, logger);

      if (!res.error) { consecutive = 0; backoff = 0; continue; }
      const left = group.slice(answered);
      if (answered > 0) {
        // The site stopped answering after `answered` parcels: that is how many one captcha buys.
        // Ask the rest in a new session (once), and keep sessions that size for the rest of the job.
        consecutive = 0; backoff = 0;
        if (answered < perSession) { perSession = answered; logger.warn(`${FM_TAG} the site answered ${answered} parcel(s) per captcha — FM_PARCELS_PER_SESSION is too high, using ${answered} for this job`); }
        const again = left.filter((c) => !retried.has(c));
        again.forEach((c) => retried.add(c));
        queue.unshift(...again);
        continue;
      }
      // Nothing answered → a failed session: back off, stamp the attempt so these rows do not lead
      // the next job, and stop after FM_BREAKER_FAILURES in a row.
      stats.failures += 1; consecutive += 1;
      backoff = Math.min(maxBackoffMs, backoff ? backoff * 2 : baseBackoffMs);
      for (const code of left) {
        for (const row of byCode.get(code) || []) {
          await serviceSb.from("parcel_tracking").update({ last_polled_at: nowIso }).eq("id", row.id).eq("user_id", userId).eq("carrier", "fm");
        }
      }
      if (consecutive >= FM_BREAKER_FAILURES) {
        stats.tripped = true; stats.stopReason = "circuit_open";
        const until = new Date(now().getTime() + FM_BREAKER_COOLDOWN_MS).toISOString();
        const { error: cErr } = await serviceSb.from("app_settings")
          .upsert({ key: FM_SETTING_COOLDOWN, value: until, updated_at: now().toISOString() }, { onConflict: "key" });
        logger.error(`${FM_TAG} 🔴 CIRCUIT OPEN — ${FM_BREAKER_FAILURES} failed sessions in a row — 全家 check paused until ${until}${cErr ? " (pause write FAILED)" : ""}`);
        break;
      }
    }
  } finally {
    if (!givenOcr && ocr) { try { await ocr.terminate(); } catch { /* already gone */ } }
  }
  return stats;
}

// ── The 全家 part of ONE job ────────────────────────────────────────────────────
// opts: { serviceSb, job, scopeOf(rows) → { rows, capped }, fetchImpl?, makeOcr?, ocr?, now?,
//         logger?, limits?, deadlineAt?, checkImpl? }
// Returns { ran, reason, total, checked, failed, requests }. NEVER throws.
//   total  = 全家 parcels this job set out to ask        checked = rows that got an answer
//   failed = there was something to ask and nothing was answered
export async function runFmForJob(opts) {
  const {
    serviceSb, job, scopeOf, fetchImpl = fetch, makeOcr = createFmOcr, ocr = null,
    now = () => new Date(), logger = console, limits = {}, deadlineAt = null, checkImpl = checkFmRows,
  } = opts;
  const none = (reason) => ({ ran: false, reason, total: 0, checked: 0, failed: false, requests: 0 });
  const startedMs = now().getTime();
  let total = 0;
  try {
    const gate = await readFmGate(serviceSb, job.user_id, now());
    if (!gate.run) {
      if (gate.reason !== "disabled" && gate.reason !== "not_allowed") logger.warn(`${FM_TAG} not running user=${job.user_id}: ${gate.reason}`);
      return none(gate.reason);
    }
    const sel = await selectFmRows(serviceSb, job.user_id);
    if (sel.error) { logger.error(`${FM_TAG} select failed:`, sel.error.code || "error"); return none("select_failed"); }
    const scope = scopeOf(sel.rows);
    const rows = scope.rows.slice(0, limits.parcelsPerJob ?? FM_PARCELS_PER_JOB);
    total = rows.length;
    if (!total) return none("nothing_due");
    const capped = scope.capped || scope.rows.length > rows.length;

    const day = taipeiDay(now());
    const d = await readFmDaily(serviceSb, day);
    let stats;
    if (d.error) {
      logger.error(`${FM_TAG} daily counter read failed:`, d.error.code || "error");
      stats = { sessions: 0, checked: 0, removed: 0, notFound: 0, notShipped: 0, unknowns: 0, failures: 0, captchaTries: 0, captchaHits: 0, tripped: false, stopReason: "daily_read_failed", sent: 0 };
    } else {
      const fmDeadline = startedMs + (limits.jobMaxMs ?? FM_JOB_MAX_MS);
      stats = await checkImpl({
        serviceSb, rows, userId: job.user_id, daily: { day, ...d }, fetchImpl, ocr, makeOcr, image: gate.image,
        now, logger, limits, deadlineAt: deadlineAt == null ? fmDeadline : Math.min(deadlineAt, fmDeadline),
      });
    }
    const failed = stats.checked === 0;
    const reason = stats.stopReason || (capped ? "capped" : null);
    await writePollHealth(serviceSb, {
      ran_at: new Date(startedMs).toISOString(), ok: !stats.tripped && !failed, reason, queries: stats.sessions,
      updated: stats.checked, errors: stats.failures, duration_ms: now().getTime() - startedMs, sellers: 1,
      skipped_cap: capped ? 1 : 0, retired: stats.removed, requests: stats.sent, kind: "fm", job_id: job.id,
    }, logger);
    logger.log(`${FM_TAG} done job=${job.id} user=${job.user_id} kind=${job.kind} checked=${stats.checked}/${total} not_found=${stats.notFound} not_shipped=${stats.notShipped} unknown=${stats.unknowns} removed=${stats.removed} sessions=${stats.sessions} failed_sessions=${stats.failures} captcha=${stats.captchaHits}/${stats.captchaTries} requests=${stats.sent}${reason ? ` reason=${reason}` : ""}`);
    return { ran: true, reason, total, checked: stats.checked, failed, requests: stats.sent };
  } catch (e) {
    logger.error(`${FM_TAG} threw job=${job.id} user=${job.user_id}:`, safeWord((e && e.code) || "threw", 40));
    return { ran: total > 0, reason: "threw", total, checked: 0, failed: total > 0, requests: 0 };
  }
}
