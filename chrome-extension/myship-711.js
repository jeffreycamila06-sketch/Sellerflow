// SellerFlow parcel-checker — 賣貨便 (myship.7-11.com.tw) content script.
// Runs in Jeff's logged-in 賣貨便 tab. On a message from the background worker it
// runs the TWO session-bound checks the server cannot do (same-origin fetches →
// session cookies attach automatically) and returns verdicts. It NEVER submits an
// order — only the read-only FULL-STORE lookup and the validation-only phone check.
//
// ⚠️ FAIL-SAFE: on ANY doubt — missing page var, HTML/redirect (expired session),
// bad shape, network error, timeout — return 'unknown', NEVER 'ok'/'open'. An
// unconfirmed parcel must not look clean.
(function sellerFlowParcelChecker() {
  const TIMEOUT_MS = 10000;

  function fetchWithTimeout(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(url, { credentials: "include", ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // Read a MAIN-world page variable (isolated content scripts can't see page JS
  // vars directly). Regex the served HTML FIRST (cheap, CSP-proof — the research
  // path); fall back to an injected MAIN-world script that postMessages the value.
  function regexPageVar(name) {
    try {
      const html = document.documentElement.innerHTML;
      const re = new RegExp(`(?:var\\s+)?${name}\\s*[:=]\\s*["']([^"']+)["']`);
      const m = html.match(re) || html.match(new RegExp(`["']${name}["']\\s*:\\s*["']([^"']+)["']`));
      return m ? m[1] : null;
    } catch {
      return null;
    }
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
      } catch { /* CSP blocked inline — the timeout resolves null */ }
      setTimeout(() => { if (!done) { window.removeEventListener("message", onMsg); resolve(null); } }, 800);
    });
  }
  async function pageVar(name) {
    return regexPageVar(name) || (await mainWorldVar(name));
  }

  // eshopGuid — server-injected on default.aspx. Regex first, then MAIN-world.
  async function getEshopGuid() {
    return pageVar("eshopGuid");
  }
  // CSRF token for CheckoutValidation. Hidden input / meta first, then page var.
  function getVerificationToken() {
    const input = document.querySelector('input[name="__RequestVerificationToken"], input[name="verificationToken"], input[name="VerificationToken"]');
    if (input && input.value) return input.value;
    const meta = document.querySelector('meta[name="verificationtoken"], meta[name="verification-token"], meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    return null; // page-var fallback handled by the async caller
  }

  // ── CHECK 1 — FULL STORE (read-only lookup) ──────────────────────────────────
  async function checkFullStore(storeId, guid) {
    if (!guid || !/^\d{6}$/.test(String(storeId || ""))) return { store_full_status: "unknown" };
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
      const text = await r.text();
      // Expected: "OK;198002+德民+addr+disable+0++門市" → field index 3 = enable|disable.
      const rec = String(text).split(";")[1];
      const field = rec ? rec.split("+")[3] : "";
      if (field === "enable") return { store_full_status: "open" };
      if (field === "disable") return { store_full_status: "full" };
      return { store_full_status: "unknown" }; // unexpected shape / HTML / redirect
    } catch {
      return { store_full_status: "unknown" };
    }
  }

  // ── CHECK 2 — RESTRICTED PHONE (validation-only — NO order is created) ────────
  async function checkRestricted(row, config, token) {
    const phone = String(row.phone || "");
    if (!token || !config.cgdmId || !config.ordMobile || !/^\d{6}$/.test(String(row.store_id || ""))) {
      return { phone_check_status: "unknown" }; // missing inputs → can't check
    }
    try {
      const body = new URLSearchParams({
        rcvName: String(row.customer_name || ""), revPhone: "", revMobile: phone,
        ordPhone: "", ordMobile: String(config.ordMobile), Cgdm_Id: String(config.cgdmId),
        Carm_Cgptshiptype: "1", Carm_Cgptpaymenttype: "1", RcvStoreID: String(row.store_id),
      }).toString();
      const r = await fetchWithTimeout("/CPF3101/CheckoutValidation/", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          verificationtoken: token,
        },
        body,
      });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return { phone_check_status: "unknown" }; // HTML/redirect = expired session
      const j = await r.json();
      if (j && j.Status === true) return { phone_check_status: "ok" };
      if (j && j.Status === false) {
        const msg = String(j.Message || "");
        const m = msg.match(/(\d{4})年(\d{2})月(\d{2})日/);
        return {
          phone_check_status: "restricted",
          phone_check_message: msg || null,
          phone_restricted_until: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
        };
      }
      return { phone_check_status: "unknown" };
    } catch {
      return { phone_check_status: "unknown" };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "PC_CHECK" || !message.row) return false;
    (async () => {
      const { row, config } = message;
      const guid = await getEshopGuid();
      const token = getVerificationToken() || (await pageVar("verificationToken")) || (await pageVar("__RequestVerificationToken"));
      const [full, restricted] = await Promise.all([
        checkFullStore(row.store_id, guid),
        checkRestricted(row, config || {}, token),
      ]);
      sendResponse({
        ok: true,
        verdict: {
          store_full_status: full.store_full_status,
          phone_check_status: restricted.phone_check_status,
          phone_check_message: restricted.phone_check_message ?? null,
          phone_restricted_until: restricted.phone_restricted_until ?? null,
          // Diagnostics for the popup (never written to the DB):
          _sessionOk: guid !== null || token !== null,
        },
      });
    })().catch(() => sendResponse({ ok: true, verdict: { store_full_status: "unknown", phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, _sessionOk: false } }));
    return true; // async sendResponse
  });
})();
