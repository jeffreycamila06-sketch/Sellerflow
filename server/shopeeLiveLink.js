// SHOPEE LIVE — SHARE-LINK READER (beta, 2026-10-27). Beside fbLive.js; a SEPARATE module.
// The seller pastes the share link of THEIR OWN Shopee live (TW or PH). The server resolves
// it → host_session?uid= → chatroom_id → polls the chat-room message endpoint the Shopee
// viewer page itself polls, and feeds the comments into the SAME emitCommentScoped relay the
// TikTok/FB readers use. Plain requests only: no login, no cookies, no signatures, no header
// spoofing, never faster than the server's own poll_interval. Research: scripts/probes/shopee/.
//
// The old official-API Shopee runtime (server/shopeeLive.js, shopeeConfig/Tokens/Sign/Comment)
// is untouched and stays dormant; this file never imports it.
//
// Pure helpers (exported, unit-tested): parseShareUrl, regionOfHost, verifyHost,
// parseChatBatches, shopeeToPayload, nextDelayMs. Runtime: createShopeeLinkRuntime(deps).

export const SHOPEE_UA = "SellerFlowLive/1.0 (+https://www.sellerflowlive.com)"; // honest UA, no browser imitation
export const REGIONS = new Set(["tw", "ph"]);
export const POLL_MIN_MS = 3000;                  // never below the server's poll_interval (3 s observed)
export const POLL_BACKOFF_MAX_MS = 60 * 1000;     // non-200 / code≠0 → 2×, capped here
export const MAX_CONSECUTIVE_FAILS = 10;          // then stop(unreachable)
export const STATUS_RECHECK_MS = 60 * 1000;       // host_session status re-read cadence (live end)
export const IDLE_STOP_MS = 10 * 60 * 1000;       // no comment for this long → check the live, stop if not live
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
export const DEDUPE_CAP = 5000;
export const MAX_REDIRECTS = 6;
export const FETCH_TIMEOUT_MS = 10 * 1000;

// ---- link parsing (pure) ----
/** "tw" | "ph" | null from a hostname (live.shopee.tw, tw.shp.ee, shopee.ph, ph.shp.ee …). */
export function regionOfHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  const m = /(?:^|\.)shopee\.(tw|ph)$/.exec(h) || /^(tw|ph)\.shp\.ee$/.exec(h);
  return m ? m[1] : null;
}
/** The ids a share URL carries: { region, sessionId, shareUserId } (nulls when absent). */
export function parseShareUrl(input) {
  let u;
  try { u = new URL(String(input || "").trim()); } catch { return { region: null, sessionId: null, shareUserId: null, host: "" }; }
  const region = regionOfHost(u.hostname);
  const sessionId = /^\d+$/.test(u.searchParams.get("session") || "") ? u.searchParams.get("session") : null;
  const shareUserId = /^\d+$/.test(u.searchParams.get("share_user_id") || "") ? u.searchParams.get("share_user_id") : null;
  return { region, sessionId, shareUserId, host: u.hostname.toLowerCase() };
}
/** Is this a Shopee link at all (short link or live.shopee.* URL)? */
export function looksLikeShopeeLink(input) {
  const p = parseShareUrl(input);
  return !!p.region || /(^|\.)shp\.ee$/.test(p.host);
}

// ---- host check (pure) ----
// The link's `share_user_id` is the SHARER. host_session?uid=<sharer> returns that uid's
// current/last session: it is the seller's OWN live only when the returned session_id equals
// the link's session_id. Different session → someone else's live (or an old link). status 1 =
// live, anything else = ended.
export function verifyHost({ sessionId, shareUserId }, hostSession) {
  const s = hostSession && hostSession.data && hostSession.data.session;
  if (!s || String(s.uid || "") !== String(shareUserId || "")) return { ok: false, error: "not_own" };
  if (String(s.session_id || "") !== String(sessionId || "")) return { ok: false, error: "not_own" };
  if (!s.chatroom_id) return { ok: false, error: "not_own" };
  if (Number(s.status) !== 1) return { ok: false, error: "ended" };
  return { ok: true, chatroomId: String(s.chatroom_id), uid: String(s.uid), sessionId: String(s.session_id), title: String(s.title || "") };
}

