// SellerFlow parcel-checker — 賣貨便 (myship.7-11.com.tw) content script.
// Runs in Jeff's logged-in 賣貨便 tab. Handles ONLY the RESTRICTED-PHONE check
// (validation-only — NEVER submits an order). The FULL-STORE check moved to
// emap-711.js (it lives on emap.pcsc.com.tw, a different origin — the old
// cross-origin call was why every store check returned 'unknown').
//
// ⚠️ FAIL-SAFE: any doubt (missing token, HTML/redirect, bad shape, timeout) →
// 'unknown' + a human reason, NEVER a guessed 'ok'.
(function sellerFlowMyshipPhoneCheck() {
  // Self-heal (v1.7.0): double-injection guard — the background re-injects this
  // file via chrome.scripting when a ping fails on an alive tab; a second copy
  // must not register a second onMessage listener (double sendResponse).
  if (window.__sflPcMyshipInjected) return;
  window.__sflPcMyshipInjected = true;
  const TIMEOUT_MS = 10000;
  // Real 賣貨便 restriction messages (seen in production, Sep 2026):
  //   "此手機號碼因多次未取紀錄，已被限制使用取貨付款功能，預計YYYY年MM月DD日 才能再次使用取貨付款功能"
  //   "您因多次未取紀錄遭檢舉，暫無法於平台成立訂單，如需了解更多資訊，請瀏覽幫助中心"
  const RESTRICTION_RE = /多次未取|限制使用取貨付款|無法於平台成立訂單/;

  // creds: "include" (legacy single-config lane — runs in the seller's own
  // logged-in cart) or "omit" (MULTI-SELLER lane — the check must be ANONYMOUS
  // so 7-11 keys the sender restriction on the body ordMobile, NOT whatever
  // account the owner's tab happens to be logged into; probe-proven 2026-09-27).
  function fetchWithTimeout(url, opts, creds) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(url, { credentials: creds || "include", ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // ── AJAX VerificationToken discovery ─────────────────────────────────────────
  // ⚠️ Confirmed on the live 確認訂單 page (CPF3102, /cart/easy/GM…): the token the
  // CheckoutValidation AJAX sends is a JS variable in an inline <script>:
  //     var tokenID = 'A…:B…';   →   headers: { "VerificationToken": tokenID }
  // It is NOT the cookie __RequestVerificationToken and NOT a hidden input/meta
  // (those are the form antiforgery token — a different value). So we ONLY read
  // `var tokenID = '…'`. Strategy: this page first, then a read-only GET of the
  // 賣場 cart page (creates no order). Returns { token, source } — null if none.
  function tokenFromHtml(html) {
    if (!html) return null;
    const m = String(html).match(/var\s+tokenID\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  }
  async function getVerificationToken(cgdmId, anon) {
    // ANON (multi lane): NEVER reuse the on-page token — it was minted under the
    // logged-in session/another GM and, paired with an omit POST, would fail
    // antiforgery. Always GET the ROW's own GM page anonymously to mint a fresh
    // token matched to the anonymous POST that follows (probe-proven).
    if (anon) {
      if (!cgdmId) return { token: null, source: null, tokenMs: 0 };
      const t0 = Date.now();
      try {
        const r = await fetchWithTimeout(`/cart/easy/${encodeURIComponent(cgdmId)}`, { method: "GET" }, "omit");
        const tokenMs = Date.now() - t0;
        if (!r.ok) return { token: null, source: null, tokenMs };
        const t = tokenFromHtml(await r.text());
        return { token: t, source: t ? `anon GET /cart/easy/${cgdmId}` : null, tokenMs };
      } catch { return { token: null, source: null, tokenMs: Date.now() - t0 }; }
    }
    const onPage = tokenFromHtml(document.documentElement.innerHTML);
    if (onPage) return { token: onPage, source: "current page", tokenMs: 0 };
    // The token lives on the 確認訂單 cart page (/cart/easy/<Cgdm_Id>). GET it read-only.
    const pages = [];
    if (cgdmId) pages.push(`/cart/easy/${encodeURIComponent(cgdmId)}`);
    pages.push("/cart/detail");
    const t0 = Date.now();
    for (const path of pages) {
      try {
        const r = await fetchWithTimeout(path, { method: "GET" });
        if (!r.ok) continue;
        const t = tokenFromHtml(await r.text());
        if (t) return { token: t, source: `GET ${path}`, tokenMs: Date.now() - t0 };
      } catch { /* try next */ }
    }
    return { token: null, source: null, tokenMs: Date.now() - t0 };
  }

  // Returns { phone_check_status, phone_check_message, phone_restricted_until, phone_reason, tokenMs, postMs }.
  // anon=true (multi lane) → token GET + POST both credential-less; the body
  // ordMobile is then the authoritative sender (login irrelevant).
  async function checkRestricted(row, config, anon) {
    if (!/^\d{6}$/.test(String(row.store_id || ""))) return { phone_check_status: "unknown", phone_reason: "store id not 6 digits" };
    // Cgdm_Id: popup config first; bonus fallback = the hidden input on the cart page.
    const cgdmId = config.cgdmId || (document.getElementById("Cgdm_Id") && document.getElementById("Cgdm_Id").value) || "";
    if (!cgdmId || !config.ordMobile) return { phone_check_status: "unknown", phone_reason: "Cgdm_Id / seller phone not set in popup config" };
    const { token, source, tokenMs } = await getVerificationToken(cgdmId, anon);
    if (!token) return { phone_check_status: "unknown", phone_reason: "tokenID not found — open the 賣場 cart page (/cart/easy/GM...)", tokenMs };
    const creds = anon ? "omit" : "include";
    const t0 = Date.now();
    try {
      const body = new URLSearchParams({
        rcvName: String(row.customer_name || ""), revPhone: "", revMobile: String(row.phone || ""),
        ordPhone: "", ordMobile: String(config.ordMobile), Cgdm_Id: String(cgdmId),
        Carm_Cgptshiptype: "1", Carm_Cgptpaymenttype: "1", RcvStoreID: String(row.store_id),
      }).toString();
      const r = await fetchWithTimeout("/CPF3101/CheckoutValidation/", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          VerificationToken: token,
        },
        body,
      }, creds);
      const postMs = Date.now() - t0;
      if (r.status === 302 || r.redirected) return { phone_check_status: "unknown", phone_reason: "CheckoutValidation redirected (session expired?)", tokenMs, postMs };
      if (!r.ok) return { phone_check_status: "unknown", phone_reason: `CheckoutValidation returned HTTP ${r.status}`, tokenMs, postMs };
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return { phone_check_status: "unknown", phone_reason: "CheckoutValidation returned HTML, expected JSON (session/token?)", tokenMs, postMs };
      const j = await r.json();
      if (j && j.Status === true) return { phone_check_status: "ok", phone_reason: "", _tokenSource: source, tokenMs, postMs };
      if (j && j.Status === false) {
        const msg = String(j.Message || "");
        // 1.14.7: only 7-11's no-pickup restriction wording counts as 'restricted';
        // any other validation failure (store, name, GM, cart…) is 'unknown' so it is
        // never shown red and never cached for other sellers.
        if (!RESTRICTION_RE.test(msg)) {
          return { phone_check_status: "unknown", phone_reason: `CheckoutValidation rejected: ${msg.slice(0, 40)}`, tokenMs, postMs };
        }
        const m = msg.match(/(\d{4})年(\d{2})月(\d{2})日/);
        return {
          phone_check_status: "restricted",
          phone_check_message: msg || null,
          phone_restricted_until: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
          phone_reason: "", _tokenSource: source, tokenMs, postMs,
        };
      }
      return { phone_check_status: "unknown", phone_reason: "CheckoutValidation JSON had no Status boolean", tokenMs, postMs };
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      return { phone_check_status: "unknown", phone_reason: aborted ? "CheckoutValidation timeout (10s)" : "CheckoutValidation network error", tokenMs, postMs: Date.now() - t0 };
    }
  }

  // ── 1.14.3 — UNATTENDED E-MAP RE-MINT ─────────────────────────────────────
  // When the worker's E-Map session is dead it asks THIS tab (parked on
  // /cart/detail, 填寫付款資料) to click the real 選擇取貨門市 button. The page's
  // own jsEmap() then POSTs with its live antiforgery token → a fresh E-Map
  // session. We store NOTHING and touch NO field. HARD GUARDS: only on
  // /cart/detail; only a button whose inline onclick is jsEmap(…) AND whose text
  // is 選擇取貨門市 / Select Pickup Location; NEVER an explicit type=submit /
  // input[type=submit]; NEVER anything whose text/id/name smells like
  // 送出結帳 / submit / checkout / 付款 / 購買. Test-pinned.
  const PICK_TEXT_RE = /選擇取貨門市|SelectPickupLocation/i;
  const FORBIDDEN_RE = /送出|結帳|submit|checkout|付款|購買|order|下一步|next/i;
  function pcSafeToClick(el, text) {
    const explicitType = String(el.getAttribute("type") || "").toLowerCase();
    if (explicitType === "submit") return false;
    if (el.tagName === "INPUT" && explicitType !== "button") return false;
    if (FORBIDDEN_RE.test(`${text} ${el.id || ""} ${el.getAttribute("name") || ""}`)) return false;
    return true;
  }
  function pcFindPickStoreButton(doc, pathname) {
    if (!/^\/cart\/detail/i.test(String(pathname || ""))) return { btn: null, reason: `not on /cart/detail (on ${pathname})` };
    const cands = doc.querySelectorAll("button, input[type=button], a");
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i];
      const text = String(el.innerText || el.value || el.textContent || "").replace(/\s+/g, "");
      const onclick = String(el.getAttribute("onclick") || "").trim();
      if (!/^jsEmap\(/.test(onclick) || !PICK_TEXT_RE.test(text)) continue;
      if (!pcSafeToClick(el, text)) return { btn: null, reason: "選擇取貨門市 candidate rejected by the submit guard" };
      return { btn: el, reason: "" };
    }
    return { btn: null, reason: "選擇取貨門市 button not found on this page" };
  }
  function pcClickPickStore() {
    const r = pcFindPickStoreButton(document, location.pathname);
    if (!r.btn) return { ok: true, clicked: false, reason: r.reason };
    try { r.btn.click(); } catch (e) { return { ok: true, clicked: false, reason: `click threw: ${e && e.message ? e.message : e}` }; }
    return { ok: true, clicked: true, reason: "", text: String(r.btn.innerText || r.btn.value || "").trim().slice(0, 30) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PC_PING") { sendResponse({ ok: true, script: "myship" }); return true; }
    if (message?.type === "PC_CLICK_PICK_STORE") { sendResponse(pcClickPickStore()); return true; }
    if (message?.type !== "PC_CHECK_PHONE" || !message.row) return false;
    (async () => {
      const res = await checkRestricted(message.row, message.config || {}, message.anon === true);
      sendResponse({
        ok: true,
        phone_check_status: res.phone_check_status,
        phone_check_message: res.phone_check_message ?? null,
        phone_restricted_until: res.phone_restricted_until ?? null,
        phone_reason: res.phone_reason || "",
        tokenMs: res.tokenMs ?? null, postMs: res.postMs ?? null,
      });
    })().catch(() => sendResponse({ ok: true, phone_check_status: "unknown", phone_check_message: null, phone_restricted_until: null, phone_reason: "phone check threw" }));
    return true;
  });
})();
