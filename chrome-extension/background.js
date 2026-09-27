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
    // MULTI-SELLER MODE (2026-09-27, dogfood): DEFAULT OFF — the existing
    // owner-only single-config path is byte-unchanged until this is ticked.
    multiSeller: c.multiSeller === true,
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
// Self-heal (v1.7.0) — the popup's decay was three mechanisms, none of them
// the classic MV3 one: (1) Chrome Memory Saver DISCARDS backgrounded tabs →
// content script gone → "not responding" until a manual refresh; (2) a frozen
// SFL tab stops supabase-js token refresh → stale token → "Log in" while
// logged in; (3) the myship/emap statuses were only written on polls that HAD
// parcels → hours-stale badges. pcHealTab runs EVERY poll: ping → ok;
// discarded → auto tabs.reload (myship/emap ONLY — NEVER the SFL tab: an
// auto-reload there could kill a live session; clicking the tab un-discards
// it, which is what the popup now says); alive-but-dead script → re-inject
// via chrome.scripting (double-injection guarded in each content script).
function pcFindTabInfo(patterns) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: patterns }, (tabs) => resolve(tabs && tabs.length ? tabs[0] : null));
  });
}
async function pcPing(tabId) {
  const r = await pcSendTab(tabId, { type: "PC_PING" });
  return Boolean(r && r.ok);
}
function pcInject(tabId, file) {
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript({ target: { tabId }, files: [file] }, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch { resolve(false); }
  });
}
// → { state, tabId }: 'ok' | 'no_tab' | 'asleep' (discarded SFL — click it) |
//   'healing' (reload/inject fired; next poll confirms) | 'dead_script'.
async function pcHealTab(patterns, file, allowReload) {
  const tab = await pcFindTabInfo(patterns);
  if (!tab) return { state: "no_tab", tabId: null };
  if (await pcPing(tab.id)) return { state: "ok", tabId: tab.id };
  if (tab.discarded || tab.frozen) {
    if (!allowReload) return { state: "asleep", tabId: null };     // SFL: never auto-reload
    try { chrome.tabs.reload(tab.id); } catch { /* next poll retries */ }
    return { state: "healing", tabId: null };
  }
  if (await pcInject(tab.id, file)) {
    if (await pcPing(tab.id)) return { state: "ok", tabId: tab.id };
    return { state: "healing", tabId: null };
  }
  return { state: "dead_script", tabId: null };
}
// Stale-token detection without any network: the JWT's exp claim. The SFL web
// app is the ONLY refresher (never the extension — the two-refreshers sign-out
// bug must not return); a frozen tab stops refreshing, so an expired exp means
// "click the SellerFlowLive tab once" — the popup says exactly that.
function pcTokenExpired(token) {
  try {
    const seg = String(token || "").split(".")[1];
    const json = JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" && json.exp * 1000 < Date.now() - 30_000; // 30s skew grace
  } catch { return false; }
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
// here; we upsert them into parcel_tracking with Jeff's token (own-scoped RLS). When a
// row carries the buyer's handle (其他資訊/備註 / the export handle column) we write it
// DIRECTLY to buyer_username — no dependence on the shipping_entries fuzzy-match trigger,
// which stays as a fallback (COALESCE-preserves a provided value). REST upsert on
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
  // The scraper's own columns only. The poller owns the live-status fields; merge-duplicates
  // touches ONLY columns present in the JSON, so the poller-set live-status values are never
  // clobbered on a re-scrape.
  const base = (r) => ({
    user_id: uid,
    tracking_no: String(r.tracking_no),
    cm_order_no: r.cm_order_no ? String(r.cm_order_no) : null,
    recipient_name: r.recipient_name ? String(r.recipient_name) : null,
    store_id: r.store_id ? String(r.store_id) : null,
    order_amount: (r.order_amount != null && r.order_amount !== "") ? Number(r.order_amount) : null,
  });
  const valid = (Array.isArray(rows) ? rows : []).filter((r) => r && r.tracking_no);
  const hasHandle = (r) => r.buyer_username != null && String(r.buyer_username).trim() !== "";
  // buyer_username is written VERBATIM (never clean "IG"/"line"/"fb"), set directly from
  // the export's handle column so the Pickup Status screen can show @handle without the
  // (unused) shipping_entries fuzzy match. ⚠️ CRUCIAL: ONLY rows that HAVE a handle carry
  // the column — sending buyer_username:null would merge-duplicate OVER a previously-set
  // handle. So partition into two upserts: with-handle rows get the extra column, handle-
  // less rows keep the old 5-column shape. (PostgREST also requires a uniform key set per
  // request, so these MUST be separate calls.) recipient_name stays null.
  const withHandle = valid.filter(hasHandle).map((r) => ({ ...base(r), buyer_username: String(r.buyer_username) }));
  const noHandle = valid.filter((r) => !hasHandle(r)).map(base);
  if (!withHandle.length && !noHandle.length) return { ok: true, upserted: 0 };
  let upserted = 0;
  for (const group of [withHandle, noHandle]) {
    for (const chunk of pcChunk(group, 500)) {
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
  }
  return { ok: true, upserted };
}

async function pcPoll() {
  const cfg = await pcConfig();
  if (cfg.paused) { await pcStatus({ sfl: "paused", myship: "paused" }); return; }
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { await pcStatus({ sfl: "no_config", lastError: "Set Supabase URL + anon key in the popup" }); return; }

  // Self-heal: health-check ALL THREE tabs EVERY poll (the old code only wrote
  // the myship/emap statuses on polls that had parcels → hours-stale badges).
  // myship/emap may auto-reload when discarded; the SFL tab NEVER does.
  const sflHealth = await pcHealTab(
    ["https://www.sellerflowlive.com/*", "https://sellerflowlive.com/*", "http://localhost:5173/*"],
    "sellerflow-bridge.js", false);
  const myshipHealth = await pcHealTab(["https://myship.7-11.com.tw/*"], "myship-711.js", true);
  // 2026-09-27: PCSC moved the 賣貨便 store-search E-Map to emap.unipcsc.com.tw
  // (same /ecmap/default.aspx page + byIDData.aspx endpoint, verified live —
  // the content script's RELATIVE fetch follows whichever origin it runs on).
  // The old domain still serves, so BOTH are matched.
  const emapHealth = await pcHealTab(["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"], "emap-711.js", true);
  const myshipTabId = myshipHealth.tabId;
  const emapTabId = emapHealth.tabId;
  await pcStatus({ myship: myshipHealth.state, emap: emapHealth.state });

  if (sflHealth.state !== "ok") { await pcStatus({ sfl: sflHealth.state }); return; } // no bridge → nothing to poll
  const sflTabId = sflHealth.tabId;
  const token = await pcGetToken(sflTabId);
  if (!token) { await pcStatus({ sfl: "no_token" }); return; }             // logged out → stop
  if (pcTokenExpired(token)) { await pcStatus({ sfl: "expired" }); return; } // frozen SFL tab stopped refreshing → click it

  // MULTI-SELLER MODE: the legacy single-config lane must NOT also process rows
  // (2026-09-27 two-lane race — it raced pcPollMulti on the owner's own rows,
  // wrote verdicts from the popup config, and bypassed cache-apply). Keep the
  // health/self-heal/token prelude above (both lanes rely on healthy tabs), but
  // stop here: pcPollMulti owns ALL row work in multi mode, so the popup
  // GM/phone is never used and can be blank.
  if (cfg.multiSeller) { await pcStatus({ lastCheckAt: new Date().toISOString(), lastCount: 0 }); return; }

  const res = await pcFetchUnchecked(cfg, token).catch(() => ({ ok: false, status: 0, rows: [] }));
  if (!res.ok) { await pcStatus({ sfl: res.status === 401 ? "expired" : "connected", lastError: `parcel_scans read failed (${res.status})` }); return; }
  await pcStatus({ sfl: "connected", lastError: "" });

  const rows = res.rows.filter((row) => row && row.id && !pcInFlight.has(row.id));
  if (!rows.length) { await pcStatus({ lastCheckAt: new Date().toISOString(), lastCount: 0 }); return; }

  // TWO different origins: the FULL-STORE lookup runs in the emap tab
  // (byIDData + eshopGuid live there), the RESTRICTED-PHONE check in the myship tab.

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
    emap: emapTabId ? (lastStoreReason ? "issue" : "ok") : emapHealth.state,
    myship: myshipTabId ? (lastPhoneReason ? "issue" : "ok") : myshipHealth.state,
    lastStoreReason, lastPhoneReason,
    lastStoreAt: lastStoreReason ? new Date().toISOString() : null,
    lastPhoneAt: lastPhoneReason ? new Date().toISOString() : null,
    lastCheckAt: new Date().toISOString(), lastCount: checked,
  });
}

