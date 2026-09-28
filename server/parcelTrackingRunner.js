// Parcel tracking — the IMPURE runner. Injects real deps (captcha GET, tesseract
// OCR, /PackageDetail POST, service-role DB) into the PURE core (parcelTracking.js).
// Called by the /admin/parcel-tracking-poll route (server.js). Kept out of the pure
// core so the parse/classify logic stays network-free + unit-tested; the runner's
// orchestration is itself tested with injected fakes (no tesseract, no network).
//
// ⚠️ SERVICE ROLE: the DB reads/writes here run as the service-role client (bypasses
// RLS). Every parcel_tracking query is scoped by EXPLICIT user_id(s) — the
// parcel_tracking_access allowlist (sql/60), or the PARCEL_POLL_USER_ID emergency
// override; updates by id + user_id (the Miners-bug lesson — never rely on RLS alone).
//
// STAGE-1 SAFETY (sql/60): kill switch app_settings.parcel_tracking_enabled read at
// the start of every run; a circuit breaker (3 consecutive failed batches → abort +
// 4h cooldown in app_settings); one parcel_tracking_health row per run. Logs are
// COUNT-ONLY — never tracking codes, names, phones, handles or HTML.
//
// ⚠️ TESSERACT RAM: the worker is created ONCE per run and TERMINATED at the end —
// never kept warm (Render memory). tesseract.js is a lazy dynamic import so the
// socket server never loads it until a poll actually runs.
import {
  pollBatch, parseSearchResults, buildQueryBody, isExpiredCaptcha,
  batch, MAX_BATCH, MAX_CAPTCHA_RETRIES, CAPTCHA_URL, QUERY_URL,
  SEARCH_URL, SHOPMORE_BASE, extractRequestToken, isHttpFailure,
} from "./parcelTracking.js";

// A realistic desktop UA — never a bot-looking agent (anti-block).
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// Per-request network timeout (AbortController) for the captcha GET + query POST —
// a hung SHOPMORE response must abort, not stall the single-flight poll.
const FETCH_TIMEOUT_MS = 15000;

// Pickup Status retention: a parcel that became terminal (picked_up OR returned) stays
// visible for this long, then the poller DELETEs it. Counted from picked_up_at /
// returned_at (poll-detection time). Non-terminal rows are never matched (see runPoll).
const PICKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;    // picked_up: 7 days (unchanged)
// 2026-09-27 (owner decision): RETURNED rows keep 365 days — returns history is
// the basis for flagging repeat no-show buyers, so a 7-day window destroyed the
// evidence. picked_up stays at 7 days; nothing else purges (non-terminal rows
// can never match the delete filter, same as before).
const RETURNED_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // returned: 365 days

// Per-seller ceiling on how many NON-TERMINAL rows one poll run will chase, at_store
// prioritized (those are near the pickup deadline — the actionable ones). Bounds
// SHOPMORE load per allowlisted seller; applied AFTER the stalest-first ordering.
export const PER_SELLER_LIVE_CAP = 300;

// Keep at most `cap` non-terminal rows per user_id — at_store first, then the rest in
// the order given (the runner passes rows stalest-first). The OUTPUT keeps the INPUT
// order, so the stalest-first interleaving across sellers survives the cap (no seller
// blocks). PURE → unit-tested. Under the cap = identity.
export function capLiveRowsPerSeller(rows, cap = PER_SELLER_LIVE_CAP) {
  const list = rows || [];
  const bySeller = new Map();
  list.forEach((r, i) => {
    const k = String(r.user_id);
    if (!bySeller.has(k)) bySeller.set(k, []);
    bySeller.get(k).push({ r, i, rank: r.status === "at_store" ? 0 : 1 });
  });
  const keep = new Set();
  for (const items of bySeller.values()) {
    const kept = items.length <= cap ? items
      : [...items].sort((a, b) => (a.rank - b.rank) || (a.i - b.i)).slice(0, cap); // at_store first, stable
    for (const x of kept) keep.add(x.i);
  }
  return list.filter((_, i) => keep.has(i));
}

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
  if (isHttpFailure(res.status)) throw httpError("page", res.status); // block signal, never "no token"
  const html = await res.text();
  return { token: extractRequestToken(html) };
}

// A thrown network/HTTP fault carries a short code the runner logs + counts (never a body).
function httpError(step, status) {
  const e = new Error(`${step}_http_${status}`);
  e.code = `${step}_http_${status}`;
  return e;
}

