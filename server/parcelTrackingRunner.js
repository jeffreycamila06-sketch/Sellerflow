// Parcel tracking — the IMPURE runner. Injects real deps (captcha GET, tesseract
// OCR, /PackageDetail POST, service-role DB) into the PURE core (parcelTracking.js).
// Called by the /admin/parcel-tracking-poll route (server.js). Kept out of the pure
// core so the parse/classify logic stays network-free + unit-tested; the runner's
// orchestration is itself tested with injected fakes (no tesseract, no network).
//
// ⚠️ SERVICE ROLE: the DB reads/writes here run as the service-role client (bypasses
// RLS). Every query filters by an EXPLICIT user_id when a poll user is configured
// (the Miners-bug lesson — never rely on RLS alone in a service query).
//
// ⚠️ TESSERACT RAM: the worker is created ONCE per run and TERMINATED at the end —
// never kept warm (Render memory). tesseract.js is a lazy dynamic import so the
// socket server never loads it until a poll actually runs.
import {
  pollBatch, parseSearchResults, buildQueryBody, isExpiredCaptcha,
  batch, MAX_BATCH, MAX_CAPTCHA_RETRIES, CAPTCHA_URL, QUERY_URL,
  SEARCH_URL, SHOPMORE_BASE, extractRequestToken,
} from "./parcelTracking.js";

// A realistic desktop UA — never a bot-looking agent (anti-block).
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// Per-request network timeout (AbortController) for the captcha GET + query POST —
// a hung SHOPMORE response must abort, not stall the single-flight poll.
const FETCH_TIMEOUT_MS = 15000;

