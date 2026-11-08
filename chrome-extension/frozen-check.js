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
// only request this module makes is ONE read-only GET of that setting per minute.
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
// one that found nothing. Same maintenance window as the normal check (01:00–05:00 Taipei),
// re-checked with the leader right before the request. Leader-only.
// SELF-HEAL: the frozen content script is pinged before a check; silent → injected, at most
// once per tab per 10 minutes.
//
// WARM-UP (1.18.0, sql/145): pre-checks every known store so a frozen parcel finds its store already
// in the cache (the sql/145 trigger then puts the verdict on the row the moment it is saved).
//  • OFF unless app_settings 'frozen_warmup_enabled' is exactly 'true' — read (≤ once a minute) ONLY
//    while the frozen switch is on, so "frozen switch off" stays byte-for-byte 1.17.0.
//  • leader-only, and ONLY when the real queues are empty: the last frozen pending read (≤ 60 s ago)
//    returned NO row at all, the dry lane's last pending read (≤ 30 s ago) had 0 rows, no row in flight.
//  • the warm-up request takes the frozen request's place in a pass (still ≤ ONE frozen E-Map request
//    per pass), right at the kick, behind every gap guard the frozen lane uses — so a new real parcel
//    waits at most for that one ≤ 3 s check (the next pass is ≥ 5 s after the kick anyway).
//  • pace: ONE store per WARMUP_GAP_MS (60 s), day and night; the maintenance window is respected.
//  • the stores come from admin_frozen_warmup_next (5 at a time, read ≤ once per 5 min — the query
//    is heavy); the answer goes to admin_frozen_warmup_verdict (same cache, log source 'warmup').
//  • safety: 3 no-answers in a row (timeout / no reply / error page) → warm-up pauses 30 min;
//    a captcha / login page / block / HTTP 403 / 429 → warm-up STOPS: admin_frozen_warmup_stop turns
//    the switch off and keeps the reason; the popup shows "Warm-up stopped: <reason>". It starts
//    again only after the switch is seen 'false' and then 'true' (Jeff turns it on again).
//    The dry and live frozen lanes keep working either way.
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
  const BLOCK_RE = /HTTP (403|429)\b|captcha|驗證碼|recaptcha|login|登入|robot|blocked|too many requests/i;
  const st = {
    busy: false, switchOn: false, switchAt: 0, switchLogged: null,
    queue: [], queueAt: 0, emptyUntil: 0, emptyLogged: false,
    lastRaw: -1,               // 1.18.0: rows the LAST pending read returned (-1 = failed / not read); warm-up needs 0
    storeAt: new Map(), injectedAt: new Map(),
    passes: 0, checks: 0, unknowns: 0, skippedBusy: 0, lastError: "",
    kicks: 0,                  // kicks so far — one per pass; === pcEv.tick ⇔ no pass is before its kick
    behindSince: 0,            // when kicks first fell behind pcEv.tick (0 = in step)
    pauseUntil: 0,             // 1: no frozen E-Map request before this (after a timeout / no answer / network error)
    logAt: new Map(),          // reason → last log time (skip reasons are logged at most once a minute)
  };
  const warm = {
    on: false, switchAt: 0, switchLogged: null,
    queue: [], queueAt: 0, emptyUntil: 0,
    lastAt: 0,                 // the last warm-up request (the 60 s pace)
    misses: 0, pauseUntil: 0,  // no-answers in a row → 30 min pause
    stopped: false, stopReason: "", stopWritten: false, sawOffSinceStop: false,
    checked: null, left: null, nothingDue: false, lastVerdictAt: 0,
    stateSig: "",
  };
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
  async function runPass(pass, otherAtKick) {
    const nowMs = Date.now();
    const cfg = await withTimeout(pcConfig(), CONFIG_TIMEOUT_MS, "config read");
    if (!cfg.multiSeller || cfg.paused) return;
    if (!pcPassLeader(pass)) return;                       // leader-only, exactly like the normal lane
    const rpc = pcEv.rpc;                                   // the normal lane's admin RPC context (set every pass it runs)
    if (!rpc || !rpc.cfg || !rpc.rpcHeaders) return;
    const tabId = (pcEv.emap.tabId && !pcEv.emap.error) ? pcEv.emap.tabId : null;
    if (st.switchOn && tabId && !pcInMaintenance(nowMs)) {
      await sendOne(pass, otherAtKick, rpc, tabId, nowMs);
      // warm-up takes the frozen request's place ONLY when the frozen queue is empty by a fresh read
      if (!st.queue.length && nowMs < st.emptyUntil && st.lastRaw === 0) await warmOne(pass, otherAtKick, rpc, tabId, nowMs);
    }
    // (3) refresh for the next pass — AFTER the request, never between the kick and it
    if (Date.now() - st.switchAt >= SWITCH_TTL_MS) await readSwitch(rpc.cfg, rpc.rpcHeaders, Date.now());
    if (st.switchOn && Date.now() - warm.switchAt >= SWITCH_TTL_MS) await readWarmSwitch(rpc.cfg, rpc.rpcHeaders, Date.now());
    if (warm.stopped && !warm.stopWritten) await writeStop(rpc.cfg, rpc.rpcHeaders);
    if (st.switchOn || warm.stateSig) await saveWarmState();             // frozen switch off and never on → no write at all
    if (!st.switchOn || !tabId || pcInMaintenance(Date.now())) return;   // no live E-Map tab / window → the rows stay queued in the DB
    if ((!st.queue.length || Date.now() - st.queueAt >= QUEUE_MAX_AGE_MS) && Date.now() >= st.emptyUntil && Date.now() >= st.pauseUntil) {
      await readPending(rpc.cfg, rpc.rpcHeaders, Date.now());          // D: not again for 60 s after an empty read
    }
    if (warm.on && !st.queue.length && Date.now() < st.emptyUntil && st.lastRaw === 0 && (!warm.queue.length || Date.now() - warm.queueAt >= WARMUP_LIST_MAX_AGE_MS)
        && Date.now() >= warm.emptyUntil && Date.now() >= warm.pauseUntil && (await dryIdle())) {
      await readWarmList(rpc.cfg, rpc.rpcHeaders, Date.now());          // the heavy query: only while idle, ≤ once per 5 min
    }
  }
  async function sendOne(pass, otherAtKick, rpc, tabId, nowMs) {
    st.queue = st.queue.filter((q) => storeDue(st.storeAt, q.store_id, nowMs));
    if (!st.queue.length) return;
    st.passes += 1;
    if (nowMs < st.pauseUntil) { logSkip("pause", `paused after a slow / missing E-Map answer (${Math.ceil((st.pauseUntil - nowMs) / 60000)} min left)`); return; }
    if (otherAtKick) { st.skippedBusy += 1; logSkip("other", otherAtKick); return; }
    const busy = laneBusy(nowMs);
    if (busy) { st.skippedBusy += 1; logSkip("busy", `normal lane busy (${busy})`); return; }
    if (!(await ensureScript(tabId, nowMs))) return;
    // right before the request: still the leader, still outside the window, still a gap, no other
    // pass started meanwhile, no alarm about to start one
    if (!pcPassLeader(pass)) { log("lease lost — stopping"); return; }
    if (pcInMaintenance(Date.now())) { log("maintenance window started — stopping"); return; }
    if (laneBusy(Date.now()) || otherPass(false)) { st.skippedBusy += 1; return; }
    if (await alarmSoon(Date.now())) { st.skippedBusy += 1; logSkip("alarm", "keepalive alarm due"); return; }
    if (otherPass(false)) { st.skippedBusy += 1; return; }                // the alarm read is async — check once more
    const row = st.queue.shift();
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

  // ── WARM-UP ───────────────────────────────────────────────────────────────────
  // The dry lane is idle: its last pending read (≤ 30 s ago) had 0 rows and nothing needs the store
  // half. Read-only (pc_status is written by the dry lane; never by this module).
  async function dryIdle() {
    if (pcInFlight.size > 0 || pcEv.lastAnyNeedStore) return false;
    let sts = null;
    try { sts = await withTimeout(pcGet(PC_STATUS_KEY, {}), CONFIG_TIMEOUT_MS, "status read"); } catch { return false; }
    if (!sts || sts.multi !== "ok" || Number(sts.multiQueueDepth) !== 0) return false;
    const at = Date.parse(String(sts.multiLastAt || ""));
    return Number.isFinite(at) && Date.now() - at <= WARMUP_DRY_FRESH_MS;
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
      if (v && warm.sawOffSinceStop) { warm.stopped = false; warm.stopReason = ""; warm.sawOffSinceStop = false; warm.misses = 0; log("warm-up switched on again"); }
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
      warm.stopWritten = r.ok;                         // not ok → retried next pass (the lane stays stopped locally meanwhile)
      if (!r.ok) logW(`warm-up stop rpc_${r.status} — retrying next pass`);
    } catch (e) { logW(`warm-up stop failed: ${(e && e.message) || "network"} — retrying next pass`); }
  }
  // The popup line ("Frozen warm-up: N checked · M left · last at HH:MM"), in its own storage key.
  async function saveWarmState() {
    const show = warm.on || warm.stopped;
    const state = show ? { on: warm.on, checked: warm.checked, left: warm.left, lastAt: warm.lastVerdictAt || null,
      pausedUntil: warm.pauseUntil > Date.now() ? warm.pauseUntil : null, nothingDue: warm.nothingDue,
      stopped: warm.stopped, stopReason: warm.stopReason || "" } : { on: false };
    const sig = JSON.stringify(state);
    if (sig === warm.stateSig) return;
    warm.stateSig = sig;
    try { await withTimeout(pcSet(WARMUP_STATE_KEY, state), CONFIG_TIMEOUT_MS, "warm-up state write"); } catch { warm.stateSig = ""; }
  }
  // ONE warm-up request, at the kick, behind the same guards as the frozen request.
  async function warmOne(pass, otherAtKick, rpc, tabId, nowMs) {
    if (!warm.on || warm.stopped || !warm.queue.length) return;
    if (nowMs - warm.lastAt < WARMUP_GAP_MS) return;                       // the 60 s pace
    if (nowMs < warm.pauseUntil || nowMs < st.pauseUntil) return;          // warm-up pause / the frozen lane's slow-E-Map pause
    if (otherAtKick || laneBusy(nowMs)) return;
    if (!(await dryIdle())) return;                                        // a real parcel waiting → it goes first
    warm.queue = warm.queue.filter((s) => storeDue(st.storeAt, s, nowMs));
    if (!warm.queue.length) return;
    if (!(await ensureScript(tabId, nowMs))) return;
    if (!pcPassLeader(pass) || pcInMaintenance(Date.now())) return;
    if (laneBusy(Date.now()) || otherPass(false)) return;
    if (await alarmSoon(Date.now())) return;
    if (otherPass(false) || pcInFlight.size > 0) return;
    const store = warm.queue.shift();
    warm.lastAt = Date.now();
    st.storeAt.set(store, Date.now());                                     // shares the per-store 10-min floor
    let resp = null; let threw = false;
    try { resp = await withTimeout(pcSendTab(tabId, { type: "PC_FROZEN_CHECK", row: { id: `warmup:${store}`, store_id: store } }), CHECK_TIMEOUT_MS, "warm-up check"); }
    catch (e) { threw = true; resp = { frozen_reason: (e && e.message) || "check threw", transient: true }; }
    const status = threw ? "unknown" : verdictOf(resp);
    const reason = resp ? String(resp.frozen_reason || "") : "emap tab not responding";
    if (!threw && isBlocked(resp, reason)) {
      warm.stopped = true; warm.on = false; warm.stopReason = reason.slice(0, 200) || "blocked"; warm.stopWritten = false; warm.sawOffSinceStop = false;
      warm.queue = [];
      logW(`warm-up STOPPED: ${warm.stopReason} (store=${store}) — turning the warm-up switch off`);
      return;                                                              // a block answer is not written as a verdict
    }
    if (status === "unknown" && noAnswer(threw ? null : resp, reason)) {
      warm.misses += 1;
      if (warm.misses >= WARMUP_MISS_LIMIT) { warm.misses = 0; warm.pauseUntil = Date.now() + WARMUP_PAUSE_MS; logW(`warm-up: ${WARMUP_MISS_LIMIT} no-answers in a row (${reason}) — paused 30 min`); }
    } else if (status !== "unknown") warm.misses = 0;
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
    if (st.busy) return;
    st.busy = true;
    Promise.resolve()
      .then(() => withTimeout(runPass(pass, otherAtKick), PASS_TIMEOUT_MS, "frozen pass"))
      .catch((e) => { st.lastError = (e && e.message) || "pass threw"; log(`pass failed: ${st.lastError}`); })
      .then(() => { st.busy = false; });
  }
  pcFrozenKick.__test = { switchValue, verdictOf, slowAnswer, pickRows, storeDue, laneBusy, otherPass, alarmSoon, resyncKicks, state: st,
    warm, isBlocked, noAnswer, WARMUP_GAP_MS };
  g.pcFrozenKick = pcFrozenKick;
})(typeof self !== "undefined" ? self : globalThis);