// ── MULTI-SELLER QUEUE (2026-09-27) — extension-as-shared-worker. Consumes
// the FAIR cross-seller queue via two admin-gated SECURITY DEFINER RPCs
// (sql/53). ⚠️ ATTRIBUTION HARD RULE (safety property, contract-test-pinned):
// ATTRIBUTION: every check uses the ROW OWNER's own GM (row.gm_id, from the
// RPC's config INNER JOIN) — never the popup config. The SENDER (ordMobile) is a
// SINGLE admin-configured clean phone (row.sender_phone = CHECK_SENDER_PHONE),
// the same for all sellers: a restricted seller's own phone would poison every
// verdict, and a fixed clean sender sidesteps it (probe-proven — ordMobile isn't
// cross-validated against the GM; no order is created). need_phone/need_store: a
// cache-satisfied half is skipped and its verdict sent NULL so the RPC never
// clobbers it. A periodic health-check guards the single sender: if it ever goes
// restricted, the RPC pauses the whole lane (no mass-flagging real buyers).
const PC_HEALTH_INTERVAL_MS = 5 * 60 * 1000; // sender health-check cadence
const PC_HEALTH_STORE_ID = "195965";          // any valid 6-digit store — the probe checks the PHONE, not this store
let pcLastHealthAt = 0;