// ---- chat payload (pure) ----
/** data.message = [ { msgs: [ … ], timestamp }, … ]; returns the flat msgs + the new cursor. */
export function parseChatBatches(data) {
  const d = data && typeof data === "object" ? data : {};
  const out = [];
  for (const kind of ["message", "e2e_message"]) {
    const b = d[kind];
    const batches = Array.isArray(b) ? b : b && typeof b === "object" && Object.keys(b).length ? [b] : [];
    for (const batch of batches) {
      const msgs = Array.isArray(batch && batch.msgs) ? batch.msgs : Array.isArray(batch) ? batch : [];
      for (const m of msgs) if (m && typeof m === "object") out.push(m);
    }
  }
  const pollIntervalMs = Math.max(POLL_MIN_MS, (Number(d.poll_interval) > 0 ? Number(d.poll_interval) : 3) * 1000);
  const cursor = typeof d.timestamp === "number" ? d.timestamp : null;
  return { msgs: out, cursor, pollIntervalMs };
}
/** The comment text of one chat message: content is a JSON string {"type":101,"content":"…"}; only chat text (type 101) is a comment. */
export function commentTextOf(msg) {
  let c = msg && msg.content;
  if (typeof c === "string" && c.trim().startsWith("{")) { try { c = JSON.parse(c); } catch { /* keep the string */ } }
  if (typeof c === "string") return c;
  if (!c || typeof c !== "object") return "";
  if (c.type != null && Number(c.type) !== 101) return "";
  return typeof c.content === "string" ? c.content : typeof c.text === "string" ? c.text : "";
}
const firstStr = (...v) => { for (const x of v) { if (typeof x === "string" && x.trim()) return x.trim(); if (typeof x === "number" && Number.isFinite(x)) return String(x); } return ""; };
/** One chat message → the relay payload (same field names as fbToPayload / the TikTok relay). */
export function shopeeToPayload(msg, ctx = {}) {
  const m = msg && typeof msg === "object" ? msg : {};
  const { sellerId, sessionId = "", uid, liveSessionId, nowMs = Date.now() } = ctx;
  const comment = commentTextOf(m);
  if (!comment) return null; // not a chat text (system / unknown type)
  const nickname = firstStr(m.nickname, m.display_name, m.username);
  const handle = firstStr(m.username, m.nickname, m.display_name, m.uid != null ? `shopee-${m.uid}` : "", "unknown");
  const msgId = firstStr(m.id, m.msg_id, m.ts != null ? `${m.uid}-${m.ts}` : "");
  const atMs = typeof m.ts === "number" ? (m.ts > 1e12 ? m.ts : m.ts * 1000) : nowMs;
  const at = new Date(atMs);
  return {
    handle, name: nickname || handle, comment, avatar: firstStr(m.avatar),
    platform: "Shopee", sellerId, sessionId: String(sessionId || ""),
    sourceUsername: String(uid || ""),          // the seller's Shopee uid = the scoping key
    roomId: String(liveSessionId || ""),        // Shopee "room" = the live session
    isBuy: false, buyerNum: null, buyerData: null,
    msgId: String(msgId || `${uid}-${atMs}`),
    time: at.toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: at.toISOString(),
  };
}
/** Delay after a poll: the server's interval, or exponential backoff after a failure. */
export function nextDelayMs({ ok, pollIntervalMs = POLL_MIN_MS, fails = 0 }) {
  if (ok) return Math.max(POLL_MIN_MS, pollIntervalMs);
  return Math.min(POLL_BACKOFF_MAX_MS, POLL_MIN_MS * 2 ** Math.max(1, fails));
}