// Wrap a fetch in an AbortController timeout. clearTimeout in finally so a fast
// response never leaves a dangling timer. On abort, undici throws (AbortError) →
// pollBatch's per-batch try/catch counts it as a batch failure + backs off.
async function fetchWithTimeout(fetchImpl, url, opts, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Read Set-Cookie off a fetch Response defensively (undici exposes getSetCookie();
// a test fake may only have get()), returning the raw cookie strings.
function rawSetCookies(res) {
  const h = res && res.headers;
  if (h && typeof h.getSetCookie === "function") { try { return h.getSetCookie() || []; } catch { /* fall through */ } }
  if (h && typeof h.get === "function") { const sc = h.get("set-cookie"); return sc ? [sc] : []; }
  return [];
}

// A tiny per-batch cookie jar: accumulates Set-Cookie `name=value` pairs across the
// search-page GET, the captcha GET, and the query POST, and emits them as a Cookie
// header. This carries the ASP.NET antiforgery/session cookie through the whole flow
// (server-side analogue of the browser + chrome-extension/myship-711.js
// `credentials: "include"`). One jar per batch so cookies never leak between batches.
function makeCookieJar() {
  const jar = new Map();
  return {
    absorb(res) {
      for (const c of rawSetCookies(res)) {
        const pair = String(c).split(";")[0].trim(); // drop Path/HttpOnly/Expires/…
        const eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    },
    header() { return Array.from(jar, ([k, v]) => `${k}=${v}`).join("; "); },
    get received() { return jar.size > 0; },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── OCR worker (tesseract.js) — created once, terminated after the run ─────────
export async function createOcr() {
  // Lazy + Vite-opaque: server.js runs on Node (Render), where tesseract.js is
  // installed; the vitest transform (which imports this module for the runner test)
  // must NOT try to resolve it — tests inject a fake ocr and never call createOcr.
  const pkg = "tesseract.js";
  const { createWorker } = await import(/* @vite-ignore */ pkg); // lazy: only when a poll runs
  const worker = await createWorker("eng");
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789", // 4-digit numeric captcha
    tessedit_pageseg_mode: "7",            // PSM 7 — single text line
  });
  return {
    solve: async (image) => {
      const b64 = String(image || "").replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      const { data } = await worker.recognize(buf);
      return (data && data.text) || "";
    },
    terminate: () => worker.terminate(),
  };
}

// ── Real network deps for pollBatch ────────────────────────────────────────────
// GET the SEARCH (index) page: capture the antiforgery cookie into the jar and
// scrape the __RequestVerificationToken hidden field. Both are required by the
// /PackageDetail POST (Razor Pages antiforgery). Returns { token }.
export async function fetchPageToken(fetchImpl = fetch, jar) {
  const res = await fetchWithTimeout(fetchImpl, SEARCH_URL, {
    headers: { "User-Agent": DESKTOP_UA, Accept: "text/html,application/xhtml+xml" },
  });
  if (jar) jar.absorb(res);
  const html = await res.text();
  return { token: extractRequestToken(html) };
}

export async function fetchCaptcha(fetchImpl = fetch, jar) {
  const headers = { "User-Agent": DESKTOP_UA, Accept: "application/json" };
  const cookie = jar && jar.header();
  if (cookie) headers.Cookie = cookie; // same session as the search page + POST
  const res = await fetchWithTimeout(fetchImpl, CAPTCHA_URL, { headers });
  if (jar) jar.absorb(res);
  const j = await res.json();
  return { captchaId: j.captchaId, image: j.image };
}

export async function submitQuery(fetchImpl, { paymentNos, captchaId, captcha, token = "" }, jar) {
  const body = buildQueryBody({ paymentNos, captchaId, captcha, token });
  const headers = {
    "User-Agent": DESKTOP_UA,
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: SHOPMORE_BASE,
    Referer: SEARCH_URL,
  };
  const cookie = jar && jar.header();
  if (cookie) headers.Cookie = cookie; // antiforgery/session cookie (fixes the empty-body 400)
  const res = await fetchWithTimeout(fetchImpl, QUERY_URL, {
    method: "POST",
    redirect: "follow",
    headers,
    body: body.toString(),
  });
  const html = await res.text();
  return { finalUrl: res.url || QUERY_URL, html };
}

// ── Daily-cap circuit breaker (per Taipei day, in the running process) ─────────
// The cron hits the LONG-RUNNING socket server (not a fresh process), so a
// module-level counter that resets on the Taipei date change is a real
// cross-invocation daily cap. A Render restart resets it (acceptable — a restart
// is rare and re-arms the cap generously).
let dailyCounter = { day: "", queries: 0 };
export function __resetDailyCounter() { dailyCounter = { day: "", queries: 0 }; }
function taipeiDay(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
// Returns true while under the cap (and counts this query); false once the cap is hit.
function underDailyCap(now, cap) {
  const d = taipeiDay(now);
  if (d !== dailyCounter.day) dailyCounter = { day: d, queries: 0 };
  dailyCounter.queries += 1;
  return dailyCounter.queries <= cap;
}

// ── The run ────────────────────────────────────────────────────────────────────
// opts: { serviceSb, userId?, fetchImpl?, ocr, now?, logger?, limits? }
//   userId  — Phase 1 = Jeff's uuid (PARCEL_POLL_USER_ID); null = all users (Phase 2).
//   ocr     — { solve(image)->digits, terminate() } from createOcr() (caller owns terminate).
// Returns a summary; never throws for a single-row/DB fault (logs + continues).
export async function runPoll(opts) {
  const {
    serviceSb, userId = null, fetchImpl = fetch, ocr,
    now = () => new Date(), logger = console, limits = {},
  } = opts;
  const {
    minGapMs = 4000, jitterMs = 3000, maxBatchesPerRun = 300,
    dailyCap = 1500, baseBackoffMs = 4000, maxBackoffMs = 60000,
  } = limits;

  // 1) SELECT live (non-terminal) rows — EXPLICIT user_id scope when configured.
  let q = serviceSb.from("parcel_tracking").select("id,user_id,tracking_no,arrived_at").eq("terminal", false);
  if (userId) q = q.eq("user_id", userId);
  const { data: rows, error } = await q;
  if (error) { logger.error("[PARCEL-POLL] select failed:", error.message); return { ok: false, error: "select_failed" }; }

  const live = (rows || []).filter((r) => r && r.tracking_no);
  const byCode = new Map(live.map((r) => [String(r.tracking_no), r]));
  const groups = batch(live.map((r) => String(r.tracking_no)), MAX_BATCH);

  let batchesRun = 0, updated = 0, unknowns = 0, notFound = 0, captchaFails = 0, backoff = 0;
  for (const group of groups) {
    if (batchesRun >= maxBatchesPerRun) { logger.warn("[PARCEL-POLL] per-run batch cap hit"); break; }
    if (!underDailyCap(now(), dailyCap)) { logger.warn("[PARCEL-POLL] daily cap hit — stopping"); break; }

    // Gentle pacing: gap + jitter (+ any backoff) BETWEEN batches, never before the first.
    if (batchesRun > 0) await sleep(minGapMs + Math.floor(Math.random() * jitterMs) + backoff);

    const jar = makeCookieJar(); // fresh session per batch (search GET → captcha GET → POST)
    const deps = {
      getPageToken: () => fetchPageToken(fetchImpl, jar),
      getCaptcha: () => fetchCaptcha(fetchImpl, jar),
      solveCaptcha: (image) => ocr.solve(image),
      submitQuery: (args) => submitQuery(fetchImpl, args, jar),
      onUnknownStatus: (m) => { unknowns += 1; logger.warn("[PARCEL-POLL] UNKNOWN status:", JSON.stringify(m)); },
    };

    let res;
    try {
      res = await pollBatch(group, deps, { maxRetries: MAX_CAPTCHA_RETRIES, now });
    } catch (e) {
      backoff = Math.min(maxBackoffMs, backoff ? backoff * 2 : baseBackoffMs);
      logger.error("[PARCEL-POLL] batch threw:", e && e.message);
      batchesRun += 1;
      continue;
    }
    batchesRun += 1;
    if (!res.ok) { captchaFails += 1; backoff = Math.min(maxBackoffMs, backoff ? backoff * 2 : baseBackoffMs); logger.warn("[PARCEL-POLL] batch captcha_failed"); continue; }
    backoff = 0; // a success clears the backoff

    for (const u of res.updates) {
      const row = byCode.get(String(u.tracking_no));
      if (!row) continue; // a code we didn't ask for — ignore
      const patch = {
        status: u.status,
        status_message: u.status_message,
        rec_store: u.rec_store,
        ship_type: u.ship_type,
        special_type: u.special_type,
        order_amount: u.order_amount,
        pickup_deadline: u.pickup_deadline,
        terminal: u.terminal,
        last_polled_at: u.last_polled_at,
      };
      // arrived_at is SET ONCE — only when the row has none yet and we now see at_store.
      if (u.arrived_at && !row.arrived_at) patch.arrived_at = u.arrived_at;
      const { error: upErr } = await serviceSb.from("parcel_tracking").update(patch).eq("id", row.id).eq("user_id", row.user_id);
      if (upErr) { logger.error("[PARCEL-POLL] update failed", row.id, upErr.message); continue; }
      updated += 1;
      if (u.status === "not_found") notFound += 1;
    }
  }

  const summary = { ok: true, rows: live.length, batchesRun, updated, unknowns, notFound, captchaFails };
  logger.log("[PARCEL-POLL] done", JSON.stringify(summary));
  return summary;
}