// Validate a KNOWN-CLEAN probe buyer through CHECK_SENDER_PHONE. restricted →
// the sender is poisoned → flip the DB health flag false (pending RPC pauses) +
// distinct alert. ok → recover the flag. unknown → inconclusive, leave as-is.
async function pcSenderHealthCheck(cfg, rpcHeaders) {
  if (Date.now() - pcLastHealthAt < PC_HEALTH_INTERVAL_MS) return;
  pcLastHealthAt = Date.now();
  let conf;
  try {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_check_config`, { method: "POST", headers: rpcHeaders, body: "{}" });
    if (!r.ok) return;
    conf = await r.json();
  } catch { return; }
  if (!conf || !conf.sender_phone || !conf.probe_buyer || !conf.sample_gm) return;
  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  if (!myshipTabId) return; // can't probe without a myship tab — try next cycle
  const resp = await pcSendTab(myshipTabId, {
    type: "PC_CHECK_PHONE", anon: true,
    row: { store_id: PC_HEALTH_STORE_ID, phone: conf.probe_buyer, customer_name: "SFL sender health" },
    config: { cgdmId: conf.sample_gm, ordMobile: conf.sender_phone },
  });
  const st = resp && resp.phone_check_status;
  const setHealth = (ok) => fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_set_parcel_sender_health`, { method: "POST", headers: rpcHeaders, body: JSON.stringify({ p_ok: ok }) }).catch(() => {});
  if (st === "restricted") {
    await setHealth(false);
    await pcStatus({ multi: "sender_poisoned" });
    console.warn(`[PC-SENDER] POISONED: sender ${conf.sender_phone} returns 'restricted' for a known-clean buyer — verdicts PAUSED. Swap parcel_check_sender_phone to a clean account.`);
  } else if (st === "ok" && conf.healthy !== "true") {
    await setHealth(true);
    console.log(`[PC-SENDER] recovered: sender ${conf.sender_phone} healthy again — resuming.`);
  }
}

