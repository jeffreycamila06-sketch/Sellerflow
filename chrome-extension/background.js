const APP_PORTS = new Set();
const PENDING_KEY = "sflc_pending_comments";
const HISTORY_KEY = "sflc_comment_history";
const MAX_PENDING = 300;
const MAX_HISTORY = 1000;

function getPending() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PENDING_KEY], (result) => {
      resolve(Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY] : []);
    });
  });
}

function setPending(comments) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PENDING_KEY]: comments.slice(-MAX_PENDING) }, resolve);
  });
}

async function queueComment(comment) {
  const pending = await getPending();
  pending.push(comment);
  await setPending(pending);
}

function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get([HISTORY_KEY], (result) => {
      resolve(Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : []);
    });
  });
}

function setHistory(comments) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [HISTORY_KEY]: comments.slice(-MAX_HISTORY) }, resolve);
  });
}

async function saveHistory(comment) {
  const history = await getHistory();
  const keyOf = (item) => [item.platform || "TikTok", item.handle || "", item.comment || "", item.timestamp || ""].join("|");
  const nextKey = keyOf(comment);
  if (!history.some((item) => keyOf(item) === nextKey)) {
    history.push(comment);
    await setHistory(history);
  }
}

async function flushPending(port) {
  const pending = await getPending();
  if (!pending.length) return;
  for (const comment of pending) {
    port.postMessage({ type: "SFL_COMMENT", comment });
  }
  await setPending([]);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sellerflow-live-comment-app") return;
  APP_PORTS.add(port);
  flushPending(port);
  port.onDisconnect.addListener(() => APP_PORTS.delete(port));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SFL_COMMENT" || !message.comment) return false;
  const comment = message.comment;
  saveHistory(comment);
  if (APP_PORTS.size) {
    for (const port of APP_PORTS) {
      port.postMessage({ type: "SFL_COMMENT", comment });
    }
    sendResponse({ ok: true, delivered: true });
    return true;
  }

  queueComment(comment).then(() => {
    sendResponse({ ok: true, delivered: false, queued: true });
  });
  return true;
});

// ════════════════════════════════════════════════════════════════════════════
// PARCEL CHECKER (v1.1) — poll SellerFlowLive for unchecked parcel_scans, run the
// two session-bound 賣貨便 checks in the myship tab, write verdicts back.
// SEPARATE from the TikTok comment relay above (that logic is untouched).
//
// AUTH (per research): re-read Jeff's Supabase access token from the SFL tab each
// poll (via sellerflow-bridge.js). NEVER persist/refresh our own session (two
// refreshers of one identity sign Jeff out). No token / no tab → stop polling.
// FAIL-SAFE: the checker only ever WRITES what the 7-11 content script returns,
// which is 'unknown' on any doubt — never a fabricated 'ok'.
// ════════════════════════════════════════════════════════════════════════════
const PC_ALARM = "parcel-checker-keepalive";
const PC_KEEPALIVE_MIN = 0.5;        // chrome.alarms floor (~30s) — only revives the loop if the SW was suspended
const PC_POLL_MS = 5000;             // ~5s cadence via a self-scheduling loop (alarms can't go this fast)
const PC_ROW_GAP_MS = 2000;          // 2s between parcels (no bulk)
const PC_LIMIT = 5;
const PC_CONFIG_KEY = "pc_config";   // { supabaseUrl, supabaseAnonKey, cgdmId, ordMobile, paused }
const PC_STATUS_KEY = "pc_status";   // { sfl, myship, lastCheckAt, lastCount, lastError }
const PC_DEFAULT_URL = "https://sqeuyuktdpidmlfpqgoc.supabase.co";
const pcInFlight = new Set();        // single-flight, keyed by row id
// AUTO-RETRY of 'unknown' verdicts. 'unknown' is often TRANSIENT (a store that
// briefly went "close" and reopens, a session hiccup), so a row that came back
// 'unknown' (with NO null verdict left) is re-checked on the next cycles — capped
// at PC_MAX_RETRY re-checks per row to avoid an infinite loop on a genuinely stuck
// store. In-memory ONLY (no DB column): if the extension restarts the count resets
// to 0, which just allows a few more retries — harmless. FINAL verdicts
// (open/full/ok/restricted) are never counted here; a row resolved to all-final is
// dropped from the map. NULL verdicts are the normal first-pass (not a "retry").
const PC_MAX_RETRY = 3;
const pcRetry = new Map();           // rowId -> # of re-checks done while unknown-only

