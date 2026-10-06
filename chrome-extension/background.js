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
// 1.14.8: every DEFINITIVE store answer E-Map can give. company = closed-area
// (factory/park) store, a valid store with no open/full info; not_found = "NO2",
// no such store. All four are real verdicts (the session resolved), 'unknown' is not.
const PC_STORE_VERDICTS = ["open", "full", "company", "not_found"];
function pcIsStoreVerdict(s) { return PC_STORE_VERDICTS.includes(s); }
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
    // 1.14.6: honour the nightly 7-ELEVEN maintenance window (01:00–05:00 Taipei).
    // On unless explicitly set false (tests turn it off unless they opt in).
    maintenanceWindow: c.maintenanceWindow !== false,
    // 1.15.0: optional "Device name" (popup) — the label the lease / Admin card show.
    deviceName: typeof c.deviceName === "string" ? c.deviceName : "",
  };
}
async function pcStatus(patch) {
  const cur = (await pcGet(PC_STATUS_KEY, {})) || {};
  await pcSet(PC_STATUS_KEY, { ...cur, ...patch });
}

// A tab address for LOG LINES: origin + path only. The query string can carry the E-Map
// session value (eshopGuid) — never log or store it (1.16.0 logging fix).
function pcSafeUrl(u) {
  if (!u) return "";
  try { const x = new URL(String(u)); return `${x.origin}${x.pathname}`; } catch { return String(u).split(/[?#]/)[0]; }
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
// skipIds (1.16.0): tab ids never to return (the frozen E-Map tabs) — the first OTHER match wins.
function pcFindTabInfo(patterns, skipIds) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: patterns }, (tabs) => {
      const list = (tabs || []).filter((t) => !(skipIds && skipIds.has(t.id)));
      resolve(list.length ? list[0] : null);
    });
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
// NEVER LET THE WORKER'S TABS SLEEP (2026-09-27): Chrome discarding a background
// tab is what killed the emap store check (a discarded tab has no running script;
// a reload of an expired session lands on error.aspx). Pin every tab the worker
// depends on (SFL / myship / emap) as not auto-discardable. Idempotent, best-effort,
// and re-applied EVERY poll (pcHealTab runs each tick) — so it also survives an
// extension reload. The v1.7 auto-reload stays as the fallback only.
function pcNoDiscard(tabId) {
  try { chrome.tabs.update(tabId, { autoDiscardable: false }, () => { void chrome.runtime.lastError; }); } catch { /* best-effort */ }
}

// → { state, tabId }: 'ok' | 'no_tab' | 'asleep' (discarded SFL — click it) |
//   'healing' (reload/inject fired; next poll confirms) | 'dead_script'.
async function pcHealTab(patterns, file, allowReload, skipIds) {
  const tab = await pcFindTabInfo(patterns, skipIds);
  if (!tab) return { state: "no_tab", tabId: null };
  pcNoDiscard(tab.id);
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
// JWT exp as a readable time for the [PC-SFL] log line.
function pcTokenExpStr(token) {
  try {
    const j = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof j.exp === "number" ? new Date(j.exp * 1000).toISOString() : "?";
  } catch { return "?"; }
}
// 1.14.5 — ask the SFL tab's bridge to refresh the session IN PLACE (bridge →
// MAIN helper → the app's own supabase client) and hand back the fresh token.
// { token, hadSession }: hadSession===false = actually logged out; null = the
// helper/app build is absent (worker falls back to a GET re-navigation).
async function pcSflRefresh(sflTabId) {
  const resp = await pcSendTab(sflTabId, { type: "SFL_REFRESH_TOKEN" });
  const token = resp && typeof resp.token === "string" && resp.token ? resp.token : null;
  const hadSession = resp && typeof resp.hadSession === "boolean" ? resp.hadSession : null;
  return { token, hadSession };
}
// The SFL token ladder, run in the poll prelude. Returns a fresh token or null
// (with sfl status already written on failure). NEVER refreshes our own session.
async function pcSflToken(sflTabId) {
  let token = await pcGetToken(sflTabId);
  if (token && !pcTokenExpired(token)) {
    if (pcEv.sfl.reloadedEpisode) { console.log(`[PC-SFL] token refreshed via=reload exp=${pcTokenExpStr(token)}`); pcEv.sfl.reloadedEpisode = false; }
    return token;
  }
  // stale / missing → try an in-place refresh (no reload)
  const r = await pcSflRefresh(sflTabId);
  if (r.token && !pcTokenExpired(r.token)) {
    console.log(`[PC-SFL] token refreshed via=bridge exp=${pcTokenExpStr(r.token)}`);
    pcEv.sfl.reloadedEpisode = false;
    return r.token;
  }
  if (r.hadSession === false) { await pcStatus({ sfl: "signed_out" }); pcEv.sfl.reloadedEpisode = false; return null; } // logged out → red, no reload
  // helper/app absent or refresh failed → ONE GET re-navigation per episode
  // (re-inits supabase-js → _recoverAndRefresh → fresh token in localStorage).
  // Never under an in-flight REST call.
  if (!pcEv.sfl.reloadedEpisode && !pcEv.sfl.fetchInFlight) {
    pcEv.sfl.reloadedEpisode = true;
    const info = await pcFindTabInfo(PC_SFL_PATTERNS);
    if (info && info.url) { try { chrome.tabs.update(info.id, { url: info.url }); } catch { /* next poll retries */ } console.log(`[PC-SFL] re-navigating SFL tab ${info.id} to refresh the session (in-place refresh unavailable)`); }
    await pcStatus({ sfl: "refreshing" }); return null;   // next poll re-handshakes → via=reload
  }
  await pcStatus({ sfl: token ? "expired" : "signed_out" }); return null; // already re-navigated this episode
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

async function pcPoll(pass) {
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
  // 1.16.0: the health check heals / pins the NORMAL E-Map tab — never a frozen one (else the
  // normal tab could lose its no-discard pin while the frozen tab took its place here).
  const emapHealth = await pcHealTab(["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"], "emap-711.js", true, pcFrozenTabIds());
  const myshipTabId = myshipHealth.tabId;
  let emapTabId = emapHealth.tabId;
  // 1.14.0: the per-tab status keys (myship / emap / emapSession) have ONE writer
  // — pcRefreshTabStatus in pcTick, evidence-based. Here we only record health.
  pcEv.health = { myship: myshipHealth, emap: emapHealth };

  if (sflHealth.state !== "ok") { await pcStatus({ sfl: sflHealth.state }); return; } // no bridge → nothing to poll
  const sflTabId = sflHealth.tabId;
  // 1.14.5: the token ladder — read → in-place refresh (no reload) → GET re-nav
  // fallback → signed_out. Replaces the old "expired → click the tab" dead end.
  const token = await pcSflToken(sflTabId);
  if (!token) return; // sfl status already written (refreshing / signed_out / expired)

  // 1.15.0 LEASE — right after the token ladder, BEFORE anything that does work. Decides
  // this pass's role for BOTH lanes (pass.leader is read by pcPollMulti / pcRunOnce).
  await pcLeaseRenew(cfg, token);
  const leaderNow = pcLeaderNowCur();
  if (pass) pass.leader = leaderNow;
  if (!leaderNow) {
    // STANDBY: tabs healed + token fresh (above) = ready to take over; no row work here.
    pcEv.lastAnyNeedStore = false; // no pending read on standby → the E-Map keepalive keeps running
    await pcStatus({ sfl: "connected", lastError: "" });
    return;
  }

  // MULTI-SELLER MODE: the legacy single-config lane must NOT also process rows
  // (2026-09-27 two-lane race — it raced pcPollMulti on the owner's own rows,
  // wrote verdicts from the popup config, and bypassed cache-apply). Keep the
  // health/self-heal/token prelude above (both lanes rely on healthy tabs), but
  // stop here: pcPollMulti owns ALL row work in multi mode, so the popup
  // GM/phone is never used and can be blank.
  // 1.13.0 FIX: refresh the SFL status HERE, before the multi-mode early return.
  // sfl:"connected" used to be written only after pcFetchUnchecked (skipped in
  // multi mode), so a transient 'expired'/'no_token' written right after an
  // extension reload stuck in storage forever → popup lied ("Click the
  // SellerFlowLive tab once") while the token was fine and RPCs succeeded. The
  // token checks above just passed, so the tab IS connected — say so every tick.
  if (cfg.multiSeller) { await pcStatus({ sfl: "connected", lastError: "", lastCheckAt: new Date().toISOString(), lastCount: 0 }); return; }

  pcEv.sfl.fetchInFlight = true;
  const res = await pcFetchUnchecked(cfg, token).catch(() => ({ ok: false, status: 0, rows: [] }));
  pcEv.sfl.fetchInFlight = false;
  if (!res.ok) { await pcStatus({ sfl: res.status === 401 ? "expired" : "connected", lastError: `parcel_scans read failed (${res.status})` }); return; }
  await pcStatus({ sfl: "connected", lastError: "" });

  const rows = res.rows.filter((row) => row && row.id && !pcInFlight.has(row.id));
  if (!rows.length) { await pcStatus({ lastCheckAt: new Date().toISOString(), lastCount: 0 }); return; }
  // 1.16.0: the legacy lane never asks the normal question on a frozen tab. The pick learns which
  // tabs are frozen (their own page says so); if the healed tab is one, use the normal pick.
  try { await pcPickEmapTab(); } catch { /* keep the healed tab */ }
  if (emapTabId != null && pcFrozenTabIds().has(emapTabId)) emapTabId = (pcEv.emap.tabId != null && !pcEv.emap.error) ? pcEv.emap.tabId : null;

  // TWO different origins: the FULL-STORE lookup runs in the emap tab
  // (byIDData + eshopGuid live there), the RESTRICTED-PHONE check in the myship tab.

  let checked = 0;
  let lastStoreReason = ""; let lastPhoneReason = "";
  for (const row of rows) {
    if (pcInFlight.has(row.id)) continue;
    if (!(await pcLeaseOkForRow(cfg, token))) break; // 1.15.0: lost / stale lease → stop before this row
    pcInFlight.add(row.id);
    try {
      // Store check → emap tab. No emap tab / no receiver → FAIL-SAFE 'unknown' + reason.
      let store = { store_full_status: "unknown", store_reason: "no emap.pcsc.com.tw tab open" };
      if (emapTabId) {
        const sResp = await pcSendTab(emapTabId, { type: "PC_CHECK_STORE", row });
        store = sResp && typeof sResp.store_full_status === "string"
          ? { store_full_status: sResp.store_full_status, store_reason: sResp.store_reason || "" }
          : { store_full_status: "unknown", store_reason: "emap tab not responding (reload emap page)" };
        // 1.14.0 evidence (legacy lane too): a resolved verdict = tab healthy
        if (pcIsStoreVerdict(store.store_full_status)) pcEmapVerdict(Date.now());
        else pcEmapMiss(Date.now(), store.store_reason, Boolean(sResp && sResp.transient));
      }
      // Phone check → myship tab.
      let phone = { phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, phone_reason: "no myship.7-11.com.tw tab open" };
      if (myshipTabId) {
        const pResp = await pcSendTab(myshipTabId, { type: "PC_CHECK_PHONE", row, config: { cgdmId: cfg.cgdmId, ordMobile: cfg.ordMobile } });
        phone = pResp && typeof pResp.phone_check_status === "string"
          ? { phone_check_status: pResp.phone_check_status, phone_check_message: pResp.phone_check_message ?? null, phone_restricted_until: pResp.phone_restricted_until ?? null, phone_reason: pResp.phone_reason || "" }
          : { phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, phone_reason: "myship tab not responding (reload 賣貨便 page)" };
        if (phone.phone_check_status === "ok" || phone.phone_check_status === "restricted") pcEv.myship.lastVerdictAt = Date.now();
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
  // 1.14.0: emap/myship badges are NOT written here anymore (single evidence-based
  // writer in pcTick); only the reasons + counts.
  pcEv.lastStoreReason = lastStoreReason; pcEv.lastPhoneReason = lastPhoneReason;
  await pcStatus({
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
const PC_HEALTH_CONFIRM_MS = 60 * 1000;       // 1.14.7: re-probe 1 min after a first 'restricted' (2 in a row pause)
let pcLastHealthAt = 0;
let pcSenderStrikes = 0;                      // 1.14.7: consecutive 'restricted' probes
let pcSenderHealthy = null;                   // 1.14.7: last-known DB flag (null = not read yet)

// ══ 1.14.0 — EVIDENCE-BASED STATUS · E-MAP TAB PICK · KEEPALIVE · RECOVERY ═══
// Spec: hands-off (session never idle-expires, tabs never sleep, auto re-
// handshake after a reload); status is TRUE per tab (green ONLY when that tab's
// checks resolved recently, otherwise name the tab + the exact fix); when several
// emap tabs exist pick the one with a live guid and log which; nothing dies
// silently (boot beacon + heartbeat); every new block is wrapped so a failure can
// never stop the row loop. pcRefreshTabStatus (pcTick) is the SINGLE writer of
// the per-tab status keys — no more ping-based badges, no more stale writes.
const PC_EMAP_PATTERNS = ["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"];
const PC_RECENT_MS = 6 * 60 * 1000;          // "resolved recently" window = keepalive 5m + slack
const PC_KEEPALIVE_MS = 5 * 60 * 1000;
const PC_KEEPALIVE_STORE = "198002";          // known store; the verdict is logged, never written
const PC_RELOAD_COOLDOWN_MS = 60 * 1000;      // one recovery attempt per minute
const PC_MAX_RELOADS = 2;                     // then it's a real expiry → red, re-open via 選擇門市
// 1.14.2 — CONSERVATIVE recovery (unattended Mac): never while a real verdict landed in
// the last 5 min; only after ≥3 consecutive definitive misses spanning ≥2 min; a
// byIDData timeout / network error is transient and never counts as a miss.
const PC_RECOVER_VERDICT_GUARD_MS = 5 * 60 * 1000;
const PC_RECOVER_MIN_MISSES = 3;
const PC_RECOVER_MIN_SPAN_MS = 2 * 60 * 1000;
const PC_HEARTBEAT_EVERY = 12;                // ~60s at the 5s cadence
const PC_WORKER_STATE_PUSH_MS = 60 * 1000;    // Admin-card mirror cadence (also on change)
let pcLastKeepaliveAt = 0;
// ── 1.16.0 FROZEN (冷凍) store check ─────────────────────────────────────────
// 7-11 answers the store question per MODE, so a frozen parcel is asked in a SEPARATE
// frozen E-Map tab, opened from 7-11's public frozen picker ONLY while frozen rows wait
// (the server switch app_settings parcel_check_frozen_enabled decides — rows arrive with
// frozen=true only when it is on). No frozen keepalive; the tab we opened is closed after
// 10 min with no frozen row waiting. One frozen request at a time, ≥ 3 s apart. E0014
// (7-11 busy) on either tab is transient: back off, never a give-up, never OK.
const PC_FROZEN_PICKER_URL = "https://myship2.7-11.com.tw/Home/FreezeStoreLookup/?customType=Receiver&eshopid=8Q7";
const PC_FROZEN_GAP_MS = 3000;                 // ≥ 3 s between frozen requests
const PC_FROZEN_IDLE_CLOSE_MS = 10 * 60 * 1000; // close the tab we opened after 10 min unused
const PC_FROZEN_OPEN_WAIT_MS = 60 * 1000;       // give a just-opened tab 1 min to land before another open
const PC_FROZEN_MAX_OPENS = 2;                  // opens per episode (a frozen verdict ends the episode)
const PC_FROZEN_DEAD_PAUSE_MS = 30 * 60 * 1000; // after that, wait 30 min before trying again
// 1.16.1: ONE 7-11 busy answer (E0014) pauses ALL store requests (normal + frozen): 1 min, then
// 2, 5, 10 min (cap) while it keeps happening; the first clean store answer resets it. Busy
// never makes a row OK or 'unknown' and never counts toward a give-up or the recovery ladder.
const PC_BUSY_PAUSE_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const pcBusy = { until: 0, streak: 0 };
function pcBusyPauseMs(streak) { // PURE
  return PC_BUSY_PAUSE_MS[Math.min(Math.max(1, streak), PC_BUSY_PAUSE_MS.length) - 1];
}
function pcBusyPaused(now) { return now < pcBusy.until; }
function pcBusyHit(now, where) {
  pcBusy.streak += 1; pcBusy.until = now + pcBusyPauseMs(pcBusy.streak);
  console.log(`[PC-BUSY] 7-11 busy (E0014) on the ${where} check — ALL store requests paused ${pcBusyPauseMs(pcBusy.streak) / 1000}s (busy #${pcBusy.streak})`);
}
function pcBusyClear() {
  if (pcBusy.streak) console.log(`[PC-BUSY] 7-11 answered cleanly — store requests resume (after ${pcBusy.streak} busy)`);
  pcBusy.streak = 0; pcBusy.until = 0;
}
const PC_FROZEN_VERDICTS = ["open", "frozen_unavailable", "company", "not_found"];
// ownedTabId = the tab WE opened: kept while it is still landing (on the 7-11 picker /
// redirect, not yet an E-Map page) and forgotten only when the tab itself is gone
// (tabs.onRemoved) or we replace / close it. bad = frozen tabs dropped after 2 unclean
// answers — never picked again until they are closed.
const pcFrz = { tabId: null, ownedTabId: null, opens: 0, lastOpenAt: 0, lastReqAt: 0, lastNeededAt: 0, misses: 0, state: "off", bad: new Set(), known: new Set(), unknownWritten: false };
// Every tab currently known to be frozen (its page said so on the last pick, or we opened it).
function pcFrozenTabIds() {
  const ids = new Set(pcFrz.known);
  if (pcFrz.ownedTabId != null) ids.add(pcFrz.ownedTabId);
  if (pcFrz.tabId != null) ids.add(pcFrz.tabId);
  return ids;
}
const PC_SFL_PATTERNS = ["https://www.sellerflowlive.com/*", "https://sellerflowlive.com/*", "http://localhost:5173/*"];
const pcEv = {
  bootAt: Date.now(), tick: 0, lastAnyNeedStore: false, health: null, rpc: null,
  lastStoreReason: "", lastPhoneReason: "",
  // 1.14.5 SFL token refresh: reloadedEpisode = one GET re-nav per expiry episode
  // (reset by the next healthy token → no loop); fetchInFlight = a REST call is
  // running (never re-navigate the SFL tab under it).
  sfl: { reloadedEpisode: false, fetchInFlight: false },
  emap: { tabId: null, url: null, guid: false, error: false, present: false, lastVerdictAt: 0, lastMissAt: 0, misses: 0, firstMissAt: 0, lastMissReason: "", reloadAt: 0, reloads: 0, state: null,
    // 1.14.3 unattended re-mint (one attempt per 'dead' episode): tried / until (20 s
    // window while we wait for the new E-Map tab) / oldTabId (closed on adoption) /
    // result ("" | "no_cart_detail" | "click_refused: …" | "timeout")
    remint: { tried: false, until: 0, oldTabId: null, result: "" } },
  myship: { lastVerdictAt: 0, state: null },
  lastPush: { at: 0, sig: "" },
  // 1.14.6 — verdictGen: bumped by every definitive store verdict (any store id), so a
  // row's repeated misses count toward the ladder at most once per generation.
  // maintEnabled: pc_config.maintenanceWindow (re-read every tick). inMaint: the
  // previous tick was inside the window (edge → 05:00 re-queue). requeueDue: a reason
  // string while a re-queue of given-up rows is owed; requeueAt: next attempt time.
  verdictGen: 0, maintEnabled: true, inMaint: false, requeueDue: "", requeueAt: 0, lastGiveUpAt: 0,
  // 1.15.0 — H1 degraded tracker (pcDegradedStep): dead ms outside maintenance, last eval, flag
  deg: { ms: 0, lastAt: 0, on: false },
};

// ══ 1.14.6 — E-MAP STORE-CHECK RESILIENCE ══════════════════════════════════════
// A store id with no clear E-Map answer used to be retried every 5 s forever and
// each miss counted toward the recovery ladder, so ONE bad id re-opened the E-Map
// tab every ~2 min and stalled every seller. Now, per parcel_scans id (in memory):
// backoff 15 s → 30 s → 1 min → 2 min; the store half gives up after 5 failed
// attempts (writes 'unknown' — the phone half NEVER, audit M1); a row adds at most
// ONE miss to the ladder until another store id resolves; given-up rows are
// re-queued (admin_parcel_check_requeue, sql/66) when the lane recovers and at 05:00.
// 01:00–05:00 Asia/Taipei (7-ELEVEN maintenance): misses don't count, nothing gives
// up, retries every 10 min.
const PC_BACKOFF_MS = [15 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000]; // after failure 1 / 2 / 3 / 4+
const PC_STORE_GIVE_UP = 5;
const PC_MAINT_RETRY_MS = 10 * 60 * 1000;
const PC_MAINT_START_H = 1, PC_MAINT_END_H = 5;           // Asia/Taipei hours [1, 5)
const PC_REQUEUE_SINCE_MS = 6 * 60 * 60 * 1000;
const PC_REQUEUE_RETRY_MS = 60 * 1000;
const PC_FETCH_LIMIT = 25;                                 // look past rows in backoff; still ≤ PC_LIMIT checks per poll
// 1.16.1: tell the pending RPC this machine can ask the frozen question (sql/81
// p_frozen_capable) — only then is it handed a frozen row's store half. A server without
// that parameter (sql/81 not applied) answers 404 → ask the old way, and try the new way
// again after 10 min (sql/81 may be applied by then). Until then frozen rows simply wait.
const PC_CAPABLE_RETRY_MS = 10 * 60 * 1000;
let pcCapableUnsupportedAt = 0;
function pcPendingBody(now) {
  return pcCapableUnsupportedAt && now - pcCapableUnsupportedAt < PC_CAPABLE_RETRY_MS
    ? { p_limit: PC_FETCH_LIMIT }
    : { p_limit: PC_FETCH_LIMIT, p_frozen_capable: true };
}
const pcBackoff = new Map(); // parcel_scans id → { storeFails, storeNextAt, phoneFails, phoneNextAt, countedGen, seenAt }
// PURE: wait after the Nth consecutive failure (N ≥ 1).
function pcBackoffDelay(fails) {
  return PC_BACKOFF_MS[Math.min(Math.max(1, fails), PC_BACKOFF_MS.length) - 1];
}
// 1.14.9 — PHONE half only: a token-GET TIMEOUT / NETWORK error (no answer from
// 7-11 at all — the anon GET hung until our abort) retries on a faster ladder,
// counted from the END of the failed attempt. Any real 7-11 answer that isn't
// ok/restricted (rejected / html / redirect / http / bad_json), a POST timeout
// (7-11 may have processed it), a missing tab or a config problem keeps the slow
// ladder above. Store / E-Map timing is untouched.
const PC_PHONE_FAST_BACKOFF_MS = [5 * 1000, 10 * 1000, 20 * 1000, 60 * 1000, 2 * 60 * 1000]; // after failure 1 / 2 / 3 / 4 / 5+ (cap = the old max)
const PC_PHONE_TOKEN_RETRY_FAILS = 2; // the in-attempt immediate token retry only while phoneFails < 2
function pcPhoneFastKind(kind) { return kind === "timeout" || kind === "network"; }
// no answer at all (GET or POST) → pause that shop's other rows for this pass
function pcPhoneNoAnswer(kind) { return pcPhoneFastKind(kind) || kind === "post_timeout" || kind === "post_network"; }
function pcPhoneBackoffDelay(fails, kind) {
  if (!pcPhoneFastKind(kind)) return pcBackoffDelay(fails);
  return PC_PHONE_FAST_BACKOFF_MS[Math.min(Math.max(1, fails), PC_PHONE_FAST_BACKOFF_MS.length) - 1];
}
// PURE: hour of day in Asia/Taipei (UTC+8, no daylight saving) — independent of
// the laptop's own time zone.
function pcTaipeiHour(nowMs) {
  const day = 24 * 3600 * 1000;
  return Math.floor((((nowMs + 8 * 3600 * 1000) % day) + day) % day / (3600 * 1000));
}
function pcInMaintenanceAt(nowMs) {
  const h = pcTaipeiHour(nowMs);
  return h >= PC_MAINT_START_H && h < PC_MAINT_END_H;
}
function pcInMaintenance(nowMs) {
  return pcEv.maintEnabled !== false && pcInMaintenanceAt(nowMs);
}
function pcBackoffEntry(id, now) {
  let b = pcBackoff.get(id);
  if (!b) { b = { storeFails: 0, storeNextAt: 0, phoneFails: 0, phoneNextAt: 0, countedGen: -1, seenAt: now }; pcBackoff.set(id, b); }
  return b;
}
// Put given-up rows (store 'unknown', ≤ 6 h old, not exported) back in the queue and
// forget every row's backoff. Retried each minute until the RPC answers.
async function pcRequeueUnknown(now) {
  if (!pcEv.requeueDue || !pcEv.rpc || now < pcEv.requeueAt) return;
  const { cfg, rpcHeaders } = pcEv.rpc; const reason = pcEv.requeueDue;
  pcBackoff.clear();
  let r = null;
  try {
    r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_check_requeue`, {
      method: "POST", headers: rpcHeaders, body: JSON.stringify({ p_since: new Date(now - PC_REQUEUE_SINCE_MS).toISOString() }),
    });
  } catch { r = null; }
  if (!r || !r.ok) {
    pcEv.requeueAt = now + PC_REQUEUE_RETRY_MS;
    console.log(`[PC-BACKOFF] requeue after ${reason} failed (${r ? `http ${r.status}` : "network"}) — backoff reset, retrying in 60s`);
    return;
  }
  const n = await r.json().catch(() => null);
  pcEv.requeueDue = ""; pcEv.requeueAt = 0;
  console.log(`[PC-BACKOFF] requeue after ${reason}: ${n ?? "?"} row(s) back in the queue, backoff reset`);
}
// PURE cadence decision (unit-tested by extracting this function's source):
// fire only when idle for the store half AND the 5-min cadence has elapsed.
function pcKeepaliveDue(now, lastAt, anyNeedStore) {
  return !anyNeedStore && (now - lastAt) >= PC_KEEPALIVE_MS;
}
// PURE tab choice: candidates [{id,url,guid,error}] in query order → the tab to
// use. Prefer a live (non-error.aspx) tab WITH a guid, sticking to the one we
// used last; then any live tab; an error.aspx-only set is returned flagged so the
// derive can say "expired". NEVER a blind tabs[0].
function pcChooseEmap(cands, preferId) {
  const live = cands.filter((c) => !c.error);
  const withGuid = live.filter((c) => c.guid);
  return withGuid.find((c) => c.id === preferId) || withGuid[0] || live.find((c) => c.id === preferId) || live[0] || cands[0] || null;
}
async function pcPickEmapTab() {
  const tabs = await new Promise((res) => { try { chrome.tabs.query({ url: PC_EMAP_PATTERNS }, (t) => res(t || [])); } catch { res([]); } });
  const cands = [];
  for (const t of tabs) {
    // error.aspx on either map section (/ecmap/ desktop, /MobileMap/ mobile — the one 選擇門市 opens now)
    const url = String(t.url || ""); const error = /\/(ecmap|mobilemap)\/error\.aspx/i.test(url);
    let guid = false, probe = null;
    if (!error) { probe = await pcSendTab(t.id, { type: "PC_EMAP_PROBE" }); guid = Boolean(probe && probe.guidFound); }
    // 1.16.0: a tab whose own page says frozen (or the frozen tab we opened) never serves the normal check
    const frozen = Boolean(probe && probe.frozen) || (pcFrz.ownedTabId != null && t.id === pcFrz.ownedTabId);
    cands.push({ id: t.id, url, guid, error, probe, frozen });
  }
  pcFrozenNoteTabs(cands);
  const pick = pcChooseEmap(cands.filter((c) => !c.frozen), pcEv.emap.tabId);
  const e = pcEv.emap;
  if (pick && pick.guid && e.remint && e.remint.until) pcAdoptRemintedTab(pick); // the click yielded a fresh session
  const nextId = pick ? pick.id : null, nextGuid = Boolean(pick && pick.guid), nextErr = Boolean(pick && pick.error);
  const changed = nextId !== e.tabId || nextGuid !== e.guid || nextErr !== e.error;
  e.present = Boolean(pick); e.tabId = nextId; e.url = pick ? pick.url : null; e.guid = nextGuid; e.error = nextErr;
  if (pick && !pick.error && !pick.guid) pcEmapMiss(Date.now(), "probe: eshopGuid not found", false); // one definitive miss per tick
  if (changed) {
    const p = pick && pick.probe;
    const diag = p ? ` section=${p.section ?? "?"} guidSource=${p.guidSource ?? "none"} guidCandidates=${p.guidCandidates ?? 0} endpoint=${p.endpoint ?? "none"}` : "";
    console.log(`[PC-EMAP] using tab ${e.tabId ?? "none"} ${pcSafeUrl(e.url)} guid=${e.guid} error=${e.error} (candidates=${cands.length})${diag}`);
  }
  return pick;
}
// 1.16.0: the usable frozen tab = a live tab whose page says frozen AND has a session value
// (prefer the one we opened). Read by pcPollMulti; never used for the normal check.
function pcFrozenNoteTabs(cands) {
  pcFrz.known = new Set(cands.filter((c) => c.frozen).map((c) => c.id));
  const ok = cands.filter((c) => c.frozen && !c.error && c.guid && c.probe && c.probe.frozen && !pcFrz.bad.has(c.id));
  const pick = ok.find((c) => c.id === pcFrz.ownedTabId) || ok.find((c) => c.id === pcFrz.tabId) || ok[0] || null;
  const next = pick ? pick.id : null;
  if (next !== pcFrz.tabId) console.log(`[PC-FROZEN] frozen tab ${next ?? "none"}${pick && pick.probe ? ` cate=${pick.probe.cate} eshopparid=${pick.probe.eshopparid} eshopid=${pick.probe.eshopid}` : ""}`);
  pcFrz.tabId = next;
  if (pcFrz.tabId != null) pcNoDiscard(pcFrz.tabId);
}
// Open the frozen picker (leader-only, while frozen rows wait). PURE decision split out for tests.
function pcFrozenOpenDecision(now, f, inMaint) {
  if (f.tabId != null) return "have";
  if (inMaint) return "maintenance";
  if (f.lastOpenAt && now - f.lastOpenAt < PC_FROZEN_OPEN_WAIT_MS) return "waiting";
  if (f.opens >= PC_FROZEN_MAX_OPENS) return now - f.lastOpenAt < PC_FROZEN_DEAD_PAUSE_MS ? "dead" : "retry";
  return "open";
}
function pcFrozenEnsureOpen(now, inMaint) {
  const d = pcFrozenOpenDecision(now, pcFrz, inMaint);
  if (d === "retry") { pcFrz.opens = 0; }
  if (d === "dead") { pcFrz.state = "dead"; return; }
  if (d !== "open" && d !== "retry") { if (d === "waiting") pcFrz.state = "opening"; return; }
  // our previous tab (session gone / not frozen) is replaced, never left behind
  if (pcFrz.ownedTabId != null) { try { chrome.tabs.remove(pcFrz.ownedTabId, () => { void chrome.runtime.lastError; }); } catch { /* gone */ } pcFrz.ownedTabId = null; }
  pcFrz.opens += 1; pcFrz.lastOpenAt = now; pcFrz.state = "opening";
  try {
    chrome.tabs.create({ url: PC_FROZEN_PICKER_URL, active: false }, (tab) => { void chrome.runtime.lastError; if (tab && tab.id != null) { pcFrz.ownedTabId = tab.id; pcNoDiscard(tab.id); } });
  } catch { /* next pass retries */ }
  console.log(`[PC-FROZEN] opening the 7-11 frozen picker (attempt ${pcFrz.opens}/${PC_FROZEN_MAX_OPENS})`);
}
// 1.16.1: frozen rows given up because the lane was dead go back in the queue once the lane can
// work again — a usable frozen tab appeared, the lane is no longer 'dead' (e.g. the idle close
// ended the episode), or the 30-min pause is over (the next frozen row then opens the picker again). PURE decision; the RPC (sql/81 admin_parcel_check_requeue_frozen)
// clears only frozen 'unknown' rows.
function pcFrozenRequeueDue(now, f) {
  if (!f.unknownWritten) return false;
  return f.tabId != null || f.state !== "dead" || now - f.lastOpenAt >= PC_FROZEN_DEAD_PAUSE_MS;
}
async function pcFrozenRequeue(now) {
  if (!pcFrozenRequeueDue(now, pcFrz) || !pcEv.rpc) return;
  const { cfg, rpcHeaders } = pcEv.rpc;
  let r = null;
  try { r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_check_requeue_frozen`, { method: "POST", headers: rpcHeaders, body: "{}" }); } catch { r = null; }
  if (!r || !r.ok) { console.log(`[PC-FROZEN] requeue failed (${r ? `http ${r.status}` : "network"}) — next pass retries`); return; }
  const n = await r.json().catch(() => null);
  pcFrz.unknownWritten = false;
  if (pcFrz.state === "dead") { pcFrz.state = "off"; pcFrz.opens = 0; } // a fresh episode: the next frozen row may open the picker
  console.log(`[PC-FROZEN] lane can work again: ${n ?? "?"} frozen row(s) back in the queue`);
}
// PURE: the frozen lane's status value (pc_status.frozen) — off | opening | ok | busy | dead.
function pcFrozenStatusValue(f) {
  if (f.state === "busy" || f.state === "dead") return f.state;
  if (f.tabId != null) return f.state === "opening" ? "opening" : "ok";
  return f.state || "off";
}
// Close the frozen tab WE opened after 10 min with no frozen row waiting (both roles).
function pcFrozenIdleClose(now) {
  if (pcFrz.ownedTabId == null) return;
  if (now - (pcFrz.lastNeededAt || pcFrz.lastOpenAt) < PC_FROZEN_IDLE_CLOSE_MS) return;
  const id = pcFrz.ownedTabId;
  try { chrome.tabs.remove(id, () => { void chrome.runtime.lastError; }); } catch { /* gone */ }
  pcFrz.ownedTabId = null; if (pcFrz.tabId === id) pcFrz.tabId = null; pcFrz.opens = 0; pcFrz.lastOpenAt = 0; pcFrz.misses = 0; pcFrz.state = "off";
  console.log(`[PC-FROZEN] closed frozen tab ${id} (no frozen parcel waiting for 10 min)`);
}

// Evidence recorders — the ONLY writers of the miss ladder.
function pcEmapVerdict(now) {
  const e = pcEv.emap;
  // 1.14.6: the lane is back after a real outage (a streak of counted misses, or a tab
  // re-open) → re-queue given-up rows. One bad row counts once, so it can't cause this.
  if (e.misses >= PC_RECOVER_MIN_MISSES || e.reloads > 0) pcEv.requeueDue = "recovery";
  e.lastVerdictAt = now; e.misses = 0; e.firstMissAt = 0; e.lastMissReason = ""; e.reloads = 0;
  pcEv.verdictGen += 1;                                           // 1.14.6: another store id resolved → rows may count again
  e.remint = { tried: false, until: 0, oldTabId: null, result: "" };   // the episode is over
}
function pcEmapMiss(now, reason, transient) {
  const e = pcEv.emap;
  if (transient) return;                                          // timeout / network blip: logged by the caller, never counted
  if (pcInMaintenance(now)) return;                               // 1.14.6: 01:00–05:00 Taipei 7-ELEVEN maintenance — never counted
  e.misses += 1; if (!e.firstMissAt) e.firstMissAt = now; e.lastMissAt = now; e.lastMissReason = String(reason || "");
}
// PURE: is a recovery attempt due? (unit-tested by source extraction)
function pcRecoveryDue(now, e) {
  if (pcInMaintenance(now)) return false;                         // 1.14.6: never re-open tabs during 7-ELEVEN maintenance
  if (e.lastVerdictAt && now - e.lastVerdictAt < PC_RECOVER_VERDICT_GUARD_MS) return false;
  if (e.misses < PC_RECOVER_MIN_MISSES) return false;
  if (!e.firstMissAt || now - e.firstMissAt < PC_RECOVER_MIN_SPAN_MS) return false;
  if (e.reloads >= PC_MAX_RELOADS) return false;
  if (e.reloadAt && now - e.reloadAt < PC_RELOAD_COOLDOWN_MS) return false;
  return true;
}
// PURE derives (unit-tested by source extraction).
function pcDeriveEmap(now, e) {
  if (!e.present) return "no_tab";
  if (e.error) return "expired";
  // 1.14.4: the 6-min window covers IDLE (no attempts), never a real failure — green
  // only if the last verdict is recent AND the latest attempt did not fail definitively.
  const recent = Boolean(e.lastVerdictAt) && now - e.lastVerdictAt <= PC_RECENT_MS;
  const latestFailed = (e.lastMissAt || 0) > (e.lastVerdictAt || 0);
  if (recent && !latestFailed) return "ok";
  if (e.remint && e.remint.until && now < e.remint.until) return "reminting"; // 選擇取貨門市 clicked, waiting for the new tab
  if (e.reloads >= PC_MAX_RELOADS && e.misses > 0) return "dead"; // recoveries didn't help → real expiry
  if (e.reloadAt && now - e.reloadAt < PC_RELOAD_COOLDOWN_MS) return "recovering";
  if (pcRecoveryDue(now, e)) return "guid_missing";               // recovery due this tick
  if (recent && latestFailed) return "degraded";                  // inside the window, but the latest check failed → amber now
  return "stale";                                                 // no recent verdict, not (yet) enough evidence to act
}
function pcDeriveMyship(now, health, m) {
  if (!health) return "starting";
  if (health.state !== "ok") return health.state;                 // no_tab / healing / dead_script / asleep
  return (now - m.lastVerdictAt <= PC_RECENT_MS) ? "ok" : "stale";
}
// KEEPALIVE (from pcTick — independent of lane, token and RPC; needs only the
// picked tab): while no pending row needs the store half, POST the EXISTING
// byIDData path on a known store every 5 min so the sliding ASP.NET session never
// idles out. Its verdict is EVIDENCE for the status (never written to a parcel).
async function pcEmapKeepalive() {
  const now = Date.now();
  if (!pcKeepaliveDue(now, pcLastKeepaliveAt, pcEv.lastAnyNeedStore)) return;
  const e = pcEv.emap;
  if (!e.tabId || e.error) return;
  if (pcBusyPaused(now)) return; // 1.16.1: 7-11 said busy — no store request at all until the pause ends
  pcLastKeepaliveAt = now;
  const resp = await pcSendTab(e.tabId, { type: "PC_CHECK_STORE", row: { store_id: PC_KEEPALIVE_STORE } });
  const verdict = resp && resp.store_full_status;
  // 1.14.8: the keepalive store is known to EXIST, so "NO2"/not_found for it says the
  // session is answering wrongly — a miss, never proof of life. company would be alive.
  const alive = pcIsStoreVerdict(verdict) && verdict !== "not_found";
  if (alive) { pcEmapVerdict(now); pcBusyClear(); }
  else if (resp && resp.busy && !pcInMaintenance(now)) pcBusyHit(now, "keepalive");
  else pcEmapMiss(now, `keepalive: ${(resp && resp.store_reason) || "no response"}`, Boolean(resp && resp.transient));
  console.log(`[PC-KEEPALIVE] tab=${e.tabId} store=${PC_KEEPALIVE_STORE} verdict=${verdict ?? "none"} guidFound=${Boolean(resp && resp.guidFound)} sessionAlive=${alive} endpoint=${(resp && resp.endpoint) || "none"}${resp && resp.store_reason ? ` reason="${resp.store_reason}"` : ""}`);
}
// SINGLE WRITER of the per-tab status keys + the auto-recovery trigger: a present
// tab whose session no longer resolves gets ONE reload per cooldown (a cookie-
// valid reload re-mints the guid; a truly expired one lands on error.aspx → red).
async function pcRefreshTabStatus(pass) {
  const now = Date.now(); const e = pcEv.emap;
  let emapState = pcDeriveEmap(now, e);
  if (emapState === "guid_missing") {
    // 1.14.2: DIALOG-FREE recovery. tabs.reload on the POST-opened E-Map tab pops
    // Chrome's "Confirm Form Resubmission" (a human-blocking modal); a GET
    // re-navigation to the same URL never does. With a live session cookie the
    // page re-mints the guid; a dead session lands on error.aspx → 'expired' (red).
    try { chrome.tabs.update(e.tabId, { url: e.url }); } catch { /* next tick retries */ }
    e.reloadAt = now; e.reloads += 1; pcLastKeepaliveAt = 0;     // verify as soon as it lands
    console.log(`[PC-EMAP] recover reason=${JSON.stringify(e.lastMissReason || "no guid")} misses=${e.misses} lastVerdictAgo=${e.lastVerdictAt ? Math.round((now - e.lastVerdictAt) / 1000) : "never"}s attempt=${e.reloads}/${PC_MAX_RELOADS} tab=${e.tabId} via=GET ${pcSafeUrl(e.url)}`);
    emapState = "recovering";
  }
  // 1.14.3: the GET re-opens didn't help → ONE unattended re-mint per episode via the
  // parked 賣貨便 /cart/detail tab (the myship content script clicks the real
  // 選擇取貨門市 button; nothing is stored). Then 20 s to see a guid-bearing E-Map
  // tab appear (adopted in pcPickEmapTab); otherwise red with the exact reason.
  const inMaint = pcInMaintenance(now);
  // 1.14.7: a truly expired session lands on error.aspx ('expired') and a closed tab is
  // 'no_tab' — both now get the same one-per-episode re-mint as 'dead', but only when a
  // 賣貨便 tab is parked on /cart/detail (otherwise they keep their honest label).
  const remintable = emapState === "dead" || ((emapState === "expired" || emapState === "no_tab") && await pcCartDetailParked());
  // 1.15.0: the re-mint clicks a real 賣貨便 button (the page POSTs) → leader-only.
  if (remintable && e.remint && !e.remint.tried && !inMaint && pcPassLeader(pass)) {
    try { emapState = await pcTryRemint(now); } catch (err) { e.remint.tried = true; e.remint.result = `remint threw: ${err && err.message ? err.message : err}`; }
  }
  if (emapState === "dead" && e.remint && e.remint.until && now >= e.remint.until) { e.remint.until = 0; if (!e.remint.result) e.remint.result = "timeout"; }
  const myshipState = pcDeriveMyship(now, pcEv.health && pcEv.health.myship, pcEv.myship);
  // 1.14.6: the maintenance window just ended (first tick at/after 05:00 Taipei) →
  // re-queue. (The recovery trigger lives in pcEmapVerdict / pcAdoptRemintedTab.)
  if (pcEv.inMaint && !inMaint) pcEv.requeueDue = "maintenance_end";
  if (!pcEv.inMaint && inMaint) console.log("[PC-BACKOFF] 7-ELEVEN maintenance window (01:00–05:00 Taipei) — misses uncounted, retries every 10 min");
  pcEv.inMaint = inMaint;
  e.state = emapState; pcEv.myship.state = myshipState;
  // 1.15.1 H1: degraded = a duty tab absent 60 s / dead 120 s outside the maintenance window (see pcDegradedStep)
  const wasDegraded = pcEv.deg.on;
  const myshipHealth = pcEv.health && pcEv.health.myship ? pcEv.health.myship.state : null;
  const degKind = pcDutyTabsAbsent(emapState, myshipHealth) ? "no_tab" : pcDutyTabsDead(emapState, myshipHealth) ? "dead" : null;
  pcEv.deg = pcDegradedStep(pcEv.deg, now, degKind, inMaint);
  if (pcEv.deg.on !== wasDegraded) console.log(`[PC-LEASE] ${pcLease.label || "worker"}: ${pcEv.deg.on ? `DEGRADED — ${degKind === "no_tab" ? `duty tab absent ${PC_DEGRADED_NO_TAB_MS / 1000}+ s (no_tab threshold)` : `duty tabs dead ${PC_DEGRADED_DEAD_MS / 1000}+ s (dead threshold)`} (emap=${emapState}, myship=${myshipHealth ?? "?"})` : "no longer degraded"}`);
  let emapDomain = null; try { emapDomain = e.url ? new URL(e.url).hostname : null; } catch { emapDomain = null; }
  await pcStatus({
    emap: emapState, myship: myshipState, emapSession: emapState, emapDomain, emapTabId: e.tabId, emapDeadReason: (e.remint && e.remint.result) || "",
    lastStoreReason: pcEv.lastStoreReason, lastPhoneReason: pcEv.lastPhoneReason,
    lastStoreVerdictAt: e.lastVerdictAt || null, lastStoreMissAt: e.lastMissAt || null, lastPhoneVerdictAt: pcEv.myship.lastVerdictAt || null, bootAt: pcEv.bootAt,
    inMaintenanceWindow: inMaint, lastGiveUpAt: pcEv.lastGiveUpAt || null, degraded: pcEv.deg.on,
  });
}
const PC_CART_DETAIL_PATTERN = "https://myship.7-11.com.tw/cart/detail*";
async function pcCartDetailParked() {
  const tabs = await new Promise((res) => { try { chrome.tabs.query({ url: PC_CART_DETAIL_PATTERN }, (t) => res(t || [])); } catch { res([]); } });
  return tabs.some((t) => !/\/error/i.test(String(t.url || "")));
}
const PC_REMINT_WINDOW_MS = 20 * 1000;
async function pcTryRemint(now) {
  const e = pcEv.emap;
  e.remint.tried = true;
  const tabs = await new Promise((res) => { try { chrome.tabs.query({ url: PC_CART_DETAIL_PATTERN }, (t) => res(t || [])); } catch { res([]); } });
  const cart = tabs.find((t) => !/\/error/i.test(String(t.url || ""))) || null;
  if (!cart) { e.remint.result = "no_cart_detail"; console.log("[PC-EMAP] re-mint skipped: no 賣貨便 tab parked on /cart/detail"); return "dead"; }
  try { pcNoDiscard(cart.id); } catch { /* best-effort */ }
  const resp = await pcSendTab(cart.id, { type: "PC_CLICK_PICK_STORE" });
  if (!resp || !resp.clicked) { e.remint.result = `click_refused: ${(resp && resp.reason) || "myship tab not responding"}`; console.log(`[PC-EMAP] re-mint refused on tab ${cart.id}: ${e.remint.result}`); return "dead"; }
  e.remint.until = now + PC_REMINT_WINDOW_MS; e.remint.oldTabId = e.tabId; e.remint.result = ""; pcLastKeepaliveAt = 0;
  console.log(`[PC-EMAP] re-mint: clicked 選擇取貨門市 (${resp.text || ""}) on 賣貨便 tab ${cart.id}; waiting ≤${PC_REMINT_WINDOW_MS / 1000}s for a new E-Map tab (old tab ${e.tabId ?? "none"})`);
  return "reminting";
}
// Called by pcPickEmapTab once a guid-bearing tab is picked while a re-mint is pending:
// adopt it, close the old dead tab, pin it, and start a fresh ladder.
function pcAdoptRemintedTab(pick) {
  const e = pcEv.emap; const old = e.remint.oldTabId;
  e.remint.until = 0; e.remint.result = ""; e.reloads = 0; e.misses = 0; e.firstMissAt = 0; e.reloadAt = 0; pcLastKeepaliveAt = 0;
  pcEv.requeueDue = "recovery";                                   // 1.14.6: the tab was re-opened with a live session
  if (old != null && old !== pick.id) { try { chrome.tabs.remove(old); } catch { /* already gone */ } }
  try { pcNoDiscard(pick.id); } catch { /* best-effort */ }
  console.log(`[PC-EMAP] re-mint via 選擇取貨門市 → tab ${pick.id} ${pcSafeUrl(pick.url)} guid=${pick.guid}${old != null && old !== pick.id ? ` (closed old tab ${old})` : ""}`);
}
// ══ 1.15.0 — TWO-MACHINE FAILOVER (lease, sql/71 v2) ═════════════════════════
// The extension may run on two machines. Exactly ONE holds the lease ("leader") and
// does all the work; the other ("standby") only keeps its tabs ready and takes over
// when the leader has been silent for 120 s, or when the leader reports itself
// DEGRADED while a ready standby waits (the server decides the yield — sql/71 v2).
// Calling admin_parcel_worker_lease IS the renewal. The check logic itself is
// untouched; this only decides whether the leader-only side effects may run.
const PC_WORKER_KEY = "pc_worker";          // { id, role } — id random, generated once; role = last confirmed (survives restarts)
const PC_LEASE_RENEW_MS = 30 * 1000;        // re-call the lease when the last confirmed answer is older than this
const PC_LEASE_RETRY_MS = 10 * 1000;        // …but at most one attempt per 10 s (a failing call is up to 8 s)
const PC_LEASE_MAX_AGE_MS = 60 * 1000;      // never do leader work on a lease older than this (unless a LONE leader)
const PC_LEASE_LONE_AFTER_S = 120;          // no other machine seen as standby for longer than this → lone leader
const PC_LEASE_FAIL_GAP_MS = 60 * 1000;     // attempts further apart than this are not "continuous" failure (MEDIUM-1)
const PC_LEASE_FAILOPEN_MS = 3 * 60 * 1000; // lease unreachable this long → act as leader (M2)
const PC_LEASE_TIMEOUT_MS = 8 * 1000;       // a hung lease call must not stall the loop (L3)
const PC_DEGRADED_NO_TAB_MS = 60 * 1000;       // 1.15.1: a duty tab ABSENT (emap / myship "no_tab") this long → degraded
const PC_DEGRADED_DEAD_MS = 2 * 60 * 1000;     // 1.15.1: duty tabs otherwise dead (expired / dead / dead_script) this long → degraded
const PC_DEGRADED_STEP_CAP_MS = 60 * 1000;     // one pass counts at most 60 s (a sleeping machine doesn't count)
const pcLease = { role: null, lastOkAt: 0, lastAttemptAt: 0, failSince: 0, failOpenLogged: false, lone: false, storedRole: null,
  leaderLabel: null, leaderAgeS: null, reason: "", failing: false, id: null, label: "" };
function pcRandomId() {
  try { if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID(); } catch { /* fall through */ }
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
function pcPlatformName() {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime.getPlatformInfo) { resolve("Device"); return; }
      chrome.runtime.getPlatformInfo((info) => {
        const os = info && info.os;
        resolve(os === "win" ? "Windows" : os === "mac" ? "Mac" : os === "linux" ? "Linux" : os === "cros" ? "ChromeOS" : "Device");
      });
    } catch { resolve("Device"); }
  });
}
// Worker id (persisted) + label (popup Device name, else "<platform> <first 4 of id>").
// First load in this worker life also restores the last confirmed role: a stored
// 'standby' starts as standby (a restarted standby stays silent); a stored 'leader' or
// nothing keeps the boot rule (no answer yet → act as leader, pre-1.15 behaviour).
async function pcWorkerIdentity(cfg) {
  if (!pcLease.id) {
    const w = (await pcGet(PC_WORKER_KEY, null)) || null;
    if (w && typeof w.id === "string" && w.id) {
      pcLease.id = w.id;
      pcLease.storedRole = w.role === "leader" || w.role === "standby" ? w.role : null;
      if (pcLease.storedRole === "standby" && pcLease.role === null) pcLease.role = "standby";
    } else { pcLease.id = pcRandomId(); await pcSet(PC_WORKER_KEY, { id: pcLease.id }); }
  }
  const name = String((cfg && cfg.deviceName) || "").trim();
  pcLease.label = name || `${await pcPlatformName()} ${pcLease.id.slice(0, 4)}`;
  return { id: pcLease.id, label: pcLease.label };
}
// PURE: may this machine do leader work now?
//  · lease unreachable for 3+ min (failSince) → yes, whatever the last role (M2: never
//    let BOTH machines sit idle on a broken RPC; a double check is safe — the verdict RPC
//    locks the row and never lets 'unknown' overwrite a real verdict)
//  · no answer yet since boot → yes (pre-1.15 behaviour)
//  · standby → no
//  · LONE leader (its last successful answer saw no other machine for > 120 s) → yes,
//    whatever the lease age — exactly 1.14.9 (MEDIUM-2: no blackout on a lease outage)
//  · leader with another machine around → only while its last confirmed lease is ≤ 60 s old.
function pcLeaderNow(role, lastOkAt, now, failSince, lone) {
  if (failSince && now - failSince >= PC_LEASE_FAILOPEN_MS) return true;
  if (role === null) return true;
  if (role !== "leader") return false;
  if (lone) return true;
  return now - lastOkAt <= PC_LEASE_MAX_AGE_MS;
}
function pcLeaderNowCur() { return pcLeaderNow(pcLease.role, pcLease.lastOkAt, Date.now(), pcLease.failSince, pcLease.lone); }
// PURE: lone = no other machine called as standby within 120 s (standby_age_s null or > 120).
// An answer without the field (pre-v3 server) is NOT lone — the safe side.
function pcLeaseLone(j) {
  if (!j || !("standby_age_s" in j)) return false;
  return j.standby_age_s === null || (typeof j.standby_age_s === "number" && j.standby_age_s > PC_LEASE_LONE_AFTER_S);
}
// H1 — DEGRADED = this machine's duty tabs have been dead: E-Map status in {no_tab, expired,
// dead} OR the myship tab health in {no_tab, dead_script}. 1.15.1: the threshold follows the
// CURRENT kind — a tab ABSENT (either "no_tab") → 60 s, otherwise → 120 s. Rule: dead time
// accumulates only OUTSIDE the 01:00–05:00 maintenance window; inside it the counter is
// frozen (neither counts nor resets) unless the tabs recover (→ 0). One pass adds at most
// 60 s, so a machine that slept doesn't come back "degraded". The server decides any yield.
function pcDutyTabsDead(emapState, myshipHealthState) {
  return ["no_tab", "expired", "dead"].includes(emapState) || ["no_tab", "dead_script"].includes(myshipHealthState);
}
function pcDutyTabsAbsent(emapState, myshipHealthState) {
  return emapState === "no_tab" || myshipHealthState === "no_tab";
}
// kind: "no_tab" (pcDutyTabsAbsent) | "dead" (pcDutyTabsDead, not absent) | null (alive)
function pcDegradedStep(d, now, kind, inMaint) {   // PURE
  const step = d.lastAt ? Math.min(Math.max(0, now - d.lastAt), PC_DEGRADED_STEP_CAP_MS) : 0;
  const ms = !kind ? 0 : inMaint ? d.ms : d.ms + step;
  return { ms, lastAt: now, on: !!kind && ms >= (kind === "no_tab" ? PC_DEGRADED_NO_TAB_MS : PC_DEGRADED_DEAD_MS) };
}
// The compact worker state (the Admin-card mirror shape) + multi / degraded / leaseFailing,
// sent as p_state on every lease call AND in the worker-state blob.
async function pcCompactState() {
  const st = (await pcGet(PC_STATUS_KEY, {})) || {};
  let multi = false; try { multi = (await pcConfig()).multiSeller === true; } catch { multi = false; }
  return {
    v: (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : "?"), bootAt: pcEv.bootAt, at: Date.now(),
    sfl: st.sfl ?? null, myship: st.myship ?? null, emap: st.emap ?? null, emapDomain: st.emapDomain ?? null,
    lastStoreVerdictAt: st.lastStoreVerdictAt ?? null, lastStoreMissAt: st.lastStoreMissAt ?? null, lastPhoneVerdictAt: st.lastPhoneVerdictAt ?? null, queue: st.multiQueueDepth ?? null,
    lastGiveUpAt: st.lastGiveUpAt ?? null, inMaintenanceWindow: Boolean(st.inMaintenanceWindow),
    multi, degraded: Boolean(pcEv.deg && pcEv.deg.on), leaseFailing: pcLease.failing,
  };
}
// One lease call, bounded by an 8 s timeout (abort + race), never throws.
async function pcLeaseFetch(cfg, token) {
  const me = await pcWorkerIdentity(cfg);
  const body = JSON.stringify({ p_worker_id: me.id, p_label: me.label, p_state: await pcCompactState() });
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const call = (async () => {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_worker_lease`, {
      method: "POST", ...(ctrl ? { signal: ctrl.signal } : {}),
      headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
    if (!r.ok) return { ok: false, why: `http ${r.status}` };
    let j = null; try { j = await r.json(); } catch { j = null; }
    return j && typeof j.leader === "boolean" ? { ok: true, j } : { ok: false, why: "bad json" };
  })();
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { try { if (ctrl) ctrl.abort(); } catch { /* */ } resolve({ ok: false, why: `timeout ${PC_LEASE_TIMEOUT_MS / 1000}s` }); }, PC_LEASE_TIMEOUT_MS);
  });
  try { return await Promise.race([call, timeout]); }
  catch (e) { return { ok: false, why: `network${e && e.message ? `: ${e.message}` : ""}` }; }
  finally { try { clearTimeout(timer); } catch { /* */ } }
}
// Call the lease RPC (= the renewal). A failure keeps the last known role; after 3 min of
// continuous failure this machine acts as leader (pcLeaderNow). One log line per failure
// streak + one when the fail-open starts; never throws.
async function pcLeaseRenew(cfg, token) {
  let res;
  const prevAttemptAt = pcLease.lastAttemptAt;
  const attemptAt = Date.now();
  pcLease.lastAttemptAt = attemptAt;
  try { res = await pcLeaseFetch(cfg, token); } catch (e) { res = { ok: false, why: `network${e && e.message ? `: ${e.message}` : ""}` }; }
  const now = Date.now();
  if (res.ok) {
    const j = res.j; const role = j.leader ? "leader" : "standby";
    if (role !== pcLease.role) {
      console.log(`[PC-LEASE] ${pcLease.label}: ${(pcLease.role ?? "starting").toUpperCase()} → ${role.toUpperCase()} (reason=${j.reason ?? "?"}${role === "standby" ? `, leader=${j.leader_label ?? "?"} seen ${j.leader_age_s ?? "?"}s ago` : ""})`);
    }
    if (pcLease.failOpenLogged) console.log(`[PC-LEASE] ${pcLease.label}: lease reachable again — role ${role.toUpperCase()}`);
    pcLease.role = role; pcLease.lastOkAt = now; pcLease.failing = false; pcLease.failSince = 0; pcLease.failOpenLogged = false;
    pcLease.lone = role === "leader" && pcLeaseLone(j);
    if (role !== pcLease.storedRole && pcLease.id) {   // persist the last confirmed role — only when it changes
      pcLease.storedRole = role;
      try { await pcSet(PC_WORKER_KEY, { id: pcLease.id, role }); } catch { /* best-effort */ }
    }
    pcLease.leaderLabel = j.leader_label ?? null; pcLease.leaderAgeS = typeof j.leader_age_s === "number" ? j.leader_age_s : null; pcLease.reason = String(j.reason ?? "");
  } else {
    // MEDIUM-1: the fail-open clock means CONTINUOUS failure — a previous attempt more than
    // 60 s before this one (sleep, pause, passes that never reached the lease) restarts it.
    const gap = Boolean(pcLease.failing && prevAttemptAt && attemptAt - prevAttemptAt > PC_LEASE_FAIL_GAP_MS);
    if (!pcLease.failing || gap) {
      pcLease.failing = true; pcLease.failSince = attemptAt; pcLease.failOpenLogged = false;
      console.log(`[PC-LEASE] ${pcLease.label || "worker"}: lease call failed (${res.why})${gap ? " after a gap — failure clock restarted" : ""} — keeping role ${pcLease.role ?? "none yet → acting as leader (pre-1.15 behaviour)"}${pcLease.role === "leader" && pcLease.lone ? " (lone leader — still working)" : ""}`);
    }
    if (!pcLease.failOpenLogged && now - pcLease.failSince >= PC_LEASE_FAILOPEN_MS) {
      pcLease.failOpenLogged = true;
      console.log(`[PC-LEASE] ${pcLease.label || "worker"}: lease unreachable for 3+ min — acting as leader until it answers (may double-check)`);
    }
  }
  try {
    await pcStatus({ leaseRole: pcLease.role, leaseLeaderLabel: pcLease.leaderLabel, leaseLeaderAgeS: pcLease.leaderAgeS, leaseReason: pcLease.reason, leaseAt: pcLease.lastOkAt || null,
      leaseFailing: pcLease.failing, leaseFailOpen: pcLease.failOpenLogged, leaseLone: pcLease.lone, leaseWorking: pcLeaderNowCur(), workerLabel: pcLease.label || null });
  } catch { /* status is display-only */ }
  return res.ok;
}
// Re-check before leader work (top of pcPollMulti) and before each row: re-call the lease
// when the last confirmed answer is older than 30 s (at most one attempt per 10 s), then
// decide on the CURRENT lease state. No answer yet since boot → today's behaviour.
async function pcLeaseOkForRow(cfg, token) {
  if (pcLease.role === null) return true;
  const now = Date.now();
  if (now - pcLease.lastOkAt > PC_LEASE_RENEW_MS && now - pcLease.lastAttemptAt >= PC_LEASE_RETRY_MS) await pcLeaseRenew(cfg, token);
  const ok = pcLeaderNowCur();
  if (!ok) console.log(`[PC-LEASE] ${pcLease.label}: ${pcLease.role === "leader" ? "lease older than 60 s" : "no longer the leader"} — stopping this pass`);
  return ok;
}
// M1 — the leader-only gate: the pass must have started as leader (when there is a pass)
// AND the CURRENT lease state must still say leader-now. Re-evaluated at every use.
function pcPassLeader(pass) {
  return (!pass || pass.leader === true) && pcLeaderNowCur();
}

// Admin-card mirror (DISPLAY-ONLY — never gates the pending RPC or any check):
// compact worker state → app_settings via an admin RPC, on change or every 60s.
// 1.15.0: leader-only, and the blob carries the worker id + label (wid / label).
async function pcPushWorkerState(cfg, rpcHeaders) {
  // never push without a real wid: a wid-less blob is what the RPC's legacy guard treats
  // as a pre-1.15 worker (it would block every machine's lease)
  const me = await pcWorkerIdentity(cfg);
  const state = { ...(await pcCompactState()), wid: me.id, label: me.label };
  const sig = `${state.sfl}|${state.myship}|${state.emap}|${state.emapDomain}|${state.inMaintenanceWindow}`;
  if (sig === pcEv.lastPush.sig && Date.now() - pcEv.lastPush.at < PC_WORKER_STATE_PUSH_MS) return;
  pcEv.lastPush = { at: Date.now(), sig };
  await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_set_parcel_worker_state`, { method: "POST", headers: rpcHeaders, body: JSON.stringify({ p_state: state }) }).catch(() => {});
}

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
  if (conf) pcSenderHealthy = conf.healthy !== "false";
  if (!conf || !conf.sender_phone || !conf.probe_buyer || !conf.sample_gm) return;
  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  if (!myshipTabId) return; // can't probe without a myship tab — try next cycle
  const resp = await pcSendTab(myshipTabId, {
    type: "PC_CHECK_PHONE", anon: true,
    row: { store_id: PC_HEALTH_STORE_ID, phone: conf.probe_buyer, customer_name: "SFL sender health" },
    config: { cgdmId: conf.sample_gm, ordMobile: conf.sender_phone },
  });
  const st = resp && resp.phone_check_status;
  if (st === "ok" || st === "restricted") pcEv.myship.lastVerdictAt = Date.now(); // the probe is myship evidence when idle
  const setHealth = (ok) => fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_set_parcel_sender_health`, { method: "POST", headers: rpcHeaders, body: JSON.stringify({ p_ok: ok }) }).catch(() => {});
  if (st === "restricted") {
    // 1.14.7: pause only on TWO consecutive restricted probes (one flaky answer must
    // not stop every seller); the confirming probe runs 1 min later, not in 5.
    pcSenderStrikes += 1;
    if (pcSenderStrikes < 2) {
      pcLastHealthAt = Date.now() - PC_HEALTH_INTERVAL_MS + PC_HEALTH_CONFIRM_MS;
      console.warn(`[PC-SENDER] probe returned 'restricted' (1/2) — confirming in ${PC_HEALTH_CONFIRM_MS / 1000}s before pausing`);
      return;
    }
    await setHealth(false);
    pcSenderHealthy = false;
    await pcStatus({ multi: "sender_poisoned" });
    console.warn(`[PC-SENDER] POISONED: sender ${conf.sender_phone} returns 'restricted' for a known-clean buyer — verdicts PAUSED. Swap parcel_check_sender_phone to a clean account.`);
  } else if (st === "ok") {
    pcSenderStrikes = 0;
    if (conf.healthy !== "true") {
      await setHealth(true);
      pcSenderHealthy = true;
      console.log(`[PC-SENDER] recovered: sender ${conf.sender_phone} healthy again — resuming.`);
    }
  }
}

async function pcPollMulti(pass) {
  const cfg = await pcConfig();
  if (!cfg.multiSeller || cfg.paused) return;
  // 1.15.0: the whole lane (sender probe, pending read — it writes caches — row checks,
  // verdicts) is LEADER-ONLY. pass.leader was decided by pcPoll's lease call this pass.
  if (!pcPassLeader(pass)) return;
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
  const sflTabId = await pcFindTab(["https://www.sellerflowlive.com/*", "https://sellerflowlive.com/*", "http://localhost:5173/*"]);
  if (!sflTabId) return;
  const token = await pcGetToken(sflTabId);
  if (!token) return;
  const rpcHeaders = {
    apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json",
  };
  // 1.15.0 M1: the pass-start role may be stale by now (slow pass / wake from sleep) —
  // re-check the lease BEFORE the sender probe and the pending read.
  if (!(await pcLeaseOkForRow(cfg, token))) return;
  // sender health-check FIRST (time-gated) — runs even while paused so a swapped
  // /recovered sender flips the lane back on; the pending RPC stays empty until it does.
  pcEv.sfl.fetchInFlight = true;   // 1.14.5: a REST call is running — no SFL re-nav under it
  try { await pcSenderHealthCheck(cfg, rpcHeaders); } catch { /* health check best-effort */ }
  let rows = [];
  try {
    const pendingUrl = `${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_checks_pending`;
    const body = pcPendingBody(Date.now());
    let r = await fetch(pendingUrl, { method: "POST", headers: rpcHeaders, body: JSON.stringify(body) });
    if (r.status === 404 && body.p_frozen_capable) {
      // the server has no p_frozen_capable yet (sql/81 not applied) → the old call
      pcCapableUnsupportedAt = Date.now();
      console.log("[PC-FROZEN] the server does not take p_frozen_capable yet — asking the old way (frozen rows wait)");
      r = await fetch(pendingUrl, { method: "POST", headers: rpcHeaders, body: JSON.stringify({ p_limit: PC_FETCH_LIMIT }) });
    }
    if (!r.ok) { pcEv.sfl.fetchInFlight = false; await pcStatus({ multi: `rpc_${r.status}` }); return; }
    rows = await r.json();
    if (!Array.isArray(rows)) rows = [];
  } catch { pcEv.sfl.fetchInFlight = false; await pcStatus({ multi: "rpc_error" }); return; }
  pcEv.sfl.fetchInFlight = false;
  // 1.14.7: while the sender is paused the pending RPC returns nothing — keep saying so
  // instead of a reassuring "OK, queue 0".
  await pcStatus({ multi: pcSenderHealthy === false ? "sender_poisoned" : "ok", multiQueueDepth: rows.length ? Number(rows[0].queue_depth) || 0 : 0, multiLastAt: new Date().toISOString() });
  // 1.14.0: the keepalive runs from pcTick (independent of this lane, the token
  // and the RPC); here we only record whether any pending row needs the store
  // half, and stash the admin RPC context for the Admin-card mirror.
  pcEv.lastAnyNeedStore = rows.some((r) => r && r.need_store && !r.frozen); // the normal keepalive only cares about normal rows
  if (rows.some((r) => r && r.frozen && r.need_store)) pcFrz.lastNeededAt = Date.now(); // 1.16.0: frozen work waiting
  pcEv.rpc = { cfg, rpcHeaders };
  if (!rows.length) return;

  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  // the ONE emap tab picked this tick (guid-bearing when several exist) — never a blind tabs[0]
  const emapTabId = (pcEv.emap.tabId && !pcEv.emap.error) ? pcEv.emap.tabId : null;
  const now = Date.now(); const inMaint = pcInMaintenance(now);
  for (const [id, b] of pcBackoff) if (now - b.seenAt > PC_REQUEUE_SINCE_MS) pcBackoff.delete(id); // forget rows gone for 6 h
  let processed = 0;
  // 1.14.9: after a phone check gets NO answer this pass, that shop's (GM's) other
  // rows wait for the next pass; once TWO different shops got no answer, 7-11 itself
  // looks stalled → every remaining phone half waits. Bounds a stall to ≤ 2 hung
  // attempts per pass without one stuck shop holding up the other sellers.
  const stalledGms = new Set();
  for (const row of rows) {
    if (processed >= PC_LIMIT) break;
    if (!row || !row.id || pcInFlight.has(row.id)) continue;
    if (!(await pcLeaseOkForRow(cfg, token))) break; // 1.15.0: lost / stale lease → stop before this row
    // 1.14.6: a half in backoff is skipped (no request) so rows behind it get their turn
    const bo = pcBackoff.get(row.id);
    if (bo) bo.seenAt = now;
    // 1.14.7: a half runs only when its tab exists — a missing/expired E-Map or myship
    // tab must not let untouchable rows use up every slot (that froze all sellers)
    // 1.16.0: a frozen row is NEVER asked the normal question — only the frozen tab answers it
    const isFrozen = row.frozen === true;
    if (isFrozen && row.need_store && !pcFrz.tabId) pcFrozenEnsureOpen(now, inMaint);
    const busy = pcBusyPaused(Date.now()); // 1.16.1: one E0014 pauses every store request (normal + frozen)
    const doStore = !isFrozen && Boolean(row.need_store) && Boolean(emapTabId) && !busy && (!bo || now >= bo.storeNextAt);
    const doFrozenStore = isFrozen && Boolean(row.need_store) && Boolean(pcFrz.tabId) && !inMaint && !busy && (!bo || now >= bo.storeNextAt);
    // 1.16.1: the frozen lane is dead (its two opens failed, 30-min pause) → a waiting frozen row
    // ends as 'unknown' (never OK) instead of sitting in the queue; re-queued when the lane recovers.
    const frozenGiveUp = isFrozen && Boolean(row.need_store) && !pcFrz.tabId && pcFrz.state === "dead" && !inMaint;
    const phoneStalled = stalledGms.size >= 2 || stalledGms.has(String(row.gm_id || ""));
    const doPhone = Boolean(row.need_phone) && Boolean(myshipTabId) && !phoneStalled && (!bo || Date.now() >= bo.phoneNextAt);
    if (!doStore && !doFrozenStore && !doPhone && !frozenGiveUp) continue;
    processed += 1;
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
      if (doStore && emapTabId) {
        const sResp = await pcSendTab(emapTabId, { type: "PC_CHECK_STORE", row });
        if (sResp && pcIsStoreVerdict(sResp.store_full_status)) storeStatus = sResp.store_full_status;
        // evidence for the per-tab status (single writer in pcTick) + the exact reason
        if (storeStatus !== null) {
          pcEmapVerdict(Date.now()); pcEv.lastStoreReason = ""; pcBusyClear();
          const b = pcBackoff.get(row.id);
          if (b && b.storeFails) { b.storeFails = 0; b.storeNextAt = 0; console.log(`[PC-BACKOFF] row=${row.id} store resolved`); }
        } else {
          pcEv.lastStoreReason = (sResp && sResp.store_reason) || "emap tab not responding";
          const transient = Boolean(sResp && sResp.transient);
          const b = pcBackoffEntry(row.id, now);
          if (inMaint) {
            // maintenance window FIRST (1.16.1): not counted toward the ladder or the give-up; slow
            // retry — a busy answer at 01:00–05:00 is maintenance, not a reason for 1-min retries
            b.storeNextAt = now + PC_MAINT_RETRY_MS;
            console.log(`[PC-BACKOFF] row=${row.id} store attempt=${b.storeFails} maintenance, next=${PC_MAINT_RETRY_MS / 1000}s`);
          } else if (sResp && sResp.busy) {
            // 7-11 busy (E0014) — pause EVERY store request (pcBusy); never a miss, never toward a give-up
            pcBusyHit(Date.now(), "normal");
          } else {
            // one row counts toward the recovery ladder at most once until another store id resolves
            if (!transient && b.countedGen !== pcEv.verdictGen) { pcEmapMiss(Date.now(), pcEv.lastStoreReason, false); b.countedGen = pcEv.verdictGen; }
            b.storeFails += 1;
            if (b.storeFails >= PC_STORE_GIVE_UP) {
              storeStatus = "unknown"; // give up the STORE half only — the phone half is never auto-stamped
              // wait the max backoff before touching it again: a 'full' store's hourly
              // recheck row (sql/66) stays queued after a give-up, since 'unknown'
              // never overwrites 'full'
              pcEv.lastGiveUpAt = now; b.storeNextAt = now + PC_BACKOFF_MS[PC_BACKOFF_MS.length - 1];
              console.log(`[PC-BACKOFF] row=${row.id} store attempt=${b.storeFails} gave up → unknown`);
            } else {
              b.storeNextAt = now + pcBackoffDelay(b.storeFails);
              console.log(`[PC-BACKOFF] row=${row.id} store attempt=${b.storeFails} next=${pcBackoffDelay(b.storeFails) / 1000}s`);
            }
          }
        }
      }
      // 1.16.0 FROZEN store half — the frozen tab, one request at a time, ≥ 3 s apart.
      // Only a clean answer for THIS store counts; anything else leaves the half NULL (retried),
      // and a give-up writes 'unknown' — never OK on doubt.
      if (doFrozenStore && pcFrz.tabId) {
        let wait = pcFrz.lastReqAt ? PC_FROZEN_GAP_MS - (Date.now() - pcFrz.lastReqAt) : 0;
        while (wait > 0) { const step = Math.min(wait, 2000); await pcSleep(step); wait -= step; } // ≥ 3 s since the last frozen request
        pcFrz.lastReqAt = Date.now();
        const fResp = await pcSendTab(pcFrz.tabId, { type: "PC_CHECK_STORE_FROZEN", row });
        const b = pcBackoffEntry(row.id, now);
        if (fResp && PC_FROZEN_VERDICTS.includes(fResp.store_full_status)) {
          storeStatus = fResp.store_full_status;
          pcFrz.misses = 0; pcFrz.opens = 0; pcFrz.state = "ok"; pcBusyClear();
          if (b.storeFails) { b.storeFails = 0; b.storeNextAt = 0; }
          console.log(`[PC-FROZEN] row=${row.id} store=${row.store_id} verdict=${storeStatus}`);
        } else if (fResp && fResp.busy) {
          pcFrz.state = "busy"; pcBusyHit(Date.now(), "frozen"); // pauses every store request; never a miss
        } else {
          const reason = (fResp && fResp.store_reason) || "frozen tab not responding";
          // 1.16.1: only a SESSION failure (error page, I0100, no session value / not a frozen page)
          // counts toward retiring the tab — an odd answer about one store only backs that row off
          if (fResp && fResp.session) {
            pcFrz.misses += 1; // the frozen session itself is not usable → after 2, replace the tab
            if (pcFrz.misses >= 2) { pcFrz.bad.add(pcFrz.tabId); pcFrz.tabId = null; pcFrz.misses = 0; pcFrozenEnsureOpen(Date.now(), inMaint); } // never pick this tab again
          }
          b.storeFails += 1;
          if (b.storeFails >= PC_STORE_GIVE_UP) {
            storeStatus = "unknown"; b.storeNextAt = Date.now() + PC_BACKOFF_MS[PC_BACKOFF_MS.length - 1];
            console.log(`[PC-FROZEN] row=${row.id} store attempt=${b.storeFails} gave up → unknown (${reason})`);
          } else {
            b.storeNextAt = Date.now() + pcBackoffDelay(b.storeFails);
            console.log(`[PC-FROZEN] row=${row.id} store attempt=${b.storeFails} next=${pcBackoffDelay(b.storeFails) / 1000}s (${reason})`);
          }
        }
      }
      if (frozenGiveUp) {
        storeStatus = "unknown"; pcFrz.unknownWritten = true; // re-queued by pcFrozenRequeue when the lane recovers
        console.log(`[PC-FROZEN] row=${row.id} frozen lane dead → unknown (re-queued when it recovers)`);
      }
      // phone half — the ROW OWNER's GM + phone, never the global config.
      // anon:true → the check runs credential-less so the body ordMobile is the
      // authoritative sender (the owner's myship login is irrelevant); this is
      // the core multi-seller fix (2026-09-27).
      let phoneStatus = null, phoneMessage = null, phoneUntil = null, pTokenMs = null, pPostMs = null;
      if (doPhone && myshipTabId) {
        const bPrev = pcBackoff.get(row.id);
        const pResp = await pcSendTab(myshipTabId, {
          type: "PC_CHECK_PHONE", row, anon: true,
          // 1.14.9: one immediate token-GET retry on a timeout — early attempts only, never in maintenance
          tokenRetry: !inMaint && (!bPrev || bPrev.phoneFails < PC_PHONE_TOKEN_RETRY_FAILS),
          config: { cgdmId: row.gm_id, ordMobile: row.sender_phone },
        });
        if (pResp) { pTokenMs = pResp.tokenMs ?? null; pPostMs = pResp.postMs ?? null; }
        // DEFINITIVE only (audit M1): 'unknown' → leave null → retry next poll.
        if (pResp && (pResp.phone_check_status === "ok" || pResp.phone_check_status === "restricted")) {
          phoneStatus = pResp.phone_check_status;
          phoneMessage = pResp.phone_check_message ?? null;
          phoneUntil = pResp.phone_restricted_until ?? null;
          pcEv.myship.lastVerdictAt = Date.now(); pcEv.lastPhoneReason = "";
          const b = pcBackoff.get(row.id);
          if (b && b.phoneFails) { b.phoneFails = 0; b.phoneNextAt = 0; console.log(`[PC-BACKOFF] row=${row.id} phone resolved`); }
        } else {
          pcEv.lastPhoneReason = (pResp && pResp.phone_reason) || "myship tab not responding";
          // kind: timeout / network (no answer) vs rejected / html / redirect / http /
          // bad_json / config (a real answer or our setup) vs no_tab (tab didn't reply)
          const kind = pResp ? (pResp.phone_fail_kind || "other") : "no_tab";
          if (pcPhoneNoAnswer(kind)) stalledGms.add(String(row.gm_id || ""));
          // same backoff, but NEVER given up (audit M1: a missed restricted number must not look checked)
          const b = pcBackoffEntry(row.id, now);
          if (!inMaint) b.phoneFails += 1;
          const wait = inMaint ? PC_MAINT_RETRY_MS : pcPhoneBackoffDelay(b.phoneFails, kind);
          b.phoneNextAt = Date.now() + wait; // from the END of this attempt (a 10 s hang can't eat a 5 s wait)
          console.log(`[PC-BACKOFF] row=${row.id} phone attempt=${b.phoneFails} reason=${kind} (${pcEv.lastPhoneReason})${inMaint ? " maintenance" : ""} next=${wait / 1000}s`);
        }
      }
      // nothing learned (both halves null) → no verdict write, row retries later
      if (storeStatus !== null || phoneStatus !== null) {
        await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_check_verdict`, {
          method: "POST", headers: rpcHeaders,
          body: JSON.stringify({
            p_id: row.id,
            // 1.14.7: the values that were CHECKED — the RPC only applies a half if the
            // row still has them, and fills the shared caches from them (sql/67)
            p_expected_phone: row.phone ?? null,
            p_expected_store: row.store_id ?? null,
            p_store_full_status: storeStatus,
            p_phone_check_status: phoneStatus,
            p_phone_check_message: phoneMessage,
            p_phone_restricted_until: phoneUntil,
            // 1.16.0: frozen rows only — a normal row's body is byte-for-byte as before
            ...(isFrozen ? { p_store_layer: "冷凍" } : {}),
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
  await pcRunOnce();
  pcScheduleLoop(PC_POLL_MS);     // re-arm ~5s after this run finishes
}
// One full pass (both lanes + pick + keepalive + status + mirror + heartbeat),
// WITHOUT re-arming — shared by the loop and the popup's "Check now".
async function pcRunOnce() {
  pcEv.tick += 1;
  // 1.15.0: this pass's role — set by pcPoll's lease call (stays false when the pass
  // never reached it: paused / no config / SFL tab not ready / no token).
  const pass = { leader: false };
  try { pcEv.maintEnabled = (await pcConfig()).maintenanceWindow; } catch { /* keep the last value */ }
  try { await pcPoll(pass); } catch { /* keep looping */ }
  // 1.14.0 — every block below is wrapped: a failure logs and can never stop the loop.
  // Both roles: tab pick, E-Map keepalive, local status (= standby stays ready).
  try { await pcPickEmapTab(); } catch (e) { console.log(`[PC-EMAP] skipped: pick ${e && e.message ? e.message : e}`); }
  try { await pcPollMulti(pass); } catch { /* keep looping */ }                       // leader-only inside
  try { await pcEmapKeepalive(); } catch (e) { console.log(`[PC-KEEPALIVE] skipped: ${e && e.message ? e.message : e}`); }
  try {
    pcFrozenIdleClose(Date.now());
    const v = pcFrozenStatusValue(pcFrz);
    if (v !== pcFrz.lastStatus) { pcFrz.lastStatus = v; await pcStatus({ frozen: v }); } // write only on change
  } catch (e) { console.log(`[PC-FROZEN] skipped: ${e && e.message ? e.message : e}`); }
  try { await pcRefreshTabStatus(pass); } catch (e) { console.log(`[PC-STATUS] skipped: ${e && e.message ? e.message : e}`); }
  // Leader-only: re-queue (DB write) and the worker-state mirror (DB write). M1: each is
  // gated on the CURRENT lease state, not the role the pass started with.
  if (pcPassLeader(pass)) { try { await pcRequeueUnknown(Date.now()); } catch (e) { console.log(`[PC-BACKOFF] requeue skipped: ${e && e.message ? e.message : e}`); } }
  if (pcPassLeader(pass)) { try { await pcFrozenRequeue(Date.now()); } catch (e) { console.log(`[PC-FROZEN] requeue skipped: ${e && e.message ? e.message : e}`); } }
  if (pcPassLeader(pass)) { try { if (pcEv.rpc) await pcPushWorkerState(pcEv.rpc.cfg, pcEv.rpc.rpcHeaders); } catch { /* mirror is best-effort */ } }
  if (pcEv.tick % PC_HEARTBEAT_EVERY === 1) {                     // heartbeat ~every 60s — never silent, never spam
    try { const st = (await pcGet(PC_STATUS_KEY, {})) || {}; console.log(`[PC-TICK] #${pcEv.tick} role=${pcLease.role ?? "none"} sfl=${st.sfl} myship=${st.myship} emap=${st.emap} queue=${st.multiQueueDepth ?? "-"} emapTab=${pcEv.emap.tabId ?? "none"}`); } catch { /* */ }
  }
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
// 1.16.0: a frozen tab is forgotten only when the TAB itself is gone (never because it is
// not on an E-Map page yet — the tab we opened is still on the 7-11 picker while it lands).
try {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === pcFrz.ownedTabId) pcFrz.ownedTabId = null;
    if (tabId === pcFrz.tabId) pcFrz.tabId = null;
    pcFrz.bad.delete(tabId);
  });
} catch { /* no tabs.onRemoved (tests) — the idle close / replace paths still clear ownership */ }
// 1.14.3: while a re-mint is pending, a finished navigation on any E-Map tab
// triggers an immediate pick + status refresh (no need to wait for the 5 s tick).
try {
  chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
    try {
      if (!pcEv.emap.remint || !pcEv.emap.remint.until) return;
      if (info.status !== "complete" || !/^https:\/\/emap\.(uni)?pcsc\.com\.tw\//i.test(String((tab && tab.url) || ""))) return;
      pcPickEmapTab().then(() => pcRefreshTabStatus()).catch(() => {});
    } catch { /* never let a listener throw */ }
  });
} catch { /* tabs.onUpdated unavailable — the tick still adopts within 5 s */ }
// BOOT (1.14.0): beacon + FULL status reset, so nothing stale from a previous
// worker life can ever be displayed — every key starts 'starting' and must be
// re-earned by evidence in this life (the 1.9 / 1.12 stale-status class bug,
// fixed at the root). The first tick is scheduled only AFTER the reset lands.
(async () => {
  let v = "?";
  try { v = chrome.runtime.getManifest ? chrome.runtime.getManifest().version : "?"; } catch { /* */ }
  try {
    await pcSet(PC_STATUS_KEY, {
      bootAt: pcEv.bootAt, version: v,
      sfl: "starting", myship: "starting", emap: "starting", emapSession: "starting", emapDomain: null, emapTabId: null,
      multi: null, multiQueueDepth: null, multiLastAt: null,
      lastStoreReason: "", lastPhoneReason: "", lastStoreAt: null, lastPhoneAt: null,
      lastCheckAt: null, lastCount: 0, lastError: "", lastStoreVerdictAt: null, lastPhoneVerdictAt: null,
      inMaintenanceWindow: false, lastGiveUpAt: null,
      leaseRole: null, leaseLeaderLabel: null, leaseLeaderAgeS: null, leaseReason: "", leaseAt: null, leaseFailing: false, leaseFailOpen: false, leaseLone: false, leaseWorking: null, workerLabel: null, degraded: false,
    });
    console.log(`[PC-BOOT] parcel-checker worker started v${v} — status reset`);
  } catch (e) { console.log(`[PC-BOOT] parcel-checker worker started v${v} (status reset skipped: ${e && e.message ? e.message : e})`); }
  pcScheduleLoop(0);
})();

// Allow the popup to trigger a poll on demand (Resume / manual refresh) — run now
// and let the loop keep going.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // "Check now" = one FULL pass (both lanes — 1.13.0 only ran the legacy lane, so in
  // multi mode the button did nothing visible).
  if (message?.type === "PC_POLL_NOW") { pcRunOnce().catch(() => {}).finally(() => sendResponse({ ok: true })); return true; }
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