async function pcPollMulti() {
  const cfg = await pcConfig();
  if (!cfg.multiSeller || cfg.paused) return;
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
  const sflTabId = await pcFindTab(["https://www.sellerflowlive.com/*", "https://sellerflowlive.com/*", "http://localhost:5173/*"]);
  if (!sflTabId) return;
  const token = await pcGetToken(sflTabId);
  if (!token) return;
  const rpcHeaders = {
    apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json",
  };
  // sender health-check FIRST (time-gated) — runs even while paused so a swapped
  // /recovered sender flips the lane back on; the pending RPC stays empty until it does.
  try { await pcSenderHealthCheck(cfg, rpcHeaders); } catch { /* health check best-effort */ }
  let rows = [];
  try {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_checks_pending`, {
      method: "POST", headers: rpcHeaders, body: JSON.stringify({ p_limit: PC_LIMIT }),
    });
    if (!r.ok) { await pcStatus({ multi: `rpc_${r.status}` }); return; }
    rows = await r.json();
    if (!Array.isArray(rows)) rows = [];
  } catch { await pcStatus({ multi: "rpc_error" }); return; }
  await pcStatus({ multi: "ok", multiQueueDepth: rows.length ? Number(rows[0].queue_depth) || 0 : 0, multiLastAt: new Date().toISOString() });
  if (!rows.length) return;

  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  const emapTabId = await pcFindTab(["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"]);
  for (const row of rows) {
    if (!row || !row.id || pcInFlight.has(row.id)) continue;
    pcInFlight.add(row.id);
    try {
      // store half (GM-free — byIDData needs no per-seller params).
      // NO tab / no script response → leave the half NULL (row stays queued,
      // next poll retries) — NEVER stamp 'unknown' for our own missing tab, or
      // one closed-tab night burns the whole cross-seller queue permanently.
      // A content-script "unknown" (real timeout/session answer) IS written.
      // Write ONLY a DEFINITIVE verdict. A transient 'unknown' (timeout / redirect
      // / non-JSON / no tab) is "not learned" → leave the half NULL so the pending
      // RPC re-selects the row next poll (eventual consistency). Stamping 'unknown'
      // is non-null → the row would never re-check → a transient hiccup could ship a
      // genuinely-restricted buyer (audit M1). A permanently-unverifiable row just
      // keeps retrying — harmless (it still exports; bad data is fixed via edit).
      let storeStatus = null;
      if (row.need_store && emapTabId) {
        const sResp = await pcSendTab(emapTabId, { type: "PC_CHECK_STORE", row });
        if (sResp && (sResp.store_full_status === "open" || sResp.store_full_status === "full")) storeStatus = sResp.store_full_status;
      }
      // phone half — the ROW OWNER's GM + phone, never the global config.
      // anon:true → the check runs credential-less so the body ordMobile is the
      // authoritative sender (the owner's myship login is irrelevant); this is
      // the core multi-seller fix (2026-09-27).
      let phoneStatus = null, phoneMessage = null, phoneUntil = null, pTokenMs = null, pPostMs = null;
      if (row.need_phone && myshipTabId) {
        const pResp = await pcSendTab(myshipTabId, {
          type: "PC_CHECK_PHONE", row, anon: true,
          config: { cgdmId: row.gm_id, ordMobile: row.sender_phone },
        });
        if (pResp) { pTokenMs = pResp.tokenMs ?? null; pPostMs = pResp.postMs ?? null; }
        // DEFINITIVE only (audit M1): 'unknown' → leave null → retry next poll.
        if (pResp && (pResp.phone_check_status === "ok" || pResp.phone_check_status === "restricted")) {
          phoneStatus = pResp.phone_check_status;
          phoneMessage = pResp.phone_check_message ?? null;
          phoneUntil = pResp.phone_restricted_until ?? null;
        }
      }
      // nothing learned (both halves null) → no verdict write, row retries later
      if (storeStatus !== null || phoneStatus !== null) {
        await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_check_verdict`, {
          method: "POST", headers: rpcHeaders,
          body: JSON.stringify({
            p_id: row.id,
            p_store_full_status: storeStatus,
            p_phone_check_status: phoneStatus,
            p_phone_check_message: phoneMessage,
            p_phone_restricted_until: phoneUntil,
          }),
        });
        // Latency instrumentation (dogfood): encode→verdict + the anon phone
        // check's per-GM token GET and POST costs. row.created_at = the encode.
        const latMs = row.created_at ? (Date.now() - new Date(row.created_at).getTime()) : null;
        console.log(`[PC-LAT] latencyMs=${latMs} tokenMs=${pTokenMs} postMs=${pPostMs} queue=${rows.length} phone=${phoneStatus} store=${storeStatus}`);
      }
    } catch { /* leave the row pending — the next poll retries */ } finally {
      pcInFlight.delete(row.id);
    }
    await pcSleep(PC_ROW_GAP_MS);
  }
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
  try { await pcPollMulti(); } catch { /* keep looping */ }
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

