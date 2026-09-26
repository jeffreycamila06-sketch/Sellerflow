// SellerFlow parcel-checker — 7-11 E-Map content script. Runs on BOTH
// emap.pcsc.com.tw (legacy) AND emap.unipcsc.com.tw (2026-09 PCSC domain move;
// same /ecmap/ pages). All fetches below are RELATIVE → same-origin on
// whichever domain the tab is on; no per-domain code.
// The FULL-STORE lookup (byIDData.aspx) lives on emap.pcsc.com.tw — a DIFFERENT
// origin from myship.7-11.com.tw — and its eshopGuid is injected on emap's own
// default.aspx. So the store check MUST run here (same-origin → session cookies
// + eshopGuid available). Fixes the "everything unknown" bug where the check ran
// cross-origin from the myship tab (no emap cookies, no eshopGuid).
//
// ⚠️ FAIL-SAFE: any doubt → 'unknown' + a human reason, NEVER 'open'/'full' guessed.
(function sellerFlowEmapStoreCheck() {
  const TIMEOUT_MS = 10000;

  function fetchWithTimeout(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(url, { credentials: "include", ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // MAIN-world page var: regex the served HTML first (CSP-proof), then an injected
  // MAIN-world script that postMessages the value back.
  function regexPageVar(name) {
    try {
      const html = document.documentElement.innerHTML;
      const m = html.match(new RegExp(`(?:var\\s+)?${name}\\s*[:=]\\s*["']([^"']+)["']`))
        || html.match(new RegExp(`["']${name}["']\\s*:\\s*["']([^"']+)["']`));
      return m ? m[1] : null;
    } catch { return null; }
  }
  function mainWorldVar(name) {
    return new Promise((resolve) => {
      let done = false;
      const tag = `__sfl_pv_${Math.random().toString(36).slice(2)}`;
      const onMsg = (e) => {
        if (e.source === window && e.data && e.data.__sflPageVar === tag) {
          done = true; window.removeEventListener("message", onMsg);
          resolve(typeof e.data.value === "string" && e.data.value ? e.data.value : null);
        }
      };
      window.addEventListener("message", onMsg);
      try {
        const s = document.createElement("script");
        s.textContent = `(function(){try{var v=(typeof ${name}!=="undefined")?${name}:(window.${name}!==undefined?window.${name}:null);window.postMessage({__sflPageVar:${JSON.stringify(tag)},value:v==null?null:String(v)},"*");}catch(e){window.postMessage({__sflPageVar:${JSON.stringify(tag)},value:null},"*");}})();`;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch { /* CSP blocked — timeout resolves null */ }
      setTimeout(() => { if (!done) { window.removeEventListener("message", onMsg); resolve(null); } }, 800);
    });
  }
  async function getEshopGuid() {
    return regexPageVar("eshopGuid") || (await mainWorldVar("eshopGuid"));
  }

  // Returns { store_full_status, store_reason }. reason "" on a clean verdict.
  async function checkFullStore(storeId, guid) {
    if (!/^\d{6}$/.test(String(storeId || ""))) return { store_full_status: "unknown", store_reason: "store id not 6 digits" };
    if (!guid) return { store_full_status: "unknown", store_reason: "eshopGuid not found on emap page" };
    try {
      const body = new URLSearchParams({
        mode: "", k: String(storeId), cate: "3", eshopparid: "7M0", eshopid: "7M0",
        multiple_type: "", Guid: guid, Nan4AjaxTrickNumber: String(Date.now()),
      }).toString();
      const r = await fetchWithTimeout(`/ecmap/byIDData.aspx?rnd=${Math.random()}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
        body,
      });
      if (!r.ok) return { store_full_status: "unknown", store_reason: `byIDData returned HTTP ${r.status}` };
      const text = await r.text();
      // Expected: "OK;198002+德民+addr+disable+0++門市" → field index 3 = enable|disable.
      const rec = String(text).split(";")[1];
      const field = rec ? rec.split("+")[3] : "";
      if (field === "enable") return { store_full_status: "open", store_reason: "" };
      if (field === "disable") return { store_full_status: "full", store_reason: "" };
      const head = String(text).replace(/\s+/g, " ").slice(0, 60);
      return { store_full_status: "unknown", store_reason: `byIDData unexpected response: "${head}"` };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return { store_full_status: "unknown", store_reason: aborted ? "byIDData timeout (10s)" : "byIDData network error" };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "PC_CHECK_STORE" || !message.row) return false;
    (async () => {
      const guid = await getEshopGuid();
      const res = await checkFullStore(message.row.store_id, guid);
      sendResponse({ ok: true, store_full_status: res.store_full_status, store_reason: res.store_reason, guidFound: guid !== null });
    })().catch(() => sendResponse({ ok: true, store_full_status: "unknown", store_reason: "emap check threw", guidFound: false }));
    return true;
  });
})();
