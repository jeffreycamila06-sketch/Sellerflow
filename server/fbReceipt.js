// FACEBOOK MESSENGER RECEIPT — step 2: the Send. One picture per Messenger message, sent as a
// Private Reply to ONE of the buyer's live comments (Facebook allows one message per comment).
// Verified by hand (Graph API Explorer, Oct 5): POST /{page-id}/messages with
//   recipient = { comment_id }   message = { attachment: { type: "image", payload: { url } } }
// and nothing else (no messaging_type, no tag).
//
// Gate: fb_receipt_access only (store.hasReceiptAccess). fb_receipts_enabled is NOT read here.
// Everything about WHICH comment and WHICH page comes from the database (live_session_orders +
// fb_pages); the client only says which buyer of which session and supplies the picture.
// The fb_receipts table (sql/75) has a unique index on comment_id where status <> 'failed', so
// the database guarantees one live message per comment even with parallel requests.
// A receipt error NEVER touches the page row (no setActive): it must not stop comment delivery.
// Pure helpers are exported and unit-tested; the runtime takes injected deps (mirror fbLive).
import { randomBytes } from "node:crypto";
import express from "express";
import { GRAPH_VERSION } from "./fbConfig.js";
import { GRAPH_HOST } from "./fbLive.js";
import { decryptToken } from "./fbTokens.js";