function pcGet(key, fallback) {
  return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve(r[key] ?? fallback)));
}
function pcSet(key, value) {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
}
async function pcConfig() {
  const c = (await pcGet(PC_CONFIG_KEY, {})) || {};
  return {
    supabaseUrl: (c.supabaseUrl || PC_DEFAULT_URL).replace(/\/+$/, ""),
    supabaseAnonKey: c.supabaseAnonKey || "",
    cgdmId: c.cgdmId || "",
    ordMobile: c.ordMobile || "",
    paused: c.paused === true,
  };
}
async function pcStatus(patch) {
  const cur = (await pcGet(PC_STATUS_KEY, {})) || {};
  await pcSet(PC_STATUS_KEY, { ...cur, ...patch });
}

// Find a tab by URL prefix list; returns the first tab id or null.
function pcFindTab(patterns) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: patterns }, (tabs) => resolve(tabs && tabs.length ? tabs[0].id : null));
  });
}
// Promise wrapper over sendMessage that resolves null instead of throwing when
// there is no receiver (tab not ready / content script not injected).
function pcSendTab(tabId, msg) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp ?? null);
      });
    } catch { resolve(null); }
  });
}
const pcSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pcGetToken(sflTabId) {
  const resp = await pcSendTab(sflTabId, { type: "SFL_GET_TOKEN" });
  return resp && typeof resp.token === "string" && resp.token ? resp.token : null;
}

