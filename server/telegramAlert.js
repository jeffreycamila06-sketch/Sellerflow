// Telegram alerts to the Admin (Jeff 2026-11-18). ONE small job: send one FIXED text with one HTTPS POST to
// api.telegram.org (20 s limit — the same for every send: the test button and each try of an alert).
//   • Env TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (set on Render). Missing either = alerts off; nothing else changes.
//   • Messages are fixed texts chosen by a key (ALERT_TEXTS). Never a phone, name, store number, tracking
//     number, cookie or token — send() has no way to take free text.
//   • ONE text carries a value after it: "new_version" + the 7-character commit the server started on
//     (ALERT_VALUE_SHAPES: 7 characters 0-9 a-f, nothing else passes). Every other text takes no value.
//   • A failed send is logged with ONE word and resolves { ok: false, word }; send() never throws.
//   • An alert (fire / deliver) gets up to 3 tries. The test button (send) is ONE try with the 20 s limit.
//   • NO SECOND COPY OF A DELIVERED ALERT (Jeff 2026-11-19). A try of an alert is not cut at 20 s: its
//     request is kept until the next try is due (20 s + 1 minute after it was sent). A late "ok" inside
//     that time means delivered and ends the tries. The next try goes out only when Telegram answered
//     with an error or the connection broke (1 minute later, as before), or nothing at all came back by
//     the time it was due (then at once). A try that truly failed still gets all 3 tries.
//   • The 2nd and 3rd try end with " (sent again)", so a copy that does arrive twice is recognisable.
//     What cannot be excluded: delivered, and the answer never arrives at all — Telegram has no way to
//     mark a message as "the same as before".
//   • Alerts go out one after another, in the order they happened.
//   • The token is never logged: the URL, the request and any error text never reach a log line.
// How long ONE send waits for Telegram's answer. 8 s until 2026-11-19: the first send after a server
// restart was delivered, but its answer came later than 8 s and the Admin panel said "Not sent".
export const TELEGRAM_SEND_MS = 20000;
export const TELEGRAM_HOST = "api.telegram.org";
export const ALERT_TRIES = 3;              // an alert: up to 3 tries …
export const ALERT_RETRY_MS = 60 * 1000;   // … 1 minute apart
// How long ONE try of an alert is kept after it was sent = the time its next try is due when nothing
// comes back. Until then a late "ok" still counts as delivered; the request is ended only then.
export const ALERT_KEEP_MS = TELEGRAM_SEND_MS + ALERT_RETRY_MS;
export const ALERT_AGAIN = " (sent again)";   // the end of the 2nd and 3rd try's text
export const ALERT_QUEUE_MAX = 20;         // alerts waiting for their turn; one more is dropped (logged)
export const ALERT_TEXTS = {
  logged_out: "7-11 server logged out. Log in from Admin.",
  logged_in: "7-11 server is logged in again.",
  test: "SellerFlowLive test alert. Alerts are working.",
  // the backup checker (server/pc711Backup.js, sql/179)
  took_over: "Lenovo stopped. The server is checking now.",
  took_over_logged_out: "Lenovo stopped. The server is checking now, but it is logged out of 7-11. Log in from Admin.",
  handed_back: "Lenovo is back. The server is a follower again.",
  // the server started on a commit it had not announced yet (server/versionAlert.js) + that commit
  new_version: "Server restarted on a new version.",
};
// The texts that carry ONE value after them, and the only shape that value may have. Never free text.
export const ALERT_VALUE_SHAPES = { new_version: /^[0-9a-f]{7}$/ };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
/** PURE — the whole message for `kind`, or "" when the key is not ours or its value has the wrong shape. */
export function alertText(kind, value) {
  if (typeof kind !== "string" || !own(ALERT_TEXTS, kind)) return "";
  if (!own(ALERT_VALUE_SHAPES, kind)) return ALERT_TEXTS[kind];   // no value: whatever was passed is never read
  return typeof value === "string" && ALERT_VALUE_SHAPES[kind].test(value) ? `${ALERT_TEXTS[kind]} ${value}` : "";
}
const TAG = "[TG_ALERT]";
// A bot token is "<digits>:<letters, digits, _ or ->"; a chat id is a number (groups are negative) or @name.
const TOKEN_RE = /^\d{3,20}:[A-Za-z0-9_-]{10,100}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{3,64})$/;

const unref = (t) => { if (t && typeof t.unref === "function") t.unref(); return t; };   // a waiting timer never keeps the server alive
const waitUnref = (ms) => new Promise((resolve) => { unref(setTimeout(resolve, ms)); });

