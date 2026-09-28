// SellerFlow parcel-checker AUTH relay — content script on the SellerFlowLive tab.
// The background service worker asks THIS tab for the current Supabase access
// token so it can call the REST API as Jeff (own-scoped RLS). We ONLY read the
// token the SFL web app already stored + keeps fresh — the extension NEVER
// persists or refreshes its own session (two refreshers of one identity would
// sign Jeff out; that bug is fixed and must not return). No token / logged out →
// return null so the background stops polling and the popup says "log in".
(function sellerFlowTokenBridge() {
  // Self-heal (v1.7.0): double-injection guard — the background re-injects this
  // file via chrome.scripting when a ping fails on an alive tab; a second copy
  // must not register a second onMessage listener (double sendResponse).
  if (window.__sflPcBridgeInjected) return;
  window.__sflPcBridgeInjected = true;
  function currentAccessToken() {
    try {
      const raw = localStorage.getItem("sf_supabase_auth"); // supabase.ts storageKey
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // supabase-js v2 stores { access_token, refresh_token, expires_at, ... } —
      // sometimes wrapped under { currentSession } depending on version.
      const token = parsed?.access_token || parsed?.currentSession?.access_token || null;
      return typeof token === "string" && token ? token : null;
    } catch {
      return null;
    }
  }

  // 1.14.5 — force an in-place session refresh via the MAIN-world helper
  // (sellerflow-refresh-main.js → app's own supabase client), then re-read the
  // token localStorage now holds. NO reload, NO second client. Returns
  // { token, hadSession } — hadSession=false means the user is actually logged
  // out (the app's client reports no session); null = the app build hasn't
  // exposed the hook yet (worker then falls back to a GET re-navigation).
  function refreshViaMain() {
    return new Promise((resolve) => {
      let done = false;
      const onDone = (e) => {
        if (done) return; done = true;
        document.removeEventListener("__sfl_pc_refresh_done", onDone);
        const hadSession = e && e.detail ? e.detail.hadSession : null;
        resolve({ token: currentAccessToken(), hadSession });
      };
      document.addEventListener("__sfl_pc_refresh_done", onDone);
      try { document.dispatchEvent(new CustomEvent("__sfl_pc_refresh_req")); } catch { /* helper absent → timeout */ }
      setTimeout(() => { if (!done) { done = true; document.removeEventListener("__sfl_pc_refresh_done", onDone); resolve({ token: currentAccessToken(), hadSession: null }); } }, 3000);
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PC_PING") { sendResponse({ ok: true, script: "bridge" }); return true; }
    if (message?.type === "SFL_GET_TOKEN") {
      sendResponse({ token: currentAccessToken() });
      return true;
    }
    if (message?.type === "SFL_REFRESH_TOKEN") {
      refreshViaMain().then((r) => sendResponse(r)).catch(() => sendResponse({ token: currentAccessToken(), hadSession: null }));
      return true; // async response
    }
    return false;
  });
})();