export async function fetchCaptcha(fetchImpl = fetch, jar) {
  const headers = { "User-Agent": DESKTOP_UA, Accept: "application/json" };
  const cookie = jar && jar.header();
  if (cookie) headers.Cookie = cookie; // same session as the search page + POST
  const res = await fetchWithTimeout(fetchImpl, CAPTCHA_URL, { headers });
  if (jar) jar.absorb(res);
  if (isHttpFailure(res.status)) throw httpError("captcha", res.status);
  let j;
  try { j = await res.json(); } catch { const e = new Error("captcha_bad_json"); e.code = "captcha_bad_json"; throw e; }
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
  return { finalUrl: res.url || QUERY_URL, html, status: res.status };
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

// ── Stage-1 gates: kill switch + circuit-breaker cooldown (app_settings) ───────
// parcel_tracking_enabled must be exactly 'true' to run (a missing row = OFF — the
// switch is opt-in). parcel_tracking_cooldown_until (ISO) is written by the circuit
// breaker; a run before it is skipped. Both are read at the START of every run, so
// flipping the switch needs no restart. A settings read error → do NOT run.
export const SETTING_ENABLED = "parcel_tracking_enabled";
export const SETTING_COOLDOWN = "parcel_tracking_cooldown_until";
export const BREAKER_FAILURES = 3;                       // consecutive failed batches → abort run
export const BREAKER_COOLDOWN_MS = 4 * 60 * 60 * 1000;   // … and skip runs for 4h
export const PAGE_SIZE = 1000;                           // paged select (never the PostgREST default cap)

// PURE — decide from the two settings values whether a run may proceed.
export function pollGateFrom({ enabled, cooldownUntil }, nowDate) {
  if (String(enabled ?? "").trim().toLowerCase() !== "true") return { run: false, reason: "disabled" };
  const until = cooldownUntil ? Date.parse(cooldownUntil) : NaN;
  if (Number.isFinite(until) && until > nowDate.getTime()) {
    return { run: false, reason: "cooldown", cooldownUntil: new Date(until).toISOString() };
  }
  return { run: true, reason: null };
}

export async function readPollGate(serviceSb, nowDate) {
  const { data, error } = await serviceSb.from("app_settings").select("key,value")
    .in("key", [SETTING_ENABLED, SETTING_COOLDOWN]);
  if (error) return { run: false, reason: "settings_read_failed" };
  const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return pollGateFrom({ enabled: map[SETTING_ENABLED], cooldownUntil: map[SETTING_COOLDOWN] }, nowDate);
}

// One row per run (incl. skips). Counts only — never codes, names or HTML. The table
// trims itself to the newest 200 (sql/60 trigger). A write error is logged, never thrown.
export async function writePollHealth(serviceSb, row, logger = console) {
  try {
    const { error } = await serviceSb.from("parcel_tracking_health").insert(row);
    if (error) logger.error("[PARCEL-POLL] health write failed:", error.code || "error");
  } catch (e) {
    logger.error("[PARCEL-POLL] health write failed:", (e && e.code) || "threw");
  }
}

// WHO to poll: the emergency override (PARCEL_POLL_USER_ID) if set, else every
// enabled row of the service-role-only allowlist (sql/60 parcel_tracking_access).
async function pollUserIds(serviceSb, userId) {
  if (userId) return { ids: [userId] };
  const { data, error } = await serviceSb.from("parcel_tracking_access").select("user_id").eq("enabled", true);
  if (error) return { error };
  return { ids: (data || []).map((r) => String(r.user_id)).filter(Boolean) };
}

// Page through ALL non-terminal rows for the given sellers, stalest first ACROSS
// sellers (last_polled_at ASC NULLS FIRST, id tiebreak for stable pages). Never relies
// on the PostgREST default row cap. Any page error → error (never a partial set).
async function selectLiveRows(serviceSb, ids, pageSize = PAGE_SIZE) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await serviceSb.from("parcel_tracking")
      .select("id,user_id,tracking_no,arrived_at,status")
      .eq("terminal", false)
      .in("user_id", ids)
      .order("last_polled_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { error };
    const page = data || [];
    out.push(...page);
    if (page.length < pageSize) return { rows: out };
  }
}

