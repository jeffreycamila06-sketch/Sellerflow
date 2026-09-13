(function sellerFlowLiveCommentBridge() {
  const LIVE_LIMIT = 5000;
  const port = chrome.runtime.connect({ name: "sellerflow-live-comment-app" });

  function getJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function setJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function sellerIdOf(email) {
    return String(email || "").trim().toLowerCase();
  }

  function liveDayId() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function browserSessionId() {
    const existing = getJson("sf_browser_session", "");
    if (existing) return existing;
    const next = `sf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setJson("sf_browser_session", next);
    return next;
  }

  function sellerLiveDataKey(base, email, sessionId) {
    return email ? `${base}:${sellerIdOf(email)}:${sessionId}` : base;
  }

  function sellerDailyDataKey(base, email, dayId) {
    return email ? `${base}:${sellerIdOf(email)}:${dayId}` : base;
  }

  function commentKey(comment) {
    return [
      comment.platform || "TikTok",
      comment.handle || "viewer",
      comment.timestamp || comment.time || "",
      comment.comment || "",
    ].join("|");
  }

  function normalizeComment(raw) {
    const comment = String(raw.comment || "").trim();
    if (!comment) return null;
    return {
      handle: String(raw.handle || "viewer").trim(),
      name: String(raw.name || raw.handle || "TikTok viewer").trim(),
      comment,
      platform: "TikTok",
      isBuy: false,
      buyerNum: null,
      buyerData: null,
      time: new Date().toLocaleTimeString(),
      timestamp: String(raw.timestamp || new Date().toISOString()),
    };
  }

  function injectComment(raw) {
    const email = getJson("sf_session", "");
    if (!email) return false;
    const sessionId = browserSessionId();
    const keys = [
      sellerLiveDataKey("sf_comments", email, sessionId),
      sellerDailyDataKey("sf_comments", email, liveDayId()),
    ];
    const comment = normalizeComment(raw);
    if (!comment) return false;
    const keyOfComment = commentKey(comment);
    for (const key of keys) {
      const current = Array.isArray(getJson(key, [])) ? getJson(key, []) : [];
      const seen = new Set(current.map(commentKey));
      if (!seen.has(keyOfComment)) {
        setJson(key, [comment, ...current].slice(0, LIVE_LIMIT));
      }
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }
    window.dispatchEvent(new CustomEvent("sellerflow-live-comment", { detail: comment }));
    return true;
  }

  port.onMessage.addListener((message) => {
    if (message?.type === "SFL_COMMENT") {
      injectComment(message.comment);
    }
  });

  // ── Parcel-checker AUTH relay (v1.1) ────────────────────────────────────────
  // The background service worker asks THIS tab for the current Supabase access
  // token so it can call the REST API as Jeff (own-scoped RLS). We ONLY read the
  // token the SFL web app already stored + keeps fresh — the extension NEVER
  // persists or refreshes its own session (two refreshers of one identity would
  // sign Jeff out; that bug is fixed and must not return). No token / logged out
  // → return null so the background stops polling and the popup says "log in".
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
    if (message?.type === "SFL_GET_TOKEN") {
      sendResponse({ token: currentAccessToken() });
      return true;
    }
    return false;
  });
})();
