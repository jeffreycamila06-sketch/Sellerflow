// INSTAGRAM LIVE — phase 1 (admin / preview only). OAuth ("Instagram API with Facebook
// Login": the same Meta app, graph.facebook.com) + live detect + comment poller. Mirrors
// server/fbLive.js and reuses its helpers (state signing, confirm page, Graph GET, token
// exchange, comment diffing); the Facebook runtime itself is not changed. Every side effect is
// injected so vitest drives the whole flow with fakes (server.js has no test harness).
//
// OFF unless IG_ENABLED is the literal "true" on Render AND the Facebook secrets are present
// (igConfig) — and per request the IG lock (server/igAccess.js): ig_enabled / preview list /
// ig_tester_access.
//
// ⚠️ UNVERIFIED until a real Instagram Live: the Graph shapes below follow Meta's docs
// (GET /{ig-user}/live_media, GET /{ig-media}/comments) but have not been called for real.
// TOKEN: the PAGE token of the Page the Instagram account is linked to (from /me/accounts), like
// Facebook — it does not expire. If live_media / comments refuse a Page token, the fallback is
// the long-lived USER token (owner decision; not built until a real test shows it is needed).
import { createHash } from "node:crypto";
import express from "express";
import {
  signState, verifyStateDetail, verifyState, buildConfirmPage, confirmPageCsp, CONFIRM_PAGE_HEADERS_BASE,
  graphGet, classifyGraphError, exchangeCodeForToken, exchangeForLongLivedUserToken,
  pickNewComments, nextPollDelay, APP_REDIRECT_URL, APP_AUTH_CALLBACK, FB_DIALOG_HOST, GRAPH_HOST,
  POLL_QUIET_MS, POLL_RATE_LIMIT_MS, MAX_AUTH_FAILURES, MAX_FETCH_ERRORS, IDLE_STOP_MS, IDLE_RECHECK_MS,
  MAX_IDLE_UNREADABLE, MAX_SESSION_MS, EMITTED_CAP, COMPLETE_FORM_LIMIT, COMPLETE_REMEMBER_MS, COMPLETE_REMEMBER_MAX,
} from "./fbLive.js";
import { GRAPH_VERSION, fbConfig } from "./fbConfig.js";
import { encryptToken, decryptToken } from "./fbTokens.js";
import { maxAccountsForPlan } from "./accountCap.js";
import { fbPreviewEmail } from "./fbAccess.js";
import { igToPayload, IG_PLATFORM } from "./igComment.js";

// Exactly the four permissions the owner approved. pages_read_user_content is added ONLY if
// Meta's dialog turns out to require it (instagram_basic lists it as a dependency).
export const IG_OAUTH_SCOPE = "instagram_basic,instagram_manage_comments,pages_show_list,pages_read_engagement";
export const IG_COMMENTS_LIMIT = 50;          // Meta's maximum per comments query
export const IG_RATE_LIMIT_CODES = new Set([80002]); // Instagram business-use-case throttle (on top of Facebook's)
export const IG_CONFIRM_LABELS = { title: "Connect your Instagram account", lead: "Your Instagram account will be connected to this SellerFlowLive account:", action: "/ig/oauth/complete", param: "ig" };

// Facebook's secrets + its own switch. Missing anything → { enabled:false }.
export function igConfig(env = process.env) {
  const on = String((env || {}).IG_ENABLED ?? "").trim() === "true";
  const fb = fbConfig({ ...(env || {}), FB_ENABLED: "true" });
  if (!on || !fb.enabled) return { enabled: false };
  return { enabled: true, appId: fb.appId, appSecret: fb.appSecret, tokenKey: fb.tokenKey };
}

const graphUrl = (path, params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") q.set(k, String(v));
  return `${GRAPH_HOST}/${GRAPH_VERSION}${path}?${q.toString()}`;
};
export function classifyIgError(status, body) {
  const c = classifyGraphError(status, body);
  if (IG_RATE_LIMIT_CODES.has(c.code)) return { ...c, rateLimited: true, authFail: false };
  return c;
}
const failDetail = (status, cls) => ({ httpStatus: status, code: cls.code > 0 ? cls.code : null, subcode: cls.subcode, type: cls.type, timedOut: false, message: cls.message });

