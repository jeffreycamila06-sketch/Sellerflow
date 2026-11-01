// TIKTOK API — Branch 1 (claude/tiktok-connect): connection + Settings card + webhook skeleton.
// PURE helpers (state nonce, webhook signature, verdicts, row shaping) are exported and unit-tested;
// createTiktokRuntime() is the thin runtime server.js wires (routes, refresh-on-use, daily sweep).
// Log prefixes: [TT-AUTH] [TT-HOOK]. Tokens never reach a log or the client (maskSecretText).
//
// Nothing here touches the live TikTok connect flow (/connect), live_session_orders, Facebook or
// Post Sales. The one shared rule: a connected Business account's @username must be one of the
// seller's REGISTERED TikTok usernames (seller_profiles.tiktok, server/accountCap.js parsing) —
// same seat as the live account, never a second seat.
import { createHmac, timingSafeEqual } from "node:crypto";
import { encryptToken, decryptToken } from "./fbTokens.js";
import { maskSecretText, makeRateGate, ipOf } from "./fbHardening.js";
import { parseRegisteredList, normalizeAccount } from "./accountCap.js";
import {
  TT_BIZ_API, TT_AUTHORIZE_URL, TT_TOKEN_PATH, TT_REFRESH_PATH, TT_REVOKE_PATH, TT_BUSINESS_GET_PATH,
  TT_SCOPES_B1, TT_BUSINESS_GET_FIELDS, TT_STATE_TTL_MS, TT_HTTP_TIMEOUT_MS, TT_REFRESH_MARGIN_MS,
  TT_REFRESH_SWEEP_MS, TT_WEBHOOK_TOLERANCE_S, TT_WEBHOOK_RATE_MAX, TT_START_RATE_MAX,
  TT_ACCESS_TOKEN_TTL_MS, TT_REFRESH_TOKEN_TTL_MS,
} from "./tiktokConfig.js";

export const APP_REDIRECT_URL = "https://www.sellerflowlive.com"; // where the callback bounces the browser back to
export const APP_AUTH_SCHEME = "com.sellerflow.live";              // the phone app's sign-in sheet callback scheme
export const APP_AUTH_CALLBACK = `${APP_AUTH_SCHEME}://tt-auth`;
export const WEBHOOK_PATH = "/tiktok/webhook";
export const OFF_BODY = { ok: false, error: "off" };

// ── OAuth state nonce (same construction as fbLive.signState, own kind "tt") ───────────────────
// state = base64url(userId).exp[.a].ktt.HMAC — "a" = started from the phone app (in-app sheet).
export function signTtState({ userId, key, nowMs = Date.now(), ttlMs = TT_STATE_TTL_MS, app = false }) {
  const body = `${Buffer.from(String(userId)).toString("base64url")}.${nowMs + ttlMs}${app ? ".a" : ""}.ktt`;
  return `${body}.${createHmac("sha256", String(key)).update(body).digest("hex")}`;
}
export function verifyTtState(state, key, nowMs = Date.now()) {
  const parts = String(state || "").split(".");
  if (parts.length < 4 || parts.length > 5) return null;
  const extra = parts.slice(2, -1);
  let app = false, i = 0;
  if (extra[i] === "a") { app = true; i++; }
  if (extra[i] !== "ktt" || i + 1 !== extra.length) return null;
  const mac = parts[parts.length - 1];
  const expect = createHmac("sha256", String(key)).update(parts.slice(0, -1).join(".")).digest("hex");
  if (mac.length !== expect.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < nowMs) return null;
  let userId = null;
  try { userId = Buffer.from(parts[0], "base64url").toString("utf8") || null; } catch { userId = null; }
  return userId ? { userId, app } : null;
}

