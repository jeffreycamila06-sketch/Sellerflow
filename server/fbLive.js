// FACEBOOK LIVE — Phase 2 (F-P2). OAuth + live-detect + comment poller + token
// re-validation. ALL logic lives here (server.js keeps a tiny wiring block, gated on
// fbConfig().enabled). Every side effect is dependency-INJECTED so vitest can drive
// the whole flow with fakes (server.js has no test harness). Mirrors
// server/shopeeLive.js in runtime shape (createFbRuntime, fail-closed, leak-discipline).
//
// ⚠️ NEW PRIVILEGE: the token read/write path uses a SERVICE-ROLE Supabase client
// (SUPABASE_SERVICE_ROLE_KEY) — it bypasses RLS because the OAuth callback + the
// background timer/poller have NO user JWT. It is created server-side only, passed in
// here as `store`, and NEVER exposed to the client. fb_pages RLS still blocks sellers
// from writing tokens; only this service path writes them.
//
// ⚠️ SACRED ZONE: comments reach the client through the SAME emitCommentScoped
// (injected as `emitComment`) — which already sanitizes + scopes per platform, so
// Facebook needs ZERO change there. select_account already accepts a "Facebook" key
// (server.js). Dedup / commentKey / buyer# / order hub are untouched: an FB payload is
// just a new producer with platform:"Facebook".
//
// ⚠️ UNVERIFIED (no FB App ID / Business Verification / live page yet): every Graph
// endpoint path + request shape + response field below is the documented Graph API
// convention but is NOT runtime-confirmed. All of it is isolated in the thin API
// wrappers here (exchangeCodeForToken / exchangeForLongLivedUserToken / fetchPages /
// fetchLiveVideos / fetchComments / revalidatePageToken) so a correction is local.
//
// ⚠️ TOKEN-REFRESH DEVIATION (load-bearing — differs from shopeeLive): a long-lived FB
// PAGE token (obtained from a long-lived USER token) is effectively non-expiring; a
// true "re-exchange" needs the USER token, which fb_pages does NOT store (F-P1 schema,
// no refresh_token column). So the refresh timer here RE-VALIDATES the page token near
// the (conservative ~60d) reminder mark and, on success, extends the reminder; on an
// auth failure (token revoked / de-authorized) it marks the row inactive so the seller
// re-runs OAuth. It never mints a token it cannot mint. A future schema column
// (user_token) would enable silent re-exchange — out of F-P2 scope.
import { createHmac } from "node:crypto";
import { GRAPH_VERSION } from "./fbConfig.js";
import { fbToPayload } from "./fbComment.js";
import { encryptToken, decryptToken, isExpiringSoon } from "./fbTokens.js";
import { maxAccountsForPlan } from "./accountCap.js";

export const GRAPH_HOST = "https://graph.facebook.com";
export const FB_DIALOG_HOST = "https://www.facebook.com";
export const APP_REDIRECT_URL = "https://www.sellerflowlive.com"; // where the callback bounces the browser back to
export const OAUTH_SCOPE = "pages_show_list,pages_read_engagement";
export const POLL_ACTIVE_MS = 2000;   // cadence while comments are flowing
export const POLL_QUIET_MS = 5000;    // cadence when a poll returned nothing new
export const MAX_AUTH_FAILURES = 3;   // consecutive auth failures → mark inactive + stop
export const MAX_FETCH_ERRORS = 3;    // consecutive hard comments-fetch errors → confirm-via-live-status then stop (fetch_error, NOT a session_end guess)
export const STATE_TTL_MS = 10 * 60 * 1000; // OAuth state nonce validity
export const REFRESH_SCAN_MS = 60 * 60 * 1000; // token re-validation timer cadence (page tokens live ~60d)
export const IDLE_STOP_MS = 10 * 60 * 1000; // F2: stop after this long with no NEW comments (orphan cap)
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // F2: hard ceiling
export const TOKEN_REREAD_MARGIN_MS = 10 * 60 * 1000; // F4: re-read the cached token this long before it expires
export const EMITTED_CAP = 500;       // per-poller bounded set of emitted comment ids
export const LONG_LIVED_USER_TTL_SEC = 60 * 24 * 60 * 60; // ~60d default when expires_in absent
export const FB_AUTH_ERROR_CODE = 190; // Graph OAuthException (invalid/expired/revoked token)
// Graph "(#200) Missing Permissions" on the live-comments edge = a FEATURE GATE (the app's
// Live Video API feature is not approved yet), NOT a bad token — the same token still
// reads /me/accounts + /{page}/live_videos. Arrives as HTTP 403, so it MUST be classified
// before the generic 401/403 → auth rule, else it deactivates a perfectly valid page.
export const FB_FEATURE_GATE_CODE = 200;

