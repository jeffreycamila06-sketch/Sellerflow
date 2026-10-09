// FACEBOOK SOLD-OUT MESSAGE (F2) — one Messenger private reply, TEXT, to a Facebook buyer whose
// comment hit an Auto-mode code that is already sold out. Same request shape as the receipt
// (POST /{page-id}/messages, recipient = { comment_id }), message = { text } instead of an image.
//
// Gates (all must pass): the app_settings switch fb_soldout_enabled (cached reader), the seller's
// fb_receipt_access row, the seller's own toggle (seller_receipt_settings.soldout_enabled), a
// sendable page OWNED by the seller (store.getPage(user, page)), and the comment really came from
// one of THIS seller's running pollers on that page (fbLive wasEmitted — read-only).
// One reply per comment: the claim is an fb_receipts row (kind 'soldout'); the existing unique
// index on fb_receipts(comment_id) where status <> 'failed' refuses a second one (receipt or
// sold-out) at the database. Errors never touch the page row and never the poller.
import { GRAPH_VERSION } from "./fbConfig.js";
import { GRAPH_HOST } from "./fbLive.js";
import { withAppSecretProof, isFbCommentId } from "./fbHardening.js";
import { classifyReceiptAnswer, checkReceiptRate, makeSendablePage, updateSentReceipt, RECEIPT_RETRYABLE_CODES, RECEIPT_GRAPH_TIMEOUT_MS } from "./fbReceipt.js";

export const SOLDOUT_RATE_MAX = 30;                 // its own bucket (separate from receipts)
export const SOLDOUT_RATE_WINDOW_MS = 60 * 1000;
export const SOLDOUT_TEXT_MAX = 1000;
export const SOLDOUT_LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];

// Built-in texts (the client shows the same ones as the placeholder — pinned by a test).
// Languages without their own text use English.
export const SOLDOUT_DEFAULTS = {
  en: { plain: "Sorry, {code} is already sold out. Thank you for your interest!", pos: "Sorry, {code} is already sold out. You are #{position} on the waitlist." },
  fil: { plain: "Pasensya na, sold out na ang {code}. Salamat sa interes!", pos: "Pasensya na, sold out na ang {code}. Ikaw ay #{position} sa waitlist." },
  zh: { plain: "抱歉，{code} 已经售完了。谢谢您的支持！", pos: "抱歉，{code} 已经售完了。您是候补名单第 {position} 位。" },
  "zh-TW": { plain: "抱歉，{code} 已經售完了。謝謝您的支持！", pos: "抱歉，{code} 已經售完了。您是候補名單第 {position} 位。" },
};