// ── Webhook signature (developers.tiktok.com/doc/webhooks-verification) ───────────────────────
// Header TikTok-Signature: "t=<unix seconds>,s=<hex>"; s = HMAC-SHA256(client_secret, `${t}.${rawBody}`).
export function parseTtSignature(header) {
  const out = { t: "", s: "" };
  for (const part of String(header || "").split(",")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "t" || k === "s") out[k] = rest.join("=").trim();
  }
  return out.t && /^[0-9a-f]+$/i.test(out.s) ? out : null;
}
// → { ok:true } | { ok:false, reason } — raw bytes, constant-time compare, timestamp tolerance.
export function verifyTtWebhook({ header, rawBody, secret, nowS = Math.floor(Date.now() / 1000), toleranceS = TT_WEBHOOK_TOLERANCE_S }) {
  if (!secret) return { ok: false, reason: "no_secret" };
  const sig = parseTtSignature(header);
  if (!sig) return { ok: false, reason: "bad_header" };
  const t = Number(sig.t);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > toleranceS) return { ok: false, reason: "stale" };
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  const expect = createHmac("sha256", String(secret)).update(Buffer.concat([Buffer.from(`${sig.t}.`, "utf8"), body])).digest("hex");
  const got = sig.s.toLowerCase();
  if (got.length !== expect.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expect))) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
// Dedup key for an event (TikTok may deliver one event more than once).
export const webhookEventKey = (ev) => `${ev?.event || ""}|${ev?.user_openid || ""}|${ev?.create_time || ""}`;

