// SellerFlow parcel-checker — FROZEN (冷凍) store check. ADD-ONLY module (1.17.0).
// ════════════════════════════════════════════════════════════════════════════
// Loaded by background.js through ONE guarded importScripts line and kicked by ONE line in
// pcRunOnce (`pcFrozenKick(pass)`). NOTHING here is awaited by the normal lane: the kick
// returns at once, the pass runs on its own promise, every step is wrapped and every call
// has a timeout — a throw, a hang or a bad answer marks only THAT parcel 'unknown' and can
// never stop, delay or retry the normal store / phone check.
//
// What it does, for 冷凍 parcels only (the DB decides which rows — dry parcels are never
// read here): POST byIDData with cate=27 (the frozen E-Map category; the normal check is
// cate=3) through its OWN content script (emap-frozen-711.js) on the E-Map tab the normal
// lane already picked, then write the verdict through its OWN RPC.
//   enable  → ok          (the store takes frozen)
//   disable → no_frozen   (can't take frozen now — permanent or full, we can't tell →
//                          blocked from export, re-checked once an hour like 'full')
//   close / NO2 / anything else / no answer → unknown (re-checked every 10 min)
//
// KILL SWITCH: app_settings 'frozen_store_check_enabled' — only the exact string 'true'
// turns it on; a read failure = off. OFF = the normal lane is byte-for-byte today's; the
// only request this module makes is ONE read-only GET of that setting per minute.
//
// NEVER OVERLAP the normal lane on the shared E-Map session: a frozen request goes out only
// in a GAP — no normal row in flight (pcInFlight empty) and no E-Map keepalive due or just
// sent. It waits up to 5 s for a gap, then gives the pass up (next pass retries). Fairness:
// the kick runs right after the normal lane's rows finished for the pass, which IS a gap, so
// while frozen rows are waiting at least one frozen request goes out per pass (≈ every 5 s
// — far inside "one per minute") even behind a long dry queue; with a dry queue waiting the
// pass sends ONE frozen row (3 when the queue is empty) so the dry rows keep their turn.
//
// REQUEST BUDGET: cate=27 only for 冷凍 rows; the shared cache (store_frozen_cache, sql/142)
// answers no_frozen for 1 h and ok for 10 min; the pending RPC never hands out a store
// checked live in the last 10 min, and this module keeps the same 10-min floor per store in
// memory — never more than 1 frozen request per store per 10 min across all sellers. Same
// maintenance window (01:00–05:00 Taipei) as the normal store check. Leader-only. Both the
// leader and the window are re-checked before EVERY row.
//
// SELF-HEAL: before a check the frozen content script is pinged; no answer → injected into
// the E-Map tab (chrome.scripting, same permission the normal heal uses) and pinged again.
const PC_FROZEN_SWITCH_KEY = "frozen_store_check_enabled";
const PC_FROZEN_SWITCH_TTL_MS = 60 * 1000;          // re-read the switch at most once a minute
const PC_FROZEN_LIMIT = 3;                          // rows per pass when the dry queue is empty (one per store)
const PC_FROZEN_LIMIT_BUSY = 1;                     // rows per pass while dry rows are waiting (fairness both ways)
const PC_FROZEN_ROW_GAP_MS = 2000;                  // same per-parcel gap as the normal lane
const PC_FROZEN_STORE_GAP_MS = 10 * 60 * 1000;      // ≥ 10 min between live requests for one store
const PC_FROZEN_CALL_TIMEOUT_MS = 15 * 1000;        // every fetch / RPC / tab message is bounded
const PC_FROZEN_PING_TIMEOUT_MS = 3 * 1000;         // the content-script ping
const PC_FROZEN_GAP_WAIT_MS = 5 * 1000;             // how long a row waits for a gap in the normal lane
const PC_FROZEN_GAP_POLL_MS = 250;
const PC_FROZEN_KEEPALIVE_GUARD_MS = 15 * 1000;     // a keepalive sent this recently may still be in flight
const PC_FROZEN_VERDICTS = ["ok", "no_frozen"];     // definitive answers; everything else = 'unknown'
const pcFrozen = {
  busy: false,                 // single-flight: a slow pass never overlaps the next kick
  switchOn: false, switchAt: 0, switchLogged: null,
  storeAt: new Map(),          // store id → last live request (ms)
  passes: 0, checks: 0, unknowns: 0, lastError: "", skippedBusy: 0,
};

function pcFrozenLog(msg) { try { console.log(`[PC-FROZEN] ${msg}`); } catch { /* never throw from a log */ } }

