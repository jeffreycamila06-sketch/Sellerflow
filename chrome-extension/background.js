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
    // 1.14.6: honour the nightly 7-ELEVEN maintenance window (01:00–05:00 Taipei).
    // On unless explicitly set false (tests turn it off unless they opt in).
    maintenanceWindow: c.maintenanceWindow !== false,
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
async function pcHealTab(patterns, file, allowReload) {
  const tab = await pcFindTabInfo(patterns);
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
  // 1.14.0: the per-tab status keys (myship / emap / emapSession) have ONE writer
  // — pcRefreshTabStatus in pcTick, evidence-based. Here we only record health.
  pcEv.health = { myship: myshipHealth, emap: emapHealth };

  if (sflHealth.state !== "ok") { await pcStatus({ sfl: sflHealth.state }); return; } // no bridge → nothing to poll
  const sflTabId = sflHealth.tabId;
  // 1.14.5: the token ladder — read → in-place refresh (no reload) → GET re-nav
  // fallback → signed_out. Replaces the old "expired → click the tab" dead end.
  const token = await pcSflToken(sflTabId);
  if (!token) return; // sfl status already written (refreshing / signed_out / expired)

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
        // 1.14.0 evidence (legacy lane too): a resolved verdict = tab healthy
        if (store.store_full_status === "open" || store.store_full_status === "full") pcEmapVerdict(Date.now());
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
let pcLastHealthAt = 0;

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
const pcBackoff = new Map(); // parcel_scans id → { storeFails, storeNextAt, phoneFails, phoneNextAt, countedGen, seenAt }
// PURE: wait after the Nth consecutive failure (N ≥ 1).
function pcBackoffDelay(fails) {
  return PC_BACKOFF_MS[Math.min(Math.max(1, fails), PC_BACKOFF_MS.length) - 1];
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
    cands.push({ id: t.id, url, guid, error, probe });
  }
  const pick = pcChooseEmap(cands, pcEv.emap.tabId);
  const e = pcEv.emap;
  if (pick && pick.guid && e.remint && e.remint.until) pcAdoptRemintedTab(pick); // the click yielded a fresh session
  const nextId = pick ? pick.id : null, nextGuid = Boolean(pick && pick.guid), nextErr = Boolean(pick && pick.error);
  const changed = nextId !== e.tabId || nextGuid !== e.guid || nextErr !== e.error;
  e.present = Boolean(pick); e.tabId = nextId; e.url = pick ? pick.url : null; e.guid = nextGuid; e.error = nextErr;
  if (pick && !pick.error && !pick.guid) pcEmapMiss(Date.now(), "probe: eshopGuid not found", false); // one definitive miss per tick
  if (changed) {
    const p = pick && pick.probe;
    const diag = p ? ` section=${p.section ?? "?"} guidSource=${p.guidSource ?? "none"} guidCandidates=${p.guidCandidates ?? 0} endpoint=${p.endpoint ?? "none"}` : "";
    console.log(`[PC-EMAP] using tab ${e.tabId ?? "none"} ${e.url ?? ""} guid=${e.guid} error=${e.error} (candidates=${cands.length})${diag}`);
  }
  return pick;
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
  pcLastKeepaliveAt = now;
  const resp = await pcSendTab(e.tabId, { type: "PC_CHECK_STORE", row: { store_id: PC_KEEPALIVE_STORE } });
  const verdict = resp && resp.store_full_status;
  const alive = verdict === "open" || verdict === "full";
  if (alive) pcEmapVerdict(now); else pcEmapMiss(now, `keepalive: ${(resp && resp.store_reason) || "no response"}`, Boolean(resp && resp.transient));
  console.log(`[PC-KEEPALIVE] tab=${e.tabId} store=${PC_KEEPALIVE_STORE} verdict=${verdict ?? "none"} guidFound=${Boolean(resp && resp.guidFound)} sessionAlive=${alive} endpoint=${(resp && resp.endpoint) || "none"}${resp && resp.store_reason ? ` reason="${resp.store_reason}"` : ""}`);
}
// SINGLE WRITER of the per-tab status keys + the auto-recovery trigger: a present
// tab whose session no longer resolves gets ONE reload per cooldown (a cookie-
// valid reload re-mints the guid; a truly expired one lands on error.aspx → red).
async function pcRefreshTabStatus() {
  const now = Date.now(); const e = pcEv.emap;
  let emapState = pcDeriveEmap(now, e);
  if (emapState === "guid_missing") {
    // 1.14.2: DIALOG-FREE recovery. tabs.reload on the POST-opened E-Map tab pops
    // Chrome's "Confirm Form Resubmission" (a human-blocking modal); a GET
    // re-navigation to the same URL never does. With a live session cookie the
    // page re-mints the guid; a dead session lands on error.aspx → 'expired' (red).
    try { chrome.tabs.update(e.tabId, { url: e.url }); } catch { /* next tick retries */ }
    e.reloadAt = now; e.reloads += 1; pcLastKeepaliveAt = 0;     // verify as soon as it lands
    console.log(`[PC-EMAP] recover reason=${JSON.stringify(e.lastMissReason || "no guid")} misses=${e.misses} lastVerdictAgo=${e.lastVerdictAt ? Math.round((now - e.lastVerdictAt) / 1000) : "never"}s attempt=${e.reloads}/${PC_MAX_RELOADS} tab=${e.tabId} via=GET ${e.url}`);
    emapState = "recovering";
  }
  // 1.14.3: the GET re-opens didn't help → ONE unattended re-mint per episode via the
  // parked 賣貨便 /cart/detail tab (the myship content script clicks the real
  // 選擇取貨門市 button; nothing is stored). Then 20 s to see a guid-bearing E-Map
  // tab appear (adopted in pcPickEmapTab); otherwise red with the exact reason.
  const inMaint = pcInMaintenance(now);
  if (emapState === "dead" && e.remint && !e.remint.tried && !inMaint) {
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
  let emapDomain = null; try { emapDomain = e.url ? new URL(e.url).hostname : null; } catch { emapDomain = null; }
  await pcStatus({
    emap: emapState, myship: myshipState, emapSession: emapState, emapDomain, emapTabId: e.tabId, emapDeadReason: (e.remint && e.remint.result) || "",
    lastStoreReason: pcEv.lastStoreReason, lastPhoneReason: pcEv.lastPhoneReason,
    lastStoreVerdictAt: e.lastVerdictAt || null, lastStoreMissAt: e.lastMissAt || null, lastPhoneVerdictAt: pcEv.myship.lastVerdictAt || null, bootAt: pcEv.bootAt,
    inMaintenanceWindow: inMaint, lastGiveUpAt: pcEv.lastGiveUpAt || null,
  });
}
const PC_CART_DETAIL_PATTERN = "https://myship.7-11.com.tw/cart/detail*";
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
  console.log(`[PC-EMAP] re-mint via 選擇取貨門市 → tab ${pick.id} ${pick.url} guid=${pick.guid}${old != null && old !== pick.id ? ` (closed old tab ${old})` : ""}`);
}
// Admin-card mirror (DISPLAY-ONLY — never gates the pending RPC or any check):
// compact worker state → app_settings via an admin RPC, on change or every 60s.
async function pcPushWorkerState(cfg, rpcHeaders) {
  const st = (await pcGet(PC_STATUS_KEY, {})) || {};
  const state = {
    v: (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : "?"), bootAt: pcEv.bootAt, at: Date.now(),
    sfl: st.sfl ?? null, myship: st.myship ?? null, emap: st.emap ?? null, emapDomain: st.emapDomain ?? null,
    lastStoreVerdictAt: st.lastStoreVerdictAt ?? null, lastStoreMissAt: st.lastStoreMissAt ?? null, lastPhoneVerdictAt: st.lastPhoneVerdictAt ?? null, queue: st.multiQueueDepth ?? null,
    lastGiveUpAt: st.lastGiveUpAt ?? null, inMaintenanceWindow: Boolean(st.inMaintenanceWindow),
  };
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
  pcEv.sfl.fetchInFlight = true;   // 1.14.5: a REST call is running — no SFL re-nav under it
  try { await pcSenderHealthCheck(cfg, rpcHeaders); } catch { /* health check best-effort */ }
  let rows = [];
  try {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/admin_parcel_checks_pending`, {
      method: "POST", headers: rpcHeaders, body: JSON.stringify({ p_limit: PC_FETCH_LIMIT }),
    });
    if (!r.ok) { pcEv.sfl.fetchInFlight = false; await pcStatus({ multi: `rpc_${r.status}` }); return; }
    rows = await r.json();
    if (!Array.isArray(rows)) rows = [];
  } catch { pcEv.sfl.fetchInFlight = false; await pcStatus({ multi: "rpc_error" }); return; }
  pcEv.sfl.fetchInFlight = false;
  await pcStatus({ multi: "ok", multiQueueDepth: rows.length ? Number(rows[0].queue_depth) || 0 : 0, multiLastAt: new Date().toISOString() });
  // 1.14.0: the keepalive runs from pcTick (independent of this lane, the token
  // and the RPC); here we only record whether any pending row needs the store
  // half, and stash the admin RPC context for the Admin-card mirror.
  pcEv.lastAnyNeedStore = rows.some((r) => r && r.need_store);
  pcEv.rpc = { cfg, rpcHeaders };
  if (!rows.length) return;

  const myshipTabId = await pcFindTab(["https://myship.7-11.com.tw/*"]);
  // the ONE emap tab picked this tick (guid-bearing when several exist) — never a blind tabs[0]
  const emapTabId = (pcEv.emap.tabId && !pcEv.emap.error) ? pcEv.emap.tabId : null;
  const now = Date.now(); const inMaint = pcInMaintenance(now);
  for (const [id, b] of pcBackoff) if (now - b.seenAt > PC_REQUEUE_SINCE_MS) pcBackoff.delete(id); // forget rows gone for 6 h
  let processed = 0;
  for (const row of rows) {
    if (processed >= PC_LIMIT) break;
    if (!row || !row.id || pcInFlight.has(row.id)) continue;
    // 1.14.6: a half in backoff is skipped (no request) so rows behind it get their turn
    const bo = pcBackoff.get(row.id);
    if (bo) bo.seenAt = now;
    const doStore = Boolean(row.need_store) && (!bo || now >= bo.storeNextAt);
    const doPhone = Boolean(row.need_phone) && (!bo || now >= bo.phoneNextAt);
    if (!doStore && !doPhone) continue;
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
        if (sResp && (sResp.store_full_status === "open" || sResp.store_full_status === "full")) storeStatus = sResp.store_full_status;
        // evidence for the per-tab status (single writer in pcTick) + the exact reason
        if (storeStatus !== null) {
          pcEmapVerdict(Date.now()); pcEv.lastStoreReason = "";
          const b = pcBackoff.get(row.id);
          if (b && b.storeFails) { b.storeFails = 0; b.storeNextAt = 0; console.log(`[PC-BACKOFF] row=${row.id} store resolved`); }
        } else {
          pcEv.lastStoreReason = (sResp && sResp.store_reason) || "emap tab not responding";
          const transient = Boolean(sResp && sResp.transient);
          const b = pcBackoffEntry(row.id, now);
          if (inMaint) {
            // maintenance window: not counted toward the ladder or the give-up; slow retry
            b.storeNextAt = now + PC_MAINT_RETRY_MS;
            console.log(`[PC-BACKOFF] row=${row.id} store attempt=${b.storeFails} maintenance, next=${PC_MAINT_RETRY_MS / 1000}s`);
          } else {
            // one row counts toward the recovery ladder at most once until another store id resolves
            if (!transient && b.countedGen !== pcEv.verdictGen) { pcEmapMiss(Date.now(), pcEv.lastStoreReason, false); b.countedGen = pcEv.verdictGen; }
            b.storeFails += 1;
            if (b.storeFails >= PC_STORE_GIVE_UP) {
              storeStatus = "unknown"; // give up the STORE half only — the phone half is never auto-stamped
              pcEv.lastGiveUpAt = now; b.storeNextAt = 0;
              console.log(`[PC-BACKOFF] row=${row.id} store attempt=${b.storeFails} gave up → unknown`);
            } else {
              b.storeNextAt = now + pcBackoffDelay(b.storeFails);
              console.log(`[PC-BACKOFF] row=${row.id} store attempt=${b.storeFails} next=${pcBackoffDelay(b.storeFails) / 1000}s`);
            }
          }
        }
      }
      // phone half — the ROW OWNER's GM + phone, never the global config.
      // anon:true → the check runs credential-less so the body ordMobile is the
      // authoritative sender (the owner's myship login is irrelevant); this is
      // the core multi-seller fix (2026-09-27).
      let phoneStatus = null, phoneMessage = null, phoneUntil = null, pTokenMs = null, pPostMs = null;
      if (doPhone && myshipTabId) {
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
          pcEv.myship.lastVerdictAt = Date.now(); pcEv.lastPhoneReason = "";
          const b = pcBackoff.get(row.id);
          if (b && b.phoneFails) { b.phoneFails = 0; b.phoneNextAt = 0; console.log(`[PC-BACKOFF] row=${row.id} phone resolved`); }
        } else {
          pcEv.lastPhoneReason = (pResp && pResp.phone_reason) || "myship tab not responding";
          // same backoff, but NEVER given up (audit M1: a missed restricted number must not look checked)
          const b = pcBackoffEntry(row.id, now);
          if (!inMaint) b.phoneFails += 1;
          const wait = inMaint ? PC_MAINT_RETRY_MS : pcBackoffDelay(b.phoneFails);
          b.phoneNextAt = now + wait;
          console.log(`[PC-BACKOFF] row=${row.id} phone attempt=${b.phoneFails}${inMaint ? " maintenance" : ""} next=${wait / 1000}s`);
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
  await pcRunOnce();
  pcScheduleLoop(PC_POLL_MS);     // re-arm ~5s after this run finishes
}
// One full pass (both lanes + pick + keepalive + status + mirror + heartbeat),
// WITHOUT re-arming — shared by the loop and the popup's "Check now".
async function pcRunOnce() {
  pcEv.tick += 1;
  try { pcEv.maintEnabled = (await pcConfig()).maintenanceWindow; } catch { /* keep the last value */ }
  try { await pcPoll(); } catch { /* keep looping */ }
  // 1.14.0 — every block below is wrapped: a failure logs and can never stop the loop.
  try { await pcPickEmapTab(); } catch (e) { console.log(`[PC-EMAP] skipped: pick ${e && e.message ? e.message : e}`); }
  try { await pcPollMulti(); } catch { /* keep looping */ }
  try { await pcEmapKeepalive(); } catch (e) { console.log(`[PC-KEEPALIVE] skipped: ${e && e.message ? e.message : e}`); }
  try { await pcRefreshTabStatus(); } catch (e) { console.log(`[PC-STATUS] skipped: ${e && e.message ? e.message : e}`); }
  try { await pcRequeueUnknown(Date.now()); } catch (e) { console.log(`[PC-BACKOFF] requeue skipped: ${e && e.message ? e.message : e}`); }
  try { if (pcEv.rpc) await pcPushWorkerState(pcEv.rpc.cfg, pcEv.rpc.rpcHeaders); } catch { /* mirror is best-effort */ }
  if (pcEv.tick % PC_HEARTBEAT_EVERY === 1) {                     // heartbeat ~every 60s — never silent, never spam
    try { const st = (await pcGet(PC_STATUS_KEY, {})) || {}; console.log(`[PC-TICK] #${pcEv.tick} sfl=${st.sfl} myship=${st.myship} emap=${st.emap} queue=${st.multiQueueDepth ?? "-"} emapTab=${pcEv.emap.tabId ?? "none"}`); } catch { /* */ }
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