// ── OAuth state nonce (bind the page authorization to the RIGHT seller) ──────
// Identical construction to shopeeLive.signState — state = base64url(userId).exp.HMAC.
// verifyState returns the userId only when the signature matches AND it has not
// expired, so a page can never be bound to a different seller by tampering.
export function signState({ userId, key, nowMs = Date.now(), ttlMs = STATE_TTL_MS }) {
  const exp = nowMs + ttlMs;
  const body = `${Buffer.from(String(userId)).toString("base64url")}.${exp}`;
  const mac = createHmac("sha256", String(key)).update(body).digest("hex");
  return `${body}.${mac}`;
}
export function verifyState(state, key, nowMs = Date.now()) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return null;
  const [uidB64, expStr, mac] = parts;
  const body = `${uidB64}.${expStr}`;
  const expect = createHmac("sha256", String(key)).update(body).digest("hex");
  if (mac.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowMs) return null; // expired
  try { return Buffer.from(uidB64, "base64url").toString("utf8") || null; } catch { return null; }
}

// ── Pure comment diffing + cadence ───────────────────────────────────────────
const commentIdOf = (c) => String((c && (c.id ?? c.comment_id ?? c.msg_id)) ?? "").trim();

// Return the items whose comment id we have NOT already emitted (in list order),
// skipping id-less items. Caller owns the `emitted` Set and adds the returned ids.
export function pickNewComments(list, emitted) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const id = commentIdOf(c);
    if (!id) continue;            // no stable id → cannot dedup safely → skip
    if (emitted.has(id)) continue;
    out.push(c);
  }
  return out;
}
export const nextPollDelay = (hadNew) => (hadNew ? POLL_ACTIVE_MS : POLL_QUIET_MS);

function rememberEmitted(emitted, ids, cap = EMITTED_CAP) {
  for (const id of ids) emitted.add(id);
  if (emitted.size > cap) {
    const drop = emitted.size - cap;
    let i = 0;
    for (const v of emitted) { if (i++ >= drop) break; emitted.delete(v); }
  }
}

// ── Thin Graph API wrappers (UNVERIFIED shapes — isolated here) ──────────────
async function graphGet({ fetchImpl, url }) {
  const r = await fetchImpl(url, { method: "GET" });
  const status = r.status;
  const j = await r.json().catch(() => ({}));
  return { status, body: j || {} };
}
const graphUrl = (path, params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") q.set(k, String(v));
  return `${GRAPH_HOST}/${GRAPH_VERSION}${path}?${q.toString()}`;
};
// FB Graph error → { authFail, rateLimited, code, subcode, message } classification
// (code 190 = OAuth; 4/17/32/613 or HTTP 429 = throttle). NOTE: code 100 ("invalid
// parameter") is DELIBERATELY NOT treated as an end-of-live signal — an invalid request
// param returns 100, and misreading that as "session ended" is exactly the bug this fix
// closes. True "ended" is confirmed against live_videos status, never guessed from 100.
function classifyGraphError(status, body) {
  const err = (body && body.error) || {};
  const code = Number(err.code);
  // Feature gate FIRST (code 200 arrives as HTTP 403): never an auth failure.
  const featureGate = code === FB_FEATURE_GATE_CODE;
  const authFail = !featureGate && (status === 401 || status === 403 || code === FB_AUTH_ERROR_CODE);
  const rateLimited = status === 429 || code === 4 || code === 17 || code === 32 || code === 613;
  return { authFail, featureGate, rateLimited, code, subcode: Number(err.error_subcode) || null, message: String(err.message || "") };
}

