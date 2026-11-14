// SellerFlow parcel-checker — E-Map FROZEN (冷凍) store check content script (1.17.0; blocked flag 1.18.0).
// ADD-ONLY: a second, independent listener on the E-Map tab. It answers ONLY the
// PC_FROZEN_CHECK message (every other message is ignored — emap-711.js handles those,
// untouched). Same request the normal check makes (byIDData, the page's own eshopGuid) with
// ONE difference: cate=27, the frozen category (probe on the normal E-Map session,
// 2026-11-05: 968551 cate=27 → "…+disable+…" while cate=3 → "…+enable+…"; 151003 →
// "…+enable+…" on both).
// SHORT AND SINGLE (the shared E-Map session must never carry two requests at once): ONE
// endpoint per check (no fallback retry) and a 2.5 s abort that covers the whole request,
// response body included (the timer is cleared only after the text is read). The endpoint starts as the tab's
// own section; an answer from it that is not a verdict (bounce / HTTP error / odd page)
// switches to the other section for the NEXT check. A timeout never switches.
//   field index 3: enable → ok · disable → no_frozen · close / NO2 / other → unknown
// Answers PC_FROZEN_PING (the worker's self-heal ping; no answer → the worker injects this file).
// 1.18.0: every answer also carries `blocked` — true for HTTP 403 / 429 or a captcha / login page
// instead of an answer. The warm-up lane stops itself on it; the live lane treats it like any other
// 'unknown' (unchanged).
// 1.18.0 NIGHT: only a message with `nightWarm: true` (the warm-up's 01:00–05:00 probe) or — 1.18.2 —
// `night: true` (the live lane's 01:00–05:00 request) treats an E-Map maintenance page (redirect path or
// body) as a transient no-answer. Every DAY request keeps the 1.17.0 order and outcome: a non-answer
// page = 'unknown', not transient, the next check uses the other section.
// Never writes anything; never executes page code (guid read from the MAIN-world helper
// emap-guid-main.js over its DOM event, or from the page SOURCE text).
(function sellerFlowEmapFrozen() {
  // Guard = a LIVENESS check, not a flag: skip only while a previous copy of this script is
  // still connected to a running extension. After an extension reload the old copy's runtime
  // is gone (rt.id undefined), so the new copy installs its listener instead of being blocked.
  try { if (typeof window.__sflPcEmapFrozenAlive === "function" && window.__sflPcEmapFrozenAlive()) return; } catch { /* treat as not alive */ }
  const rt = chrome.runtime;
  window.__sflPcEmapFrozenAlive = () => { try { return Boolean(rt && rt.id); } catch { return false; } };
  const TIMEOUT_MS = 2500;
  const MAIN_WAIT_MS = 300;
  const GUID_RE = /eshop[Gg]uid\s*[:=]\s*["']([^"']{8,})["']/;
  const BLOCK_PAGE_RE = /captcha|驗證碼|recaptcha|login|登入|robot/i;
  // 1.18.0 (night warm-up probe only): an E-Map MAINTENANCE page (a redirect to it, or its body in a 200)
  // is a transient no-answer, never a verdict and never a block (such pages often carry a "登入" link).
  // HTTP 403 / 429, a login / captcha URL, captcha words and a login form still block.
  // MAINT_URL_RE is tested on the redirect's PATH only (never its query string).
  const MAINT_URL_RE = /maint|維護|upgrade|update\.(aspx|html?)|closed?\.(aspx|html?)|sorry|busy/i;
  const MAINT_BODY_RE = /維護|维护|系統更新|系统更新|暫停服務|暂停服务|maintenance|maintain|under construction/i;
  const STRONG_BLOCK_RE = /captcha|驗證碼|验证码|recaptcha|robot/i;   // these win over a maintenance look
  // 1.18.2 night reading only: "robot" counts as its own word, and never inside a <meta …> tag
  // (<meta name="robots"> is on ordinary pages, maintenance pages included)
  const STRONG_BLOCK_NIGHT_RE = /captcha|驗證碼|验证码|recaptcha|\brobot\b/i;
  const stripMeta = (html) => String(html).replace(/<meta\b[^>]*>/gi, " ");
  // a login form / password input = a sign-in page, even when it also looks like maintenance
  const LOGIN_FORM_RE = /<input\b[^>]*\btype\s*=\s*["']?password\b|<form\b[^>]*login/i;
  const pathOf = (u) => { try { return new URL(String(u || ""), location.href).pathname; } catch { return ""; } };
  // a real byIDData answer is "OK;<6-digit store>+…" or exactly "NO2" — nothing else is parsed
  const ANSWER_RE = /^OK;\d{6}\+/;

  function sectionOf(pathname) {
    const m = /^\/(mobilemap|ecmap)\//i.exec(String(pathname || ""));
    return m ? m[1].toLowerCase() : "ecmap";
  }
  const otherSection = (s) => (s === "mobilemap" ? "ecmap" : "mobilemap");
  let section = sectionOf(location.pathname);       // the ONE endpoint the next check uses
  const endpointOf = (s) => `/${s}/byIDData.aspx`;

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
    if (!ANSWER_RE.test(raw)) return null;                  // any page (maintenance / login / HTML) is never a verdict
    const rec = raw.split(";")[1];
    const field = rec ? rec.split("+")[3] : "";
    if (field === "enable") return { status: "ok", reason: "" };
    if (field === "disable") return { status: "no_frozen", reason: "" };
    if (field === "close") return { status: "unknown", reason: "company store (close)" };
    return null;
  }
  async function postFrozen(endpoint, storeId, guid, nightWarm) {
    const body = new URLSearchParams({
      mode: "", k: String(storeId), cate: "27", eshopparid: "7M0", eshopid: "7M0",
      multiple_type: "", Guid: guid, Nan4AjaxTrickNumber: String(Date.now()),
    }).toString();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);   // 2.5 s for headers AND body
    try {
      const r = await fetch(`${endpoint}?rnd=${Math.random()}`, {
        credentials: "include", method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
        body, signal: ctrl.signal,
      });
      const httpBlock = r.status === 403 || r.status === 429;
      // 1.18.2 night: the redirect's PATH only (a "login" word in its query string is not a block); day: as before
      const urlBlock = BLOCK_PAGE_RE.test(nightWarm ? pathOf(r.url) : String(r.url || ""));
      if (nightWarm) {                                       // night requests ONLY (warm-up probe + live lane)
        if (httpBlock) return { verdict: null, reason: `${endpoint} returned HTTP ${r.status}`, transient: false, blocked: true };
        if (urlBlock) return { verdict: null, reason: `${endpoint} redirected to a login / captcha page`, transient: false, blocked: true };
        if (MAINT_URL_RE.test(pathOf(r.url))) return { verdict: null, reason: `${endpoint} redirected to a maintenance page`, transient: true, maintenance: true };
      }
      // day + live lane: the 1.17.0 order and outcome (blocked = a flag only, read by the warm-up)
      if (/\/error\.aspx/i.test(String(r.url || ""))) return { verdict: null, reason: `${endpoint} bounced to error.aspx`, transient: false, blocked: httpBlock || urlBlock };
      if (!r.ok) return { verdict: null, reason: `${endpoint} returned HTTP ${r.status}`, transient: r.status >= 500, blocked: httpBlock || urlBlock };
      const text = await r.text();
      const v = parseFrozen(text);
      if (v) return { verdict: v, reason: "", transient: false };
      const page = String(text).slice(0, 4000);
      // night: <meta …> tags (e.g. <meta name="robots">) never count; day: as before
      const pageBlock = BLOCK_PAGE_RE.test(nightWarm ? stripMeta(page) : page) || LOGIN_FORM_RE.test(page);
      if (nightWarm && !STRONG_BLOCK_NIGHT_RE.test(stripMeta(page)) && !LOGIN_FORM_RE.test(page) && MAINT_BODY_RE.test(page)) {
        return { verdict: null, reason: `${endpoint} maintenance page`, transient: true, maintenance: true };
      }
      const head = String(text).replace(/\s+/g, " ").slice(0, 60);
      return { verdict: null, reason: `${endpoint} unexpected response: "${head}"`, transient: false, blocked: httpBlock || urlBlock || pageBlock };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return { verdict: null, reason: aborted ? `${endpoint} timeout (2.5s)` : `${endpoint} network error`, transient: true };
    } finally { clearTimeout(t); }                            // only after the body was read (or failed)
  }
  async function checkFrozenStore(storeId, guid, nightWarm) {
    const endpoint = endpointOf(section);
    if (!/^\d{6}$/.test(String(storeId || ""))) return { status: "unknown", reason: "store id not 6 digits", transient: false, endpoint };
    if (!guid) return { status: "unknown", reason: "eshopGuid not found on emap page", transient: false, endpoint };
    const r = await postFrozen(endpoint, storeId, guid, nightWarm === true);
    if (r.verdict) return { status: r.verdict.status, reason: r.verdict.reason, transient: false, endpoint };
    if (!r.transient) section = otherSection(section);  // a real non-verdict answer → the other section NEXT time
    return { status: "unknown", reason: r.reason, transient: r.transient, blocked: Boolean(r.blocked), maintenance: Boolean(r.maintenance), endpoint };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "PC_FROZEN_PING") { sendResponse({ ok: true, script: "emap-frozen" }); return true; } // self-heal ping
    if (!message || message.type !== "PC_FROZEN_CHECK" || !message.row) return false; // not ours
    (async () => {
      const guid = await getGuid();
      // night = the warm-up's night probe OR (1.18.2) the live lane's night request; a day message has neither
      const res = await checkFrozenStore(message.row.store_id, guid, message.nightWarm === true || message.night === true);
      sendResponse({ ok: true, script: "emap-frozen", frozen_store_status: res.status, frozen_reason: res.reason, transient: Boolean(res.transient), blocked: Boolean(res.blocked), maintenance: Boolean(res.maintenance), guidFound: guid !== null, endpoint: res.endpoint });
    })().catch((e) => sendResponse({ ok: true, script: "emap-frozen", frozen_store_status: "unknown", frozen_reason: `frozen check threw: ${(e && e.message) || "error"}`, transient: true, guidFound: false, endpoint: endpointOf(section) }));
    return true;
  });
})();