// ── The run ────────────────────────────────────────────────────────────────────
// opts: { serviceSb, userId?, fetchImpl?, ocr? | makeOcr?, now?, logger?, limits? }
//   userId  — EMERGENCY OVERRIDE (PARCEL_POLL_USER_ID): poll only this user. Unset →
//             the parcel_tracking_access allowlist (enabled rows).
//   ocr     — a caller-owned { solve, terminate } (tests), OR
//   makeOcr — a factory (server.js: createOcr); the run creates the worker only when
//             there is a batch to send and ALWAYS terminates it before returning.
// Returns a summary; never throws for a single-row/DB fault (logs + continues).
export async function runPoll(opts) {
  const {
    serviceSb, userId = null, fetchImpl = fetch, ocr: givenOcr = null, makeOcr = null,
    now = () => new Date(), logger = console, limits = {},
  } = opts;
  const {
    minGapMs = 4000, jitterMs = 3000, maxBatchesPerRun = 300,
    dailyCap = 1500, baseBackoffMs = 4000, maxBackoffMs = 60000,
    perSellerCap = PER_SELLER_LIVE_CAP, pageSize = PAGE_SIZE,
  } = limits;
  const startedAt = now();
  const t0 = Date.now();
  const finish = async (summary) => {
    const durationMs = Date.now() - t0;
    await writePollHealth(serviceSb, {
      ran_at: startedAt.toISOString(), ok: !!summary.ok, reason: summary.reason || null,
      queries: summary.batchesRun || 0, updated: summary.updated || 0,
      errors: summary.failures || 0, duration_ms: durationMs,
    }, logger);
    const out = { ...summary, durationMs };
    logger.log("[PARCEL-POLL] done", JSON.stringify(out));
    return out;
  };

  // 0) Kill switch + breaker cooldown — read at the start of EVERY run.
  const gate = await readPollGate(serviceSb, startedAt);
  if (!gate.run) {
    if (gate.reason === "disabled") logger.log("[PARCEL-POLL] disabled");
    else if (gate.reason === "cooldown") logger.warn(`[PARCEL-POLL] cooldown until ${gate.cooldownUntil} — skipping run`);
    else logger.error("[PARCEL-POLL] settings read failed — not running");
    return finish({ ok: gate.reason !== "settings_read_failed", skipped: true, reason: gate.reason });
  }

  // 1) WHO — override or allowlist. 2) WHAT — every non-terminal row, stalest first.
  const who = await pollUserIds(serviceSb, userId);
  if (who.error) { logger.error("[PARCEL-POLL] access select failed:", who.error.code || "error"); return finish({ ok: false, reason: "select_failed", error: "select_failed" }); }
  let rows = [];
  if (who.ids.length) {
    const sel = await selectLiveRows(serviceSb, who.ids, pageSize);
    if (sel.error) { logger.error("[PARCEL-POLL] select failed:", sel.error.code || "error"); return finish({ ok: false, reason: "select_failed", error: "select_failed" }); }
    rows = sel.rows;
  }

  // Per-seller cap AFTER ordering (at_store first within a seller; order preserved).
  const liveAll = rows.filter((r) => r && r.tracking_no);
  const live = capLiveRowsPerSeller(liveAll, perSellerCap);
  const capped = liveAll.length - live.length;
  if (capped > 0) logger.warn(`[PARCEL-POLL] per-seller cap: skipped ${capped} row(s) over ${perSellerCap}/seller`);
  // A code can belong to more than one seller (a shared/duplicated upload): query it
  // ONCE, update EVERY row that carries it.
  const byCode = new Map();
  for (const r of live) {
    const k = String(r.tracking_no);
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(r);
  }
  const groups = batch([...byCode.keys()], MAX_BATCH);

  let batchesRun = 0, updated = 0, unknowns = 0, notFound = 0, captchaFails = 0, failures = 0, backoff = 0;
  let consecutive = 0, tripped = false, stopReason = null;
  const failReasons = [];
  let ocr = givenOcr;
  try {
    for (const group of groups) {
      if (batchesRun >= maxBatchesPerRun) { logger.warn("[PARCEL-POLL] per-run batch cap hit"); stopReason = "run_cap"; break; }
      if (!underDailyCap(now(), dailyCap)) { logger.warn("[PARCEL-POLL] daily cap hit — stopping"); stopReason = "daily_cap"; break; }

      // Gentle pacing: gap + jitter (+ any backoff) BETWEEN batches, never before the first.
      if (batchesRun > 0) await sleep(minGapMs + Math.floor(Math.random() * jitterMs) + backoff);
      if (!ocr && makeOcr) ocr = await makeOcr(); // lazily — only when a batch is actually sent

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
        res = { ok: false, updates: [], error: (e && (e.code || (e.name === "AbortError" ? "timeout" : ""))) || "threw" };
      }
      batchesRun += 1;

      if (!res.ok) {
        failures += 1;
        consecutive += 1;
        if (res.error === "captcha_failed") captchaFails += 1;
        failReasons.push(res.error);
        backoff = Math.min(maxBackoffMs, backoff ? backoff * 2 : baseBackoffMs);
        logger.warn(`[PARCEL-POLL] batch failed: ${res.error} (${consecutive} in a row)`);
        // Rotate: stamp the attempt so this batch doesn't lead every run (the next
        // run starts with other sellers' stalest rows). Status fields untouched.
        const attemptIso = now().toISOString();
        for (const code of group) {
          for (const row of byCode.get(code) || []) {
            await serviceSb.from("parcel_tracking").update({ last_polled_at: attemptIso }).eq("id", row.id).eq("user_id", row.user_id);
          }
        }
        if (consecutive >= BREAKER_FAILURES) {
          tripped = true;
          stopReason = "circuit_open";
          const until = new Date(now().getTime() + BREAKER_COOLDOWN_MS).toISOString();
          const { error: cErr } = await serviceSb.from("app_settings")
            .upsert({ key: SETTING_COOLDOWN, value: until, updated_at: now().toISOString() }, { onConflict: "key" });
          logger.error(`[PARCEL-POLL] 🔴 CIRCUIT OPEN — ${BREAKER_FAILURES} consecutive failures (${failReasons.slice(-BREAKER_FAILURES).join(", ")}) — run aborted, no runs until ${until}${cErr ? " (cooldown write FAILED)" : ""}`);
          break;
        }
        continue;
      }
      consecutive = 0;
      backoff = 0; // a success clears the backoff

      for (const u of res.updates) {
        const targets = byCode.get(String(u.tracking_no));
        if (!targets) continue; // a code we didn't ask for — ignore
        for (const row of targets) {
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
          // Stamp the terminal transition (once — terminal rows are never re-polled) so the
          // retention pass below can age them out. u.last_polled_at = this poll's time.
          if (u.status === "picked_up") patch.picked_up_at = u.last_polled_at;
          else if (u.status === "returned") patch.returned_at = u.last_polled_at;
          const { error: upErr } = await serviceSb.from("parcel_tracking").update(patch).eq("id", row.id).eq("user_id", row.user_id);
          if (upErr) { logger.error("[PARCEL-POLL] update failed", row.id, upErr.code || "error"); continue; }
          updated += 1;
          if (u.status === "not_found") notFound += 1;
        }
      }
    }
  } finally {
    if (!givenOcr && ocr) { try { await ocr.terminate(); } catch { /* worker already gone */ } }
  }

  // 3) RETENTION — DELETE terminal parcels past their per-status window (picked_up 7d,
  //    returned 365d — see the constants), scoped to the SAME sellers this run polls.
  //    The OR filter references ONLY the two terminal states, so a non-terminal row
  //    (in_transit / at_store / created / not_found / unknown) can NEVER match; a NULL
  //    picked_up_at/returned_at never matches `.lt`. Runs every poll regardless of how
  //    the poll loop went (skipped only when nobody is on the allowlist).
  let purged = 0;
  if (who.ids.length) {
    const cutoffPicked = new Date(now().getTime() - PICKUP_RETENTION_MS).toISOString();
    const cutoffReturned = new Date(now().getTime() - RETURNED_RETENTION_MS).toISOString();
    let delQ = serviceSb.from("parcel_tracking").delete()
      .or(`and(status.eq.picked_up,picked_up_at.lt.${cutoffPicked}),and(status.eq.returned,returned_at.lt.${cutoffReturned})`)
      .select("id");
    delQ = userId ? delQ.eq("user_id", userId) : delQ.in("user_id", who.ids);
    const { data: purgedRows, error: delErr } = await delQ;
    if (delErr) logger.error("[PARCEL-POLL] retention delete failed:", delErr.code || "error");
    else purged = (purgedRows || []).length;
  }

  return finish({
    ok: !tripped, reason: stopReason, sellers: who.ids.length, rows: live.length, capped,
    batchesRun, updated, unknowns, notFound, captchaFails, failures, tripped, purged,
  });
}
