// SellerFlow parcel-checker — 賣貨便 (myship.7-11.com.tw) content script.
// Runs in Jeff's logged-in 賣貨便 tab. Handles ONLY the RESTRICTED-PHONE check
// (validation-only — NEVER submits an order). The FULL-STORE check moved to
// emap-711.js (it lives on emap.pcsc.com.tw, a different origin — the old
// cross-origin call was why every store check returned 'unknown').
//
// ⚠️ FAIL-SAFE: any doubt (missing token, HTML/redirect, bad shape, timeout) →
// 'unknown' + a human reason, NEVER a guessed 'ok'.
(function sellerFlowMyshipPhoneCheck() {
  const TIMEOUT_MS = 10000;

  function fetchWithTimeout(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(url, { credentials: "include", ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // ── CSRF verificationtoken discovery ─────────────────────────────────────────
  // ⚠️ The header token is NOT the cookie __RequestVerificationToken — it is a
  // page-issued token (ASP.NET MVC antiforgery, per controller/page). It may not
  // exist on /Home. Strategy: (1) scan THIS page (inputs / meta / any <script>),
  // (2) read-only GET a couple of pages that DO carry it and regex it out (a GET
  // creates no order). Returns { token, source } — token null if none found.
  function tokenFromHtml(html) {
    if (!html) return null;
    // hidden input value=… (order-independent), meta content=…, or a JS assignment.
    let m = html.match(/name=["']__RequestVerificationToken["'][^>]*\bvalue=["']([^"']+)["']/i)
      || html.match(/\bvalue=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i)
      || html.match(/name=["']verification[Tt]oken["'][^>]*\bvalue=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+name=["']verification-?token["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/verification[Tt]oken\s*[:=]\s*["']([^"']{16,})["']/);
    return m ? m[1] : null;
  }
  function tokenFromDom() {
    const input = document.querySelector('input[name="__RequestVerificationToken"], input[name="verificationToken"], input[name="VerificationToken"]');
    if (input && input.value) return input.value;
    const meta = document.querySelector('meta[name="verificationtoken"], meta[name="verification-token"], meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    return null;
  }
  // Candidate pages known to carry the checkout antiforgery token. Read-only GETs.
  const TOKEN_PAGES = ["/CPF3101/", "/CPF3101/Index", "/cart", "/Cart"];
  async function getVerificationToken() {
    const onPage = tokenFromDom() || tokenFromHtml(document.documentElement.innerHTML);
    if (onPage) return { token: onPage, source: "current page" };
    for (const path of TOKEN_PAGES) {
      try {
        const r = await fetchWithTimeout(path, { method: "GET", headers: { "x-requested-with": "XMLHttpRequest" } });
        if (!r.ok) continue;
        const t = tokenFromHtml(await r.text());
        if (t) return { token: t, source: `GET ${path}` };
      } catch { /* try next */ }
    }
    return { token: null, source: null };
  }

  // Returns { phone_check_status, phone_check_message, phone_restricted_until, phone_reason }.
  async function checkRestricted(row, config) {
    if (!/^\d{6}$/.test(String(row.store_id || ""))) return { phone_check_status: "unknown", phone_reason: "store id not 6 digits" };
    if (!config.cgdmId || !config.ordMobile) return { phone_check_status: "unknown", phone_reason: "Cgdm_Id / seller phone not set in popup config" };
    const { token, source } = await getVerificationToken();
    if (!token) return { phone_check_status: "unknown", phone_reason: "verificationtoken not found (open a cart/checkout page in 賣貨便)" };
    try {
      const body = new URLSearchParams({
        rcvName: String(row.customer_name || ""), revPhone: "", revMobile: String(row.phone || ""),
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
      if (r.status === 302 || r.redirected) return { phone_check_status: "unknown", phone_reason: "CheckoutValidation redirected (session expired?)" };
      if (!r.ok) return { phone_check_status: "unknown", phone_reason: `CheckoutValidation returned HTTP ${r.status}` };
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return { phone_check_status: "unknown", phone_reason: "CheckoutValidation returned HTML, expected JSON (session/token?)" };
      const j = await r.json();
      if (j && j.Status === true) return { phone_check_status: "ok", phone_reason: "", _tokenSource: source };
      if (j && j.Status === false) {
        const msg = String(j.Message || "");
        const m = msg.match(/(\d{4})年(\d{2})月(\d{2})日/);
        return {
          phone_check_status: "restricted",
          phone_check_message: msg || null,
          phone_restricted_until: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
          phone_reason: "", _tokenSource: source,
        };
      }
      return { phone_check_status: "unknown", phone_reason: "CheckoutValidation JSON had no Status boolean" };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return { phone_check_status: "unknown", phone_reason: aborted ? "CheckoutValidation timeout (10s)" : "CheckoutValidation network error" };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "PC_CHECK_PHONE" || !message.row) return false;
    (async () => {
      const res = await checkRestricted(message.row, message.config || {});
      sendResponse({
        ok: true,
        phone_check_status: res.phone_check_status,
        phone_check_message: res.phone_check_message ?? null,
        phone_restricted_until: res.phone_restricted_until ?? null,
        phone_reason: res.phone_reason || "",
      });
    })().catch(() => sendResponse({ ok: true, phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, phone_reason: "phone check threw" }));
    return true;
  });
})();