// Long-lived USER token → every Page that has a linked Instagram professional account.
// [] on any failure (never throws).
export async function fetchIgAccounts({ fetchImpl, userToken }) {
  try {
    const { body } = await graphGet({ fetchImpl, url: graphUrl("/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", access_token: userToken }) });
    const list = Array.isArray(body.data) ? body.data : [];
    return list
      .filter((p) => p && p.instagram_business_account && p.instagram_business_account.id && p.access_token)
      .map((p) => ({ pageId: String(p.id), pageName: String(p.name || ""), pageToken: String(p.access_token), igUserId: String(p.instagram_business_account.id), igUsername: String(p.instagram_business_account.username || "") }));
  } catch { return []; }
}

// Is this Instagram account broadcasting now? live_media returns only a live broadcast.
// → { liveMediaId ("" = not live), failed, authFail, detail? }. Never throws.
export async function fetchLiveMedia({ fetchImpl, igUserId, token }) {
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${igUserId}/live_media`, { fields: "id,media_product_type,timestamp", access_token: token }) });
    const cls = classifyIgError(status, body);
    if (status !== 200 || cls.code > 0 || !Array.isArray(body.data)) return { liveMediaId: "", failed: true, authFail: cls.authFail, rateLimited: cls.rateLimited, detail: failDetail(status, cls) };
    const first = body.data.find((m) => m && m.id);
    return { liveMediaId: first ? String(first.id) : "", failed: false, authFail: false };
  } catch (e) {
    const timedOut = !!e && (e.name === "AbortError" || e.message === "graph_timeout");
    return { liveMediaId: "", failed: true, authFail: false, detail: { httpStatus: null, code: null, subcode: null, type: null, timedOut, message: "" } };
  }
}

// Newest-first comments of the live media (readable only while the live runs).
export async function fetchIgComments({ fetchImpl, liveMediaId, token }) {
  const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${liveMediaId}/comments`, { fields: "id,text,timestamp,username,from{id,username}", limit: IG_COMMENTS_LIMIT, access_token: token }) });
  const hasData = Array.isArray(body.data);
  const cls = classifyIgError(status, body);
  const shapeAnomaly = status === 200 && !(cls.code > 0) && !hasData;
  return {
    status, list: hasData ? body.data : [], authFail: cls.authFail, rateLimited: cls.rateLimited,
    hardError: status !== 200 || cls.code > 0 || shapeAnomaly, shapeAnomaly,
    errorCode: cls.code || null, errorSubcode: cls.subcode, error: cls.message,
  };
}

// After a socket (re)joins the seller room: one platform_status per running Instagram poller.
export function replayIgStatus(runtime, sellerId, emailId, emit) {
  try {
    for (const p of runtime ? runtime.listPollers(sellerId) : []) {
      emit({ platform: IG_PLATFORM, connected: true, sellerId: emailId, username: p.scopeKey, sessionId: p.sessionId });
    }
  } catch { /* best effort */ }
}

const commentId = (c) => String((c && c.id) ?? "").trim();
function remember(emitted, ids, cap = EMITTED_CAP) {
  for (const id of ids) emitted.add(id);
  while (emitted.size > cap) emitted.delete(emitted.values().next().value);
}

