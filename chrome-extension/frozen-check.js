// SellerFlow parcel-checker — FROZEN (冷凍) store check. ADD-ONLY module (1.17.0; warm-up 1.18.0).
// ════════════════════════════════════════════════════════════════════════════
// Loaded by background.js through ONE guarded importScripts line and kicked by ONE line in
// pcRunOnce. The whole module is ONE function scope: the only global it creates is
// self.pcFrozenKick (tested: no top-level name shared with background.js, no other global).
// Nothing here is awaited by the normal lane: the kick returns at once and the pass runs on
// its own promise; every call is bounded; any failure marks only THAT parcel 'unknown'.
//
// What it does, for 冷凍 parcels only (the DB picks them — dry parcels are never read here):
// POST byIDData with cate=27 (the frozen E-Map category; the normal check is cate=3) through
// its OWN content script (emap-frozen-711.js) on the E-Map tab the normal lane picked, then
// write the verdict through its OWN RPC.
//   enable → ok · disable → no_frozen (blocked from export; cached 30 days — no freezer)
//   close / NO2 / anything else / no answer → unknown (re-checked after 10 min)
//
// KILL SWITCH: app_settings 'frozen_store_check_enabled' — only the exact string 'true'
// turns it on; a read failure = off. OFF = the normal lane is byte-for-byte today's; the
// only request this module makes is ONE read-only GET of that setting per minute (plus, since
// 1.18.0, one LOCAL chrome.storage write per worker start: the warm-up popup line {on:false}).
//
// NEVER OVERLAP THE NORMAL LANE (two ways) on the shared E-Map session:
//  • the frozen E-Map request is sent ONLY right at the kick — pcRunOnce calls the kick after
//    the normal lane's rows have all finished (pcPollMulti is awaited); the next normal E-Map
//    request is at the earliest in the NEXT pass, ≥ 5 s after this one ends;
//  • nothing from the database sits between the kick and the request: the request uses rows
//    read in an EARLIER pass, and the switch / rows are refreshed only AFTER it;
//  • a second pass running at the same time (Chrome's 30 s keepalive alarm can start one
//    while a pass is running — main's own loop) is detected, read-only: every pass kicks
//    exactly once and bumps pcEv.tick when it starts, so "kicks so far === pcEv.tick" means no
//    pass is still in its row phase; pcTimer === null means no other pass already re-armed the
//    loop (a new pass would start within 5 s); and the alarm must not be due within 4 s;
//  • the frozen request is capped: the content script aborts at 2.5 s, the worker stops
//    waiting at 3 s;
//  • it is sent only when no normal row is in flight (pcInFlight), the E-Map keepalive is not
//    due within 20 s (it runs right after the kick in the same pass) and was not sent in the
//    last 25 s (a keepalive can take two 10 s endpoint attempts);
//  • at most ONE frozen request per pass.
// SLOW E-MAP: after ANY frozen timeout / no answer / network error the whole frozen lane pauses
// 10 minutes — a slow E-Map never gets a stream of cate=27 requests across many stores.
// NEVER STUCK: every await is bounded (config 3 s, inject 5 s, every body read, the whole pass
// 120 s) so `busy` is always released; a `kicks` count left behind pcEv.tick for 2 min (a pass
// that never reached its kick) is resynced once, so the lane can never stay off for good.
// REQUEST BUDGET: cate=27 only for 冷凍 rows; shared cache (sql/142): no_frozen 30 days, ok 7 days;
// ≤ 1 live request per store per 10 min (DB + a local floor); no pending read for 60 s after
// one that found nothing. Leader-only.
// NIGHT (1.18.2): the 01:00–05:00 Taipei window (7-ELEVEN maintenance) no longer turns the LIVE
// frozen lane off — it works like the dry lane does at night. The pending read runs (so sql/157's
// cache step gives instant answers from store_frozen_cache) and the live request is sent; a real
// answer is written as usual; a no-answer / timeout / maintenance page writes NOTHING and is NOT
// counted (no lane pause), that store is asked again 10 min later (the per-store floor). A block
// (captcha / login / 403 / 429) is never treated as a harmless no-answer: it is written 'unknown'
// exactly like by day. Every night request logs `[PC-FROZEN] night send store=… result=…`.
// The window state is re-checked with the leader right before the request (a pass decided by day
// never sends at night, and the other way round). Day behaviour is unchanged.
// SELF-HEAL: the frozen content script is pinged before a check; silent → injected, at most
// once per tab per 10 minutes.
//
// WARM-UP (1.18.0, sql/145): pre-checks every known store so a frozen parcel finds its store already
// in the cache (the sql/145 trigger then puts the verdict on the row the moment it is saved).
//  • OFF unless app_settings 'frozen_warmup_enabled' is exactly 'true' — read (≤ once a minute) ONLY
//    while the frozen switch is on. Frozen switch off = the same NETWORK requests as 1.17.0; the one
//    difference is a LOCAL chrome.storage write per worker start (pc_frozen_warmup → {on:false} + mem).
//  • leader-only on a FRESH, CONFIRMED lease (the last lease answer said leader ≤ 60 s ago and the
//    lease call is not failing — never on the lease fail-open path, the pre-answer boot rule or a
//    lone leader's stale lease), and ONLY when the real queues are empty: the last frozen pending read (≤ 60 s ago)
//    returned NO row at all, the dry lane's last pending read (≤ 30 s ago) had 0 rows, no row in flight.
//  • the warm-up request takes the frozen request's place in a pass (still ≤ ONE frozen E-Map request
//    per pass), right at the kick, behind every gap guard the frozen lane uses — so a new real parcel
//    waits at most for that one ≤ 3 s check (the next pass is ≥ 5 s after the kick anyway). It is NOT
//    sent when more than WARMUP_SEND_WINDOW_MS (2 s) has passed since the kick (the gap is used early
//    or not at all).
//  • pace: ONE store per WARMUP_GAP_MS (60 s), day and night; the maintenance window is respected.
//  • the stores come from admin_frozen_warmup_next (5 at a time, read NEVER sooner than 5 min after the
//    last read, even when that read was empty — the query is heavy); a real answer goes to
//    admin_frozen_warmup_verdict (same cache, log source 'warmup'). A no-answer (timeout / no reply /
//    error page) writes NOTHING — it only counts as a miss.
//  • safety: 3 no-answers in a row → warm-up pauses 30 min; 2 such pauses in a row with no real
//    verdict (ok / no_frozen) in between → warm-up STOPS. A captcha / login page / block / HTTP 403 /
//    429 → warm-up STOPS at once. A stop = admin_frozen_warmup_stop turns the switch off and keeps the
//    reason; the popup shows "Warm-up stopped: <reason>". It starts again only after the switch is seen
//    'false' and then 'true' (Jeff turns it on again). A failed stop write is retried ≤ once per 60 s.
//    The dry and live frozen lanes keep working.
//  • the pace (last request), the pause, the miss / pause counters, the stop and the ≤ 5 unchecked
//    store ids of the last list read survive a worker restart: kept in chrome.storage
//    (pc_frozen_warmup.mem) and loaded before the first warm-up decision (awaited right before warmOne —
//    AFTER the real frozen request, so a slow read never delays a real parcel; warmOne and the store-list
//    read also refuse while it is not loaded).
//    A failed / timed-out load writes nothing, blocks warm-up (pace + list clock set to now) and is
//    retried on the next pass. Restored times are clamped (lastAt / queueAt ≤ now, pauseUntil ≤ now +
//    30 min); a saved queue older than 5 min is dropped. The popup line is written {on:false} at boot
//    and whenever the frozen switch is seen off.
(function sflFrozenStoreCheck(g) {
  const SWITCH_KEY = "frozen_store_check_enabled";
  const SWITCH_TTL_MS = 60 * 1000;           // re-read the switch at most once a minute
  const PENDING_LIMIT = 3;                   // rows per pending read (one per store)
  const QUEUE_MAX_AGE_MS = 60 * 1000;        // rows read more than a minute ago are read again
  const EMPTY_WAIT_MS = 60 * 1000;           // D: a read that found nothing → no read for 60 s
  const STORE_GAP_MS = 10 * 60 * 1000;       // ≥ 10 min between live requests for one store
  const DB_TIMEOUT_MS = 15 * 1000;           // the switch / pending / verdict calls
  const CHECK_TIMEOUT_MS = 3 * 1000;         // the E-Map check (the content script aborts at 2.5 s)
  const PING_TIMEOUT_MS = 1000;              // the content-script ping (local, no network)
  const KEEPALIVE_SOON_MS = 20 * 1000;       // the keepalive due within this → busy
  const KEEPALIVE_RECENT_MS = 25 * 1000;     // the keepalive sent within this → busy
  const INJECT_GAP_MS = 10 * 60 * 1000;      // B: ≤ 1 injection per tab per 10 min
  const ALARM_GUARD_MS = 4 * 1000;           // the keepalive alarm due within this → no request (it may start a 2nd pass)
  const ALARM_READ_TIMEOUT_MS = 500;
  const SLOW_PAUSE_MS = 10 * 60 * 1000;      // 1: a timeout / no answer / network error → the lane pauses 10 min
  const CONFIG_TIMEOUT_MS = 3 * 1000;        // pcConfig (chrome.storage read)
  const INJECT_TIMEOUT_MS = 5 * 1000;        // pcInject (chrome.scripting)
  const PASS_TIMEOUT_MS = 120 * 1000;        // the whole frozen pass — busy is always released
  const KICKS_STALE_MS = 2 * 60 * 1000;      // kicks behind pcEv.tick this long → resync
  const VERDICTS = ["ok", "no_frozen"];
  // ── warm-up (1.18.0) ──
  const WARMUP_GAP_MS = 60 * 1000;             // THE pace: one warm-up store per minute
  const WARMUP_SWITCH_KEY = "frozen_warmup_enabled";
  const WARMUP_LIMIT = 5;                      // stores per admin_frozen_warmup_next read
  const WARMUP_LIST_MAX_AGE_MS = 5 * 60 * 1000; // re-read the store list at most every 5 min
  const WARMUP_EMPTY_WAIT_MS = 30 * 60 * 1000; // nothing due → ask again in 30 min
  const WARMUP_DRY_FRESH_MS = 30 * 1000;       // the dry lane's "0 pending" must be this fresh
  const WARMUP_MISS_LIMIT = 3;                 // no-answers in a row → pause
  const WARMUP_PAUSE_MS = 30 * 60 * 1000;
  const WARMUP_STATE_KEY = "pc_frozen_warmup"; // its own storage key (never races pc_status)
  const WARMUP_PAUSES_STOP = 2;                // pauses in a row with no real verdict → STOP
  const WARMUP_SEND_WINDOW_MS = 2 * 1000;      // the warm-up request only within 2 s of the kick
  const WARMUP_STOP_RETRY_MS = 60 * 1000;      // a failed stop write is retried at most once per minute
  // NIGHT (01:00–05:00 Taipei, the maintenance window): the warm-up probes at night too — since 1.18.2
  // only behind the real frozen parcels, exactly like by day. A real answer → the normal 60 s pace; a no-answer /
  // timeout / maintenance page → nothing written, NOT counted (no miss / pause / stop), next probe in 10 min.
  // A block (captcha / login / 403 / 429) still STOPS, any hour.
  const WARMUP_NIGHT_RETRY_MS = 10 * 60 * 1000;
  const WARMUP_NIGHT_MISS_LIMIT = 6;            // night: 6 no-answers in a row → no more probes until 05:00
  // 1.18.1 — REAL PARCELS FIRST. Two more gates, BOTH checked right before every warm-up send:
  //  (b) FRESH READ: the dry lane's pending read must have run in THIS pass — pc_status.multiLastAt later than
  //      the previous pass's kick (and this worker's boot). A pass that skipped its read (no SFL tab / token,
  //      a lease re-check) leaves the previous "0" in pc_status → no warm-up.
  //  (a) GIVEN-UP ROWS: no warm-up while any parcel's store half is the given-up 'unknown' that the re-queue
  //      would put back (admin_parcel_gave_up_count, sql/147 = the re-queue's own filter). Read at most once a
  //      minute and only while warm-up is on; a failed / missing / older-than-90 s read = no warm-up. A give-up
  //      seen in THIS worker also blocks for 60 s, and until a read taken ≥ 30 s after it says 0.
  const WARMUP_GAVEUP_EVERY_MS = 60 * 1000;
  const WARMUP_GAVEUP_MAX_AGE_MS = 90 * 1000;
  const WARMUP_GIVEUP_HOLD_MS = 60 * 1000;
  const WARMUP_GIVEUP_SETTLE_MS = 30 * 1000;
  // the end of the current / next maintenance window (05:00 Asia/Taipei) — background.js's window hours
  function nightEndAfter(nowMs) {
    const H = 3600 * 1000, D = 24 * H, TZ = 8 * H;
    let end = Math.floor((nowMs + TZ) / D) * D + PC_MAINT_END_H * H - TZ;
    if (end <= nowMs) end += D;
    return end;
  }
  const BLOCK_RE = /HTTP (403|429)\b|captcha|驗證碼|recaptcha|login|登入|robot|blocked|too many requests/i;
  const st = {
    busy: false, switchOn: false, switchAt: 0, switchLogged: null,
    queue: [], queueAt: 0, emptyUntil: 0, emptyLogged: false,
    lastRaw: -1,               // 1.18.0: rows the LAST pending read returned (-1 = failed / not read); warm-up needs 0
    storeAt: new Map(), injectedAt: new Map(),
    passes: 0, checks: 0, unknowns: 0, skippedBusy: 0, lastError: "",
    kicks: 0,                  // kicks so far — one per pass; === pcEv.tick ⇔ no pass is before its kick
    lastKickAt: 0,             // 1.18.1 (b): the previous kick — this pass's pending read must be later
    behindSince: 0,            // when kicks first fell behind pcEv.tick (0 = in step)
    pauseUntil: 0,             // 1: no frozen E-Map request before this (after a timeout / no answer / network error)
    logAt: new Map(),          // reason → last log time (skip reasons are logged at most once a minute)
  };
  const warm = {
    on: false, switchAt: 0, switchLogged: null,
    queue: [], queueAt: 0, emptyUntil: 0,
    lastAt: 0,                 // the last warm-up request (the 60 s pace)
    misses: 0, pauseUntil: 0,  // no-answers in a row → 30 min pause
    pauses: 0,                 // pauses since the last real verdict (ok / no_frozen) → 2 = STOP
    stopped: false, stopReason: "", stopWritten: false, sawOffSinceStop: false, stopTriedAt: 0,
    nightRetryAt: 0,           // night: no warm-up probe before this (10 min after a night no-answer; 05:00 after 6 in a row)
    nightMisses: 0,            // night no-answers in a row (never counted as misses / pauses)
    lastNight: null,           // the window state of the last pass (null = none yet) — 01:00 / 05:00 edge detection
    checked: null, left: null, nothingDue: false, lastVerdictAt: 0,
    stateSig: "", loaded: false,
    gaveUp: { ok: false, n: null, at: 0 }, gaveUpReadAt: 0, gaveUpBusy: false,  // 1.18.1 (a): the last admin_parcel_gave_up_count read
  };
  // the part of `warm` that must survive a worker restart (pc_frozen_warmup.mem)
  const MEM_KEYS = ["lastAt", "pauseUntil", "misses", "pauses", "stopped", "stopReason", "stopWritten", "sawOffSinceStop", "stopTriedAt", "nightRetryAt", "nightMisses", "lastNight", "queueAt", "queue"];
  const memOf = () => { const m = {}; for (const k of MEM_KEYS) m[k] = k === "queue" ? warm.queue.slice(0, WARMUP_LIMIT) : warm[k]; return m; };
  function restoreMem(m) {
    if (!m || typeof m !== "object") return;
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const now = Date.now();
    // a bad / future saved time can never stretch the pace, the list clock or the pause (clock jumps, a
    // corrupted value): lastAt / queueAt ≤ now (= at most the normal 60 s / 5 min wait), pause ≤ 30 min
    warm.lastAt = Math.min(num(m.lastAt), now); warm.queueAt = Math.min(num(m.queueAt), now);
    warm.stopTriedAt = Math.min(num(m.stopTriedAt), now);       // the stop-write retry clock (≤ now: never delays a retry > 60 s)
    warm.pauseUntil = Math.min(num(m.pauseUntil), now + WARMUP_PAUSE_MS);
    // at night ≤ the window's end (05:00); by day ≤ 10 min (it is not used by day)
    warm.nightRetryAt = Math.min(num(m.nightRetryAt), pcInMaintenance(now) ? nightEndAfter(now) : now + WARMUP_NIGHT_RETRY_MS);
    warm.nightMisses = Math.max(0, Math.floor(num(m.nightMisses)));
    warm.lastNight = typeof m.lastNight === "boolean" ? m.lastNight : null;
    warm.misses = Math.max(0, Math.floor(num(m.misses))); warm.pauses = Math.max(0, Math.floor(num(m.pauses)));
    warm.stopped = m.stopped === true; warm.stopReason = typeof m.stopReason === "string" ? m.stopReason.slice(0, 200) : "";
    warm.stopWritten = m.stopWritten === true; warm.sawOffSinceStop = m.sawOffSinceStop === true;
    // the unchecked stores of the last list read (≤ 5 ids) — so a restart does not wait 5 min for a new read
    warm.queue = Array.isArray(m.queue) ? m.queue.map(String).filter((x) => /^\d{6}$/.test(x)).slice(0, WARMUP_LIMIT) : [];
    if (now - warm.queueAt > WARMUP_LIST_MAX_AGE_MS) warm.queue = [];   // older than 5 min → stale; a fresh read is due anyway
    if (warm.stopped) { warm.on = false; warm.queue = []; }
  }
  const log = (msg) => { try { console.log(`[PC-FROZEN] ${msg}`); } catch { /* never throw from a log */ } };
  const logW = (msg) => { try { console.log(`[PC-WARMUP] ${msg}`); } catch { /* never throw from a log */ } };
  const logSkip = (key, msg) => { const now = Date.now(); if (now - (st.logAt.get(key) || 0) >= 60 * 1000) { st.logAt.set(key, now); log(`${msg} — next pass`); } };
  // Another pass is running or about to start (the normal lane may send a row check any moment).
  // pcTimer is read ONLY synchronously inside the kick (atKick): a moment later the kicking pass
  // itself ends and re-arms the loop for 5 s from then — that one is safe and must not count.
  function otherPass(atKick) {
    if (st.kicks !== pcEv.tick) return `${pcEv.tick - st.kicks} other pass(es) before their row checks`;
    if (atKick && pcTimer !== null) return "another pass already re-armed the loop";
    return "";
  }
  // 10: warm-up needs a FRESH, CONFIRMED lease — the last lease answer said leader, ≤ 60 s ago, and the
  // lease call is not failing. pcPassLeader alone also says yes on the 3-min fail-open path, before the
  // first answer (role null) and for a lone leader on a stale lease — warm-up never runs on those.
  function leaseConfirmed(nowMs) {
    return pcLease.role === "leader" && !pcLease.failing && pcLease.lastOkAt > 0 && nowMs - pcLease.lastOkAt <= PC_LEASE_MAX_AGE_MS;
  }

  // ── PURE helpers (unit-tested through pcFrozenKick.__test) ────────────────────
  const switchValue = (rows) => Array.isArray(rows) && rows.some((r) => r && r.key === SWITCH_KEY && r.value === "true");
  const storeDue = (map, storeId, nowMs) => { const at = map.get(String(storeId)); return !at || nowMs - at >= STORE_GAP_MS; };
  const verdictOf = (resp) => (resp && VERDICTS.includes(resp.frozen_store_status) ? resp.frozen_store_status : "unknown");
  // 1: E-Map slow or not answering (no reply, the 3 s cap, or the content script's abort / network /
  // 5xx, which it flags transient) — NOT a real answer like NO2 / close / a bounce.
  const slowAnswer = (resp, threw) => Boolean(threw || !resp || resp.transient === true);
  function pickRows(rows, storeAt, nowMs, limit) {
    const out = []; const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (out.length >= limit) break;
      if (!row || !row.id || !row.store_id) continue;
      const store = String(row.store_id);
      if (seen.has(store) || !storeDue(storeAt, store, nowMs)) continue;
      seen.add(store); out.push({ id: String(row.id), store_id: store });
    }
    return out;
  }
  // The normal lane is using the E-Map session now, or is about to in this pass.
  function laneBusy(nowMs) {
    if (pcInFlight.size > 0) return "row in flight";
    if (nowMs - pcLastKeepaliveAt < KEEPALIVE_RECENT_MS) return "keepalive just sent";
    // due within 20 s = the same rule as pcKeepaliveDue, 20 s early (it never fires while rows need the store half)
    if (!pcEv.lastAnyNeedStore && nowMs - pcLastKeepaliveAt >= PC_KEEPALIVE_MS - KEEPALIVE_SOON_MS) return "keepalive due";
    return "";
  }
  // Chrome's keepalive alarm (background.js PC_ALARM) is due within ALARM_GUARD_MS? Read-only.
  // No alarms API / no alarm / an error → false (the started-pass check still applies).
  function alarmSoon(nowMs) {
    const read = new Promise((resolve) => {
      try {
        if (!chrome.alarms || typeof chrome.alarms.get !== "function") { resolve(false); return; }
        chrome.alarms.get(PC_ALARM, (a) => {
          try { void chrome.runtime.lastError; } catch { /* ignore */ }
          resolve(Boolean(a && typeof a.scheduledTime === "number" && a.scheduledTime - nowMs < ALARM_GUARD_MS && a.scheduledTime - nowMs > -1000));
        });
      } catch { resolve(false); }
    });
    return withTimeout(read, ALARM_READ_TIMEOUT_MS, "alarm read").catch(() => false);
  }
  function withTimeout(promise, ms, what) {
    let timer = null;
    const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what} timeout (${ms / 1000}s)`)), ms); });
    return Promise.race([promise, timeout]).finally(() => { if (timer !== null) clearTimeout(timer); });
  }

  // ── database reads (a pass that does one sends nothing to E-Map) ──────────────
  async function readSwitch(cfg, headers, nowMs) {
    let on = false;
    try {
      const r = await withTimeout(fetch(`${cfg.supabaseUrl}/rest/v1/app_settings?select=key,value&key=eq.${SWITCH_KEY}`, { method: "GET", headers }), DB_TIMEOUT_MS, "switch read");
      on = r.ok ? switchValue(await withTimeout(r.json(), DB_TIMEOUT_MS, "switch body")) : false;
    } catch { on = false; }
    st.switchOn = on; st.switchAt = nowMs;
    if (st.switchLogged !== on) { st.switchLogged = on; log(`switch ${on ? "ON" : "off"}`); }
    if (!on) { warm.on = false; warm.switchAt = 0; }        // 12: warm-up off with it; the save right after this read writes {on:false}
  }
  async function readPending(cfg, headers, nowMs) {
    st.queue = []; st.queueAt = nowMs;
    let rows = [];
    try {
      const r = await withTimeout(fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_frozen_pending`, {
        method: "POST", headers, body: JSON.stringify({ p_limit: PENDING_LIMIT }),
      }), DB_TIMEOUT_MS, "pending read");
      st.lastRaw = -1;
      if (!r.ok) { log(`pending rpc_${r.status}`); return; }
      rows = await withTimeout(r.json(), DB_TIMEOUT_MS, "pending body");
    } catch (e) { st.lastRaw = -1; log(`pending failed: ${(e && e.message) || "network"}`); return; }
    st.lastRaw = Array.isArray(rows) ? rows.length : -1;
    st.queue = pickRows(rows, st.storeAt, Date.now(), PENDING_LIMIT);
    if (!st.queue.length) {
      st.emptyUntil = nowMs + EMPTY_WAIT_MS;
      if (!st.emptyLogged) { st.emptyLogged = true; log("no frozen parcels waiting — next read in 60 s"); }
    } else st.emptyLogged = false;
  }

  // ── the content script (ping; inject when silent, ≤ once per tab per 10 min) ──
  async function ensureScript(tabId, nowMs) {
    const ping = () => withTimeout(pcSendTab(tabId, { type: "PC_FROZEN_PING" }), PING_TIMEOUT_MS, "frozen ping").catch(() => null);
    let r = await ping();
    if (r && r.script === "emap-frozen") return true;
    const last = st.injectedAt.get(tabId);
    if (last && nowMs - last < INJECT_GAP_MS) return false;  // injected recently — wait (no injection loop)
    st.injectedAt.set(tabId, nowMs);
    const injected = await withTimeout(pcInject(tabId, "emap-frozen-711.js"), INJECT_TIMEOUT_MS, "inject").catch(() => false);
    log(`emap-frozen-711.js not answering on tab ${tabId} → ${injected ? "injected" : "inject failed"}`);
    if (!injected) return false;
    r = await ping();
    return Boolean(r && r.script === "emap-frozen");
  }

  // ── one pass: at most ONE frozen E-Map request, sent right at the kick ────────
  // Order: (1) the request, from rows read in an earlier pass — nothing from the database
  // before it; (2) its verdict write; (3) refresh the switch / rows for the NEXT pass.
  async function runPass(pass, otherAtKick, kickAt, prevKickAt) {
    const nowMs = Date.now();
    const cfg = await withTimeout(pcConfig(), CONFIG_TIMEOUT_MS, "config read");
    if (!cfg.multiSeller || cfg.paused) return;
    if (!pcPassLeader(pass)) return;                       // leader-only, exactly like the normal lane
    const rpc = pcEv.rpc;                                   // the normal lane's admin RPC context (set every pass it runs)
    if (!rpc || !rpc.cfg || !rpc.rpcHeaders) return;
    const tabId = (pcEv.emap.tabId && !pcEv.emap.error) ? pcEv.emap.tabId : null;
    const night = pcInMaintenance(nowMs);                  // 01:00–05:00 Taipei: both lanes work, with the night no-answer rules
    // 5: the 01:00 and 05:00 edges start a fresh count (day misses never carry into the night, night never into the day)
    if (warm.loaded) {
      if (warm.lastNight !== null && warm.lastNight !== night) {
        warm.misses = 0; warm.nightMisses = 0; warm.nightRetryAt = 0;
        logW(`warm-up: maintenance window ${night ? "started (01:00)" : "ended (05:00)"} — no-answer count reset`);
      }
      warm.lastNight = night;
    }
    if (st.switchOn && tabId) {
      await sendOne(pass, otherAtKick, rpc, tabId, nowMs, night);  // real frozen parcels first, day and night — never waits on the warm-up state
      // warm-up takes the frozen request's place ONLY when the frozen queue is empty by a fresh read — day and
      // night (1.18.2: the live frozen lane runs at night too, so the real parcels go first at night as well)
      if (!st.queue.length && nowMs < st.emptyUntil && st.lastRaw === 0) {
        await loadWarm();                                   // 6: the saved warm-up state, before the first warm-up decision
        await warmOne(pass, otherAtKick, rpc, tabId, nowMs, kickAt, night, prevKickAt);
      }
    }
    // a failed boot read is retried here every pass — also with the frozen switch OFF or a frozen queue
    // that never empties (the awaited loadWarm above would never run then). NOT awaited: nothing waits on it.
    if (!warm.loaded) void loadWarm();
    // (3) refresh for the next pass — AFTER the request, never between the kick and it
    if (Date.now() - st.switchAt >= SWITCH_TTL_MS) await readSwitch(rpc.cfg, rpc.rpcHeaders, Date.now());
    if (st.switchOn && Date.now() - warm.switchAt >= SWITCH_TTL_MS) await readWarmSwitch(rpc.cfg, rpc.rpcHeaders, Date.now());
    if (st.switchOn && warm.stopped && !warm.stopWritten && Date.now() - warm.stopTriedAt >= WARMUP_STOP_RETRY_MS) {
      warm.stopTriedAt = Date.now();                       // 2: a failing stop write is retried at most once per 60 s
      await writeStop(rpc.cfg, rpc.rpcHeaders);
    }
    await saveWarmState();                                               // written only when it changed
    if (!st.switchOn || !tabId) return;                                   // no live E-Map tab → the rows stay queued in the DB
    if ((!st.queue.length || Date.now() - st.queueAt >= QUEUE_MAX_AGE_MS) && Date.now() >= st.emptyUntil && Date.now() >= st.pauseUntil) {
      await readPending(rpc.cfg, rpc.rpcHeaders, Date.now());          // D: not again for 60 s after an empty read; day and night (1.18.2)
    }
    // 1.18.1 (a): the given-up count — AFTER the live frozen queue refresh, and NOT awaited: a slow database
    // never delays that refresh nor holds the pass (a held pass = the next kick skips its live frozen request).
    // One read at a time; only while warm-up is on (switch off = no extra request), ≤ once a minute.
    if (warm.on && !warm.stopped && !warm.gaveUpBusy && Date.now() - warm.gaveUpReadAt >= WARMUP_GAVEUP_EVERY_MS) {
      warm.gaveUpBusy = true;
      void readGaveUp(rpc.cfg, rpc.rpcHeaders, Date.now()).finally(() => { warm.gaveUpBusy = false; });
    }
    if (warm.loaded && warm.on && !st.queue.length && Date.now() < st.emptyUntil && st.lastRaw === 0 && Date.now() - warm.queueAt >= WARMUP_LIST_MAX_AGE_MS
        && Date.now() >= warm.emptyUntil && Date.now() >= warm.pauseUntil && leaseConfirmed(Date.now()) && (await dryIdle())) {
      await readWarmList(rpc.cfg, rpc.rpcHeaders, Date.now());          // 8: the heavy query — only while idle, NEVER sooner than 5 min after the last read
      await saveWarmState();
    }
  }
  async function sendOne(pass, otherAtKick, rpc, tabId, nowMs, night) {
    st.queue = st.queue.filter((q) => storeDue(st.storeAt, q.store_id, nowMs));
    if (!st.queue.length) return;
    st.passes += 1;
    if (nowMs < st.pauseUntil) { logSkip("pause", `paused after a slow / missing E-Map answer (${Math.ceil((st.pauseUntil - nowMs) / 60000)} min left)`); return; }
    if (otherAtKick) { st.skippedBusy += 1; logSkip("other", otherAtKick); return; }
    const busy = laneBusy(nowMs);
    if (busy) { st.skippedBusy += 1; logSkip("busy", `normal lane busy (${busy})`); return; }
    if (!(await ensureScript(tabId, nowMs))) return;
    // right before the request: still the leader, still on the same side of the window, still a gap, no
    // other pass started meanwhile, no alarm about to start one
    if (!pcPassLeader(pass)) { log("lease lost — stopping"); return; }
    if (pcInMaintenance(Date.now()) !== Boolean(night)) { log(night ? "maintenance window ended — next pass" : "maintenance window started — stopping"); return; }
    if (laneBusy(Date.now()) || otherPass(false)) { st.skippedBusy += 1; return; }
    if (await alarmSoon(Date.now())) { st.skippedBusy += 1; logSkip("alarm", "keepalive alarm due"); return; }
    if (otherPass(false)) { st.skippedBusy += 1; return; }                // the alarm read is async — check once more
    const row = st.queue.shift();
    if (night) { await sendNight(rpc, tabId, row); return; }
    let status = "unknown"; let reason = ""; let slow = false;
    try {
      st.storeAt.set(row.store_id, Date.now());             // the floor starts at the request, answered or not
      const resp = await withTimeout(pcSendTab(tabId, { type: "PC_FROZEN_CHECK", row }), CHECK_TIMEOUT_MS, "frozen check");
      status = verdictOf(resp);
      reason = resp ? String(resp.frozen_reason || "") : "emap tab not responding";
      slow = slowAnswer(resp, false);
    } catch (e) { status = "unknown"; reason = (e && e.message) || "check threw"; slow = slowAnswer(null, true); }
    if (slow) {
      st.pauseUntil = Date.now() + SLOW_PAUSE_MS;
      log(`E-Map slow or not answering (${reason}) — frozen checks paused 10 min`);
    }
    try {
      const w = await withTimeout(fetch(`${rpc.cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_frozen_verdict`, {
        method: "POST", headers: rpc.rpcHeaders,
        body: JSON.stringify({ p_id: row.id, p_expected_store: row.store_id, p_status: status }),
      }), DB_TIMEOUT_MS, "verdict write");
      if (!w.ok) log(`row=${row.id} verdict rpc_${w.status}`);
      st.checks += 1; if (status === "unknown") st.unknowns += 1;
      log(`row=${row.id} store=${row.store_id} → ${status}${reason ? ` (${reason})` : ""}`);
    } catch (e) { log(`row=${row.id} verdict write failed: ${(e && e.message) || "network"}`); }
  }
  // 1.18.2 — the live request at NIGHT (01:00–05:00 Taipei). The message carries `night: true` so the
  // content script reads an E-Map maintenance page as a no-answer (not a verdict). A real answer (ok /
  // no_frozen, or NO2 / close = 'unknown' that E-Map really said) is written as by day. A no-answer
  // (no reply, the 3 s cap, timeout, maintenance page, an odd page) writes NOTHING and is NOT counted:
  // no lane pause; the per-store floor (set at the request) asks that store again in 10 min. A block
  // (captcha / login / 403 / 429) is never a harmless no-answer: written 'unknown' exactly like by day.
  async function sendNight(rpc, tabId, row) {
    let resp = null;
    st.storeAt.set(row.store_id, Date.now());               // the floor starts at the request, answered or not
    try { resp = await withTimeout(pcSendTab(tabId, { type: "PC_FROZEN_CHECK", row, night: true }), CHECK_TIMEOUT_MS, "frozen check"); }
    catch (e) { log(`night send store=${row.store_id} row=${row.id} result=no_answer (${(e && e.message) || "check threw"}) — nothing written, retry in 10 min`); return; }
    const status = verdictOf(resp);
    const reason = resp ? String(resp.frozen_reason || "") : "emap tab not responding";
    const blocked = isBlocked(resp, reason);
    if (status === "unknown" && !blocked && noAnswer(resp, reason)) {
      log(`night send store=${row.store_id} row=${row.id} result=no_answer (${reason}) — nothing written, retry in 10 min`);
      return;
    }
    try {
      const w = await withTimeout(fetch(`${rpc.cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_frozen_verdict`, {
        method: "POST", headers: rpc.rpcHeaders,
        body: JSON.stringify({ p_id: row.id, p_expected_store: row.store_id, p_status: status }),
      }), DB_TIMEOUT_MS, "verdict write");
      if (!w.ok) log(`row=${row.id} verdict rpc_${w.status}`);
      st.checks += 1; if (status === "unknown") st.unknowns += 1;
      log(`night send store=${row.store_id} row=${row.id} result=${status}${blocked ? " (blocked)" : ""}${reason ? ` (${reason})` : ""}`);
    } catch (e) { log(`night send store=${row.store_id} row=${row.id} result=${status} — verdict write failed: ${(e && e.message) || "network"}`); }
  }

  // ── WARM-UP ───────────────────────────────────────────────────────────────────
  // The dry lane is idle: its last pending read (≤ 30 s ago) had 0 rows and nothing needs the store
  // half. Read-only (pc_status is written by the dry lane; never by this module).
  // 1.18.1 (b): with minReadAt, that read must also be LATER than minReadAt (= it ran in this pass).
  // Returns "" when idle, else the reason (for the throttled skip log).
  let lastDry = { queue: null, at: 0 };   // the last pc_status snapshot dryState looked at (for the send log)
  async function dryState(minReadAt) {
    if (pcInFlight.size > 0) return "dry row in flight";
    if (pcEv.lastAnyNeedStore) return "dry row needs the store half";
    let sts = null;
    try { sts = await withTimeout(pcGet(PC_STATUS_KEY, {}), CONFIG_TIMEOUT_MS, "status read"); } catch { return "status unreadable"; }
    if (!sts || sts.multi !== "ok") return `dry lane ${sts && sts.multi ? sts.multi : "no status"}`;
    const at = Date.parse(String(sts.multiLastAt || ""));
    lastDry = { queue: Number(sts.multiQueueDepth), at: Number.isFinite(at) ? at : 0 };
    if (Number(sts.multiQueueDepth) !== 0) return `dry queue ${sts.multiQueueDepth}`;
    if (!Number.isFinite(at) || Date.now() - at > WARMUP_DRY_FRESH_MS) return "dry read too old";
    if (minReadAt !== undefined && !(at > minReadAt)) return "no pending read in this pass";
    return "";
  }
  async function dryIdle(minReadAt) { return (await dryState(minReadAt)) === ""; }
  // 1.18.1 (a): no given-up row waiting for the re-queue — by a fresh DB read taken after any give-up
  // this worker saw, and not within 60 s of one.
  function gaveUpClear(nowMs) {
    const g = warm.gaveUp;
    if (!g || g.ok !== true || g.n !== 0) return false;                   // unread / failed / rows waiting
    if (nowMs - g.at > WARMUP_GAVEUP_MAX_AGE_MS) return false;            // too old
    const gu = Number(pcEv.lastGiveUpAt) || 0;
    if (gu && nowMs - gu < WARMUP_GIVEUP_HOLD_MS) return false;           // a give-up just happened here
    if (gu && g.at < gu + WARMUP_GIVEUP_SETTLE_MS) return false;          // the read may predate its 'unknown' write
    return true;
  }
  async function readGaveUp(cfg, headers, nowMs) {
    warm.gaveUpReadAt = nowMs;
    try {
      const r = await withTimeout(fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_gave_up_count`, { method: "POST", headers, body: "{}" }), DB_TIMEOUT_MS, "gave-up read");
      if (!r.ok) { warm.gaveUp = { ok: false, n: null, at: nowMs }; logSkip("warm-gaveup-read", `gave-up read rpc_${r.status} — warm-up held`); return; }
      const n = await withTimeout(r.json(), DB_TIMEOUT_MS, "gave-up body");
      const ok = typeof n === "number" && Number.isInteger(n) && n >= 0;
      warm.gaveUp = { ok, n: ok ? n : null, at: nowMs };
      if (!ok) logSkip("warm-gaveup-read", "gave-up read: bad answer — warm-up held");
    } catch (e) {
      warm.gaveUp = { ok: false, n: null, at: nowMs };
      logSkip("warm-gaveup-read", `gave-up read failed (${(e && e.message) || "network"}) — warm-up held`);
    }
  }
  const isBlocked = (resp, reason) => Boolean(resp && resp.blocked === true) || BLOCK_RE.test(String(reason || ""));
  // A no-answer (counts toward the 30-min pause) vs a real answer that is just not a verdict
  // (NO2 = no such store, close = company store: E-Map answered fine).
  const noAnswer = (resp, reason) => !resp || resp.transient === true || !/\(NO2\)|\(close\)/.test(String(reason || ""));
  async function readWarmSwitch(cfg, headers, nowMs) {
    let v = false;
    try {
      const r = await withTimeout(fetch(`${cfg.supabaseUrl}/rest/v1/app_settings?select=key,value&key=eq.${WARMUP_SWITCH_KEY}`, { method: "GET", headers }), DB_TIMEOUT_MS, "warm-up switch read");
      const rows = r.ok ? await withTimeout(r.json(), DB_TIMEOUT_MS, "warm-up switch body") : [];
      v = Array.isArray(rows) && rows.some((x) => x && x.key === WARMUP_SWITCH_KEY && x.value === "true");
    } catch { v = false; }
    warm.switchAt = nowMs;
    if (warm.stopped) {
      if (!v && warm.stopWritten) warm.sawOffSinceStop = true;
      if (v && warm.sawOffSinceStop) { warm.stopped = false; warm.stopReason = ""; warm.sawOffSinceStop = false; warm.misses = 0; warm.pauses = 0; warm.pauseUntil = 0; logW("warm-up switched on again"); }
    }
    warm.on = v && !warm.stopped;
    if (warm.switchLogged !== warm.on) { warm.switchLogged = warm.on; logW(`warm-up ${warm.on ? "ON" : "off"}`); }
  }
  async function readWarmList(cfg, headers, nowMs) {
    warm.queueAt = nowMs;
    let rows = [];
    try {
      const r = await withTimeout(fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_frozen_warmup_next`, {
        method: "POST", headers, body: JSON.stringify({ p_limit: WARMUP_LIMIT }),
      }), DB_TIMEOUT_MS, "warm-up list read");
      if (!r.ok) { logW(`warm-up list rpc_${r.status}`); warm.emptyUntil = nowMs + WARMUP_LIST_MAX_AGE_MS; return; }
      rows = await withTimeout(r.json(), DB_TIMEOUT_MS, "warm-up list body");
    } catch (e) { logW(`warm-up list failed: ${(e && e.message) || "network"}`); warm.emptyUntil = nowMs + WARMUP_LIST_MAX_AGE_MS; return; }
    rows = Array.isArray(rows) ? rows : [];
    warm.queue = rows.map((x) => String((x && x.store_id) || "")).filter((x) => /^\d{6}$/.test(x));
    if (rows.length) {
      warm.left = Number(rows[0].left_count) || 0; warm.checked = Number(rows[0].checked_count) || 0; warm.nothingDue = false;
    } else { warm.nothingDue = true; warm.emptyUntil = nowMs + WARMUP_EMPTY_WAIT_MS; logW("warm-up: no store due — next look in 30 min"); }
  }
  async function writeStop(cfg, headers) {
    try {
      const r = await withTimeout(fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_frozen_warmup_stop`, {
        method: "POST", headers, body: JSON.stringify({ p_reason: warm.stopReason }),
      }), DB_TIMEOUT_MS, "warm-up stop write");
      warm.stopWritten = r.ok;                         // not ok → retried in ≥ 60 s (the lane stays stopped locally meanwhile)
      if (!r.ok) logW(`warm-up stop rpc_${r.status} — retrying in 60 s`);
    } catch (e) { logW(`warm-up stop failed: ${(e && e.message) || "network"} — retrying in 60 s`); }
  }
  // The popup line ("Frozen warm-up: N checked · M left · last at HH:MM"), in its own storage key.
  // The same key carries `mem` (6: what must survive a worker restart); the popup reads only the top level.
  // 12: frozen switch off → the line is {on:false} (no stale "N checked" / "stopped" from before).
  async function saveWarmState() {
    if (!warm.loaded) return;                         // never overwrite the saved state before it was read
    const show = st.switchOn && (warm.on || warm.stopped);
    const state = show ? { on: warm.on, checked: warm.checked, left: warm.left, lastAt: warm.lastVerdictAt || null,
      pausedUntil: warm.pauseUntil > Date.now() ? warm.pauseUntil : null, nothingDue: warm.nothingDue,
      stopped: warm.stopped, stopReason: warm.stopReason || "" } : { on: false };
    state.mem = memOf();
    const sig = JSON.stringify(state);
    if (sig === warm.stateSig) return;
    warm.stateSig = sig;
    try { await withTimeout(pcSet(WARMUP_STATE_KEY, state), CONFIG_TIMEOUT_MS, "warm-up state write"); } catch { warm.stateSig = ""; }
  }
  // 6: read the saved state ONCE (at boot — the module schedules it — and awaited by every pass before a
  // warm-up decision), then write the popup line {on:false} (12). Bounded (3 s).
  // E: a failed / timed-out read is NOT a load: warm.loaded stays false (so nothing is written over the
  // saved mem), warm-up is held back (pace + list clock = now) and loadP is cleared → the next pass retries.
  let loadP = null;
  function loadWarm() {
    if (!loadP) {
      loadP = (async () => {
        let saved;
        try { saved = await withTimeout(pcGet(WARMUP_STATE_KEY, null), CONFIG_TIMEOUT_MS, "warm-up state read"); }
        catch (e) {
          warm.lastAt = Date.now(); warm.queueAt = Date.now();
          loadP = null;
          logSkip("warm-load", `warm-up state read failed (${(e && e.message) || "error"}) — warm-up held, retry`); // ≤ once a minute
          return;
        }
        // NOTE: a warm-up switch off→on seen BEFORE this load finished is overwritten by the saved state
        // (stopped / sawOffSinceStop from mem) → a stopped warm-up then needs ONE more off→on to restart.
        // Safe direction: it stays stopped, it never restarts by itself.
        restoreMem(saved && saved.mem);
        warm.loaded = true;
        if (warm.stopped || warm.pauseUntil > Date.now()) logW(`warm-up state restored (${warm.stopped ? `stopped: ${warm.stopReason}` : `paused until ${new Date(warm.pauseUntil).toISOString()}`})`);
        void saveWarmState();                          // H: not awaited — the load never waits on a write
      })().catch(() => { loadP = null; });
    }
    return loadP;
  }
  function stopWarm(reason, store) {
    warm.stopped = true; warm.on = false; warm.stopReason = String(reason || "").slice(0, 200) || "blocked";
    warm.stopWritten = false; warm.sawOffSinceStop = false; warm.queue = []; warm.misses = 0; warm.pauses = 0;
    logW(`warm-up STOPPED: ${warm.stopReason} (store=${store}) — turning the warm-up switch off`);
  }
  // ONE warm-up request, at the kick, behind the same guards as the frozen request.
  async function warmOne(pass, otherAtKick, rpc, tabId, nowMs, kickAt, night, prevKickAt) {
    if (!warm.loaded) return;                                              // the saved state is not read yet → no warm-up decision
    if (!warm.on || warm.stopped || !warm.queue.length) return;
    if (nowMs - warm.lastAt < WARMUP_GAP_MS) return;                       // the 60 s pace
    if (night && nowMs < warm.nightRetryAt) return;                        // night: 10 min after a night no-answer
    if (nowMs < warm.pauseUntil || nowMs < st.pauseUntil) return;          // warm-up pause / the frozen lane's slow-E-Map pause
    if (!leaseConfirmed(nowMs)) return;                                    // 10: a fresh, confirmed lease only
    if (otherAtKick || laneBusy(nowMs)) return;
    if (!gaveUpClear(nowMs)) { logSkip("warm-gaveup", warm.gaveUp && warm.gaveUp.ok && warm.gaveUp.n > 0 ? `warm-up held: ${warm.gaveUp.n} given-up parcel(s) wait for the re-queue` : "warm-up held: given-up rows not confirmed 0"); return; } // 1.18.1 (a)
    const minReadAt = Math.max(Number(prevKickAt) || 0, Number(pcEv.bootAt) || 0);
    const idle = await dryState(minReadAt);                                // a real parcel waiting → it goes first; (b) the read is from THIS pass
    if (idle) { if (idle === "no pending read in this pass") logSkip("warm-stale", `warm-up held: ${idle}`); return; }
    warm.queue = warm.queue.filter((s) => storeDue(st.storeAt, s, nowMs));
    if (!warm.queue.length) return;
    if (!(await ensureScript(tabId, nowMs))) return;
    if (!pcPassLeader(pass) || !leaseConfirmed(Date.now()) || pcInMaintenance(Date.now()) !== Boolean(night)) return; // the window started / ended meanwhile → next pass
    if (laneBusy(Date.now()) || otherPass(false)) return;
    if (await alarmSoon(Date.now())) return;
    if (otherPass(false) || pcInFlight.size > 0) return;
    if (Date.now() - kickAt > WARMUP_SEND_WINDOW_MS) { logSkip("warm-late", `warm-up skipped: ${Date.now() - kickAt} ms since the kick (> ${WARMUP_SEND_WINDOW_MS} ms)`); return; } // 11
    // 1.18.1: the last look right before the send — both gates again, on what pc_status says NOW
    if (!gaveUpClear(Date.now())) return;
    const lastLook = await dryState(minReadAt);
    if (lastLook) { logSkip("warm-lastlook", `warm-up held at the send: ${lastLook}`); return; }
    const store = warm.queue.shift();
    // 1.18.1 post-deploy check: EVERY send logs the dry queue + read age it was decided on — "queue=" must be 0
    logW(`warm-up send store=${store} queue=${lastDry.queue} read=${Date.now() - lastDry.at}ms gaveUp=${warm.gaveUp.n}${night ? " night" : ""}`);
    warm.lastAt = Date.now();
    st.storeAt.set(store, Date.now());                                     // shares the per-store 10-min floor
    void saveWarmState();                                                  // 6: the pace survives a restart (not awaited — never delays the request)
    let resp = null; let threw = false;
    // the night probe says so (the content script then treats a maintenance page as a transient no-answer);
    // the day warm-up message is exactly the pre-night one
    const msg = night ? { type: "PC_FROZEN_CHECK", row: { id: `warmup:${store}`, store_id: store }, nightWarm: true } : { type: "PC_FROZEN_CHECK", row: { id: `warmup:${store}`, store_id: store } };
    try { resp = await withTimeout(pcSendTab(tabId, msg), CHECK_TIMEOUT_MS, "warm-up check"); }
    catch (e) { threw = true; resp = { frozen_reason: (e && e.message) || "check threw", transient: true }; }
    const status = threw ? "unknown" : verdictOf(resp);
    const reason = resp ? String(resp.frozen_reason || "") : "emap tab not responding";
    if (!threw && isBlocked(resp, reason)) { stopWarm(reason, store); return; } // a block answer is not written as a verdict
    if (status === "unknown" && noAnswer(threw ? null : resp, reason) && night) {
      // night: a no-answer (timeout / maintenance page / odd page) writes NOTHING and is NOT counted
      // (no miss, no pause, no stop) — the next probe 10 min later; 6 in a row → none until 05:00
      warm.nightMisses += 1;
      if (warm.nightMisses >= WARMUP_NIGHT_MISS_LIMIT) {
        warm.nightRetryAt = nightEndAfter(Date.now());
        logW(`warm-up store=${store} → no answer at night (${reason}) — ${warm.nightMisses} in a row, no more probes until 05:00, nothing written`);
      } else {
        warm.nightRetryAt = Date.now() + WARMUP_NIGHT_RETRY_MS;
        logW(`warm-up store=${store} → no answer at night (${reason}) — nothing written, not counted, next probe in 10 min`);
      }
      void saveWarmState();
      return;
    }
    if (status === "unknown" && noAnswer(threw ? null : resp, reason)) {
      // 9: a no-answer writes NOTHING — it only counts as a miss
      warm.misses += 1;
      logW(`warm-up store=${store} → no answer (${reason}) — miss ${warm.misses}/${WARMUP_MISS_LIMIT}, nothing written`);
      if (warm.misses >= WARMUP_MISS_LIMIT) {
        warm.misses = 0; warm.pauses += 1;
        if (warm.pauses >= WARMUP_PAUSES_STOP) stopWarm(`${WARMUP_PAUSES_STOP} pauses in a row with no answer from E-Map (last: ${reason})`.slice(0, 200), store); // 7
        else { warm.pauseUntil = Date.now() + WARMUP_PAUSE_MS; logW(`warm-up: ${WARMUP_MISS_LIMIT} no-answers in a row (${reason}) — paused 30 min (pause ${warm.pauses}/${WARMUP_PAUSES_STOP})`); }
      }
      return;
    }
    warm.misses = 0;                                                       // a real answer breaks the "in a row"
    warm.nightRetryAt = 0; warm.nightMisses = 0;                           // night: a real answer → back to the 60 s pace
    if (status !== "unknown") warm.pauses = 0;                             // a real verdict ends the pause streak
    try {
      const w = await withTimeout(fetch(`${rpc.cfg.supabaseUrl}/rest/v1/rpc/admin_frozen_warmup_verdict`, {
        method: "POST", headers: rpc.rpcHeaders, body: JSON.stringify({ p_store: store, p_status: status }),
      }), DB_TIMEOUT_MS, "warm-up verdict write");
      if (!w.ok) logW(`warm-up store=${store} verdict rpc_${w.status}`);
      else { warm.lastVerdictAt = Date.now(); if (warm.checked !== null) warm.checked += 1; if (warm.left !== null && status !== "unknown" && warm.left > 0) warm.left -= 1; }
      logW(`warm-up store=${store} → ${status}${reason ? ` (${reason})` : ""}`);
    } catch (e) { logW(`warm-up store=${store} verdict write failed: ${(e && e.message) || "network"}`); }
  }

  // 2: a pass that never reached its kick (it threw or hung before pcPollMulti finished) would keep
  // kicks behind pcEv.tick forever and the lane off. Behind for 2 minutes → resync once (logged).
  function resyncKicks(nowMs) {
    if (st.kicks >= pcEv.tick) { st.kicks = pcEv.tick; st.behindSince = 0; return; } // in step (a late kick after a resync clamps back)
    if (!st.behindSince) { st.behindSince = nowMs; return; }
    if (nowMs - st.behindSince < KICKS_STALE_MS) return;
    log(`pass count ${pcEv.tick - st.kicks} behind for 2 min — resynced`);
    st.kicks = pcEv.tick; st.behindSince = 0;
  }

  // ── the kick (the ONE line in pcRunOnce calls it; it never awaits) ────────────
  function pcFrozenKick(pass) {
    st.kicks += 1;                                            // counted for EVERY pass, busy or not
    resyncKicks(Date.now());
    const otherAtKick = otherPass(true);                      // synchronous: before the kicking pass can end
    const kickAt = Date.now();                                // 11: the warm-up request only within 2 s of this
    const prevKickAt = st.lastKickAt;                         // 1.18.1 (b): this pass's pending read must be later than this
    st.lastKickAt = kickAt;                                   // set for EVERY pass, busy or not
    if (st.busy) return;
    st.busy = true;
    Promise.resolve()
      .then(() => withTimeout(runPass(pass, otherAtKick, kickAt, prevKickAt), PASS_TIMEOUT_MS, "frozen pass"))
      .catch((e) => { st.lastError = (e && e.message) || "pass threw"; log(`pass failed: ${st.lastError}`); })
      .then(() => { st.busy = false; });
  }
  pcFrozenKick.__test = { switchValue, verdictOf, slowAnswer, pickRows, storeDue, laneBusy, otherPass, alarmSoon, resyncKicks, state: st,
    warm, isBlocked, noAnswer, leaseConfirmed, WARMUP_GAP_MS, WARMUP_SEND_WINDOW_MS, gaveUpClear, dryState };
  g.pcFrozenKick = pcFrozenKick;
  Promise.resolve().then(loadWarm).catch(() => { /* never throw at boot */ }); // 6 + 12: at boot (after background.js finished loading)
})(typeof self !== "undefined" ? self : globalThis);
