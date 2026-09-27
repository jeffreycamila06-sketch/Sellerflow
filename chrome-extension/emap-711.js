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
  document.addEventListener("__sfl_emap_guid", (e) => {
    const d = e && e.detail;
    if (d && typeof d.guid === "string" && d.guid.length >= 8) mainGuid = { guid: d.guid, source: d.source || "main" };
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

  // One diagnostic line per page life (the owner reads it in the tab console).
  let diagLogged = false;
  function diag(g, endpoint) {
    if (diagLogged) return;
    diagLogged = true;
    console.log(`[PC-EMAP] ${sectionOf(location.pathname)}: guid candidates=${g.candidates} source=${g.source || "none"} endpoint=${endpoint || "none"} url=${location.href}`);
  }

  // ── byIDData ───────────────────────────────────────────────────────────────
  // Expected: "OK;198002+德民+addr+disable+0++門市" → field index 3 = enable|disable.
  function parseByIdData(text) {
    const rec = String(text).split(";")[1];
    const field = rec ? rec.split("+")[3] : "";
    if (field === "enable") return { store_full_status: "open", store_reason: "" };
    if (field === "disable") return { store_full_status: "full", store_reason: "" };
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
    const reasons = []; let allTransient = true;
    for (const endpoint of order) {
      const r = await postByIdData(endpoint, storeId, guid);
      if (r.verdict) { knownEndpoint = endpoint; return { ...r.verdict, endpoint, transient: false }; }
      reasons.push(r.reason); if (!r.transient) allTransient = false;
    }
    return { store_full_status: "unknown", store_reason: reasons.join(" · "), endpoint: knownEndpoint, transient: allTransient };
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
        sendResponse({ ok: true, script: "emap", guidFound: g.guid !== null, guidSource: g.source, guidCandidates: g.candidates, section: sectionOf(location.pathname), endpoint: knownEndpoint, url: location.href });
      })().catch(() => sendResponse({ ok: true, script: "emap", guidFound: false, guidSource: null, guidCandidates: 0, section: sectionOf(location.pathname), endpoint: knownEndpoint, url: location.href }));
      return true;
    }
    if (message?.type !== "PC_CHECK_STORE" || !message.row) return false;
    (async () => {
      const g = await getEshopGuid();
      const res = await checkFullStore(message.row.store_id, g.guid);
      diag(g, res.endpoint);
      sendResponse({ ok: true, store_full_status: res.store_full_status, store_reason: res.store_reason, transient: Boolean(res.transient), guidFound: g.guid !== null, guidSource: g.source, endpoint: res.endpoint, section: sectionOf(location.pathname) });
    })().catch(() => sendResponse({ ok: true, store_full_status: "unknown", store_reason: "emap check threw", transient: true, guidFound: false, guidSource: null, endpoint: knownEndpoint, section: sectionOf(location.pathname) }));
    return true;
  });
})();
