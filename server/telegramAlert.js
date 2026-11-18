// Telegram alerts to the Admin (Jeff 2026-11-18). ONE small job: send one FIXED text with one HTTPS POST to
// api.telegram.org (8 s limit).
//   • Env TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (set on Render). Missing either = alerts off; nothing else changes.
//   • Messages are fixed texts chosen by a key (ALERT_TEXTS). Never a phone, name, store number, tracking
//     number, cookie or token — send() has no way to take free text.
//   • A failed send is logged with ONE word and resolves { ok: false, word }; send() never throws.
//   • The token is never logged: the URL, the request and any error text never reach a log line.
export const TELEGRAM_SEND_MS = 8000;
export const TELEGRAM_HOST = "api.telegram.org";
export const ALERT_TEXTS = {
  logged_out: "7-11 server logged out. Log in from Admin.",
  logged_in: "7-11 server is logged in again.",
  test: "SellerFlowLive test alert. Alerts are working.",
};
const TAG = "[TG_ALERT]";
// A bot token is "<digits>:<letters, digits, _ or ->"; a chat id is a number (groups are negative) or @name.
const TOKEN_RE = /^\d{3,20}:[A-Za-z0-9_-]{10,100}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{3,64})$/;

// opts: env, fetchImpl, log.
export function createTelegramAlert({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const token = String(env?.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chat = String(env?.TELEGRAM_CHAT_ID ?? "").trim();
  // off: one is missing. bad_format: both are set but one does not look like a Telegram value.
  const why = !token || !chat ? "off" : !TOKEN_RE.test(token) ? "bad_token_format" : !CHAT_RE.test(chat) ? "bad_chat_format" : "";
  const enabled = why === "";
  const say = (line) => { try { log(`${TAG} ${line}`); } catch { /* a log never stops anything */ } };

  /** Send the fixed text of `kind`. → { ok: true } | { ok: false, word }. Never throws. */
  async function send(kind) {
    const text = Object.prototype.hasOwnProperty.call(ALERT_TEXTS, kind) ? ALERT_TEXTS[kind] : "";
    if (!text) return { ok: false, word: "unknown_text" };
    if (!enabled) return { ok: false, word: why };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TELEGRAM_SEND_MS);
    let word = "";
    try {
      const r = await fetchImpl(`https://${TELEGRAM_HOST}/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        redirect: "error", signal: ctl.signal,
      });
      const status = Number(r && r.status) || 0;
      if (status < 200 || status >= 300) word = `http_${status}`;
      else {
        let j = null;
        try { j = await r.json(); } catch { j = null; }
        if (!j || j.ok !== true) word = "not_ok";
      }
    } catch (e) {
      word = e?.name === "AbortError" || ctl.signal.aborted ? "timeout" : "network";
    } finally { clearTimeout(timer); }
    if (word) { say(`send failed ${word}`); return { ok: false, word }; }
    return { ok: true };
  }

  return {
    enabled: () => enabled,
    /** one word for the boot log: on | off | bad_token_format | bad_chat_format */
    stateWord: () => (enabled ? "on" : why),
    send,
    /** Fire and forget: never awaited by the caller, never throws, never slows the checker. */
    fire(kind) { try { void send(kind).catch(() => {}); } catch { /* nothing */ } },
  };
}

// POST /admin/pc711/alert-test (server.js mounts it behind requireAuth + requireAdmin).
// → 200 { sent: true } | 200 { sent: false, reason: <one word> } | 429 { sent: false, reason: "rate_limited" }
export function createAlertTestHandler({ alert, allowed }) {
  return async function alertTestHandler(req, res) {
    if (typeof allowed === "function" && !allowed(req.authUserId)) return res.status(429).json({ sent: false, reason: "rate_limited" });
    let r;
    try { r = await alert.send("test"); } catch { r = { ok: false, word: "error" }; }
    return res.json(r && r.ok ? { sent: true } : { sent: false, reason: String((r && r.word) || "error") });
  };
}