// ── Pure verdicts ──────────────────────────────────────────────────────────────────────────────
// The connected account must be a Business account AND one of the seller's registered TikTok names.
export function connectVerdict({ info, registeredRaw }) {
  if (!info || !info.username) return { ok: false, code: "read_failed" };
  if (info.is_business_account === false) return { ok: false, code: "not_business" };
  const list = parseRegisteredList(registeredRaw);
  if (!list.includes(normalizeAccount(info.username))) return { ok: false, code: "not_registered" };
  return { ok: true };
}
// What the app may see of a row (never the token columns).
export function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id, ttAccountId: row.tt_account_id, username: row.username || "", displayName: row.display_name || "",
    avatarUrl: row.avatar_url || "", followers: Number(row.followers) || 0, status: row.status || "active",
    expiresAt: row.expires_at || null, refreshExpiresAt: row.refresh_expires_at || null,
    lastPollAt: row.last_poll_at || null, lastWebhookAt: row.last_webhook_at || null, updatedAt: row.updated_at || null,
  };
}
export function needsRefresh(row, nowMs = Date.now(), marginMs = TT_REFRESH_MARGIN_MS) {
  const t = new Date(row?.expires_at || 0).getTime();
  return !Number.isFinite(t) || t - nowMs <= marginMs;
}
// The /business/get/ answer → the columns we store (profile_image = avatar url).
export function infoToColumns(info) {
  return {
    username: String(info?.username || ""), display_name: String(info?.display_name || ""),
    avatar_url: String(info?.profile_image || ""), followers: Number(info?.followers_count) || 0,
  };
}
export function tokenColumns(tok, tokenKey, nowMs = Date.now()) {
  return {
    access_token_enc: encryptToken(tok.access_token, tokenKey),
    refresh_token_enc: encryptToken(tok.refresh_token, tokenKey),
    expires_at: new Date(nowMs + (Number(tok.expires_in) > 0 ? Number(tok.expires_in) * 1000 : TT_ACCESS_TOKEN_TTL_MS)).toISOString(),
    refresh_expires_at: new Date(nowMs + (Number(tok.refresh_token_expires_in) > 0 ? Number(tok.refresh_token_expires_in) * 1000 : TT_REFRESH_TOKEN_TTL_MS)).toISOString(),
    scopes: String(tok.scope || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

// ── Runtime ────────────────────────────────────────────────────────────────────────────────────
// deps.store (service role): getAccount(userId) → row|null, listAccounts() → rows (admin: + email),
// upsertAccount(cols), updateAccount(id, patch), deleteAccount(id), getRegistered(userId) → the
// seller_profiles.tiktok text, markWebhook(ttAccountId) ; deps.onDisconnect(userId, accountId) =
// Branch 2's "end that account's selling sales" hook (Branch 1: no-op).
export function createTiktokRuntime(deps) {
  const { config, store, onDisconnect = async () => {}, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {},
    setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (h) => clearInterval(h), appUrl = APP_REDIRECT_URL } = deps;
  const safe = (msg, token = "") => maskSecretText(msg, token, 200) || "-";
  const refreshLocks = new Map(); // account id → Promise (per-account lock on refresh)
  const seenHooks = new Map();    // event key → at (process-local idempotency; nothing is actioned in Branch 1)
  let sweepHandle = null;

  async function call(path, { method = "POST", body = null, token = "", query = null } = {}) {
    const url = `${TT_BIZ_API}${path}${query ? `?${new URLSearchParams(query).toString()}` : ""}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TT_HTTP_TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, { method, signal: ctrl.signal, headers: { "Content-Type": "application/json", ...(token ? { "Access-Token": token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const j = await r.json().catch(() => ({}));
      // TikTok API for Business: code 0 = ok; everything else carries code + message.
      if (!r.ok || Number(j.code) !== 0) return { ok: false, code: Number(j.code) || r.status, message: String(j.message || `http_${r.status}`) };
      return { ok: true, data: j.data || {} };
    } catch (e) {
      return { ok: false, code: 0, message: e && e.name === "AbortError" ? "timeout" : "network" };
    } finally { clearTimeout(timer); }
  }

  function buildAuthUrl(userId, { app = false } = {}) {
    const q = new URLSearchParams({
      client_key: config.bizAppId, scope: TT_SCOPES_B1.join(","), response_type: "code",
      redirect_uri: config.bizRedirectUri, state: signTtState({ userId, key: config.bizAppSecret, nowMs: now(), app }),
    });
    return `${TT_AUTHORIZE_URL}?${q.toString()}`;
  }
  const exchangeCode = (code) => call(TT_TOKEN_PATH, { body: { client_id: config.bizAppId, client_secret: config.bizAppSecret, grant_type: "authorization_code", auth_code: code, redirect_uri: config.bizRedirectUri } });
  const refreshCall = (refreshToken) => call(TT_REFRESH_PATH, { body: { client_id: config.bizAppId, client_secret: config.bizAppSecret, grant_type: "refresh_token", refresh_token: refreshToken } });
  const revokeCall = (accessToken) => call(TT_REVOKE_PATH, { body: { client_id: config.bizAppId, client_secret: config.bizAppSecret, access_token: accessToken } });
  const businessGet = (businessId, token) => call(TT_BUSINESS_GET_PATH, { method: "GET", token, query: { business_id: businessId, fields: JSON.stringify(TT_BUSINESS_GET_FIELDS) } });

  // Refresh-on-use: a fresh access token for this row (refreshes when < margin remains); the
  // rotated refresh token is stored every time. Auth failure → status 'revoked' (UI: Reconnect).
  async function freshToken(row) {
    const have = decryptToken(row.access_token_enc, config.tokenKey);
    if (have && !needsRefresh(row, now())) return { ok: true, token: have, row };
    if (refreshLocks.has(row.id)) return refreshLocks.get(row.id);
    const p = (async () => {
      const rt = decryptToken(row.refresh_token_enc, config.tokenKey);
      if (!rt) { await store.updateAccount(row.id, { status: "revoked" }); return { ok: false, code: "revoked" }; }
      const r = await refreshCall(rt);
      if (!r.ok) {
        log(`[TT-AUTH] refresh failed account=${row.id} code=${r.code} msg=${safe(r.message, rt)}`);
        await store.updateAccount(row.id, { status: "revoked" });
        return { ok: false, code: "revoked" };
      }
      const cols = tokenColumns(r.data, config.tokenKey, now());
      await store.updateAccount(row.id, { ...cols, status: "active", updated_at: new Date(now()).toISOString() });
      return { ok: true, token: r.data.access_token, row: { ...row, ...cols, status: "active" } };
    })().finally(() => refreshLocks.delete(row.id));
    refreshLocks.set(row.id, p);
    return p;
  }

  async function handleCallback({ code, state }) {
    const st = verifyTtState(state, config.bizAppSecret, now());
    if (!st) return { redirect: `${appUrl}/?tt=error&code=bad_state` };
    const back = (q) => (st.app ? `${APP_AUTH_CALLBACK}?${q}` : `${appUrl}/?${q}`);
    if (!code) return { redirect: back("tt=error&code=missing_params") };
    const tok = await exchangeCode(code);
    if (!tok.ok) { log(`[TT-AUTH] exchange failed user=${st.userId} code=${tok.code} msg=${safe(tok.message)}`); return { redirect: back("tt=error&code=token_exchange") }; }
    const openId = String(tok.data.open_id || "");
    const info = await businessGet(openId, tok.data.access_token);
    if (!info.ok) { log(`[TT-AUTH] account read failed user=${st.userId} code=${info.code} msg=${safe(info.message, tok.data.access_token)}`); await revokeCall(tok.data.access_token); return { redirect: back("tt=error&code=read_failed") }; }
    let registeredRaw = "";
    try { registeredRaw = await store.getRegistered(st.userId); } catch { registeredRaw = null; }
    if (registeredRaw === null) { await revokeCall(tok.data.access_token); return { redirect: back("tt=error&code=read_failed") }; }
    const v = connectVerdict({ info: info.data, registeredRaw });
    if (!v.ok) { await revokeCall(tok.data.access_token); log(`[TT-AUTH] refused user=${st.userId} code=${v.code}`); return { redirect: back(`tt=error&code=${v.code}`) }; }
    try {
      await store.upsertAccount({ user_id: st.userId, tt_account_id: openId, ...infoToColumns(info.data), ...tokenColumns(tok.data, config.tokenKey, now()), status: "active", updated_at: new Date(now()).toISOString() });
    } catch (e) { log(`[TT-AUTH] save failed user=${st.userId}: ${safe(e && e.message)}`); await revokeCall(tok.data.access_token); return { redirect: back("tt=error&code=save_failed") }; }
    log(`[TT-AUTH] connected user=${st.userId} account=${normalizeAccount(info.data.username)}`);
    return { redirect: back("tt=connected") };
  }

  // Revoke at TikTok (best effort), delete the row, end that account's sales (Branch 2 hook).
  async function disconnect(userId, row) {
    const tok = decryptToken(row.access_token_enc, config.tokenKey);
    if (tok) { const r = await revokeCall(tok); if (!r.ok) log(`[TT-AUTH] revoke failed account=${row.id} code=${r.code}`); }
    await store.deleteAccount(row.id);
    try { await onDisconnect(userId, row.id); } catch (e) { log(`[TT-AUTH] onDisconnect failed: ${safe(e && e.message)}`); }
    log(`[TT-AUTH] disconnected user=${userId} account=${row.id}`);
  }
  // Account deletion: revoke every token BEFORE the auth.users cascade removes the rows.
  async function revokeAllForUser(userId) {
    const rows = await store.listAccountsOf(userId);
    for (const row of rows) { try { await disconnect(userId, row); } catch (e) { log(`[TT-AUTH] revoke-all failed account=${row.id}: ${safe(e && e.message)}`); } }
    return rows.length;
  }

  // Daily sweep: refresh what is about to expire (refresh-on-use covers active use).
  async function sweep() {
    let rows = [];
    try { rows = await store.listAccounts({ status: "active" }); } catch (e) { log(`[TT-AUTH] sweep read failed: ${safe(e && e.message)}`); return; }
    for (const row of rows) if (needsRefresh(row, now())) { try { await freshToken(row); } catch (e) { log(`[TT-AUTH] sweep refresh failed account=${row.id}: ${safe(e && e.message)}`); } }
  }

  // Webhook skeleton (developer app): verify on the RAW bytes, reject stale, answer 200 fast, drop
  // duplicates. Branch 1 only logs + stamps last_webhook_at; authorization.removed on the DEV app
  // cannot be mapped to a Business-app row yet (open_id differs per app — plan, Branch 5).
  function handleWebhook(rawBody) {
    let ev = null;
    try { ev = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "")); } catch { ev = null; }
    if (!ev || typeof ev !== "object") return { ok: false, reason: "bad_json" };
    const key = webhookEventKey(ev);
    if (seenHooks.has(key)) return { ok: true, duplicate: true };
    seenHooks.set(key, now());
    while (seenHooks.size > 2000) seenHooks.delete(seenHooks.keys().next().value);
    log(`[TT-HOOK] event=${String(ev.event || "").slice(0, 60)} openid=${String(ev.user_openid || "").slice(0, 6)}… at=${ev.create_time || "-"}`);
    if (ev.user_openid) store.markWebhook(String(ev.user_openid)).catch(() => {});
    return { ok: true, event: String(ev.event || "") };
  }

  function registerRoutes(app, { requireAuth, requireAdmin, requirePlanActive, requireTtAvailable, rawParser }) {
    const startGate = makeRateGate({ max: TT_START_RATE_MAX, windowMs: 60 * 1000, keyOf: (req) => String(req.authUserId || ""), onLimit: (_req, res) => res.status(429).json({ ok: false, error: "rate_limited" }), now });
    const hookGate = makeRateGate({ max: TT_WEBHOOK_RATE_MAX, windowMs: 60 * 1000, keyOf: ipOf, onLimit: (_req, res) => res.status(429).end(), now });

    app.get("/tiktok/status", requireAuth, async (req, res) => {
      try {
        const row = await store.getAccount(req.authUserId);
        if (row && row.status === "active" && needsRefresh(row, now())) { const r = await freshToken(row); return res.json({ ok: true, account: publicAccount(r.ok ? r.row : { ...row, status: "revoked" }) }); }
        return res.json({ ok: true, account: publicAccount(row) });
      } catch (e) { log(`[TT-AUTH] status failed: ${safe(e && e.message)}`); return res.status(502).json({ ok: false, error: "tt_read_failed" }); }
    });
    app.get("/tiktok/oauth/start", requireAuth, requireTtAvailable, requirePlanActive, startGate, (req, res) => {
      const isApp = String((req.query && req.query.client) || "") === "app";
      try { return res.json({ ok: true, url: buildAuthUrl(req.authUserId, { app: isApp }) }); } catch { return res.status(500).json({ ok: false, error: "tt_start_failed" }); }
    });
    app.get("/tiktok/oauth/callback", async (req, res) => {
      const out = await handleCallback({ code: String(req.query.code || ""), state: String(req.query.state || "") });
      return res.redirect(303, out.redirect);
    });
    app.post("/tiktok/disconnect", requireAuth, async (req, res) => {
      try {
        const row = await store.getAccount(req.authUserId);
        if (row) await disconnect(req.authUserId, row);
        return res.json({ ok: true });
      } catch (e) { log(`[TT-AUTH] disconnect failed: ${safe(e && e.message)}`); return res.status(502).json({ ok: false, error: "tt_disconnect_failed" }); }
    });
    app.post("/tiktok/revoke-all", requireAuth, async (req, res) => {       // before self-deletion (best effort)
      try { return res.json({ ok: true, revoked: await revokeAllForUser(req.authUserId) }); } catch { return res.status(502).json({ ok: false, error: "tt_revoke_failed" }); }
    });
    app.post("/tiktok/admin/revoke-user", requireAuth, requireAdmin, async (req, res) => { // before an admin deletes a seller
      let userId = String((req.body && req.body.userId) || "");
      const email = String((req.body && req.body.email) || "").trim().toLowerCase();
      try {
        if (!userId && email && typeof store.userIdOf === "function") userId = String((await store.userIdOf(email)) || "");
        if (!userId) return res.status(400).json({ ok: false, error: "missing_params" });
        return res.json({ ok: true, revoked: await revokeAllForUser(userId) }); } catch { return res.status(502).json({ ok: false, error: "tt_revoke_failed" }); }
    });
    app.get("/tiktok/admin/accounts", requireAuth, requireAdmin, async (_req, res) => {  // the admin health line
      try { return res.json({ ok: true, accounts: (await store.listAccounts({})).map((r) => ({ ...publicAccount(r), email: r.email || "" })) }); }
      catch { return res.status(502).json({ ok: false, error: "tt_read_failed" }); }
    });
    app.post(WEBHOOK_PATH, hookGate, rawParser, (req, res) => {
      const v = verifyTtWebhook({ header: req.get("tiktok-signature"), rawBody: req.body, secret: config.devClientSecret, nowS: Math.floor(now() / 1000) });
      if (!v.ok) { log(`[TT-HOOK] rejected ${v.reason}`); return res.status(401).end(); }
      res.status(200).end();            // acknowledge FIRST (TikTok retries anything but a 200 for 72 h)
      try { handleWebhook(req.body); } catch (e) { log(`[TT-HOOK] handler error: ${safe(e && e.message)}`); }
    });
  }
  function start() { if (!sweepHandle) sweepHandle = setTimer(() => { void sweep(); }, TT_REFRESH_SWEEP_MS); }
  function stop() { if (sweepHandle) { clearTimer(sweepHandle); sweepHandle = null; } }
  return { registerRoutes, start, stop, buildAuthUrl, handleCallback, freshToken, disconnect, revokeAllForUser, sweep, handleWebhook };
}