// The text sent: the seller's own (trimmed, non-empty) or the built-in default for the language.
// {code} → the code. {position} → the waitlist position when there is one; without one the
// placeholder (and a "#" right before it) is removed. Whitespace collapsed, max SOLDOUT_TEXT_MAX.
export function soldoutText({ custom, lang, code, position }) {
  const pos = Number.isInteger(position) && position > 0 ? position : null;
  const own = typeof custom === "string" ? custom.trim() : "";
  const d = SOLDOUT_DEFAULTS[lang] || SOLDOUT_DEFAULTS.en;
  let t = own || (pos ? d.pos : d.plain);
  t = t.split("{code}").join(String(code || ""));
  t = pos ? t.split("{position}").join(String(pos)) : t.replace(/#?\{position\}/g, "");
  return t.replace(/[ \t]+/g, " ").replace(/ +([.,!?。，！？])/g, "$1").trim().slice(0, SOLDOUT_TEXT_MAX);
}

export function buildSoldoutRequest({ pageId, commentId, text, pageToken }) {
  return {
    url: `${GRAPH_HOST}/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/messages?access_token=${encodeURIComponent(pageToken)}`,
    body: { recipient: { comment_id: commentId }, message: { text } },
  };
}

// { pageId, commentId, code, lang?, position? } → validated, or null.
export function parseSoldoutBody(body) {
  const pageId = String(body?.pageId ?? "").trim();
  const commentId = String(body?.commentId ?? "").trim();
  const code = String(body?.code ?? "").trim();
  if (!/^\d{1,40}$/.test(pageId) || !isFbCommentId(commentId) || !code || code.length > 40) return null;
  const lang = SOLDOUT_LANGS.includes(String(body?.lang)) ? String(body.lang) : "en";
  const p = Number(body?.position);
  const position = Number.isInteger(p) && p >= 1 && p <= 9999 ? p : null;
  return { pageId, commentId, code, lang, position };
}

export function createFbSoldout(deps) {
  const {
    config, store, soldoutEnabled, isOwnedComment,
    fetchImpl: rawFetch = globalThis.fetch, now = () => Date.now(), log = () => {},
    graphTimeoutMs = RECEIPT_GRAPH_TIMEOUT_MS,
  } = deps;
  const fetchImpl = withAppSecretProof(rawFetch, config && config.appSecret); // Build 8: appsecret_proof
  const sendablePage = makeSendablePage(store, config);
  const attempts = new Map(); // userId → timestamps (in memory)

  const flagOn = async () => { try { return (await soldoutEnabled()) === true; } catch { return false; } };
  const hasAccess = async (userId) => { try { return typeof store.hasReceiptAccess === "function" && (await store.hasReceiptAccess(userId)) === true; } catch { return false; } };
  const logAttempt = (userId, pageId, result, code = 0, subcode = 0, detail = "") =>
    log(`[FB] soldout user=${String(userId).slice(0, 8)} page=${pageId} result=${result} code=${code}/${subcode}${detail ? ` detail=${detail}` : ""}`);

  async function updateFailed(id, patch, detail) {
    if (!detail) return store.updateReceipt(id, patch);
    let r;
    try { r = await store.updateReceipt(id, { ...patch, error_detail: detail }); } catch (e) { r = { error: e }; }
    if (r && r.error) return store.updateReceipt(id, patch);
    return r;
  }

  async function send(userId, body) {
    if (!(await flagOn())) return { status: 403, json: { ok: false, error: "disabled" } };
    if (!(await hasAccess(userId))) return { status: 403, json: { ok: false, error: "no_access" } };
    const b = parseSoldoutBody(body);
    if (!b) return { status: 400, json: { ok: false, error: "bad_request" } };
    let settings = null;
    try { settings = await store.getSoldoutSettings(userId); } catch { settings = null; }
    if (!settings || settings.enabled !== true) return { status: 409, json: { ok: false, error: "seller_off" } };
    const page = await sendablePage(userId, b.pageId);
    if (!page) return { status: 409, json: { ok: false, error: "needs_messaging" } };
    let owned = false;
    try { owned = isOwnedComment(userId, b.commentId, b.pageId) === true; } catch { owned = false; }
    if (!owned) return { status: 403, json: { ok: false, error: "not_owned" } };

    const ins = await store.insertReceipt({ user_id: userId, page_id: page.pageId, comment_id: b.commentId, status: "pending", kind: "soldout" });
    if (ins && ins.conflict) return { status: 409, json: { ok: false, error: "already_replied" } };
    if (!ins || ins.error || ins.id == null) return { status: 500, json: { ok: false, error: "claim_failed" } };

    const text = soldoutText({ custom: settings.text, lang: b.lang, code: b.code, position: b.position });
    const req = buildSoldoutRequest({ pageId: page.pageId, commentId: b.commentId, text, pageToken: page.token });
    let answer;
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), graphTimeoutMs) : null;
    try {
      const r = await fetchImpl(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body), ...(ac ? { signal: ac.signal } : {}) });
      const j = await r.json().catch(() => null);
      answer = classifyReceiptAnswer(r.status, j, page.token);
    } catch {
      answer = { kind: "unknown" };
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (answer.kind === "sent") {
      await updateSentReceipt(store, ins.id, { status: "sent", message_id: answer.messageId, sent_at: new Date(now()).toISOString() }, answer.recipientId);
      logAttempt(userId, page.pageId, "sent");
      return { status: 200, json: { ok: true } };
    }
    if (answer.kind === "failed" && RECEIPT_RETRYABLE_CODES.has(answer.code)) {
      // nothing delivered, not this comment's fault → give the comment back
      let deleted = false;
      try { deleted = (await store.deleteReceipt(ins.id, userId)) === true; } catch { deleted = false; }
      if (!deleted) await updateFailed(ins.id, { status: "failed", error_code: `${answer.code}/${answer.subcode}` }, answer.detail);
      logAttempt(userId, page.pageId, "failed", answer.code, answer.subcode, answer.detail);
      return { status: 502, json: { ok: false, error: answer.code === 190 ? "needs_reauth" : "try_later" } };
    }
    if (answer.kind === "failed") {
      await updateFailed(ins.id, { status: "failed", error_code: `${answer.code}/${answer.subcode}` }, answer.detail);
      logAttempt(userId, page.pageId, "failed", answer.code, answer.subcode, answer.detail);
      return { status: 502, json: { ok: false, error: "send_failed" } };
    }
    logAttempt(userId, page.pageId, "unknown"); // row stays 'pending' → this comment is never reused
    return { status: 502, json: { ok: false, error: "unknown_result" } };
  }

  // switch → access → rate limit (nothing counted for a refused account)
  async function gate(req, res, next) {
    if (!(await flagOn())) return res.status(403).json({ ok: false, error: "disabled" });
    if (!(await hasAccess(req.authUserId))) return res.status(403).json({ ok: false, error: "no_access" });
    return next();
  }
  function rateLimit(req, res, next) {
    const uid = req.authUserId;
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthorized" });
    const { allowed, kept } = checkReceiptRate(attempts.get(uid), now(), SOLDOUT_RATE_MAX, SOLDOUT_RATE_WINDOW_MS);
    attempts.set(uid, kept);
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
    app.post("/fb/soldout/send", requireAuth, gate, rateLimit, wrap(send));
  }

  return { send, gate, rateLimit, registerRoutes, _attempts: attempts };
}