// code → short-lived user token. UNVERIFIED path.
export async function exchangeCodeForToken({ config, fetchImpl, code, redirectUri }) {
  const { status, body } = await graphGet({ fetchImpl, url: graphUrl("/oauth/access_token", {
    client_id: config.appId, redirect_uri: redirectUri, client_secret: config.appSecret, code,
  }) });
  const access = String(body.access_token || "");
  return { ok: status === 200 && !!access, status, access };
}
// short-lived user token → LONG-LIVED user token (+ expires_in seconds, ~60d). UNVERIFIED.
export async function exchangeForLongLivedUserToken({ config, fetchImpl, shortToken }) {
  const { status, body } = await graphGet({ fetchImpl, url: graphUrl("/oauth/access_token", {
    grant_type: "fb_exchange_token", client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: shortToken,
  }) });
  const access = String(body.access_token || "");
  const expireIn = Number(body.expires_in || 0);
  return { ok: status === 200 && !!access, status, access, expireInSec: Number.isFinite(expireIn) && expireIn > 0 ? expireIn : LONG_LIVED_USER_TTL_SEC };
}
// long-lived user token → the seller's pages (each with its own long-lived page token).
// Returns [] on any failure (never throws — the callback treats [] as "no pages").
export async function fetchPages({ config, fetchImpl, userToken }) {
  void config;
  try {
    const { body } = await graphGet({ fetchImpl, url: graphUrl("/me/accounts", { fields: "id,name,username,access_token", access_token: userToken }) });
    const list = Array.isArray(body.data) ? body.data : [];
    return list.map((p) => ({ id: String(p.id || ""), name: String(p.name || ""), username: p.username ? String(p.username) : "", access_token: String(p.access_token || "") })).filter((p) => p.id && p.access_token);
  } catch { return []; }
}
// Is this page currently live? Returns { liveVideoId } (the first status=LIVE video, most
// recent first) or { liveVideoId: "" }. status is uppercase-compared so only an ACTIVE
// broadcast matches — an ended one (VOD / LIVE_STOPPED / PROCESSING) is excluded, so we
// never attach to a stale broadcast. broadcast_start_time desc prefers the newest LIVE.
// UNVERIFIED shape; never throws.
export async function fetchLiveVideos({ config, fetchImpl, pageId, pageToken }) {
  void config;
  try {
    const { body } = await graphGet({ fetchImpl, url: graphUrl(`/${pageId}/live_videos`, { fields: "status,id,broadcast_start_time", access_token: pageToken }) });
    const list = (Array.isArray(body.data) ? body.data : []).filter((v) => String(v.status || "").toUpperCase() === "LIVE");
    list.sort((a, b) => Date.parse(b.broadcast_start_time || 0) - Date.parse(a.broadcast_start_time || 0)); // newest LIVE first
    return { liveVideoId: list[0] ? String(list[0].id || "") : "" };
  } catch { return { liveVideoId: "" }; }
}
// Authoritative "is this SPECIFIC live video still LIVE?" — GET /{lv}?fields=status.
// Returns the uppercased status string ("LIVE" | "LIVE_STOPPED" | "VOD" | …) or "" when
// unreadable (transient → the caller does NOT conclude ended on ""). This is the ONLY
// source we trust to declare session_end — never a comments-fetch error code.
export async function fetchLiveStatus({ config, fetchImpl, liveVideoId, pageToken }) {
  void config;
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${liveVideoId}`, { fields: "status", access_token: pageToken }) });
    if (status !== 200) return "";
    return String(body.status || "").toUpperCase();
  } catch { return ""; }
}
// comments for a live video. Correct params per Meta v25.0 Live Video Comments reference:
//   filter=stream          (ALL comments incl. the live stream, not just toplevel)
//   live_filter=no_filter  (do NOT drop "low quality" comments — we want every buyer)
//   order=reverse_chronological  (documented best practice for real-time polling)
// ⚠️ The previous `live_filter=stream` was INVALID ("stream" is a `filter` value, not a
// `live_filter` value) → Graph returned code 100, which the old classifier misread as
// session_end (poller died seconds after connect). Returns the raw error detail; the
// caller (pollOnce) decides retry-vs-ended — this NEVER self-declares ended.
export async function fetchComments({ config, fetchImpl, liveVideoId, pageToken }) {
  void config;
  const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${liveVideoId}/comments`, {
    fields: "id,message,from,created_time", filter: "stream", live_filter: "no_filter", order: "reverse_chronological", access_token: pageToken,
  }) });
  const hasData = Array.isArray(body.data);
  const list = hasData ? body.data : [];
  const cls = classifyGraphError(status, body);
  // A 200 WITHOUT a `data` array (non-JSON body → graphGet's {} fallback, or an unexpected
  // shape) is NOT "zero comments" — it used to be silently reported as comments=0. Treat it
  // as a hard error so it is logged (bodyKeys) and retried, never mistaken for an empty feed.
  const shapeAnomaly = status === 200 && !(cls.code > 0) && !hasData;
  const hardError = status !== 200 || cls.code > 0 || shapeAnomaly; // non-2xx, Graph error body, or bad shape
  return {
    status, list, authFail: cls.authFail, featureGate: cls.featureGate, rateLimited: cls.rateLimited, hardError, shapeAnomaly,
    errorCode: cls.code || null, errorSubcode: cls.subcode, error: cls.message,
    bodyKeys: Object.keys(body || {}).join(",") || "(empty)", // key NAMES only — never values (token-free)
  };
}
// Lightweight re-validation of a page token (the refresh-timer path, see the deviation
// note above). Returns { ok, authFail }. A valid token → ok. A 190 → authFail (revoked).
export async function revalidatePageToken({ config, fetchImpl, pageId, pageToken }) {
  void config;
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${pageId}`, { fields: "id", access_token: pageToken }) });
    const cls = classifyGraphError(status, body);
    return { ok: status === 200 && !cls.authFail, authFail: cls.authFail };
  } catch { return { ok: false, authFail: false }; } // transient → leave for the next scan
}

// ── Runtime factory (routes + timers + poller registry) ──────────────────────
// deps: { config, store, emitComment, statusEmit, liveKey, renderUrl, appUrl?,
//   fetchImpl?, now?, log?, setTimer?, clearTimer?, setLoop?, clearLoop? }
//   store: async getPlan(userId), countPages(userId), getPage(userId,pageId),
//     upsertPage(row), listActivePages(), listPages(userId),
//     setActive(userId,pageId,active), updateExpiry(userId,pageId,iso)
//   emitComment(sellerId, scopeKey, payload) → the real emitCommentScoped(..., "Facebook", ...)
//   statusEmit(sellerId, { connected, pageId, liveVideoId, scopeKey })
//   liveKey(sellerId, "Facebook", pageId) → registry key (mirror of the TikTok key)
export function createFbRuntime(deps) {
  const {
    config, store, emitComment, statusEmit, liveKey,
    renderUrl, appUrl = APP_REDIRECT_URL,
    fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {},
    setLoop = (fn, ms) => setTimeout(fn, ms), clearLoop = (h) => clearTimeout(h),
    setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (h) => clearInterval(h),
  } = deps;

  const pollers = new Map();   // liveKey → entry
  let refreshHandle = null;

  const redirectUri = `${String(renderUrl).replace(/\/+$/, "")}/fb/oauth/callback`;

  // ---- OAuth ----
  function buildAuthUrl(userId) {
    const state = signState({ userId, key: config.appSecret, nowMs: now() });
    const q = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: redirectUri,
      state,
      scope: OAUTH_SCOPE,
      response_type: "code",
    });
    return `${FB_DIALOG_HOST}/${GRAPH_VERSION}/dialog/oauth?${q.toString()}`;
  }

  async function handleCallback({ code, state }) {
    const userId = verifyState(state, config.appSecret, now());
    if (!userId) return { redirect: `${appUrl}/?fb=error&code=bad_state` };
    if (!code) return { redirect: `${appUrl}/?fb=error&code=missing_params` };
    try {
      const shortTok = await exchangeCodeForToken({ config, fetchImpl, code, redirectUri });
      if (!shortTok.ok) return { redirect: `${appUrl}/?fb=error&code=token_exchange` };
      const longTok = await exchangeForLongLivedUserToken({ config, fetchImpl, shortToken: shortTok.access });
      if (!longTok.ok) return { redirect: `${appUrl}/?fb=error&code=token_exchange` };
      const pages = await fetchPages({ config, fetchImpl, userToken: longTok.access });
      if (pages.length === 0) return { redirect: `${appUrl}/?fb=error&code=no_pages` };

      // Per-plan cap (Option A: fb_pages rows vs maxAccountsForPlan) — re-auth of an
      // EXISTING page is always allowed; each NEW page counts against the cap.
      const plan = await store.getPlan(userId);
      let count = await store.countPages(userId);
      const max = plan ? maxAccountsForPlan(plan) : Infinity;
      // ~60d reminder from the long-lived user-token window (see the deviation note).
      const expiresAtIso = new Date(now() + longTok.expireInSec * 1000).toISOString();
      let upserted = 0, capped = 0;
      for (const p of pages) {
        let existing = null;
        try { existing = await store.getPage(userId, p.id); } catch { existing = null; }
        // F6-class TOCTOU (ACCEPTED, LOW — same as shopeeLive): two concurrent
        // callbacks could both pass the cap for two NEW pages. Soft business cap only.
        if (!existing && count >= max) { capped++; continue; }
        await store.upsertPage({
          user_id: userId, page_id: p.id, page_name: p.name || null, page_username: p.username || null,
          access_token: encryptToken(p.access_token, config.tokenKey),
          token_expires_at: expiresAtIso, active: true,
        });
        upserted++;
        if (!existing) count++;
      }
      if (upserted === 0) return { redirect: `${appUrl}/?fb=error&code=cap` };
      log(`[FB] callback ok user=${userId} pages=${upserted} capped=${capped}`);
      return { redirect: `${appUrl}/?fb=connected` };
    } catch (e) {
      log(`[FB] callback error: ${e && e.message}`);
      return { redirect: `${appUrl}/?fb=error&code=exception` };
    }
  }

  // ---- Token re-validation timer (see the deviation note) ----
  async function refreshDuePages() {
    let pages = [];
    try { pages = await store.listActivePages(); } catch { return; }
    for (const p of pages) {
      if (!isExpiringSoon(p.token_expires_at, now())) continue;
      try {
        const token = decryptToken(p.access_token, config.tokenKey);
        if (!token) { await store.setActive(p.user_id, p.page_id, false); continue; }
        const v = await revalidatePageToken({ config, fetchImpl, pageId: p.page_id, pageToken: token });
        if (v.ok) {
          // Valid page token → extend the reminder window (page tokens don't expire).
          await store.updateExpiry(p.user_id, p.page_id, new Date(now() + LONG_LIVED_USER_TTL_SEC * 1000).toISOString());
        } else if (v.authFail) {
          await store.setActive(p.user_id, p.page_id, false);
          log(`[FB] token revoked page=${p.page_id} → inactive (re-auth needed)`);
        }
        // transient (neither ok nor authFail) → leave active, retry next scan
      } catch (e) {
        log(`[FB] revalidate error page=${p.page_id}: ${e && e.message}`);
      }
    }
  }
  function startRefreshTimer() {
    if (refreshHandle) return;
    refreshHandle = setTimer(() => { void refreshDuePages(); }, REFRESH_SCAN_MS);
    if (refreshHandle && typeof refreshHandle.unref === "function") refreshHandle.unref();
  }

  // ---- Poller ----
  async function pollOnce(entry) {
    const nowMs = now();
    // F2 — orphan/idle caps.
    if (nowMs - entry.startedAtMs >= MAX_SESSION_MS) return { hadNew: false, stop: true, reason: "max_session" };
    // A session that was only ever feature-gated ends with the honest reason, not "idle".
    if (nowMs - entry.lastActivityMs >= IDLE_STOP_MS) return { hadNew: false, stop: true, reason: entry.featureGated ? "feature_gate" : "idle" };

    // F4 — cache the decrypted page token; re-read only when unset, near expiry, or
    // after an auth failure (entry.reauth) — NOT every tick (egress discipline).
    if (!entry.accessToken || entry.reauth || nowMs >= entry.tokenExpiresAtMs - TOKEN_REREAD_MARGIN_MS) {
      let page;
      try { page = await store.getPage(entry.userId, entry.pageId); }
      catch { return { hadNew: false, stop: false }; } // transient store error → keep looping
      if (!page || !page.active) return { hadNew: false, stop: true, reason: "inactive" };
      const tok = decryptToken(page.access_token, config.tokenKey);
      if (!tok) return { hadNew: false, stop: true, reason: "no_token" };
      entry.accessToken = tok;
      const expMs = new Date(page.token_expires_at || 0).getTime();
      entry.tokenExpiresAtMs = Number.isFinite(expMs) && expMs > 0 ? expMs : nowMs + LONG_LIVED_USER_TTL_SEC * 1000;
      entry.reauth = false;
    }

    let res;
    try {
      res = await fetchComments({ config, fetchImpl, liveVideoId: entry.liveVideoId, pageToken: entry.accessToken });
    } catch { return { hadNew: false, stop: false }; } // transient network → keep looping

    // Order: feature-gate (#200) → auth-fail (190 / non-#200 401-403) → transient backoff
    // (429/5xx) → other HARD error. NOTHING here concludes "ended" from a comments error —
    // that is confirmed ONLY against live_videos status below.
    //
    // FEATURE GATE (#200 Missing Permissions = Live Video API feature not approved yet):
    // NOT an auth failure. Page stays ACTIVE (no setActive(false)), authFails/fetchErrors
    // untouched, session kept alive at the quiet cadence so comments start flowing on their
    // own the moment the feature is approved. Logged ONCE per poller (no 5s log spam); an
    // all-gated session ends at the idle cap with reason=feature_gate.
    if (res.featureGate) {
      if (!entry.featureGated) {
        entry.featureGated = true;
        log(`[FB] comments blocked: Live Video API not approved (code 200) page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} subcode=${res.errorSubcode ?? "-"} msg=${res.error || "-"} — page kept active, session kept alive`);
      }
      return { hadNew: false, stop: false, backoff: true };
    }
    if (res.authFail) {
      entry.authFails = (entry.authFails || 0) + 1;
      entry.reauth = true; // F4 — force a fresh token read + one retry on the next poll
      log(`[FB] comments auth-fail page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} code=${res.errorCode ?? "-"} subcode=${res.errorSubcode ?? "-"} msg=${res.error || "-"} (${entry.authFails}/${MAX_AUTH_FAILURES})`);
      if (entry.authFails >= MAX_AUTH_FAILURES) {
        try { await store.setActive(entry.userId, entry.pageId, false); } catch { /* best effort */ }
        return { hadNew: false, stop: true, reason: "auth" };
      }
      return { hadNew: false, stop: false };
    }
    if (res.rateLimited || res.status >= 500) return { hadNew: false, stop: false, backoff: true };
    // HARD ERROR (e.g. code 100 invalid-param, a transient 400): NEVER conclude ended
    // from the comments error alone (that was the bug). Log the full Graph error
    // (token-free), retry with backoff; after MAX_FETCH_ERRORS consecutive, CONFIRM
    // against live_videos status — not LIVE → session_end (authoritative); still
    // LIVE / unreadable → fetch_error (distinct, so a real invalid-param can't masquerade
    // as an ended live).
    if (res.hardError) {
      entry.fetchErrors = (entry.fetchErrors || 0) + 1;
      log(`[FB] comments error page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} code=${res.errorCode ?? "-"} subcode=${res.errorSubcode ?? "-"} msg=${res.error || "-"}${res.shapeAnomaly ? ` shape=no-data-array keys=${res.bodyKeys}` : ""} (${entry.fetchErrors}/${MAX_FETCH_ERRORS})`);
      if (entry.fetchErrors >= MAX_FETCH_ERRORS) {
        const liveStatus = await fetchLiveStatus({ config, fetchImpl, liveVideoId: entry.liveVideoId, pageToken: entry.accessToken });
        if (liveStatus && liveStatus !== "LIVE") return { hadNew: false, stop: true, reason: "session_end" };
        return { hadNew: false, stop: true, reason: "fetch_error" };
      }
      return { hadNew: false, stop: false, backoff: true };
    }
    entry.authFails = 0;
    entry.fetchErrors = 0; // a clean fetch resets the hard-error streak
    if (entry.featureGated) {
      entry.featureGated = false;
      log(`[FB] comments unblocked: Live Video API now returning data page=${entry.pageId} lv=${entry.liveVideoId}`);
    }

    // F1 — RE-EMIT SAFETY. The FIRST successful poll after (re)Connect carries the
    // comments that ALREADY existed; emit them with initial:true so the client routes
    // them to its DISPLAY-ONLY lane (useLiveFeed — before the Auto-Mode seam +
    // pushComment) and can NEVER create a duplicate order on a reconnect. Every comment
    // AFTER the first poll is genuinely new → live (no flag). An empty first poll
    // consumes the flag → the first real comment then arrives live and IS orderable.
    const asInitial = !entry.firstPollDone;
    // reverse_chronological returns NEWEST first; reverse the unseen slice so they emit
    // OLDEST→newest (chronological append order for the feed).
    const fresh = pickNewComments(res.list, entry.emitted).reverse();
    if (asInitial) log(`[FB] first poll page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} comments=${fresh.length} initial=true`);
    for (const raw of fresh) {
      const payload = fbToPayload(raw, {
        sellerId: entry.sellerId, sessionId: entry.liveVideoId,
        pageId: entry.pageId, liveVideoId: entry.liveVideoId, pageUsername: entry.scopeKey, nowMs,
      });
      if (asInitial) payload.initial = true; // display-only lane; dedup by msgId (initialKey)
      // → the real emitCommentScoped (sanitizes + per-account scoping). platform "Facebook".
      emitComment(entry.sellerId, entry.scopeKey, payload);
    }
    rememberEmitted(entry.emitted, fresh.map(commentIdOf));
    entry.firstPollDone = true;
    if (fresh.length > 0) entry.lastActivityMs = nowMs; // F2 — reset the idle clock on real activity
    return { hadNew: fresh.length > 0, stop: false, initialBatch: asInitial };
  }

  function scheduleNext(entry, delayMs) {
    if (entry.stopped) return;
    entry.timer = setLoop(async () => {
      if (entry.stopped) return;
      let r = { hadNew: false, stop: false };
      try { r = await pollOnce(entry); } catch { r = { hadNew: false, stop: false }; }
      if (entry.stopped) return;
      if (r.stop) { stopPoller(entry.key, r.reason || "stopped"); return; }
      const delay = r.backoff ? POLL_QUIET_MS : nextPollDelay(r.hadNew);
      scheduleNext(entry, delay);
    }, delayMs);
  }

  function startPoller({ sellerId, userId, pageId, pageUsername, liveVideoId }) {
    const scopeKey = String(pageUsername || pageId); // the select_account scoping key
    const key = liveKey(sellerId, "Facebook", pageId);
    stopPoller(key, "restart"); // single poller per page
    const nowMs = now();
    const entry = {
      key, sellerId, userId, pageId: String(pageId), scopeKey, liveVideoId: String(liveVideoId),
      emitted: new Set(), authFails: 0, fetchErrors: 0, featureGated: false, timer: null, stopped: false,
      firstPollDone: false,                 // F1
      startedAtMs: nowMs, lastActivityMs: nowMs, // F2
      accessToken: null, tokenExpiresAtMs: 0, reauth: false, // F4
    };
    pollers.set(key, entry);
    log(`[FB] poller start page=${String(pageId)} lv=${String(liveVideoId)} status=LIVE`);
    statusEmit(sellerId, { connected: true, pageId: String(pageId), liveVideoId: String(liveVideoId), scopeKey });
    scheduleNext(entry, 0);
    return entry;
  }

  function stopPoller(key, reason = "stopped") {
    const entry = pollers.get(key);
    if (!entry) return false;
    entry.stopped = true;
    if (entry.timer != null) { clearLoop(entry.timer); entry.timer = null; }
    pollers.delete(key);
    try { statusEmit(entry.sellerId, { connected: false, pageId: entry.pageId, liveVideoId: entry.liveVideoId, scopeKey: entry.scopeKey }); } catch { /* best effort */ }
    log(`[FB] poller stop page=${entry.pageId} reason=${reason}`);
    return true;
  }

  function stopAll() {
    for (const key of [...pollers.keys()]) stopPoller(key, "shutdown");
    if (refreshHandle) { clearTimer(refreshHandle); refreshHandle = null; }
  }

  // ---- Routes ----
  const passThrough = (_req, _res, next) => next();
  function registerRoutes(app, requireAuth, extra = {}) {
    const requireConnectRate = extra.requireConnectRate || passThrough;
    const requirePlanActive = extra.requirePlanActive || passThrough;

    app.get("/fb/oauth/start", requireAuth, (req, res) => {
      try { return res.json({ url: buildAuthUrl(req.authUserId) }); }
      catch { return res.status(500).json({ ok: false, error: "fb_start_failed" }); }
    });

    app.get("/fb/oauth/callback", async (req, res) => {
      const out = await handleCallback({ code: String(req.query.code || ""), state: String(req.query.state || "") });
      return res.redirect(out.redirect);
    });

    // List own pages — id, name, username, active. NEVER the token column.
    app.get("/fb/pages", requireAuth, async (req, res) => {
      try {
        const pages = await store.listPages(req.authUserId);
        return res.json({ ok: true, pages: (pages || []).map((p) => ({ page_id: String(p.page_id), name: p.page_name || "", username: p.page_username || "", active: !!p.active })) });
      } catch { return res.status(500).json({ ok: false, error: "fb_pages_failed" }); }
    });

    // F3 — requireAuth → requireConnectRate → requirePlanActive, MIRRORING
    // /connect/tiktok + /shopee/connect: an expired/inactive plan is 403'd here (no
    // poller starts), and the connect rate limit applies.
    app.post("/fb/connect", requireAuth, requireConnectRate, requirePlanActive, async (req, res) => {
      const userId = req.authUserId;
      const sellerId = req.sellerId;
      const pageId = String(req.body.page_id || "");
      if (!pageId) return res.status(400).json({ ok: false, error: "page_id required" });
      let page;
      try { page = await store.getPage(userId, pageId); } catch { page = null; }
      if (!page || !page.active) return res.status(404).json({ ok: false, error: "page_not_found" });
      const token = decryptToken(page.access_token, config.tokenKey);
      if (!token) return res.status(409).json({ ok: false, error: "needs_reauth" });
      let live;
      try { live = await fetchLiveVideos({ config, fetchImpl, pageId, pageToken: token }); }
      catch { live = { liveVideoId: "" }; }
      if (!live.liveVideoId) return res.json({ ok: false, reason: "not_live" });
      startPoller({ sellerId, userId, pageId, pageUsername: page.page_username || pageId, liveVideoId: live.liveVideoId });
      return res.json({ ok: true, live_video_id: live.liveVideoId });
    });

    app.post("/fb/disconnect", requireAuth, (req, res) => {
      const pageId = String(req.body.page_id || "");
      const key = liveKey(req.sellerId, "Facebook", pageId);
      const stopped = stopPoller(key, "disconnect");
      return res.json({ ok: true, stopped });
    });
  }

  return { registerRoutes, startRefreshTimer, stopAll, stopPoller, startPoller, pollOnce, refreshDuePages, handleCallback, buildAuthUrl, _pollers: pollers };
}
