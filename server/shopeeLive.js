// SHOPEE LIVE — Phase 2. OAuth + token refresh + manual Connect + comment poller.
// ALL logic lives here (server.js keeps a tiny wiring block, gated on
// shopeeConfig().enabled). Every side effect is dependency-INJECTED so vitest can
// drive the whole flow with fakes (server.js has no test harness).
//
// ⚠️ NEW PRIVILEGE: the token read/write path uses a SERVICE-ROLE Supabase client
// (SUPABASE_SERVICE_ROLE_KEY) — it bypasses RLS because the OAuth callback + the
// background refresh/poller have NO user JWT. It is created server-side only,
// passed in here as `store`, and NEVER exposed to the client. shopee_shops RLS
// still blocks sellers from writing tokens; only this service path writes them.
//
// ⚠️ SACRED ZONE: comments reach the client through the SAME emitCommentScoped
// (injected as `emitComment`) — which already sanitizes + scopes per platform, so
// Shopee needs ZERO change there. The only server.js edit is the select_account
// handler accepting a "Shopee" key. Dedup / commentKey / buyer# / order hub are
// untouched: a Shopee payload is just a new producer with platform:"Shopee".
//
// ⚠️ UNVERIFIED (until a Partner ID + live TW shop): every endpoint path + request
// shape + response field below is the documented Open Platform v2 convention but
// is NOT runtime-confirmed. All of it is isolated in the thin API wrappers here
// (exchangeToken / refreshToken / fetchShopInfo / fetchLatestComments) so a
// correction is local. Session auto-detect has no confirmed endpoint → /shopee/
// connect accepts a client-supplied session_id (documented below).
import { createHmac } from "node:crypto";
import { buildSignedUrl, nowUnixSeconds } from "./shopeeSign.js";
import { shopeeToPayload } from "./shopeeComment.js";
import { encryptToken, decryptToken, isExpiringSoon } from "./shopeeTokens.js";
import { maxAccountsForPlan } from "./accountCap.js";

export const SHOPEE_HOST = "https://partner.shopeemobile.com";
export const APP_REDIRECT_URL = "https://www.sellerflowlive.com"; // where the callback bounces the browser back to
export const POLL_ACTIVE_MS = 2000;   // cadence while comments are flowing
export const POLL_QUIET_MS = 5000;    // cadence when a poll returned nothing new
export const MAX_AUTH_FAILURES = 3;   // consecutive auth failures → mark inactive + stop
export const STATE_TTL_MS = 10 * 60 * 1000; // OAuth state nonce validity
export const REFRESH_SCAN_MS = 5 * 60 * 1000; // token-refresh timer cadence
export const IDLE_STOP_MS = 10 * 60 * 1000; // F2: stop after this long with no NEW comments (orphan cap)
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // F2: hard ceiling regardless of the (unverified) end signal
export const TOKEN_REREAD_MARGIN_MS = 10 * 60 * 1000; // F4: re-read the cached token this long before it expires
export const EMITTED_CAP = 500;       // per-poller bounded set of emitted comment ids

// ── OAuth state nonce (bind the shop to the RIGHT seller) ────────────────────
// state = base64url(userId).exp.HMAC(key, "userId.exp"). verifyState returns the
// userId only when the signature matches AND it has not expired — so a shop can
// never be bound to a different seller by tampering with the redirect.
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
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowMs) return null; // expired
  try { return Buffer.from(uidB64, "base64url").toString("utf8") || null; } catch { return null; }
}

// ── Pure comment diffing + cadence ───────────────────────────────────────────
const commentIdOf = (c) => String((c && (c.comment_id ?? c.id ?? c.msg_id)) ?? "").trim();

// Return the items whose comment_id we have NOT already emitted (in list order),
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

// Bound the emitted-id set so a long session can't grow it without limit.
function rememberEmitted(emitted, ids, cap = EMITTED_CAP) {
  for (const id of ids) emitted.add(id);
  if (emitted.size > cap) {
    const drop = emitted.size - cap;
    let i = 0;
    for (const v of emitted) { if (i++ >= drop) break; emitted.delete(v); }
  }
}