// opts: env, fetchImpl, log, sleep (the wait between tries; tests pass their own).
export function createTelegramAlert({ env = process.env, fetchImpl = fetch, log = console.log, sleep = waitUnref } = {}) {
  const token = String(env?.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chat = String(env?.TELEGRAM_CHAT_ID ?? "").trim();
  // off: one is missing. bad_format: both are set but one does not look like a Telegram value.
  const why = !token || !chat ? "off" : !TOKEN_RE.test(token) ? "bad_token_format" : !CHAT_RE.test(chat) ? "bad_chat_format" : "";
  const enabled = why === "";
  const say = (line) => { try { log(`${TAG} ${line}`); } catch { /* a log never stops anything */ } };

  // ONE request to Telegram with one finished text. `answer` resolves "" (Telegram said ok) or ONE word and
  // never rejects; stop() ends our side of the request (its answer is then "timeout").
  function post(text) {
    const ctl = new AbortController();
    const answer = (async () => {
      try {
        const r = await fetchImpl(`https://${TELEGRAM_HOST}/bot${token}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
          redirect: "error", signal: ctl.signal,
        });
        const status = Number(r && r.status) || 0;
        if (status < 200 || status >= 300) return `http_${status}`;
        let j = null;
        try { j = await r.json(); } catch { j = null; }
        return !j || j.ok !== true ? "not_ok" : "";
      } catch (e) {
        return e?.name === "AbortError" || ctl.signal.aborted ? "timeout" : "network";
      }
    })();
    return { answer, stop: () => ctl.abort() };
  }

  /** Send the fixed text of `kind` (+ its value, for the one text that has one) ONCE, with the 20 s limit.
   *  → { ok: true } | { ok: false, word }. Never throws. (The Admin test button.) */
  async function send(kind, value) {
    const text = alertText(kind, value);
    if (!text) return { ok: false, word: "unknown_text" };
    if (!enabled) return { ok: false, word: why };
    const req = post(text);
    const timer = setTimeout(req.stop, TELEGRAM_SEND_MS);
    const word = await req.answer;
    clearTimeout(timer);
    if (word) { say(`send failed ${word}`); return { ok: false, word }; }
    return { ok: true };
  }

  // One ALERT: up to ALERT_TRIES sends. Each failed try = one log word; a try that is slow but answered "ok"
  // = delivered (one line says it was late). See the header for when the next try goes out.
  async function tryAll(kind, value) {
    const text = alertText(kind, value);
    if (!text) return { ok: false, word: "unknown_text" };
    if (!enabled) return { ok: false, word: why };
    let word = "error";
    for (let n = 1; n <= ALERT_TRIES; n++) {
      const sentAt = Date.now();
      const req = post(n === 1 ? text : text + ALERT_AGAIN);
      let slow = false, gaveUp = false;
      // 20 s: nothing yet — NOT sent again, the same request is kept
      const slowTimer = unref(setTimeout(() => { slow = true; say(`no answer yet try=${n}, still waiting`); }, TELEGRAM_SEND_MS));
      // the next try is due and nothing came back: this request is ended
      const keepTimer = unref(setTimeout(() => { gaveUp = true; req.stop(); }, ALERT_KEEP_MS));
      word = await req.answer;
      clearTimeout(slowTimer); clearTimeout(keepTimer);
      if (!word) {
        if (slow) say(`late ok try=${n} after=${Math.round((Date.now() - sentAt) / 1000)}s`);
        return { ok: true };
      }
      say(`send failed ${word}`);
      // an error answer / a broken connection: the next try a minute later. Nothing came back: it is due now.
      if (n < ALERT_TRIES && !gaveUp) await sleep(ALERT_RETRY_MS);
    }
    return { ok: false, word };
  }
  let chain = Promise.resolve();   // alerts go out one after another, in order
  let waiting = 0;
  /** An alert with its retries, after the alerts queued before it. Resolves { ok } | { ok: false, word }; never throws. */
  function deliver(kind, value) {
    if (waiting >= ALERT_QUEUE_MAX) { say("send failed queue_full"); return Promise.resolve({ ok: false, word: "queue_full" }); }
    waiting += 1;
    const mine = chain.then(() => tryAll(kind, value)).catch(() => ({ ok: false, word: "error" })).finally(() => { waiting -= 1; });
    chain = mine.then(() => {}, () => {});
    return mine;
  }

  return {
    enabled: () => enabled,
    /** one word for the boot log: on | off | bad_token_format | bad_chat_format */
    stateWord: () => (enabled ? "on" : why),
    /** ONE try, answers at once (the Admin test button). */
    send,
    deliver,
    /** Fire and forget (with the retries): never awaited by the caller, never throws, never slows the checker. */
    fire(kind, value) { try { void deliver(kind, value).catch(() => {}); } catch { /* nothing */ } },
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