export const RECEIPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000; // 7 days minus 1 hour
export const RECEIPT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const RECEIPT_BODY_LIMIT = "6mb";
export const RECEIPT_SEND_RATE_MAX = 30;
export const RECEIPT_SEND_RATE_WINDOW_MS = 60 * 1000;
export const RECEIPT_MAX_FAILS = 2;
export const RECEIPT_GRAPH_TIMEOUT_MS = 15 * 1000;
export const RECEIPT_BUCKET = "fb-receipts";
// Graph errors that prove nothing was delivered and are not this comment's fault (unknown /
// service errors, throttling, invalid token). They do not use up the comment: the claim is
// deleted like an upload failure. 190 → the seller must re-authorize; the rest → try later.
export const RECEIPT_RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 190, 613, 80001, 80006]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// base64 (optionally a data:image/png;base64, URL) → Buffer, only when it really is a PNG
// of at most maxBytes. Anything else → null.
export function decodeReceiptPng(input, maxBytes = RECEIPT_MAX_IMAGE_BYTES) {
  if (typeof input !== "string" || !input) return null;
  const b64 = input.replace(/^data:image\/png;base64,/, "").replace(/\s+/g, "");
  if (!b64 || b64.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.length < PNG_SIGNATURE.length || buf.length > maxBytes) return null;
  if (!buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  return buf;
}

// A row whose handle is empty or "unknown" (any case) is never a recipient.
const knownHandle = (h) => { const v = String(h ?? "").trim(); return v !== "" && v.toLowerCase() !== "unknown"; };

// More than one distinct non-empty platform_meta.commenter_id among a buyer number's Facebook
// rows = the number holds comments from different Facebook accounts → not sendable. Rows
// without commenter_id (older orders) do not count.
export function isMixedBuyer(orders) {
  const ids = new Set();
  for (const o of orders || []) {
    const meta = o && o.platform_meta && typeof o.platform_meta === "object" ? o.platform_meta : {};
    const id = typeof meta.commenter_id === "string" ? meta.commenter_id.trim() : "";
    if (id) ids.add(id);
  }
  return ids.size > 1;
}

// orders: [{ comment_msg_id, platform_meta, handle, created_at }]; rows: fb_receipts rows for those
// comment ids (any user). → candidates [{ commentId, pageId, createdAt, fails }]: no
// pending/sent row, fewer than RECEIPT_MAX_FAILS failed rows, a known handle; never-failed
// first, then newest.
export function pickReceiptCandidates(orders, rows) {
  const busy = new Set();
  const fails = new Map();
  for (const r of rows || []) {
    const id = String(r.comment_id || "");
    if (r.status === "failed") fails.set(id, (fails.get(id) || 0) + 1);
    else busy.add(id);
  }
  const seen = new Set();
  const out = [];
  for (const o of orders || []) {
    const commentId = String(o.comment_msg_id || "").trim();
    if (!commentId || seen.has(commentId) || !knownHandle(o.handle)) continue;
    seen.add(commentId);
    const f = fails.get(commentId) || 0;
    if (busy.has(commentId) || f >= RECEIPT_MAX_FAILS) continue;
    const meta = o.platform_meta && typeof o.platform_meta === "object" ? o.platform_meta : {};
    out.push({ commentId, pageId: String(meta.page_id || ""), liveVideoId: meta.live_video_id ? String(meta.live_video_id) : null, handle: o.handle ? String(o.handle) : null, createdAt: String(o.created_at || ""), fails: f });
  }
  out.sort((a, b) => (Math.min(a.fails, 1) - Math.min(b.fails, 1)) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return out;
}

// The verified request shape — exactly recipient + message, page token as access_token.
export function buildReceiptRequest({ pageId, commentId, imageUrl, pageToken }) {
  return {
    url: `${GRAPH_HOST}/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/messages?access_token=${encodeURIComponent(pageToken)}`,
    body: { recipient: { comment_id: commentId }, message: { attachment: { type: "image", payload: { url: imageUrl } } } },
  };
}

// Graph answer → sent (message_id) | failed (Graph error object) | unknown (anything else:
// delivery cannot be ruled out, so the comment must not be reused).
export function classifyReceiptAnswer(status, body) {
  const b = body && typeof body === "object" ? body : null;
  if (b && b.error && typeof b.error === "object") {
    return { kind: "failed", code: Number(b.error.code) || 0, subcode: Number(b.error.error_subcode) || 0 };
  }
  if (status === 200 && b && b.message_id) return { kind: "sent", messageId: String(b.message_id) };
  return { kind: "unknown" };
}

// Sliding-window per-user send limit. Returns { allowed, kept }.
export function checkReceiptRate(prev, nowMs, max = RECEIPT_SEND_RATE_MAX, windowMs = RECEIPT_SEND_RATE_WINDOW_MS) {
  const kept = (prev || []).filter((t) => nowMs - t < windowMs);
  if (kept.length >= max) return { allowed: false, kept };
  kept.push(nowMs);
  return { allowed: true, kept };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseTarget(body) {
  const sessionId = String(body?.sessionId || "").trim();
  const buyerNumber = Number(body?.buyerNumber);
  if (!UUID_RE.test(sessionId) || !Number.isInteger(buyerNumber) || buyerNumber <= 0) return null;
  return { sessionId, buyerNumber };
}

// ── Receipt picture cleanup: the bucket keeps a picture 24 hours (Messenger has copied it by
// then). Hourly, plus once ~1 minute after start. Pages of 100, at most 1000 per run. Never
// throws; one log line with the number deleted (no paths). fb_receipts rows are not touched.
export const RECEIPT_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const RECEIPT_CLEANUP_EVERY_MS = 60 * 60 * 1000;
export const RECEIPT_CLEANUP_FIRST_MS = 60 * 1000;
export const RECEIPT_CLEANUP_PAGE = 100;
export const RECEIPT_CLEANUP_MAX = 1000;

// store.listOldReceiptImages(beforeIso, limit) → [path] (oldest first);
// store.removeReceiptImages(paths) → number removed (throws on error).
export async function cleanupReceiptImages({ store, now = () => Date.now(), log = () => {} }) {
  let deleted = 0;
  try {
    const before = new Date(now() - RECEIPT_IMAGE_TTL_MS).toISOString();
    while (deleted < RECEIPT_CLEANUP_MAX) {
      const want = Math.min(RECEIPT_CLEANUP_PAGE, RECEIPT_CLEANUP_MAX - deleted);
      const paths = ((await store.listOldReceiptImages(before, want)) || []).slice(0, want);
      if (paths.length === 0) break;
      const removed = Number(await store.removeReceiptImages(paths)) || 0;
      deleted += removed;
      if (removed < paths.length || paths.length < want) break; // partial remove / last page → stop (no busy loop)
    }
  } catch { /* never throws — the next run tries again */ }
  log(`[FB] receipt images cleanup deleted=${deleted}`);
  return deleted;
}

// Starts the hourly cleanup (+ one run ~1 minute after start). Timers are unref'd; the
// returned stop() clears both.
export function startReceiptImageCleanup({ store, now = () => Date.now(), log = () => {}, setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (h) => clearInterval(h), setOnce = (fn, ms) => setTimeout(fn, ms), clearOnce = (h) => clearTimeout(h) }) {
  const run = () => { void cleanupReceiptImages({ store, now, log }); };
  const first = setOnce(run, RECEIPT_CLEANUP_FIRST_MS);
  const every = setTimer(run, RECEIPT_CLEANUP_EVERY_MS);
  for (const h of [first, every]) if (h && typeof h.unref === "function") h.unref();
  return function stop() { clearOnce(first); clearTimer(every); };
}

export function createFbReceipt(deps) {
  const {
    config, store, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {},
    randomHex = () => randomBytes(32).toString("hex"),
    makeJsonParser = (limit) => express.json({ limit }),
    graphTimeoutMs = RECEIPT_GRAPH_TIMEOUT_MS,
  } = deps;
  const sendAttempts = new Map(); // userId → timestamps (in memory; a restart clears it)
  const sending = new Set();      // user|session|buyer — one send at a time per buyer (in memory)

  async function gather(userId, sessionId, buyerNumber) {
    const since = new Date(now() - RECEIPT_WINDOW_MS).toISOString();
    const orders = await store.listReceiptOrders(userId, sessionId, buyerNumber, since);
    const ids = [...new Set((orders || []).map((o) => String(o.comment_msg_id || "").trim()).filter(Boolean))];
    const rows = ids.length ? await store.listReceiptRows(ids) : [];
    const mine = (rows || []).filter((r) => r.user_id === userId && r.status === "sent");
    const lastSentAt = mine.map((r) => String(r.sent_at || "")).filter(Boolean).sort().pop() || null;
    return { orders: orders || [], candidates: pickReceiptCandidates(orders, rows), mixed: isMixedBuyer(orders), sentCount: mine.length, lastSentAt };
  }

  // A page that can send: exists, active, can_message, token decrypts. Else null.
  async function sendablePage(userId, pageId) {
    if (!pageId) return null;
    let page = null;
    try { page = await store.getPage(userId, pageId); } catch { page = null; }
    if (!page || !page.active || page.can_message !== true) return null;
    const token = decryptToken(page.access_token, config.tokenKey);
    return token ? { pageId: String(page.page_id || pageId), token } : null;
  }

  async function info(userId, body) {
    if (!(await hasAccess(userId))) return { status: 200, json: { ok: true, canSend: false, reason: "no_access", sentCount: 0, lastSentAt: null, remaining: 0 } };
    const target = parseTarget(body);
    if (!target) return { status: 400, json: { ok: false, error: "bad_request" } };
    const g = await gather(userId, target.sessionId, target.buyerNumber);
    const base = { sentCount: g.sentCount, lastSentAt: g.lastSentAt, remaining: g.candidates.length };
    if (g.orders.length === 0) return { status: 200, json: { ok: true, canSend: false, reason: "no_orders", ...base } };
    if (g.mixed) return { status: 200, json: { ok: true, canSend: false, reason: "mixed_buyer", ...base } };
    if (g.candidates.length === 0) return { status: 200, json: { ok: true, canSend: false, reason: "none_left", ...base } };
    const page = await sendablePage(userId, g.candidates[0].pageId);
    if (!page) return { status: 200, json: { ok: true, canSend: false, reason: "needs_messaging", ...base } };
    return { status: 200, json: { ok: true, canSend: true, ...base } };
  }

  async function hasAccess(userId) {
    try { return typeof store.hasReceiptAccess === "function" && (await store.hasReceiptAccess(userId)) === true; } catch { return false; }
  }

  function logAttempt(userId, pageId, result, code = 0, subcode = 0) {
    log(`[FB] receipt user=${String(userId).slice(0, 8)} page=${pageId} result=${result} code=${code}/${subcode}`);
  }

  async function send(userId, body) {
    if (!(await hasAccess(userId))) return { status: 403, json: { ok: false, error: "no_access" } };
    const png = decodeReceiptPng(body?.imagePngBase64);
    if (!png) return { status: 400, json: { ok: false, error: "bad_image" } };
    const target = parseTarget(body);
    if (!target) return { status: 400, json: { ok: false, error: "bad_request" } };

    // One send at a time per buyer: a second tap while one is running is refused.
    const lockKey = `${userId}|${target.sessionId}|${target.buyerNumber}`;
    if (sending.has(lockKey)) return { status: 409, json: { ok: false, error: "busy" } };
    sending.add(lockKey);
    try {
      return await sendLocked(userId, target, png);
    } finally {
      sending.delete(lockKey);
    }
  }

  async function sendLocked(userId, target, png) {
    const g = await gather(userId, target.sessionId, target.buyerNumber);
    if (g.mixed) return { status: 409, json: { ok: false, error: "mixed_buyer" } };
    if (g.candidates.length === 0) return { status: 409, json: { ok: false, error: "none_left" } };

    // Claim the first candidate the database lets us have (page checked per candidate).
    const pages = new Map();
    let claim = null;
    for (const c of g.candidates) {
      if (!pages.has(c.pageId)) pages.set(c.pageId, await sendablePage(userId, c.pageId));
      const page = pages.get(c.pageId);
      if (!page) return { status: 409, json: { ok: false, error: "needs_messaging" } };
      const ins = await store.insertReceipt({
        user_id: userId, page_id: page.pageId, live_video_id: c.liveVideoId, session_id: target.sessionId,
        buyer_number: target.buyerNumber, handle: c.handle, comment_id: c.commentId, status: "pending",
      });
      if (ins && ins.conflict) continue;
      if (!ins || ins.error || ins.id == null) return { status: 500, json: { ok: false, error: "claim_failed" } };
      claim = { id: ins.id, commentId: c.commentId, page };
      break;
    }
    if (!claim) return { status: 409, json: { ok: false, error: "none_left" } };

    // Upload. If this fails nothing reached Facebook → delete the claim so the comment stays
    // usable (an upload failure must not count toward the failure cap). Only if the delete
    // itself fails is the claim marked failed ("upload/0") so it never blocks the comment.
    const imagePath = `${randomHex()}.png`;
    let imageUrl;
    try {
      imageUrl = await store.uploadReceiptImage(imagePath, png);
      if (!imageUrl) throw new Error("no_url");
    } catch {
      let deleted = false;
      try { deleted = (await store.deleteReceipt(claim.id, userId)) === true; } catch { deleted = false; }
      if (!deleted) await store.updateReceipt(claim.id, { status: "failed", error_code: "upload/0", image_path: imagePath });
      logAttempt(userId, claim.page.pageId, "failed", "upload", 0);
      return { status: 502, json: { ok: false, error: "upload_failed" } };
    }

    // ONE Graph call.
    const req = buildReceiptRequest({ pageId: claim.page.pageId, commentId: claim.commentId, imageUrl, pageToken: claim.page.token });
    let answer;
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), graphTimeoutMs) : null;
    try {
      const r = await fetchImpl(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body), ...(ac ? { signal: ac.signal } : {}) });
      const j = await r.json().catch(() => null);
      answer = classifyReceiptAnswer(r.status, j);
    } catch {
      answer = { kind: "unknown" };
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (answer.kind === "sent") {
      await store.updateReceipt(claim.id, { status: "sent", message_id: answer.messageId, sent_at: new Date(now()).toISOString(), image_path: imagePath });
      logAttempt(userId, claim.page.pageId, "sent");
      const after = await gather(userId, target.sessionId, target.buyerNumber);
      return { status: 200, json: { ok: true, sentCount: after.sentCount, remaining: after.candidates.length, lastSentAt: after.lastSentAt } };
    }
    if (answer.kind === "failed" && RECEIPT_RETRYABLE_CODES.has(answer.code)) {
      // Nothing was delivered and the comment is not at fault → give the comment back (same
      // path as an upload failure; only if the delete fails is the claim marked failed).
      let deleted = false;
      try { deleted = (await store.deleteReceipt(claim.id, userId)) === true; } catch { deleted = false; }
      if (!deleted) await store.updateReceipt(claim.id, { status: "failed", error_code: `${answer.code}/${answer.subcode}`, image_path: imagePath });
      logAttempt(userId, claim.page.pageId, "failed", answer.code, answer.subcode);
      return { status: 502, json: { ok: false, error: answer.code === 190 ? "needs_reauth" : "try_later", code: answer.code } };
    }
    if (answer.kind === "failed") {
      await store.updateReceipt(claim.id, { status: "failed", error_code: `${answer.code}/${answer.subcode}`, image_path: imagePath });
      logAttempt(userId, claim.page.pageId, "failed", answer.code, answer.subcode);
      return { status: 502, json: { ok: false, error: "send_failed", code: answer.code } };
    }
    // Delivery unknown: leave the row 'pending' so this comment is never reused.
    await store.updateReceipt(claim.id, { image_path: imagePath });
    logAttempt(userId, claim.page.pageId, "unknown");
    return { status: 502, json: { ok: false, error: "unknown_result" } };
  }

  // Access BEFORE the rate limit and the 6mb parser: an account without fb_receipt_access is
  // refused with nothing parsed and no rate-limit entry. send() checks access again.
  async function sendAccessGate(req, res, next) {
    if (!(await hasAccess(req.authUserId))) return res.status(403).json({ ok: false, error: "no_access" });
    return next();
  }

  function sendRateLimit(req, res, next) {
    const uid = req.authUserId;
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthorized" });
    const { allowed, kept } = checkReceiptRate(sendAttempts.get(uid), now());
    sendAttempts.set(uid, kept);
    if (!allowed) return res.status(429).json({ ok: false, error: "too_many_requests" });
    return next();
  }

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req.authUserId, req.body || {});
      return res.status(out.status).json(out.json);
    } catch {
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  };

  function registerRoutes(app, requireAuth) {
    app.post("/fb/receipt/info", requireAuth, wrap(info));
    // auth → access → rate limit → the raised-limit parser (the global parser skips this path).
    app.post("/fb/receipt/send", requireAuth, sendAccessGate, sendRateLimit, makeJsonParser(RECEIPT_BODY_LIMIT), wrap(send));
  }

  return { info, send, registerRoutes, sendAccessGate, sendRateLimit, _sendAttempts: sendAttempts, _sending: sending };
}
