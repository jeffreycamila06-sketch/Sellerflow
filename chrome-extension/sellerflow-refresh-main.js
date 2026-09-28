// SellerFlow parcel-checker — SFL session-refresh helper (MAIN world, 1.14.5).
// Runs in the PAGE world on the SellerFlowLive tab (exempt from any page CSP, and
// able to reach the app's own supabase client). supabase-js pauses its
// auto-refresh ticker while the tab is hidden, so a backgrounded worker tab lets
// the access token expire. On request from the isolated bridge, this asks the
// app's SINGLE client to refresh the session in place (window.__sflEnsureFreshSession,
// exposed by src/supabase.ts) — never a second client (that would rotate the
// shared refresh_token and sign the user out). It updates localStorage; the
// isolated bridge then reads the fresh token from there. It never handles the
// token itself.
(function sellerFlowRefreshMain() {
  if (window.__sflPcRefreshMain) return;
  window.__sflPcRefreshMain = true;
  document.addEventListener("__sfl_pc_refresh_req", () => {
    (async () => {
      let hadSession = null; // null = the app hasn't exposed the hook (old build)
      try {
        if (typeof window.__sflEnsureFreshSession === "function") {
          hadSession = await window.__sflEnsureFreshSession();
        }
      } catch { hadSession = null; }
      try { document.dispatchEvent(new CustomEvent("__sfl_pc_refresh_done", { detail: { hadSession } })); } catch { /* no CustomEvent — the bridge times out */ }
    })();
  });
})();
