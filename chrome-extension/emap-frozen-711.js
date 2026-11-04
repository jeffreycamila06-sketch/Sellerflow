// SellerFlow parcel-checker — E-Map FROZEN (冷凍) store check content script (1.17.0).
// ADD-ONLY: a second, independent listener on the E-Map tab. It answers ONLY the
// PC_FROZEN_CHECK message (every other message is ignored — emap-711.js handles those,
// untouched). Same request the normal check makes (byIDData on the tab's own section,
// same-origin fallback, the page's own eshopGuid) with ONE difference: cate=27, the
// frozen category (probe on the normal E-Map session, 2026-11-05: 968551 cate=27 →
// "…+disable+…" while cate=3 → "…+enable+…"; 151003 → "…+enable+…" on both).
//   field index 3: enable → ok · disable → no_frozen · close / NO2 / other → unknown
// Never writes anything; never executes page code (guid read from the MAIN-world helper
// emap-guid-main.js over its DOM event, or from the page SOURCE text).
(function sellerFlowEmapFrozen() {
  if (window.__sflPcEmapFrozenInjected) return;
  window.__sflPcEmapFrozenInjected = true;
  const TIMEOUT_MS = 10000;
  const MAIN_WAIT_MS = 300;
  const GUID_RE = /eshop[Gg]uid\s*[:=]\s*["']([^"']{8,})["']/;

  function fetchWithTimeout(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(url, { credentials: "include", ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }
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

  // guid: MAIN-world runtime value (emap-guid-main.js replies on the DOM event) → page source text
  let mainGuid = null;
  document.addEventListener("__sfl_emap_guid", (ev) => {
    const d = ev && ev.detail;
    if (d && typeof d.guid === "string" && d.guid.length >= 8) mainGuid = d.guid;
  });
  function mainWorldGuid() {
    if (mainGuid) return Promise.resolve(mainGuid);
    return new Promise((resolve) => {
      try { document.dispatchEvent(new CustomEvent("__sfl_emap_guid_req")); } catch { /* no CustomEvent */ }
      setTimeout(() => resolve(mainGuid), MAIN_WAIT_MS);
    });
  }
  async function getGuid() {
    const g = await mainWorldGuid();
    if (g) return g;
    try {
      for (const s of Array.from(document.querySelectorAll("script"))) {
        const m = GUID_RE.exec(String(s.textContent || ""));
        if (m) return m[1];
      }
    } catch { /* fall through */ }
    return null;
  }

  // "OK;968551+新蓮盈+addr+disable+0++門市" → field index 3
  function parseFrozen(text) {
    const raw = String(text).trim();
    if (raw === "NO2") return { status: "unknown", reason: "store not found (NO2)" };
    const rec = raw.split(";")[1];
    const field = rec ? rec.split("+")[3] : "";
    if (field === "enable") return { status: "ok", reason: "" };
    if (field === "disable") return { status: "no_frozen", reason: "" };
    if (field === "close") return { status: "unknown", reason: "company store (close)" };
    return null;
  }
  async function postFrozen(endpoint, storeId, guid) {
    const body = new URLSearchParams({
      mode: "", k: String(storeId), cate: "27", eshopparid: "7M0", eshopid: "7M0",
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
      const v = parseFrozen(text);
      if (v) return { verdict: v, reason: "", transient: false };
      const head = String(text).replace(/\s+/g, " ").slice(0, 60);
      return { verdict: null, reason: `${endpoint} unexpected response: "${head}"`, transient: false };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return { verdict: null, reason: aborted ? `${endpoint} timeout (10s)` : `${endpoint} network error`, transient: true };
    }
  }
  async function checkFrozenStore(storeId, guid) {
    if (!/^\d{6}$/.test(String(storeId || ""))) return { status: "unknown", reason: "store id not 6 digits", transient: false };
    if (!guid) return { status: "unknown", reason: "eshopGuid not found on emap page", transient: false };
    const order = knownEndpoint ? [knownEndpoint, ...endpointCandidates(location.pathname).filter((p) => p !== knownEndpoint)] : endpointCandidates(location.pathname);
    const reasons = []; let allTransient = true;
    for (const endpoint of order) {
      const r = await postFrozen(endpoint, storeId, guid);
      if (r.verdict) { knownEndpoint = endpoint; return { status: r.verdict.status, reason: r.verdict.reason, transient: false }; }
      reasons.push(r.reason); if (!r.transient) allTransient = false;
    }
    return { status: "unknown", reason: reasons.join(" · "), transient: allTransient };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "PC_FROZEN_CHECK" || !message.row) return false; // not ours
    (async () => {
      const guid = await getGuid();
      const res = await checkFrozenStore(message.row.store_id, guid);
      sendResponse({ ok: true, script: "emap-frozen", frozen_store_status: res.status, frozen_reason: res.reason, transient: Boolean(res.transient), guidFound: guid !== null, endpoint: knownEndpoint });
    })().catch((e) => sendResponse({ ok: true, script: "emap-frozen", frozen_store_status: "unknown", frozen_reason: `frozen check threw: ${(e && e.message) || "error"}`, transient: true, guidFound: false, endpoint: knownEndpoint }));
    return true;
  });
})();