// deps: { config, store, emitComment, statusEmit, liveKey, renderUrl, appUrl?, fetchImpl?, now?, log?,
//   setLoop?, clearLoop?, makeFormParser? }
//   store: getPlan(userId), countAccounts(userId), getAccount(userId, igUserId), upsertAccount(row),
//     listAccounts(userId), setActive(userId, igUserId, active), getAccountLabel(userId)
export function createIgRuntime(deps) {
  const {
    config, store, emitComment, statusEmit, liveKey, renderUrl, appUrl = APP_REDIRECT_URL,
    fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {},
    makeFormParser = (limit) => express.urlencoded({ extended: false, limit }),
    setLoop = (fn, ms) => setTimeout(fn, ms), clearLoop = (h) => clearTimeout(h),
  } = deps;
  const pollers = new Map();
  const redirectUri = `${String(renderUrl).replace(/\/+$/, "")}/ig/oauth/callback`;
  // Web flows come back to the app with ?ig=…; app flows end on the native sheet's callback,
  // which reads ?fb=… (the native contract) — the sheet only reports the status word.
  const backTo = (app) => (status, code) => (app
    ? `${APP_AUTH_CALLBACK}?fb=${status}${code ? `&code=${code}` : ""}`
    : `${appUrl}/?ig=${status}${code ? `&code=${code}` : ""}`);

  function buildAuthUrl(userId, { app = false } = {}) {
    const state = signState({ userId, key: config.appSecret, nowMs: now(), app, kind: "ig" });
    const q = new URLSearchParams({ client_id: config.appId, redirect_uri: redirectUri, state, scope: IG_OAUTH_SCOPE, response_type: "code" });
    return `${FB_DIALOG_HOST}/${GRAPH_VERSION}/dialog/oauth?${q.toString()}`;
  }

  async function handleCallback({ code, state }) {
    const st = verifyStateDetail(state, config.appSecret, now(), "ig"); // Build 8: an Instagram state only
    if (!st) return { redirect: backTo(false)("error", "bad_state") };
    const back = backTo(st.app);
    const userId = st.userId;
    if (!code) return { redirect: back("error", "missing_params") };
    try {
      const shortTok = await exchangeCodeForToken({ config, fetchImpl, code, redirectUri });
      if (!shortTok.ok) return { redirect: back("error", "token_exchange") };
      const longTok = await exchangeForLongLivedUserToken({ config, fetchImpl, shortToken: shortTok.access });
      if (!longTok.ok) return { redirect: back("error", "token_exchange") };
      const accounts = await fetchIgAccounts({ fetchImpl, userToken: longTok.access });
      if (accounts.length === 0) return { redirect: back("error", "no_ig_account") };
      let plan, count;
      try { plan = await store.getPlan(userId); count = await store.countAccounts(userId); }
      catch (e) { log(`[IG] callback read_failed user=${userId}: ${e && e.message}`); return { redirect: back("error", "read_failed") }; }
      const max = plan ? maxAccountsForPlan(plan) : Infinity;
      let saved = 0, capped = 0, failed = 0, limited = 0;
      for (const a of accounts) {
        let existing = null;
        try { existing = await store.getAccount(userId, a.igUserId); } catch { existing = null; }
        if (!existing && count >= max) { capped++; continue; }   // re-authorization always passes
        try {
          await store.upsertAccount({
            user_id: userId, ig_user_id: a.igUserId, ig_username: a.igUsername || null, page_id: a.pageId, page_name: a.pageName || null,
            access_token: encryptToken(a.pageToken, config.tokenKey), token_expires_at: null, active: true,
          });
        } catch (e) { if (e && e.message === "account_limit") limited++; else failed++; continue; }
        saved++;
        if (!existing) count++;
      }
      if (saved === 0 && limited > 0) return { redirect: back("error", "account_limit") };
      if (saved === 0 && failed > 0) return { redirect: back("error", "save_failed") };
      if (saved === 0) return { redirect: back("error", "cap") };
      log(`[IG] callback ok user=${userId} accounts=${saved} capped=${capped} failed=${failed}`);
      return { redirect: back("connected") };
    } catch (e) {
      log(`[IG] callback error: ${e && e.message}`);
      return { redirect: back("error", "exception") };
    }
  }

  async function confirmCallback({ code, state }) {
    const st = verifyStateDetail(state, config.appSecret, now(), "ig"); // Build 8: an Instagram state only
    if (!st) return { redirect: backTo(false)("error", "bad_state") };
    const back = backTo(st.app);
    if (!code) return { redirect: back("error", "missing_params") };
    let label = null;
    try { label = await store.getAccountLabel(st.userId); } catch { label = null; }
    if (!label || !String(label.email || "").trim()) return { redirect: back("error", "exception") };
    return { app: st.app, html: buildConfirmPage({ code, state, email: label.email, storeName: label.storeName, appUrl, app: st.app, labels: IG_CONFIRM_LABELS }) };
  }

  // ---- Poller ----
  async function pollOnce(entry) {
    const nowMs = now();
    if (nowMs - entry.startedAtMs >= MAX_SESSION_MS) return { stop: true, reason: "max_session" };
    if (!entry.token || entry.reauth) {
      let acct;
      try { acct = await store.getAccount(entry.userId, entry.igUserId); } catch { return { stop: false }; }
      if (!acct || !acct.active) return { stop: true, reason: "inactive" };
      const tok = decryptToken(acct.access_token, config.tokenKey);
      if (!tok) return { stop: true, reason: "no_token" };
      entry.token = tok; entry.reauth = false;
    }
    // Quiet for IDLE_STOP_MS: is the live still on? Not in live_media any more → ended.
    if (nowMs - entry.lastActivityMs >= IDLE_STOP_MS && nowMs >= (entry.idleRecheckAtMs || 0)) {
      const live = await fetchLiveMedia({ fetchImpl, igUserId: entry.igUserId, token: entry.token });
      if (entry.stopped) return { stop: false };
      if (!live.failed && live.liveMediaId === entry.liveMediaId) { entry.lastActivityMs = nowMs; entry.idleUnreadable = 0; entry.idleRecheckAtMs = 0; }
      else if (!live.failed) return { stop: true, reason: "session_end" };
      else {
        entry.idleUnreadable = (entry.idleUnreadable || 0) + 1;
        if (entry.idleUnreadable >= MAX_IDLE_UNREADABLE) return { stop: true, reason: "idle" };
        entry.idleRecheckAtMs = nowMs + IDLE_RECHECK_MS;
      }
    }
    let res;
    try { res = await fetchIgComments({ fetchImpl, liveMediaId: entry.liveMediaId, token: entry.token }); }
    catch { return { stop: false }; }
    if (entry.stopped) return { stop: false };
    if (res.rateLimited) {
      if (!entry.rateLimited) { entry.rateLimited = true; log(`[IG] comments rate-limited ig=${entry.igUserId} code=${res.errorCode ?? "-"} — waiting ${POLL_RATE_LIMIT_MS / 1000}s`); }
      return { stop: false, delayMs: POLL_RATE_LIMIT_MS };
    }
    entry.rateLimited = false;
    if (res.status >= 500) return { stop: false, backoff: true };
    if (res.authFail) {
      entry.authFails = (entry.authFails || 0) + 1; entry.reauth = true;
      log(`[IG] comments auth-fail ig=${entry.igUserId} code=${res.errorCode ?? "-"} (${entry.authFails}/${MAX_AUTH_FAILURES})`);
      if (entry.authFails >= MAX_AUTH_FAILURES) {
        try { await store.setActive(entry.userId, entry.igUserId, false); } catch { /* best effort */ }
        return { stop: true, reason: "auth" };
      }
      return { stop: false };
    }
    if (res.hardError) {
      entry.fetchErrors = (entry.fetchErrors || 0) + 1;
      log(`[IG] comments error ig=${entry.igUserId} media=${entry.liveMediaId} http=${res.status} code=${res.errorCode ?? "-"} msg=${res.error || "-"}${res.shapeAnomaly ? " shape=no-data-array" : ""} (${entry.fetchErrors}/${MAX_FETCH_ERRORS})`);
      if (entry.fetchErrors >= MAX_FETCH_ERRORS) {
        const live = await fetchLiveMedia({ fetchImpl, igUserId: entry.igUserId, token: entry.token });
        if (!live.failed && live.liveMediaId !== entry.liveMediaId) return { stop: true, reason: "session_end" };
        return { stop: true, reason: "fetch_error" };
      }
      return { stop: false, backoff: true };
    }
    entry.authFails = 0; entry.fetchErrors = 0;
    // The first successful poll carries the comments that already existed → initial:true
    // (display-only lane on the client; never an order on a reconnect). Newest-first → reverse.
    const asInitial = !entry.firstPollDone;
    const fresh = pickNewComments(res.list, entry.emitted).reverse();
    if (asInitial) log(`[IG] first poll ig=${entry.igUserId} media=${entry.liveMediaId} comments=${fresh.length} initial=true`);
    if (res.list.length >= IG_COMMENTS_LIMIT && !asInitial && fresh.length >= IG_COMMENTS_LIMIT) log(`[IG] full page of new comments ig=${entry.igUserId} — some may be missed`);
    for (const raw of fresh) {
      const payload = igToPayload(raw, { sellerId: entry.sellerId, sessionId: entry.sessionId, igUserId: entry.igUserId, igUsername: entry.scopeKey, liveMediaId: entry.liveMediaId, nowMs });
      if (asInitial) payload.initial = true;
      emitComment(entry.sellerId, entry.scopeKey, payload);
    }
    remember(entry.emitted, fresh.map(commentId));
    entry.firstPollDone = true;
    if (fresh.length > 0) { entry.lastActivityMs = nowMs; entry.idleUnreadable = 0; entry.idleRecheckAtMs = 0; }
    return { stop: false, hadNew: fresh.length > 0 };
  }

  function scheduleNext(entry, delayMs) {
    if (entry.stopped) return;
    entry.timer = setLoop(async () => {
      if (entry.stopped) return;
      let r = { stop: false };
      try { r = await pollOnce(entry); } catch { r = { stop: false }; }
      if (entry.stopped) return;
      if (r.stop) { stopPoller(entry.key, r.reason || "stopped"); return; }
      scheduleNext(entry, r.delayMs || (r.backoff ? POLL_QUIET_MS : nextPollDelay(r.hadNew)));
    }, delayMs);
  }

  function startPoller({ sellerId, userId, igUserId, igUsername, liveMediaId, sessionId = "" }) {
    const scopeKey = String(igUsername || igUserId);
    const key = liveKey(sellerId, IG_PLATFORM, igUserId);
    stopPoller(key, "restart");
    const nowMs = now();
    const entry = {
      key, sellerId, userId, igUserId: String(igUserId), scopeKey, liveMediaId: String(liveMediaId), sessionId: String(sessionId || ""),
      emitted: new Set(), authFails: 0, fetchErrors: 0, rateLimited: false, timer: null, stopped: false,
      idleUnreadable: 0, idleRecheckAtMs: 0, firstPollDone: false, startedAtMs: nowMs, lastActivityMs: nowMs, token: null, reauth: false,
    };
    pollers.set(key, entry);
    log(`[IG] poller start ig=${entry.igUserId} media=${entry.liveMediaId}`);
    statusEmit(sellerId, { connected: true, scopeKey, sessionId: entry.sessionId });
    scheduleNext(entry, 0);
    return entry;
  }

  function stopPoller(key, reason = "stopped") {
    const entry = pollers.get(key);
    if (!entry) return false;
    entry.stopped = true;
    if (entry.timer != null) { clearLoop(entry.timer); entry.timer = null; }
    pollers.delete(key);
    try { statusEmit(entry.sellerId, { connected: false, scopeKey: entry.scopeKey, sessionId: entry.sessionId }); } catch { /* best effort */ }
    log(`[IG] poller stop ig=${entry.igUserId} reason=${reason}`);
    return true;
  }

  function listPollers(sellerId) {
    const out = [];
    for (const e of pollers.values()) if (e.sellerId === sellerId && !e.stopped) out.push({ scopeKey: e.scopeKey, sessionId: e.sessionId, igUserId: e.igUserId });
    return out;
  }
  function stopAll() { for (const key of [...pollers.keys()]) stopPoller(key, "shutdown"); }

  // ---- Routes ----
  const completeInFlight = new Map();
  const completeDone = new Map();
  async function runComplete(code, state, key) {
    try {
      const { redirect } = await handleCallback({ code, state });
      let reason = "";
      try { const u = new URL(redirect); if ((u.searchParams.get("ig") || u.searchParams.get("fb")) === "error") reason = u.searchParams.get("code") || "unknown"; } catch { reason = ""; }
      if (reason) { const uid = verifyState(state, config.appSecret, now()); log(`[IG] callback failed user=${uid ? String(uid).slice(0, 8) : "-"} reason=${reason}`); }
      if (!reason || reason === "cap") {
        const nowMs = now();
        for (const [k, v] of completeDone) { if (nowMs - v.at >= COMPLETE_REMEMBER_MS) completeDone.delete(k); else break; }
        completeDone.set(key, { redirect, at: nowMs });
        while (completeDone.size > COMPLETE_REMEMBER_MAX) completeDone.delete(completeDone.keys().next().value);
      }
      return redirect;
    } finally { completeInFlight.delete(key); }
  }

  const passThrough = (_req, _res, next) => next();
  function registerRoutes(app, requireAuth, extra = {}) {
    const requireConnectRate = extra.requireConnectRate || passThrough;
    const requirePlanActive = extra.requirePlanActive || passThrough;
    const requireIgAvailable = extra.requireIgAvailable || passThrough;
    const requireIgPlan = extra.requireIgPlan || passThrough;
    const accountLiveCheck = extra.accountLiveCheck || (async () => ({ allow: true }));
    const startPlanActive = (req, res, next) => (fbPreviewEmail(req.userEmail) ? next() : requirePlanActive(req, res, next));

    app.get("/ig/oauth/start", requireAuth, requireIgAvailable, startPlanActive, requireIgPlan, (req, res) => {
      const isApp = String((req.query && req.query.client) || "") === "app";
      try { return res.json({ url: buildAuthUrl(req.authUserId, { app: isApp }) }); }
      catch { return res.status(500).json({ ok: false, error: "ig_start_failed" }); }
    });

    app.get("/ig/oauth/callback", async (req, res) => {
      const out = await confirmCallback({ code: String(req.query.code || ""), state: String(req.query.state || "") });
      if (out.redirect) return res.redirect(out.redirect);
      res.set({ ...CONFIRM_PAGE_HEADERS_BASE, "Content-Security-Policy": confirmPageCsp(appUrl, { app: out.app === true }), "Content-Type": "text/html; charset=utf-8" });
      return res.status(200).send(out.html);
    });

    const formParser = makeFormParser(COMPLETE_FORM_LIMIT);
    const parseForm = (req, res, next) => formParser(req, res, (err) => { if (err) req.body = {}; next(); });
    app.post("/ig/oauth/complete", parseForm, async (req, res) => {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const code = typeof body.code === "string" ? body.code : "";
      const state = typeof body.state === "string" ? body.state : "";
      if (!code || !state) return res.redirect(303, (await handleCallback({ code, state })).redirect);
      const key = createHash("sha256").update(`${code}|${state}`, "utf8").digest("hex");
      const kept = completeDone.get(key);
      if (kept && now() - kept.at < COMPLETE_REMEMBER_MS) return res.redirect(303, kept.redirect);
      if (kept) completeDone.delete(key);
      let flight = completeInFlight.get(key);
      if (!flight) { flight = runComplete(code, state, key); completeInFlight.set(key, flight); }
      return res.redirect(303, await flight);
    });

    // Own accounts — NEVER the token column.
    app.get("/ig/accounts", requireAuth, requireIgAvailable, async (req, res) => {
      try {
        const rows = await store.listAccounts(req.authUserId);
        return res.json({ ok: true, accounts: (rows || []).map((a) => ({ ig_user_id: String(a.ig_user_id), username: a.ig_username || "", page_name: a.page_name || "", active: !!a.active })) });
      } catch { return res.status(500).json({ ok: false, error: "ig_accounts_failed" }); }
    });

    app.post("/ig/connect", requireAuth, requireIgAvailable, requireConnectRate, requirePlanActive, requireIgPlan, async (req, res) => {
      const userId = req.authUserId;
      const sellerId = req.sellerId;
      const body = req.body || {};
      const igUserId = String(body.ig_user_id || "");
      if (!igUserId) return res.status(400).json({ ok: false, error: "ig_user_id required" });
      let acct;
      try { acct = await store.getAccount(userId, igUserId); }
      catch { return res.status(502).json({ ok: false, error: "ig_check_failed" }); }
      if (!acct || !acct.active) return res.status(404).json({ ok: false, error: "account_not_found" });
      if (!pollers.has(liveKey(sellerId, IG_PLATFORM, igUserId))) {
        const v = await accountLiveCheck(req, "instagram", igUserId);
        if (!v.allow) return res.status(403).json({ ok: false, error: "account_not_covered" });
      }
      const token = decryptToken(acct.access_token, config.tokenKey);
      if (!token) return res.status(409).json({ ok: false, error: "needs_reauth" });
      const live = await fetchLiveMedia({ fetchImpl, igUserId, token });
      if (live.failed) {
        const d = live.detail || {};
        log(`[IG] connect check failed user=${String(userId || "").slice(0, 8)} ig=${igUserId} http=${d.httpStatus ?? "-"} code=${d.code ?? "-"} timeout=${d.timedOut === true}`);
      }
      if (live.authFail) return res.status(409).json({ ok: false, error: "needs_reauth" });
      if (live.rateLimited) return res.status(429).json({ ok: false, error: "too_many_requests" });
      if (live.failed) return res.status(502).json({ ok: false, error: "ig_check_failed", ig_code: Number.isFinite(live.detail?.code) ? live.detail.code : null });
      if (!live.liveMediaId) return res.json({ ok: false, reason: "not_live" });
      startPoller({ sellerId, userId, igUserId, igUsername: acct.ig_username || igUserId, liveMediaId: live.liveMediaId, sessionId: String(body.sessionId || "") });
      return res.json({ ok: true, live_media_id: live.liveMediaId });
    });

    app.post("/ig/disconnect", requireAuth, (req, res) => {
      const igUserId = String((req.body || {}).ig_user_id || "");
      return res.json({ ok: true, stopped: stopPoller(liveKey(req.sellerId, IG_PLATFORM, igUserId), "disconnect") });
    });
  }

  return { registerRoutes, stopAll, stopPoller, startPoller, listPollers, pollOnce, handleCallback, confirmCallback, buildAuthUrl, _pollers: pollers };
}
