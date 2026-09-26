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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PC_PING") { sendResponse({ ok: true, script: "bridge" }); return true; }
    if (message?.type === "SFL_GET_TOKEN") {
      sendResponse({ token: currentAccessToken() });
      return true;
    }
    return false;
  });
})();
