// SellerFlow parcel-checker — 7-11 E-Map content script. Runs on BOTH
// emap.pcsc.com.tw (legacy) AND emap.unipcsc.com.tw (2026-09 PCSC domain move),
// on BOTH the desktop map (/ecmap/) and the mobile map (/mobilemap/ — what
// 賣貨便 → 選擇門市 opens since 2026-09). All fetches below are RELATIVE →
// same-origin on whichever domain the tab is on; no per-domain code.
// The FULL-STORE lookup (byIDData.aspx) lives on the emap origin — a DIFFERENT
// origin from myship.7-11.com.tw — and its eshopGuid is minted into the emap
// session. So the store check MUST run here (same-origin → session cookies +
// eshopGuid available).
//
// 1.14.1 — NO PAGE-CONTEXT EXECUTION. The mobilemap page ships a strict CSP
// (`script-src 'self' 'wasm-unsafe-eval'`) that blocks the inline <script> the
// old guid read injected (193× CSP errors → guidFound=false → store verdicts
// null). The guid is now read (a) from TEXT we can always see — the URL query,
// inline script SOURCE (`var eshopGuid="…"`), hidden inputs / data attributes —
// and (b) as a runtime window var via the MAIN-world helper emap-guid-main.js
// (registered in the manifest, exempt from page CSP) over a CustomEvent.
// This file never creates a <script> element (test-pinned).
//
// ⚠️ FAIL-SAFE: any doubt → 'unknown' + a human reason, NEVER 'open'/'full' guessed.
(function sellerFlowEmapStoreCheck() {
  // Self-heal (v1.7.0): double-injection guard — the background re-injects this
  // file via chrome.scripting when a ping fails on an alive tab; a second copy
  // must not register a second onMessage listener (double sendResponse).
  if (window.__sflPcEmapInjected) return;
  window.__sflPcEmapInjected = true;
  const TIMEOUT_MS = 10000;
  const MAIN_WAIT_MS = 300;
  const GUID_RE = /eshop[Gg]uid\s*[:=]\s*["']([^"']{8,})["']/;      // inline `var eshopGuid="…"` (ecmap + mobilemap source)
  const GUID_RE_JSON = /["']eshop[Gg]uid["']\s*:\s*["']([^"']{8,})["']/;

  function fetchWithTimeout(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(url, { credentials: "include", ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // ── section + endpoint ─────────────────────────────────────────────────────
  // /mobilemap/ tabs try their own byIDData first, then the desktop one (same
  // origin, same session cookie); /ecmap/ tabs the reverse. The first endpoint
  // that answers with a real verdict is remembered for the rest of the page life.
  function sectionOf(pathname) {
    const m = /^\/(mobilemap|ecmap)\//i.exec(String(pathname || ""));
    return m ? m[1].toLowerCase() : "ecmap";
  }
  function endpointCandidates(pathname) {
    const own = sectionOf(pathname);
    const other = own === "mobilemap" ? "ecmap" : "mobilemap";
    return [`/${own}/byIDData.aspx`, `/${other}/byIDData.aspx`];
  }
  let knownEndpoint = null;

  // ── guid candidates — TEXT only, no execution ──────────────────────────────
  function guidCandidates(doc, loc) {
    const out = [];
    const push = (guid, source) => { if (typeof guid === "string" && guid.length >= 8 && !out.some((c) => c.guid === guid)) out.push({ guid, source }); };
    try {
      const qs = new URLSearchParams(String(loc.search || ""));
      qs.forEach((v, k) => { if (/guid/i.test(k)) push(v, `url:${k}`); });
    } catch { /* no query */ }
    try {
      const scripts = doc.scripts || doc.querySelectorAll("script");
      for (let i = 0; i < scripts.length; i++) {
        const text = String(scripts[i].textContent || "");
        const m = GUID_RE.exec(text) || GUID_RE_JSON.exec(text);
        if (m) push(m[1], `script[${i}]`);
      }
    } catch { /* no scripts collection */ }
    try {
      const html = doc.documentElement ? doc.documentElement.innerHTML : "";
      const m = GUID_RE.exec(html) || GUID_RE_JSON.exec(html);
      if (m) push(m[1], "html");
    } catch { /* detached document */ }
    try {
      const inputs = doc.querySelectorAll("input[type=hidden],input[name*=uid i],input[id*=uid i],[data-guid],[data-eshopguid]");
      for (let i = 0; i < inputs.length; i++) {
        const el = inputs[i];
        const name = String(el.getAttribute("name") || el.getAttribute("id") || "");
        const v = el.getAttribute("data-eshopguid") || el.getAttribute("data-guid") || (/guid/i.test(name) ? el.getAttribute("value") : null);
        if (v) push(v, `input:${name || "data"}`);
      }
    } catch { /* no querySelectorAll */ }
    return out;
  }

  // MAIN-world value (runtime `window.eshopGuid`) via emap-guid-main.js — the
  // helper replies to a request event; also caches its unsolicited load-time reply.
  let mainGuid = { guid: null, source: null };
  let mainMode = null; // 1.16.0: the page's mode globals as the MAIN-world helper saw them
  document.addEventListener("__sfl_emap_guid", (e) => {
    const d = e && e.detail;
    if (d && typeof d.guid === "string" && d.guid.length >= 8) mainGuid = { guid: d.guid, source: d.source || "main" };
    if (d && d.mode && typeof d.mode === "object") mainMode = d.mode;
  });
  function mainWorldGuid() {
    if (mainGuid.guid) return Promise.resolve(mainGuid);
    return new Promise((resolve) => {
      let done = false;
      const onMsg = (e) => {
        const d = e && e.detail;
        if (done) return;
        if (d && typeof d.guid === "string" && d.guid.length >= 8) { done = true; document.removeEventListener("__sfl_emap_guid", onMsg); resolve({ guid: d.guid, source: d.source || "main" }); }
      };
      document.addEventListener("__sfl_emap_guid", onMsg);
      try { document.dispatchEvent(new CustomEvent("__sfl_emap_guid_req")); } catch { /* helper absent — timeout resolves null */ }
      setTimeout(() => { if (!done) { done = true; document.removeEventListener("__sfl_emap_guid", onMsg); resolve({ guid: null, source: null }); } }, MAIN_WAIT_MS);
    });
  }

  // Returns { guid, source, candidates } — text candidates first (free, sync),
  // the MAIN-world var as the fallback.
  async function getEshopGuid() {
    const cands = guidCandidates(document, location);
    if (cands.length) return { guid: cands[0].guid, source: cands[0].source, candidates: cands.length };
    const m = await mainWorldGuid();
    return { guid: m.guid, source: m.source, candidates: m.guid ? 1 : 0 };
  }

  // ── 1.16.0 page MODE: normal vs FROZEN ─────────────────────────────────────
  // Read ONLY from the page itself (text first, the MAIN-world globals as the fallback):
  //   normal 賣貨便 map:     storecategory "" · eshopparid "7M0" · eshopid "7M0"
  //   7-11 frozen picker:   storecategory 27 · eshopparid 870  · eshopid 870
  // A tab is FROZEN only when its own page says storecategory = 27 (7-11's frozen category)
  // and carries both eshop values. The frozen question then sends exactly what the page says.
  const FROZEN_CATEGORY = "27";
  const MODE_NAMES = ["storecategory", "eshopparid", "eshopid"];
  function modeFromText(doc) {
    const out = { storecategory: null, eshopparid: null, eshopid: null };
    let text = "";
    try { const scripts = doc.scripts || doc.querySelectorAll("script"); for (let i = 0; i < scripts.length; i++) text += String(scripts[i].textContent || "") + "\n"; } catch { /* no scripts */ }
    for (const name of MODE_NAMES) {
      const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_-]+))`).exec(text);
      if (m) out[name] = m[1] ?? m[2] ?? m[3] ?? null;
    }
    return out;
  }
  function pageMode() {
    const t = modeFromText(document);
    const out = {};
    for (const name of MODE_NAMES) {
      const v = t[name] != null ? t[name] : (mainMode && mainMode[name] != null ? String(mainMode[name]) : null);
      out[name] = v == null ? null : String(v).trim();
    }
    return out;
  }
  const isFrozenMode = (m) => Boolean(m && m.storecategory === FROZEN_CATEGORY && m.eshopparid && m.eshopid);

  // One diagnostic line per page life (the owner reads it in the tab console).
  let diagLogged = false;
  function diag(g, endpoint) {
    if (diagLogged) return;
    diagLogged = true;
    console.log(`[PC-EMAP] ${sectionOf(location.pathname)}: guid candidates=${g.candidates} source=${g.source || "none"} endpoint=${endpoint || "none"} path=${location.pathname}`); // never the full address (its query can hold the session value)
  }

  // ── byIDData ───────────────────────────────────────────────────────────────
  // Expected: "OK;198002+德民+addr+disable+0++門市" → field index 3:
  //   enable  → open · disable → full
  //   close   → company (1.14.8) — a closed-area store inside a factory/park
  //             (正常配送(限公司員工取貨)); a valid store that carries NO open/full info
  // The whole answer "NO2" → not_found (1.14.8) — no such store (wrong code / closed).
  // Real captures (Jeff, /ecmap/, 2026-09-30):
  //   "OK;180849+明月+高雄市楠梓區楠梓加工區第二園區創意北路1號+close+0++門市"
  //   "NO2" (277895)
  // Anything else → null → 'unknown' (fail-safe, unchanged).
  function parseByIdData(text) {
    const raw = String(text).trim();
    if (raw === "NO2") return { store_full_status: "not_found", store_reason: "" };
    const rec = raw.split(";")[1];
    const field = rec ? rec.split("+")[3] : "";
    if (field === "enable") return { store_full_status: "open", store_reason: "" };
    if (field === "disable") return { store_full_status: "full", store_reason: "" };
    if (field === "close") return { store_full_status: "company", store_reason: "" };
    return null;
  }
  async function postByIdData(endpoint, storeId, guid) {
    const body = new URLSearchParams({
      mode: "", k: String(storeId), cate: "3", eshopparid: "7M0", eshopid: "7M0",
      multiple_type: "", Guid: guid, Nan4AjaxTrickNumber: String(Date.now()),
    }).toString();
    try {
      const r = await fetchWithTimeout(`${endpoint}?rnd=${Math.random()}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
        body,
      });
      if (/\/error\.aspx/i.test(String(r.url || ""))) return { verdict: null, reason: `${endpoint} bounced to error.aspx`, transient: false };
      if (!r.ok) return { verdict: null, reason: `${endpoint} returned HTTP ${r.status}`, transient: r.status >= 500 };
      const text = await r.text();
      // 1.16.0: 7-11 "系統忙碌中 E0014" (busy) is transient — back off, never a give-up, never OK
      if (/E0014/.test(String(text))) return { verdict: null, reason: `${endpoint} busy (E0014)`, transient: true, busy: true };
      const v = parseByIdData(text);
      if (v) return { verdict: v, reason: "", transient: false };
      const head = String(text).replace(/\s+/g, " ").slice(0, 60);
      return { verdict: null, reason: `${endpoint} unexpected response: "${head}"`, transient: false };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      // a timeout / network blip says nothing about the session → TRANSIENT (never a miss)
      return { verdict: null, reason: aborted ? `${endpoint} timeout (10s)` : `${endpoint} network error`, transient: true };
    }
  }
  // Returns { store_full_status, store_reason, endpoint }. reason "" on a clean verdict.
  // `transient: true` = every attempt was a timeout / network / 5xx blip (the
  // session may be fine) — the worker's recovery ladder ignores those.
  async function checkFullStore(storeId, guid) {
    if (!/^\d{6}$/.test(String(storeId || ""))) return { store_full_status: "unknown", store_reason: "store id not 6 digits", endpoint: knownEndpoint, transient: false };
    if (!guid) return { store_full_status: "unknown", store_reason: "eshopGuid not found on emap page", endpoint: knownEndpoint, transient: false };
    const order = knownEndpoint ? [knownEndpoint, ...endpointCandidates(location.pathname).filter((p) => p !== knownEndpoint)] : endpointCandidates(location.pathname);
    const reasons = []; let allTransient = true; let busy = false;
    for (const endpoint of order) {
      const r = await postByIdData(endpoint, storeId, guid);
      if (r.verdict) { knownEndpoint = endpoint; return { ...r.verdict, endpoint, transient: false }; }
      reasons.push(r.reason); if (!r.transient) allTransient = false;
      if (r.busy) { busy = true; break; } // 7-11 is busy — don't hit the other endpoint
    }
    return { store_full_status: "unknown", store_reason: reasons.join(" · "), endpoint: knownEndpoint, transient: allTransient, busy };
  }

  // ── 1.16.0 FROZEN check ───────────────────────────────────────────────────
  // STRICT: only "OK;<the store we asked>+…+enable|disable|close+…" or the bare "NO2" is an
  // answer. A different store number (7-11's "nearest store" reply), "I0100" (a session that
  // is not in frozen mode), anything else → null → 'unknown'. E0014 → busy (transient).
  //   enable → 'open' (OK for frozen) · disable → 'frozen_unavailable' · close → 'company'
  //   NO2 → 'not_found'
  function parseFrozenByIdData(text, storeId) {
    const raw = String(text).trim();
    if (raw === "NO2") return { store_full_status: "not_found", store_reason: "" };
    if (!raw.startsWith("OK;")) return null;
    const rec = raw.slice(3).split(";")[0];
    const f = rec.split("+");
    if (f[0] !== String(storeId)) return null; // an answer about ANOTHER store is never this store's answer
    if (f[3] === "enable") return { store_full_status: "open", store_reason: "" };
    if (f[3] === "disable") return { store_full_status: "frozen_unavailable", store_reason: "" };
    if (f[3] === "close") return { store_full_status: "company", store_reason: "" };
    return null;
  }
  async function checkFrozenStore(storeId, guid, m) {
    if (!/^\d{6}$/.test(String(storeId || ""))) return { store_full_status: "unknown", store_reason: "store id not 6 digits", transient: false };
    if (!isFrozenMode(m)) return { store_full_status: "unknown", store_reason: "not a frozen E-Map page (mode values missing)", transient: false };
    if (!guid) return { store_full_status: "unknown", store_reason: "session value not found on the frozen page", transient: false };
    const endpoint = `/${sectionOf(location.pathname)}/byIDData.aspx`;
    // same field order as the normal question; cate / eshopparid / eshopid exactly as the page says
    const body = new URLSearchParams({
      mode: "", k: String(storeId), cate: m.storecategory, eshopparid: m.eshopparid, eshopid: m.eshopid,
      multiple_type: "", Guid: guid, Nan4AjaxTrickNumber: String(Date.now()),
    }).toString();
    try {
      const r = await fetchWithTimeout(`${endpoint}?rnd=${Math.random()}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
        body,
      });
      if (/\/error\.aspx/i.test(String(r.url || ""))) return { store_full_status: "unknown", store_reason: "frozen session bounced to error.aspx", transient: false };
      if (!r.ok) return { store_full_status: "unknown", store_reason: `frozen check HTTP ${r.status}`, transient: r.status >= 500 };
      const text = await r.text();
      if (/E0014/.test(String(text))) return { store_full_status: "unknown", store_reason: "7-11 busy (E0014)", transient: true, busy: true };
      const v = parseFrozenByIdData(text, storeId);
      if (v) return { ...v, transient: false };
      return { store_full_status: "unknown", store_reason: `frozen check: not a clean answer for ${storeId} (${String(text).trim().length} chars)`, transient: false };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return { store_full_status: "unknown", store_reason: aborted ? "frozen check timeout (10s)" : "frozen check network error", transient: true };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PC_PING") { sendResponse({ ok: true, script: "emap" }); return true; }
    // 1.14.0 — cheap guid probe (NO byIDData): lets the worker pick the emap tab
    // that actually has a live eshopGuid when several are open. Reports section,
    // guid source/candidates and the endpoint in use for the worker's log line.
    if (message?.type === "PC_EMAP_PROBE") {
      (async () => {
        let g = { guid: null, source: null, candidates: 0 };
        try { g = await getEshopGuid(); } catch { /* fail-safe below */ }
        diag(g, knownEndpoint);
        const m = pageMode();
        sendResponse({ ok: true, script: "emap", guidFound: g.guid !== null, guidSource: g.source, guidCandidates: g.candidates, section: sectionOf(location.pathname), endpoint: knownEndpoint, path: location.pathname, frozen: isFrozenMode(m), cate: m.storecategory, eshopparid: m.eshopparid, eshopid: m.eshopid });
      })().catch(() => sendResponse({ ok: true, script: "emap", guidFound: false, guidSource: null, guidCandidates: 0, section: sectionOf(location.pathname), endpoint: knownEndpoint, path: location.pathname }));
      return true;
    }
    if (message?.type === "PC_CHECK_STORE_FROZEN" && message.row) {
      (async () => {
        const g = await getEshopGuid();
        const m = pageMode();
        const res = await checkFrozenStore(message.row.store_id, g.guid, m);
        sendResponse({ ok: true, store_full_status: res.store_full_status, store_reason: res.store_reason, transient: Boolean(res.transient), busy: Boolean(res.busy), guidFound: g.guid !== null, frozenPage: isFrozenMode(m), section: sectionOf(location.pathname) });
      })().catch(() => sendResponse({ ok: true, store_full_status: "unknown", store_reason: "frozen check threw", transient: true, busy: false, guidFound: false, frozenPage: false, section: sectionOf(location.pathname) }));
      return true;
    }
    if (message?.type !== "PC_CHECK_STORE" || !message.row) return false;
    if (isFrozenMode(pageMode())) { // 1.16.0: the normal question is never asked on a frozen page
      sendResponse({ ok: true, store_full_status: "unknown", store_reason: "frozen E-Map page — normal check refused", transient: true, guidFound: false, guidSource: null, endpoint: knownEndpoint, section: sectionOf(location.pathname) });
      return true;
    }
    (async () => {
      const g = await getEshopGuid();
      const res = await checkFullStore(message.row.store_id, g.guid);
      diag(g, res.endpoint);
      sendResponse({ ok: true, store_full_status: res.store_full_status, store_reason: res.store_reason, transient: Boolean(res.transient), busy: Boolean(res.busy), guidFound: g.guid !== null, guidSource: g.source, endpoint: res.endpoint, section: sectionOf(location.pathname) });
    })().catch(() => sendResponse({ ok: true, store_full_status: "unknown", store_reason: "emap check threw", transient: true, guidFound: false, guidSource: null, endpoint: knownEndpoint, section: sectionOf(location.pathname) }));
    return true;
  });
})();