// ── Thin API wrappers (UNVERIFIED shapes — isolated here) ────────────────────
async function shopeeGet({ config, fetchImpl, path, accessToken, shopId, extra }) {
  const url = buildSignedUrl({ host: SHOPEE_HOST, path, partnerId: config.partnerId, partnerKey: config.partnerKey, timestamp: nowUnixSeconds(), accessToken, shopId, extra });
  const r = await fetchImpl(url, { method: "GET" });
  const status = r.status;
  const j = await r.json().catch(() => ({}));
  return { status, body: j || {} };
}
async function shopeePost({ config, fetchImpl, path, accessToken, shopId, payload }) {
  const url = buildSignedUrl({ host: SHOPEE_HOST, path, partnerId: config.partnerId, partnerKey: config.partnerKey, timestamp: nowUnixSeconds(), accessToken, shopId });
  const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
  const status = r.status;
  const j = await r.json().catch(() => ({}));
  return { status, body: j || {} };
}

// code + shop_id → { access_token, refresh_token, expire_in(seconds) }. UNVERIFIED path.
export async function exchangeToken({ config, fetchImpl, code, shopId }) {
  return shopePostToken({ config, fetchImpl, path: "/api/v2/auth/token/get", payload: { code, shop_id: Number(shopId), partner_id: Number(config.partnerId) } });
}
export async function refreshToken({ config, fetchImpl, refreshTok, shopId }) {
  return shopePostToken({ config, fetchImpl, path: "/api/v2/auth/access_token/get", payload: { refresh_token: refreshTok, shop_id: Number(shopId), partner_id: Number(config.partnerId) } });
}
async function shopePostToken({ config, fetchImpl, path, payload }) {
  const { status, body } = await shopeePost({ config, fetchImpl, path, payload });
  const access = body.access_token || "";
  const refresh = body.refresh_token || "";
  const expireIn = Number(body.expire_in || body.expires_in || 0); // seconds; ~4h
  const ok = status === 200 && !!access && !!refresh;
  return { ok, status, access, refresh, expireInSec: Number.isFinite(expireIn) && expireIn > 0 ? expireIn : 14400 };
}
// shop info → shop_name. UNVERIFIED path/shape; never throws (name is cosmetic).
export async function fetchShopInfo({ config, fetchImpl, accessToken, shopId }) {
  try {
    const { body } = await shopeeGet({ config, fetchImpl, path: "/api/v2/shop/get_shop_info", accessToken, shopId });
    return String(body.shop_name || body.response?.shop_name || "");
  } catch { return ""; }
}
// latest comments for a live session. UNVERIFIED path/shape. Returns
// { status, list, sessionEnded }. sessionEnded is a best-effort heuristic.
// F7 (ACCEPTED, LOW): the poller always reads offset:0 with page_size 50, so a
// burst of >50 comments within one poll interval drops the OLDEST beyond 50 (they
// are never emitted). This is a completeness gap, NOT a duplicate — the emitted
// set still dedups everything shown. Advancing offset/paging within a tick is a
// later enhancement; comment volume this high in a 2 s window is rare.
// shopSessionId = the SHOPEE live-session id (Shopee's own `session_id` API param) — never
// the browser session.
export async function fetchLatestComments({ config, fetchImpl, accessToken, shopId, shopSessionId, offset = 0, pageSize = 50 }) {
  const { status, body } = await shopeeGet({ config, fetchImpl, path: "/api/v2/livestream/get_latest_comment_list", accessToken, shopId, extra: { session_id: shopSessionId, offset, page_size: pageSize } });
  const resp = body.response || body;
  const list = Array.isArray(resp.list) ? resp.list : Array.isArray(resp.comment_list) ? resp.comment_list : [];
  // Heuristic end-of-session signal (unverified): an explicit ended flag, or a
  // Shopee error naming the session as closed/not-found.
  const err = String(body.error || "").toLowerCase();
  const sessionEnded = resp.session_status === "end" || resp.status === "end" || err.includes("session_not_exist") || err.includes("session_end") || err.includes("not_exist");
  const authFail = status === 401 || status === 403 || err.includes("invalid_access_token") || err.includes("error_auth") || err.includes("token");
  return { status, list, sessionEnded, authFail, error: err };
}

