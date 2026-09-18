// SellerFlow parcel-checker — background service worker.
// ════════════════════════════════════════════════════════════════════════════
// PARCEL CHECKER — poll SellerFlowLive for unchecked parcel_scans, run the
// two session-bound 賣貨便 checks in the myship tab, write verdicts back.
// The extension is now parcel-checker only (the TikTok comment relay was removed).
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

// ── Order-list scraper writeback (parcel_tracking upsert) ──────────────────────
// The myship-order-711 content script scrapes the order list and sends the rows
// here; we upsert them into parcel_tracking with Jeff's token (own-scoped RLS —
// the DB trigger link_parcel_tracking() then fills buyer_username). REST upsert on
// (user_id, tracking_no); merge-duplicates only touches the columns we send, so the
// poller's status/ship_type/special_type are NEVER clobbered on a re-scrape.
function pcUserIdFromToken(token) {
  try {
    const seg = String(token || "").split(".")[1];
    if (!seg) return null;
    const json = JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" && json.sub ? json.sub : null;
  } catch { return null; }
}
function pcChunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function pcUpsertTracking(cfg, token, rows) {
  const uid = pcUserIdFromToken(token);
  if (!uid) return { ok: false, reason: "no_uid_in_token" };
  // ⚠️ ONLY the scraper's own columns below — the poller owns the live-status fields;
  // merge-duplicates would otherwise reset a poller-set value on a re-scrape.
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.tracking_no)
    .map((r) => ({
      user_id: uid,
      tracking_no: String(r.tracking_no),
      cm_order_no: r.cm_order_no ? String(r.cm_order_no) : null,
      recipient_name: r.recipient_name ? String(r.recipient_name) : null,
      store_id: r.store_id ? String(r.store_id) : null,
      order_amount: (r.order_amount != null && r.order_amount !== "") ? Number(r.order_amount) : null,
    }));
  if (!clean.length) return { ok: true, upserted: 0 };
  let upserted = 0;
  for (const chunk of pcChunk(clean, 500)) {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/parcel_tracking?on_conflict=user_id,tracking_no`, {
      method: "POST",
      headers: {
        apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) return { ok: false, reason: `upsert_http_${r.status}`, upserted };
    upserted += chunk.length;
  }
  return { ok: true, upserted };
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

  // TWO different origins: the FULL-STORE lookup runs in the emap.pcsc.com.tw tab
  // (byIDData + eshopGuid live there), the RESTRICTED-PHONE check in the myship tab.
  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  const emapTabId = await pcFindTab(["https://emap.pcsc.com.tw/*"]);

  let checked = 0;
  let lastStoreReason = ""; let lastPhoneReason = "";
  for (const row of rows) {
    if (pcInFlight.has(row.id)) continue;
    pcInFlight.add(row.id);
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

// Order-list scraper → upsert scraped rows into parcel_tracking. Same auth as the
// checker: read Jeff's token from the SFL tab (single-refresher bridge), never
// persist our own. No SFL tab / no token / no config → post nothing (honest reason).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PC_ORDER_ROWS") return false;
  (async () => {
    const cfg = await pcConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { sendResponse({ ok: false, reason: "no_config" }); return; }
    const sflTabId = await pcFindTab(["https://www.sellerflowlive.com/*", "https://sellerflowlive.com/*", "http://localhost:5173/*"]);
    if (!sflTabId) { sendResponse({ ok: false, reason: "no_sfl_tab" }); return; }
    const token = await pcGetToken(sflTabId);
    if (!token) { sendResponse({ ok: false, reason: "no_token" }); return; }
    const res = await pcUpsertTracking(cfg, token, message.rows);
    sendResponse(res);
  })().catch((e) => sendResponse({ ok: false, reason: "threw", detail: e && e.message }));
  return true;
});