// ---- runtime ----
export function createShopeeLinkRuntime(deps) {
  const {
    emitComment,                 // (sellerId, scopeKey, payload) → the real emitCommentScoped(…, "Shopee", …)
    statusEmit,                  // (sellerId, { connected, scopeKey, sessionId, reason })
    liveKey,                     // server.js liveKey(sellerId, platform, username)
    enabled = async () => false, // app_settings.shopee_live_enabled — fail-closed
    betaAllowed = async () => false, // (userId, email) → admin OR shopee_beta row not expired
    rememberAccount = async () => {},  // (userId, region, uid) → the Shopee account key (account seats)
    fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {},
    setLoop = (fn, ms) => setTimeout(fn, ms), clearLoop = (h) => clearTimeout(h),
  } = deps;
  const pollers = new Map(); // key → entry

  async function get(url) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const r = await fetchImpl(url, { headers: { "user-agent": SHOPEE_UA, accept: "application/json" }, redirect: "manual", signal: ctl ? ctl.signal : undefined });
      let body = null; try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body, location: r.headers && typeof r.headers.get === "function" ? r.headers.get("location") : null };
    } finally { if (t) clearTimeout(t); }
  }

  /** Short link → the share URL ids (follows redirects by hand; max MAX_REDIRECTS). */
  async function resolveLink(input) {
    let url = String(input || "").trim();
    let p = parseShareUrl(url);
    if (p.sessionId && p.region) return { ok: true, ...p };
    if (!looksLikeShopeeLink(url)) return { ok: false, error: "bad_link" };
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      let r;
      try { r = await get(url); } catch { return { ok: false, error: "unreachable" }; }
      if (!r.location) return { ok: false, error: "bad_link" };
      url = new URL(r.location, url).toString();
      // Only Shopee hosts are followed (live.shopee.tw/ph, *.shp.ee): a redirect anywhere else
      // ends the resolve with bad_link and that host is never fetched.
      if (!looksLikeShopeeLink(url)) return { ok: false, error: "bad_link" };
      p = parseShareUrl(url);
      if (p.sessionId && p.region) return { ok: true, ...p };
    }
    return { ok: false, error: "bad_link" };
  }
  async function hostSession(region, uid) {
    try {
      const r = await get(`https://live.shopee.${region}/api/v1/host_session?uid=${encodeURIComponent(uid)}`);
      if (r.status !== 200 || !r.body) return { ok: false, error: r.status === 403 ? "blocked" : "unreachable", status: r.status };
      return { ok: true, body: r.body };
    } catch { return { ok: false, error: "unreachable" }; }
  }
  async function liveStatus(entry) {
    const hs = await hostSession(entry.region, entry.uid);
    if (!hs.ok) return "unknown";
    const s = hs.body && hs.body.data && hs.body.data.session;
    if (!s || String(s.session_id || "") !== entry.liveSessionId) return "ended";
    return Number(s.status) === 1 ? "live" : "ended";
  }

  async function pollOnce(entry) {
    const t = now();
    if (t - entry.startedAtMs >= MAX_SESSION_MS) return { stop: "max_session" };
    if (t - entry.lastActivityMs >= IDLE_STOP_MS && t - entry.lastStatusMs >= STATUS_RECHECK_MS) {
      entry.lastStatusMs = t;
      const st = await liveStatus(entry);
      if (st === "ended") return { stop: "session_end" };
      if (st === "live") entry.lastActivityMs = t; // still live, quiet → keep going
    } else if (t - entry.lastStatusMs >= STATUS_RECHECK_MS) {
      entry.lastStatusMs = t;
      if ((await liveStatus(entry)) === "ended") return { stop: "session_end" };
    }
    let r;
    try {
      r = await get(`https://chatroom-live.shopee.${entry.region}/api/v1/fetch/chatroom/${encodeURIComponent(entry.chatroomId)}/message?uuid=${entry.uuid}&timestamp=${entry.cursor}&version=v2`);
    } catch { r = { status: 0, body: null }; }
    const okResp = r.status === 200 && r.body && Number(r.body.code) === 0;
    if (!okResp) {
      entry.fails++;
      if (entry.fails === 1 || entry.fails % 5 === 0) log(`[SHOPEE-LINK] poll fail #${entry.fails} http=${r.status} code=${r.body && r.body.code} seller=${entry.sellerId}`);
      if (entry.fails >= MAX_CONSECUTIVE_FAILS) return { stop: "unreachable" };
      return { delayMs: nextDelayMs({ ok: false, fails: entry.fails }) };
    }
    entry.fails = 0;
    const { msgs, cursor, pollIntervalMs } = parseChatBatches(r.body.data);
    if (cursor != null) entry.cursor = cursor;
    const asInitial = !entry.firstPollDone; // F1 mirror: the first poll's backlog is display-only
    let fresh = 0;
    for (const m of msgs) {
      const payload = shopeeToPayload(m, { sellerId: entry.sellerId, sessionId: entry.sessionId, uid: entry.uid, liveSessionId: entry.liveSessionId, nowMs: t });
      if (!payload) continue;
      if (entry.seen.has(payload.msgId)) continue;
      entry.seen.add(payload.msgId); entry.seenOrder.push(payload.msgId);
      if (entry.seenOrder.length > DEDUPE_CAP) entry.seen.delete(entry.seenOrder.shift());
      if (asInitial) payload.initial = true;
      emitComment(entry.sellerId, entry.scopeKey, payload);
      fresh++;
    }
    entry.firstPollDone = true;
    if (fresh > 0) entry.lastActivityMs = t;
    return { delayMs: pollIntervalMs };
  }
  function scheduleNext(entry, delayMs) {
    if (entry.stopped) return;
    entry.timer = setLoop(async () => {
      if (entry.stopped) return;
      let r = {};
      try { r = await pollOnce(entry); } catch { r = { delayMs: nextDelayMs({ ok: false, fails: 1 }) }; }
      if (entry.stopped) return;
      if (r.stop) { stopPoller(entry.key, r.stop); return; }
      scheduleNext(entry, r.delayMs || POLL_MIN_MS);
    }, delayMs);
  }
  function startPoller({ sellerId, userId, region, uid, liveSessionId, chatroomId, sessionId = "" }) {
    // single-flight per seller: one Shopee live per seller at a time
    for (const [k, e] of pollers) if (e.sellerId === sellerId) stopPoller(k, "restart");
    const key = liveKey(sellerId, "Shopee", uid);
    const t = now();
    const entry = {
      key, sellerId, userId, region, uid: String(uid), liveSessionId: String(liveSessionId), chatroomId: String(chatroomId), sessionId: String(sessionId || ""),
      scopeKey: String(uid), uuid: cryptoUuid(), cursor: 0, seen: new Set(), seenOrder: [], fails: 0, timer: null, stopped: false,
      firstPollDone: false, startedAtMs: t, lastActivityMs: t, lastStatusMs: t,
    };
    pollers.set(key, entry);
    statusEmit(sellerId, { connected: true, scopeKey: entry.scopeKey, sessionId: entry.sessionId });
    log(`[SHOPEE-LINK] poller start seller=${sellerId} region=${region} live=${liveSessionId}`);
    scheduleNext(entry, 0);
    return entry;
  }
  function stopPoller(key, reason = "stopped") {
    const entry = pollers.get(key);
    if (!entry) return false;
    entry.stopped = true;
    if (entry.timer != null) { clearLoop(entry.timer); entry.timer = null; }
    pollers.delete(key);
    try { statusEmit(entry.sellerId, { connected: false, scopeKey: entry.scopeKey, sessionId: entry.sessionId, reason: String(reason) }); } catch { /* best effort */ }
    log(`[SHOPEE-LINK] poller stop seller=${entry.sellerId} reason=${reason}`);
    return true;
  }
  function stopAll() { for (const k of [...pollers.keys()]) stopPoller(k, "shutdown"); }
  function listPollers() { return [...pollers.values()].map((e) => ({ sellerId: e.sellerId, region: e.region, liveSessionId: e.liveSessionId, scopeKey: e.scopeKey })); }

  /** The whole connect decision, HTTP-free (so it is testable): returns { status, json }. */
  async function connect({ sellerId, userId, email, shareLink, sessionId }) {
    if (!(await enabled().catch(() => false))) return { status: 503, json: { ok: false, error: "shopee_off" } };
    if (!(await betaAllowed(userId, email).catch(() => false))) return { status: 403, json: { ok: false, error: "no_beta" } };
    const link = await resolveLink(shareLink);
    if (!link.ok) return { status: link.error === "unreachable" ? 502 : 400, json: { ok: false, error: link.error } };
    if (!link.shareUserId) return { status: 400, json: { ok: false, error: "not_own" } }; // no sharer id = not a seller's own share link
    const hs = await hostSession(link.region, link.shareUserId);
    if (!hs.ok) return { status: hs.error === "blocked" ? 503 : 502, json: { ok: false, error: hs.error } };
    const v = verifyHost(link, hs.body);
    if (!v.ok) return { status: v.error === "ended" ? 410 : 403, json: { ok: false, error: v.error } };
    try { await rememberAccount(userId, link.region, v.uid); } catch (e) { log(`[SHOPEE-LINK] account remember failed seller=${sellerId}: ${e && e.message}`); }
    startPoller({ sellerId, userId, region: link.region, uid: v.uid, liveSessionId: v.sessionId, chatroomId: v.chatroomId, sessionId });
    return { status: 200, json: { ok: true, region: link.region, session_id: v.sessionId, uid: v.uid } };
  }
  function registerRoutes(app, requireAuth, extra = {}) {
    const { requireConnectRate = (_req, _res, next) => next() } = extra;
    app.post("/shopee/live/connect", requireAuth, requireConnectRate, async (req, res) => {
      const body = req.body || {};
      const r = await connect({ sellerId: req.sellerId, userId: req.authUserId, email: req.userEmail || "", shareLink: String(body.shareLink || ""), sessionId: String(body.sessionId || "") });
      return res.status(r.status).json(r.json);
    });
  }
  return { registerRoutes, connect, startPoller, stopPoller, stopAll, listPollers, pollOnce, resolveLink, hostSession, _pollers: pollers };
}
function cryptoUuid() { try { return globalThis.crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; } }