// ── Runtime factory (routes + timers + poller registry) ──────────────────────
// deps: { config, store, emitComment, statusEmit, liveKey, renderUrl, appUrl?,
//   fetchImpl?, now?, log?, setTimer?, clearTimer?, setLoop?, clearLoop? }
//   store: async getPlan(userId), countShops(userId), getShop(userId,shopId),
//     upsertShop(row), listActiveShops(), updateTokens(userId,shopId,{access,refresh,expiresAtIso}),
//     setActive(userId,shopId,active)
//   emitComment(sellerId, shopUsername, payload) → the real emitCommentScoped(..., "Shopee", ...)
//   statusEmit(sellerId, { connected, shopId, sessionId, shopSessionId })
//     sessionId = the CONNECTING BROWSER session (server.js stamps it on platform_status;
//     the client drops a status whose sessionId ≠ its own); shopSessionId = Shopee live session.
//   liveKey(sellerId, "Shopee", shopId) → registry key (mirror of the TikTok key)
export function createShopeeRuntime(deps) {
  const {
    config, store, emitComment, statusEmit, liveKey,
    renderUrl, appUrl = APP_REDIRECT_URL,
    fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {},
    setLoop = (fn, ms) => setTimeout(fn, ms), clearLoop = (h) => clearTimeout(h),
    setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (h) => clearInterval(h),
  } = deps;

  const pollers = new Map();   // liveKey → entry
  let refreshHandle = null;

  const redirectUri = `${String(renderUrl).replace(/\/+$/, "")}/shopee/oauth/callback`;

  // ---- OAuth ----
  function buildAuthUrl(userId) {
    const state = signState({ userId, key: config.partnerKey, nowMs: now() });
    // Shopee auth_partner is a PUBLIC signed call; the seller opens this URL and
    // authorizes → Shopee redirects to redirect+? with code & shop_id (+ our state).
    const redirect = `${redirectUri}?state=${encodeURIComponent(state)}`;
    return buildSignedUrl({ host: SHOPEE_HOST, path: "/api/v2/shop/auth_partner", partnerId: config.partnerId, partnerKey: config.partnerKey, timestamp: nowUnixSeconds(), extra: { redirect } });
  }

  async function handleCallback({ code, shopId, state }) {
    const userId = verifyState(state, config.partnerKey, now());
    if (!userId) return { redirect: `${appUrl}/?shopee=error&code=bad_state` };
    if (!code || !shopId) return { redirect: `${appUrl}/?shopee=error&code=missing_params` };
    try {
      const tok = await exchangeToken({ config, fetchImpl, code, shopId });
      if (!tok.ok) return { redirect: `${appUrl}/?shopee=error&code=token_exchange` };
      // Per-plan cap (Option A: shopee_shops rows vs maxAccountsForPlan) — allow if
      // this shop already exists for the user (re-auth), else enforce the count.
      const existing = await store.getShop(userId, shopId);
      if (!existing) {
        const plan = await store.getPlan(userId);
        const count = await store.countShops(userId);
        // F6 (ACCEPTED, LOW): read-then-upsert is a TOCTOU — two concurrent OAuth
        // completions for two NEW shops by the same seller could both pass the cap
        // and land count+1. Impact is a soft business cap only (one extra shop),
        // requires two simultaneous authorizations, and there is no DB uniqueness
        // to lean on across shops. Not worth a lock here; noted deliberately.
        if (plan && count >= maxAccountsForPlan(plan)) {
          return { redirect: `${appUrl}/?shopee=error&code=cap` };
        }
      }
      const shopName = await fetchShopInfo({ config, fetchImpl, accessToken: tok.access, shopId });
      const expiresAtIso = new Date(now() + tok.expireInSec * 1000).toISOString();
      await store.upsertShop({
        user_id: userId, shop_id: Number(shopId), shop_name: shopName || null,
        access_token: encryptToken(tok.access, config.tokenKey),
        refresh_token: encryptToken(tok.refresh, config.tokenKey),
        token_expires_at: expiresAtIso, active: true,
      });
      return { redirect: `${appUrl}/?shopee=connected` };
    } catch (e) {
      log(`[SHOPEE] callback error: ${e && e.message}`);
      return { redirect: `${appUrl}/?shopee=error&code=exception` };
    }
  }

  // ---- Token refresh timer ----
  async function refreshDueShops() {
    let shops = [];
    try { shops = await store.listActiveShops(); } catch { return; }
    for (const s of shops) {
      if (!isExpiringSoon(s.token_expires_at, now())) continue;
      try {
        const refreshTok = decryptToken(s.refresh_token, config.tokenKey);
        if (!refreshTok) { await store.setActive(s.user_id, s.shop_id, false); continue; }
        const tok = await refreshToken({ config, fetchImpl, refreshTok, shopId: s.shop_id });
        if (!tok.ok) { await store.setActive(s.user_id, s.shop_id, false); log(`[SHOPEE] refresh failed shop=${s.shop_id} → inactive`); continue; }
        await store.updateTokens(s.user_id, s.shop_id, {
          access: encryptToken(tok.access, config.tokenKey),
          refresh: encryptToken(tok.refresh, config.tokenKey),
          expiresAtIso: new Date(now() + tok.expireInSec * 1000).toISOString(),
        });
      } catch (e) {
        log(`[SHOPEE] refresh error shop=${s.shop_id}: ${e && e.message}`);
        // never crash the loop; leave active so the next scan retries
      }
    }
  }
  function startRefreshTimer() {
    if (refreshHandle) return;
    refreshHandle = setTimer(() => { void refreshDueShops(); }, REFRESH_SCAN_MS);
    if (refreshHandle && typeof refreshHandle.unref === "function") refreshHandle.unref();
  }

  // ---- Poller ----
  // One poll pass. Returns { hadNew, stop } — stop true means the loop must end.
  async function pollOnce(entry) {
    const nowMs = now();
    // F2 — orphan/idle caps (independent of the UNVERIFIED end signal). Idle = no
    // NEW comments for IDLE_STOP_MS; max session = a hard ceiling. Both stop → the
    // loop calls stopPoller (which emits platform_status connected:false = "ended").
    if (nowMs - entry.startedAtMs >= MAX_SESSION_MS) return { hadNew: false, stop: true, reason: "max_session" };
    if (nowMs - entry.lastActivityMs >= IDLE_STOP_MS) return { hadNew: false, stop: true, reason: "idle" };

    // F4 — cache the decrypted access token on the entry; re-read from the store
    // ONLY when it is unset, near expiry (the refresh timer rotates it before then),
    // or after an auth failure (entry.reauth) — NOT every tick (egress discipline).
    if (!entry.accessToken || entry.reauth || nowMs >= entry.tokenExpiresAtMs - TOKEN_REREAD_MARGIN_MS) {
      let shop;
      try { shop = await store.getShop(entry.userId, entry.shopId); }
      catch { return { hadNew: false, stop: false }; } // transient store error → keep looping
      if (!shop || !shop.active) return { hadNew: false, stop: true, reason: "inactive" };
      const tok = decryptToken(shop.access_token, config.tokenKey);
      if (!tok) return { hadNew: false, stop: true, reason: "no_token" };
      entry.accessToken = tok;
      const expMs = new Date(shop.token_expires_at || 0).getTime();
      entry.tokenExpiresAtMs = Number.isFinite(expMs) && expMs > 0 ? expMs : nowMs + 4 * 60 * 60 * 1000;
      entry.reauth = false;
    }

    let res;
    try {
      res = await fetchLatestComments({ config, fetchImpl, accessToken: entry.accessToken, shopId: entry.shopId, shopSessionId: entry.shopSessionId });
    } catch { return { hadNew: false, stop: false }; } // transient network → keep looping

    if (res.sessionEnded) return { hadNew: false, stop: true, reason: "session_end" };
    if (res.authFail) {
      entry.authFails = (entry.authFails || 0) + 1;
      entry.reauth = true; // F4 — force a fresh token read + one retry on the next poll
      if (entry.authFails >= MAX_AUTH_FAILURES) {
        try { await store.setActive(entry.userId, entry.shopId, false); } catch { /* best effort */ }
        return { hadNew: false, stop: true, reason: "auth" };
      }
      return { hadNew: false, stop: false };
    }
    if (res.status === 429 || res.status >= 500) return { hadNew: false, stop: false, backoff: true };
    entry.authFails = 0;

    // F1 — RE-EMIT SAFETY. The FIRST successful poll after (re)Connect carries the
    // comments that ALREADY existed at connect time; emit them with initial:true so
    // the client routes them to its DISPLAY-ONLY lane (useLiveFeed:399 — before the
    // Auto-Mode seam + pushComment) and can NEVER create a duplicate order on a
    // reconnect. Every comment seen AFTER the first poll is genuinely new → live
    // (no flag). An empty first poll (fresh live, no history) consumes the flag →
    // the first real comment then arrives live and IS orderable.
    const asInitial = !entry.firstPollDone;
    const fresh = pickNewComments(res.list, entry.emitted);
    for (const raw of fresh) {
      // sessionId = the connecting BROWSER session (client drop rule / per-device scoping);
      // shopSessionId = the Shopee live session (→ payload.shopeeSessionId + roomId).
      // shopId = the authorized shop (explicit field → the client's platform_meta.shop_id).
      const payload = shopeeToPayload(raw, { sellerId: entry.sellerId, sessionId: entry.sessionId, shopSessionId: entry.shopSessionId, shopId: entry.shopId, shopUsername: entry.shopUsername, nowMs });
      if (asInitial) payload.initial = true; // display-only lane; dedup by msgId (initialKey)
      // → the real emitCommentScoped (sanitizes + per-account scoping). platform "Shopee".
      emitComment(entry.sellerId, entry.shopUsername, payload);
    }
    rememberEmitted(entry.emitted, fresh.map(commentIdOf));
    entry.firstPollDone = true;                 // after the first successful poll, all further comments are live
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

  // shopSessionId = the SHOPEE live session (polled via Shopee's session_id param).
  // sessionId = the browser session of the device that tapped Connect (POST body), stamped
  // on every comment + platform_status — mirrors TikTok's relay + the FB poller.
  // "" (old client / missing) → the client's `c.sessionId && …` filter passes it through.
  function startPoller({ sellerId, userId, shopId, shopUsername, shopSessionId, sessionId = "" }) {
    const key = liveKey(sellerId, "Shopee", String(shopId));
    stopPoller(key, "restart"); // single poller per shop
    const nowMs = now();
    const entry = {
      key, sellerId, userId, shopId: Number(shopId), shopUsername,
      shopSessionId: String(shopSessionId ?? ""), sessionId: String(sessionId || ""),
      emitted: new Set(), authFails: 0, timer: null, stopped: false,
      firstPollDone: false,                 // F1 — first poll emits existing comments as initial:true
      startedAtMs: nowMs, lastActivityMs: nowMs, // F2 — idle + max-session caps
      accessToken: null, tokenExpiresAtMs: 0, reauth: false, // F4 — cached token (no getShop per tick)
    };
    pollers.set(key, entry);
    statusEmit(sellerId, { connected: true, shopId: Number(shopId), sessionId: entry.sessionId, shopSessionId: entry.shopSessionId });
    scheduleNext(entry, 0);
    return entry;
  }

  function stopPoller(key, reason = "stopped") {
    const entry = pollers.get(key);
    if (!entry) return false;
    entry.stopped = true;
    if (entry.timer != null) { clearLoop(entry.timer); entry.timer = null; }
    pollers.delete(key);
    try { statusEmit(entry.sellerId, { connected: false, shopId: entry.shopId, sessionId: entry.sessionId, shopSessionId: entry.shopSessionId }); } catch { /* best effort */ }
    log(`[SHOPEE] poller stop shop=${entry.shopId} reason=${reason}`);
    return true;
  }

  function stopAll() {
    for (const key of [...pollers.keys()]) stopPoller(key, "shutdown");
    if (refreshHandle) { clearTimer(refreshHandle); refreshHandle = null; }
  }

  // ---- Routes ----
  // `extra` carries the SAME middlewares TikTok uses on /connect/tiktok so /shopee/
  // connect enforces the paywall + rate limit identically (F3). They default to
  // pass-throughs so a caller/test can wire just requireAuth.
  const passThrough = (_req, _res, next) => next();
  function registerRoutes(app, requireAuth, extra = {}) {
    const requireConnectRate = extra.requireConnectRate || passThrough;
    const requirePlanActive = extra.requirePlanActive || passThrough;
    app.get("/shopee/oauth/start", requireAuth, (req, res) => {
      try { return res.json({ url: buildAuthUrl(req.authUserId) }); }
      catch { return res.status(500).json({ ok: false, error: "shopee_start_failed" }); }
    });

    app.get("/shopee/oauth/callback", async (req, res) => {
      const out = await handleCallback({ code: String(req.query.code || ""), shopId: String(req.query.shop_id || ""), state: String(req.query.state || "") });
      return res.redirect(out.redirect);
    });

    // F3 — requireAuth → requireConnectRate → requirePlanActive, MIRRORING
    // /connect/tiktok: an expired/inactive plan is 403'd here (no poller starts),
    // and the connect rate limit applies, exactly like TikTok.
    app.post("/shopee/connect", requireAuth, requireConnectRate, requirePlanActive, async (req, res) => {
      const userId = req.authUserId;
      const sellerId = req.sellerId;
      const shopId = String(req.body.shop_id || "");
      // ⚠️ SESSION DETECTION: no confirmed "current live session for shop" endpoint,
      // so the client supplies session_id (from the seller's Shopee live). If a
      // detect endpoint is confirmed later, resolve it here and ignore the body.
      // TWO ids in the body — do not conflate:
      //   session_id = the SHOPEE live session (what we poll)        → shopSessionId
      //   sessionId  = the connecting BROWSER session (like TikTok/FB) → stamped on every
      //                comment + status so only the tapping device receives the live flow.
      const shopSessionId = String(req.body.session_id || "");
      if (!shopId) return res.status(400).json({ ok: false, error: "shop_id required" });
      let shop;
      try { shop = await store.getShop(userId, shopId); } catch { shop = null; }
      if (!shop || !shop.active) return res.status(404).json({ ok: false, error: "shop_not_found" });
      if (!shopSessionId) return res.json({ ok: false, reason: "not_live" });
      startPoller({ sellerId, userId, shopId, shopUsername: String(shopId), shopSessionId, sessionId: String(req.body.sessionId || "") });
      return res.json({ ok: true, session_id: shopSessionId });
    });

    app.post("/shopee/disconnect", requireAuth, (req, res) => {
      const shopId = String(req.body.shop_id || "");
      const key = liveKey(req.sellerId, "Shopee", shopId);
      const stopped = stopPoller(key, "disconnect");
      return res.json({ ok: true, stopped });
    });
  }

  return { registerRoutes, startRefreshTimer, stopAll, stopPoller, startPoller, pollOnce, refreshDueShops, handleCallback, buildAuthUrl, _pollers: pollers };
}