// ── Export-reader writeback (buyer handle only) ───────────────────────────────
// The 匯出報表 .xlsx pairs the F-code (配送單編號) with the buyer handle (其它資訊 / FB·LINE·IG)
// on the 訂單匯入 tab. Unlike the on-screen scraper, the export is authoritative for the HANDLE
// LINK and NOTHING else, so we write ONLY buyer_username (+ keys): merge-duplicates on
// (user_id, tracking_no) then never clobbers the poller's live-status columns OR the scraper's
// cm_order_no/store_id/order_amount. Handle-less rows are dropped (the F-code alone is already
// covered by the poller/scraper). Handle stored VERBATIM (never clean "IG"/"line"/"fb").
async function pcUpsertHandles(cfg, token, rows) {
  const uid = pcUserIdFromToken(token);
  if (!uid) return { ok: false, reason: "no_uid_in_token" };
  const withHandle = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.tracking_no && r.buyer_username != null && String(r.buyer_username).trim() !== "")
    .map((r) => ({ user_id: uid, tracking_no: String(r.tracking_no), buyer_username: String(r.buyer_username) }));
  if (!withHandle.length) return { ok: true, upserted: 0 };
  let upserted = 0;
  for (const chunk of pcChunk(withHandle, 500)) {
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

// Export reader (myship-export-711.js) → upsert the buyer handles. SAME auth as the scraper:
// read Jeff's token from the SFL tab (single-refresher bridge), never persist our own.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PC_EXPORT_HANDLES") return false;
  (async () => {
    const cfg = await pcConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { sendResponse({ ok: false, reason: "no_config" }); return; }
    const sflTabId = await pcFindTab(["https://www.sellerflowlive.com/*", "https://sellerflowlive.com/*", "http://localhost:5173/*"]);
    if (!sflTabId) { sendResponse({ ok: false, reason: "no_sfl_tab" }); return; }
    const token = await pcGetToken(sflTabId);
    if (!token) { sendResponse({ ok: false, reason: "no_token" }); return; }
    sendResponse(await pcUpsertHandles(cfg, token, message.rows));
  })().catch((e) => sendResponse({ ok: false, reason: "threw", detail: e && e.message }));
  return true;
});
