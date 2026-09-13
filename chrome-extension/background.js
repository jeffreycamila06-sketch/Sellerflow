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
const PC_ALARM = "parcel-checker-poll";
const PC_PERIOD_MIN = 0.75;          // 45s
const PC_ROW_GAP_MS = 2000;          // 2s between parcels (no bulk)
const PC_LIMIT = 5;
const PC_CONFIG_KEY = "pc_config";   // { supabaseUrl, supabaseAnonKey, cgdmId, ordMobile, paused }
const PC_STATUS_KEY = "pc_status";   // { sfl, myship, lastCheckAt, lastCount, lastError }
const PC_DEFAULT_URL = "https://sqeuyuktdpidmlfpqgoc.supabase.co";
const pcInFlight = new Set();        // single-flight, keyed by row id

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
  const url = `${cfg.supabaseUrl}/rest/v1/parcel_scans`
    + `?select=id,phone,store_id,customer_name`
    + `&status=neq.exported`
    + `&or=(store_full_status.is.null,phone_check_status.is.null)`
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

  const rows = res.rows.filter((row) => row && row.id && !pcInFlight.has(row.id));
  if (!rows.length) { await pcStatus({ lastCheckAt: new Date().toISOString(), lastCount: 0 }); return; }

  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  if (!myshipTabId) { await pcStatus({ myship: "no_tab" }); return; }      // no 賣貨便 tab → can't check

  let checked = 0; let sessionOk = false;
  for (const row of rows) {
    if (pcInFlight.has(row.id)) continue;
    pcInFlight.add(row.id);
    try {
      const resp = await pcSendTab(myshipTabId, { type: "PC_CHECK", row, config: { cgdmId: cfg.cgdmId, ordMobile: cfg.ordMobile } });
      // No receiver / no verdict → FAIL-SAFE 'unknown' (never skip silently as 'ok').
      const v = (resp && resp.verdict) || { store_full_status: "unknown", phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, _sessionOk: false };
      if (v._sessionOk) sessionOk = true;
      await pcWriteVerdict(cfg, token, row.id, v);
      checked += 1;
    } catch { /* leave the row unchecked (null) — next poll retries */ } finally {
      pcInFlight.delete(row.id);
    }
    await pcSleep(PC_ROW_GAP_MS); // 2s between parcels, no bulk
  }
  await pcStatus({ myship: checked > 0 && !sessionOk ? "expired" : "ok", lastCheckAt: new Date().toISOString(), lastCount: checked });
}

chrome.alarms.create(PC_ALARM, { periodInMinutes: PC_PERIOD_MIN });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === PC_ALARM) { pcPoll().catch(() => {}); } });
// Also allow the popup to trigger a poll on demand (Resume / manual refresh).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PC_POLL_NOW") { pcPoll().catch(() => {}).finally(() => sendResponse({ ok: true })); return true; }
  return false;
});