// ── PURE helpers (unit-tested) ────────────────────────────────────────────────
// The switch: the exact string 'true' on the exact key, nothing else.
function pcFrozenSwitchValue(rows) {
  return Array.isArray(rows) && rows.some((r) => r && r.key === PC_FROZEN_SWITCH_KEY && r.value === "true");
}
// Local per-store floor: a store checked live less than 10 min ago is skipped this pass.
function pcFrozenStoreDue(map, storeId, nowMs) {
  const at = map.get(String(storeId));
  return !at || nowMs - at >= PC_FROZEN_STORE_GAP_MS;
}
// What the content script answered → the verdict to write. Anything not definitive = 'unknown'.
function pcFrozenVerdictOf(resp) {
  return resp && PC_FROZEN_VERDICTS.includes(resp.frozen_store_status) ? resp.frozen_store_status : "unknown";
}
// Which rows to check this pass: one per store, never a store under the local floor, ≤ limit.
function pcFrozenPickRows(rows, storeAt, nowMs, limit) {
  const out = []; const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (out.length >= limit) break;
    if (!row || !row.id || !row.store_id) continue;
    const store = String(row.store_id);
    if (seen.has(store) || !pcFrozenStoreDue(storeAt, store, nowMs)) continue;
    seen.add(store); out.push({ id: String(row.id), store_id: store });
  }
  return out;
}
// The normal lane is using the E-Map session right now (or is about to): a row is in flight,
// or the keepalive is due this pass / was sent moments ago.
function pcFrozenLaneBusy(nowMs) {
  if (pcInFlight.size > 0) return true;
  if (nowMs - pcLastKeepaliveAt < PC_FROZEN_KEEPALIVE_GUARD_MS) return true;
  return pcKeepaliveDue(nowMs, pcLastKeepaliveAt, pcEv.lastAnyNeedStore);
}
// A bounded promise: rejects with a named timeout instead of hanging the lane.
function pcFrozenWithTimeout(promise, ms, what) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what} timeout (${ms / 1000}s)`)), ms); });
  return Promise.race([promise, timeout]).finally(() => { if (timer !== null) clearTimeout(timer); });
}

// ── the switch (read-only GET, once a minute; any failure = off) ──────────────
async function pcFrozenReadSwitch(cfg, rpcHeaders, nowMs) {
  if (nowMs - pcFrozen.switchAt < PC_FROZEN_SWITCH_TTL_MS) return pcFrozen.switchOn;
  let on = false;
  try {
    const r = await pcFrozenWithTimeout(fetch(`${cfg.supabaseUrl}/rest/v1/app_settings?select=key,value&key=eq.${PC_FROZEN_SWITCH_KEY}`, { method: "GET", headers: rpcHeaders }), PC_FROZEN_CALL_TIMEOUT_MS, "switch read");
    on = r.ok ? pcFrozenSwitchValue(await r.json()) : false;
  } catch { on = false; }
  pcFrozen.switchOn = on; pcFrozen.switchAt = nowMs;
  if (pcFrozen.switchLogged !== on) { pcFrozen.switchLogged = on; pcFrozenLog(`switch ${on ? "ON" : "off"}`); }
  return on;
}

// Wait for a gap in the normal lane (≤ PC_FROZEN_GAP_WAIT_MS). true = free now.
async function pcFrozenWaitForGap() {
  for (let i = 0; i <= PC_FROZEN_GAP_WAIT_MS / PC_FROZEN_GAP_POLL_MS; i++) {
    if (!pcFrozenLaneBusy(Date.now())) return true;
    await pcSleep(PC_FROZEN_GAP_POLL_MS);
  }
  return false;
}
// The frozen content script must answer on the tab; otherwise inject it (self-heal) and ask again.
async function pcFrozenEnsureScript(tabId) {
  const ping = () => pcFrozenWithTimeout(pcSendTab(tabId, { type: "PC_FROZEN_PING" }), PC_FROZEN_PING_TIMEOUT_MS, "frozen ping").catch(() => null);
  let r = await ping();
  if (r && r.script === "emap-frozen") return true;
  const injected = await pcInject(tabId, "emap-frozen-711.js");
  pcFrozenLog(`emap-frozen-711.js not answering on tab ${tabId} → ${injected ? "injected" : "inject failed"}`);
  if (!injected) return false;
  r = await ping();
  return Boolean(r && r.script === "emap-frozen");
}

// ── the kick (the ONE line in pcRunOnce calls this; it never awaits) ───────────
function pcFrozenKick(pass) {
  if (pcFrozen.busy) return;
  pcFrozen.busy = true;
  Promise.resolve()
    .then(() => pcFrozenPass(pass))
    .catch((e) => { pcFrozen.lastError = (e && e.message) || "pass threw"; pcFrozenLog(`pass failed: ${pcFrozen.lastError}`); })
    .then(() => { pcFrozen.busy = false; });
}

async function pcFrozenPass(pass) {
  const nowMs = Date.now();
  const cfg = await pcConfig();
  if (!cfg.multiSeller || cfg.paused) return;
  if (!pcPassLeader(pass)) return;                 // leader-only, exactly like the normal lane
  const rpc = pcEv.rpc;                             // the normal lane's admin RPC context (set every pass it runs)
  if (!rpc || !rpc.cfg || !rpc.rpcHeaders) return;
  if (!(await pcFrozenReadSwitch(rpc.cfg, rpc.rpcHeaders, nowMs))) return;
  if (pcInMaintenance(nowMs)) return;               // 01:00–05:00 Taipei: no frozen requests
  const emapTabId = (pcEv.emap.tabId && !pcEv.emap.error) ? pcEv.emap.tabId : null;
  if (!emapTabId) return;                           // no live E-Map tab → nothing (the row stays queued)
  let rows = [];
  try {
    const r = await pcFrozenWithTimeout(fetch(`${rpc.cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_frozen_pending`, {
      method: "POST", headers: rpc.rpcHeaders, body: JSON.stringify({ p_limit: PC_FROZEN_LIMIT }),
    }), PC_FROZEN_CALL_TIMEOUT_MS, "pending read");
    if (!r.ok) { pcFrozenLog(`pending rpc_${r.status}`); return; }
    rows = await r.json();
  } catch (e) { pcFrozenLog(`pending failed: ${(e && e.message) || "network"}`); return; }
  pcFrozen.passes += 1;
  // fairness: while dry rows are waiting in the normal queue, one frozen row per pass
  let queueBusy = false;
  try { queueBusy = Number((((await pcGet(PC_STATUS_KEY, {})) || {}).multiQueueDepth) || 0) > 0; } catch { queueBusy = false; }
  const picks = pcFrozenPickRows(rows, pcFrozen.storeAt, Date.now(), queueBusy ? PC_FROZEN_LIMIT_BUSY : PC_FROZEN_LIMIT);
  let scriptOk = null;                              // pinged once per pass, lazily
  for (const pick of picks) {
    if (!pcPassLeader(pass)) { pcFrozenLog("lease lost mid-pass — stopping"); break; }
    if (pcInMaintenance(Date.now())) { pcFrozenLog("maintenance window started — stopping"); break; }
    if (!(await pcFrozenWaitForGap())) { pcFrozen.skippedBusy += 1; pcFrozenLog("normal lane busy — retry next pass"); break; }
    if (scriptOk === null) scriptOk = await pcFrozenEnsureScript(emapTabId);
    if (!scriptOk) { pcFrozenLog("frozen script unavailable on the E-Map tab — retry next pass"); break; }
    let status = "unknown"; let reason = "";
    try {
      pcFrozen.storeAt.set(pick.store_id, Date.now());   // the floor starts at the request, answered or not
      const resp = await pcFrozenWithTimeout(pcSendTab(emapTabId, { type: "PC_FROZEN_CHECK", row: pick }), PC_FROZEN_CALL_TIMEOUT_MS, "frozen check");
      status = pcFrozenVerdictOf(resp);
      reason = resp ? String(resp.frozen_reason || "") : "emap tab not responding";
    } catch (e) { status = "unknown"; reason = (e && e.message) || "check threw"; }
    try {
      const w = await pcFrozenWithTimeout(fetch(`${rpc.cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_frozen_verdict`, {
        method: "POST", headers: rpc.rpcHeaders,
        body: JSON.stringify({ p_id: pick.id, p_expected_store: pick.store_id, p_status: status }),
      }), PC_FROZEN_CALL_TIMEOUT_MS, "verdict write");
      if (!w.ok) pcFrozenLog(`row=${pick.id} verdict rpc_${w.status}`);
      pcFrozen.checks += 1; if (status === "unknown") pcFrozen.unknowns += 1;
      pcFrozenLog(`row=${pick.id} store=${pick.store_id} → ${status}${reason ? ` (${reason})` : ""}`);
    } catch (e) { pcFrozenLog(`row=${pick.id} verdict write failed: ${(e && e.message) || "network"}`); }
    await pcSleep(PC_FROZEN_ROW_GAP_MS);
  }
}