async function pcFetchUnchecked(cfg, token) {
  // Candidates = a verdict still NULL (never tried) OR a verdict 'unknown'
  // (transient — auto-retried up to the cap in pcPoll). The two verdict columns
  // are selected so pcPoll can classify null-vs-unknown (retry accounting).
  const url = `${cfg.supabaseUrl}/rest/v1/parcel_scans`
    + `?select=id,phone,store_id,customer_name,store_full_status,phone_check_status`
    + `&status=neq.exported`
    + `&or=(store_full_status.is.null,phone_check_status.is.null,store_full_status.eq.unknown,phone_check_status.eq.unknown)`
    + `&order=created_at.desc&limit=${PC_LIMIT}`;
  const r = await fetch(url, { headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, status: r.status, rows: [] };
  const rows = await r.json().catch(() => []);
  return { ok: true, status: 200, rows: Array.isArray(rows) ? rows : [] };
}

async function pcWriteVerdict(cfg, token, id, verdict) {
  const body = {
    store_full_status: verdict.store_full_status,
    store_full_at: new Date().toISOString(),
    phone_check_status: verdict.phone_check_status,
    phone_check_at: new Date().toISOString(),
    phone_check_message: verdict.phone_check_message ?? null,
    phone_restricted_until: verdict.phone_restricted_until ?? null,
  };
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/parcel_scans?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function pcPoll() {
  const cfg = await pcConfig();
  if (cfg.paused) { await pcStatus({ sfl: "paused", myship: "paused" }); return; }
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { await pcStatus({ sfl: "no_config", lastError: "Set Supabase URL + anon key in the popup" }); return; }

  const sflTabId = await pcFindTab(["https://www.sellerflowlive.com/*", "https://sellerflowlive.com/*", "http://localhost:5173/*"]);
  if (!sflTabId) { await pcStatus({ sfl: "no_tab" }); return; }             // no SFL tab → stop
  const token = await pcGetToken(sflTabId);
  if (!token) { await pcStatus({ sfl: "no_token" }); return; }             // logged out → stop

  const res = await pcFetchUnchecked(cfg, token).catch(() => ({ ok: false, status: 0, rows: [] }));
  if (!res.ok) { await pcStatus({ sfl: res.status === 401 ? "no_token" : "connected", lastError: `parcel_scans read failed (${res.status})` }); return; }
  await pcStatus({ sfl: "connected", lastError: "" });

  // Eligible = not in-flight AND (a verdict still NULL → first pass) OR
  // (unknown-only AND under the retry cap → transient auto-retry). A row whose
  // 'unknown' has already been re-checked PC_MAX_RETRY times is left alone (Jeff
  // manual-rechecks). Fully-final rows never reach here (query excludes them).
  const rows = res.rows.filter((row) => {
    if (!row || !row.id || pcInFlight.has(row.id)) return false;
    const hasNull = row.store_full_status == null || row.phone_check_status == null;
    if (hasNull) return true;
    const hasUnknown = row.store_full_status === "unknown" || row.phone_check_status === "unknown";
    return hasUnknown && (pcRetry.get(row.id) || 0) < PC_MAX_RETRY;
  });
  if (!rows.length) { await pcStatus({ lastCheckAt: new Date().toISOString(), lastCount: 0 }); return; }

  // TWO different origins: the FULL-STORE lookup runs in the emap.pcsc.com.tw tab
  // (byIDData + eshopGuid live there), the RESTRICTED-PHONE check in the myship tab.
  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  const emapTabId = await pcFindTab(["https://emap.pcsc.com.tw/*"]);

  let checked = 0;
  let lastStoreReason = ""; let lastPhoneReason = "";
  for (const row of rows) {
    if (pcInFlight.has(row.id)) continue;
    pcInFlight.add(row.id);
    // A candidate with BOTH verdicts already non-null is an unknown-only row =
    // a re-check → count it toward the cap. (A NULL-verdict row is the first
    // pass, not a retry.)
    const isRetry = row.store_full_status != null && row.phone_check_status != null;
    if (isRetry) pcRetry.set(row.id, (pcRetry.get(row.id) || 0) + 1);
    try {
      // Store check → emap tab. No emap tab / no receiver → FAIL-SAFE 'unknown' + reason.
      let store = { store_full_status: "unknown", store_reason: "no emap.pcsc.com.tw tab open" };
      if (emapTabId) {
        const sResp = await pcSendTab(emapTabId, { type: "PC_CHECK_STORE", row });
        store = sResp && typeof sResp.store_full_status === "string"
          ? { store_full_status: sResp.store_full_status, store_reason: sResp.store_reason || "" }
          : { store_full_status: "unknown", store_reason: "emap tab not responding (reload emap page)" };
      }
      // Phone check → myship tab.
      let phone = { phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, phone_reason: "no myship.7-11.com.tw tab open" };
      if (myshipTabId) {
        const pResp = await pcSendTab(myshipTabId, { type: "PC_CHECK_PHONE", row, config: { cgdmId: cfg.cgdmId, ordMobile: cfg.ordMobile } });
        phone = pResp && typeof pResp.phone_check_status === "string"
          ? { phone_check_status: pResp.phone_check_status, phone_check_message: pResp.phone_check_message ?? null, phone_restricted_until: pResp.phone_restricted_until ?? null, phone_reason: pResp.phone_reason || "" }
          : { phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, phone_reason: "myship tab not responding (reload 賣貨便 page)" };
      }
      if (store.store_reason) lastStoreReason = store.store_reason;
      if (phone.phone_reason) lastPhoneReason = phone.phone_reason;
      await pcWriteVerdict(cfg, token, row.id, {
        store_full_status: store.store_full_status,
        phone_check_status: phone.phone_check_status,
        phone_check_message: phone.phone_check_message,
        phone_restricted_until: phone.phone_restricted_until,
      });
      // Fully resolved (no 'unknown' left) → drop the retry counter (done). Still
      // 'unknown' → keep the count so the next cycles march toward the cap.
      if (store.store_full_status !== "unknown" && phone.phone_check_status !== "unknown") pcRetry.delete(row.id);
      checked += 1;
    } catch { /* leave the row unchecked (null) — next poll retries */ } finally {
      pcInFlight.delete(row.id);
    }
    await pcSleep(PC_ROW_GAP_MS); // 2s between parcels, no bulk
  }
  // Per-origin status + the exact last reason for each check (popup shows these,
  // so Jeff never has to open DevTools).
  await pcStatus({
    emap: emapTabId ? (lastStoreReason ? "issue" : "ok") : "no_tab",
    myship: myshipTabId ? (lastPhoneReason ? "issue" : "ok") : "no_tab",
    lastStoreReason, lastPhoneReason,
    lastStoreAt: lastStoreReason ? new Date().toISOString() : null,
    lastPhoneAt: lastPhoneReason ? new Date().toISOString() : null,
    lastCheckAt: new Date().toISOString(), lastCount: checked,
  });
}

// ~5s cadence via a self-scheduling setTimeout loop (chrome.alarms is clamped to
// ~30s, too slow for "save → ~5-9s → badge"). pcInFlight (by id) + the 2s
// per-parcel gap already prevent overlap; a single-flight `pcTimer` guard prevents
// two loops. Each pcPoll does network work, which keeps the SW alive between ticks;
// if the SW is ever suspended (timer lost), the keepalive alarm below restarts it.
let pcTimer = null;
async function pcTick() {
  pcTimer = null;                 // this run consumed the scheduled slot
  try { await pcPoll(); } catch { /* keep looping */ }
  pcScheduleLoop(PC_POLL_MS);     // re-arm ~5s after this run finishes
}
function pcScheduleLoop(delayMs) {
  if (pcTimer !== null) return;   // a tick is already scheduled — no double loop
  pcTimer = setTimeout(pcTick, delayMs);
}

// Keepalive alarm (~30s): its ONLY job is to restart the loop if the SW was
// suspended (module globals reset → pcTimer null). While the SW is alive the 5s
// loop drives the cadence; this never runs a second concurrent poll.
chrome.alarms.create(PC_ALARM, { periodInMinutes: PC_KEEPALIVE_MIN });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === PC_ALARM) pcScheduleLoop(0); });
// Kick the loop on SW startup too.
pcScheduleLoop(0);

// Allow the popup to trigger a poll on demand (Resume / manual refresh) — run now
// and let the loop keep going.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PC_POLL_NOW") { pcPoll().catch(() => {}).finally(() => sendResponse({ ok: true })); return true; }
  return false;
});
