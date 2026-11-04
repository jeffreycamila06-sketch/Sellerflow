// SellerFlow parcel-checker — FROZEN (冷凍) store check. ADD-ONLY module (1.17.0).
// ════════════════════════════════════════════════════════════════════════════
// Loaded by background.js through ONE importScripts line and kicked by ONE line in
// pcRunOnce (`pcFrozenKick(pass)`). NOTHING here is awaited by the normal lane: the
// kick returns at once, the pass runs on its own promise, and every step is wrapped —
// a throw, a timeout or a bad answer marks only THAT parcel 'unknown' and can never
// stop, delay or retry the normal store / phone check.
//
// What it does, for 冷凍 parcels only (the DB decides which rows — dry parcels are never
// read here): POST byIDData with cate=27 (the frozen E-Map category; the normal check is
// cate=3) through its OWN content script (emap-frozen-711.js) on the E-Map tab the
// normal lane already picked, then write the verdict through its OWN RPC.
//   enable  → ok          (the store takes frozen)
//   disable → no_frozen   (can't take frozen now — permanent or full, we can't tell →
//                          blocked from export, re-checked once an hour like 'full')
//   close / NO2 / anything else / no answer → unknown (re-checked every 10 min)
//
// KILL SWITCH: app_settings 'frozen_store_check_enabled' — only the exact string 'true'
// turns it on; a read failure = off. OFF = the normal lane is byte-for-byte today's; the
// only request this module makes is ONE read-only GET of that setting per minute.
//
// REQUEST BUDGET: cate=27 only for 冷凍 rows; the shared cache (store_frozen_cache,
// sql/142) answers no_frozen for 1 h and ok for 10 min; the pending RPC never hands out
// a store checked live in the last 10 min, and this module keeps the same 10-min floor
// per store in memory (belt and braces) — never more than 1 frozen request per store per
// 10 min across all sellers. Same maintenance window (01:00–05:00 Taipei) as the normal
// store check: no frozen request inside it. Leader-only, like the normal lane.
const PC_FROZEN_SWITCH_KEY = "frozen_store_check_enabled";
const PC_FROZEN_SWITCH_TTL_MS = 60 * 1000;          // re-read the switch at most once a minute
const PC_FROZEN_LIMIT = 3;                          // rows per pass (one per store)
const PC_FROZEN_ROW_GAP_MS = 2000;                  // same per-parcel gap as the normal lane
const PC_FROZEN_STORE_GAP_MS = 10 * 60 * 1000;      // ≥ 10 min between live requests for one store
const PC_FROZEN_VERDICTS = ["ok", "no_frozen"];     // definitive answers; everything else = 'unknown'
const pcFrozen = {
  busy: false,                 // single-flight: a slow pass never overlaps the next kick
  switchOn: false, switchAt: 0, switchLogged: null,
  storeAt: new Map(),          // store id → last live request (ms)
  passes: 0, checks: 0, unknowns: 0, lastError: "",
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

// ── the switch (read-only GET, once a minute; any failure = off) ──────────────
async function pcFrozenReadSwitch(cfg, rpcHeaders, nowMs) {
  if (nowMs - pcFrozen.switchAt < PC_FROZEN_SWITCH_TTL_MS) return pcFrozen.switchOn;
  let on = false;
  try {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/app_settings?select=key,value&key=eq.${PC_FROZEN_SWITCH_KEY}`, { method: "GET", headers: rpcHeaders });
    on = r.ok ? pcFrozenSwitchValue(await r.json()) : false;
  } catch { on = false; }
  pcFrozen.switchOn = on; pcFrozen.switchAt = nowMs;
  if (pcFrozen.switchLogged !== on) { pcFrozen.switchLogged = on; pcFrozenLog(`switch ${on ? "ON" : "off"}`); }
  return on;
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
    const r = await fetch(`${rpc.cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_frozen_pending`, {
      method: "POST", headers: rpc.rpcHeaders, body: JSON.stringify({ p_limit: PC_FROZEN_LIMIT }),
    });
    if (!r.ok) { pcFrozenLog(`pending rpc_${r.status}`); return; }
    rows = await r.json();
  } catch (e) { pcFrozenLog(`pending failed: ${(e && e.message) || "network"}`); return; }
  pcFrozen.passes += 1;
  const picks = pcFrozenPickRows(rows, pcFrozen.storeAt, Date.now(), PC_FROZEN_LIMIT);
  for (const pick of picks) {
    let status = "unknown"; let reason = "";
    try {
      pcFrozen.storeAt.set(pick.store_id, Date.now());   // the floor starts at the request, answered or not
      const resp = await pcSendTab(emapTabId, { type: "PC_FROZEN_CHECK", row: pick });
      status = pcFrozenVerdictOf(resp);
      reason = resp ? String(resp.frozen_reason || "") : "emap tab not responding";
    } catch (e) { status = "unknown"; reason = (e && e.message) || "check threw"; }
    try {
      const w = await fetch(`${rpc.cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_frozen_verdict`, {
        method: "POST", headers: rpc.rpcHeaders,
        body: JSON.stringify({ p_id: pick.id, p_expected_store: pick.store_id, p_status: status }),
      });
      if (!w.ok) pcFrozenLog(`row=${pick.id} verdict rpc_${w.status}`);
      pcFrozen.checks += 1; if (status === "unknown") pcFrozen.unknowns += 1;
      pcFrozenLog(`row=${pick.id} store=${pick.store_id} → ${status}${reason ? ` (${reason})` : ""}`);
    } catch (e) { pcFrozenLog(`row=${pick.id} verdict write failed: ${(e && e.message) || "network"}`); }
    await pcSleep(PC_FROZEN_ROW_GAP_MS);
  }
}
