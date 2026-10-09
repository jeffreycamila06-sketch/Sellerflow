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
import { createHash, createHmac } from "node:crypto";
import express from "express";
import { GRAPH_VERSION } from "./fbConfig.js";
import { fbToPayload } from "./fbComment.js";
import { withAppSecretProof, maskSecretText, makeRateGate, ipOf, parseSignedRequest } from "./fbHardening.js";
import { encryptToken, decryptToken, isExpiringSoon } from "./fbTokens.js";
import { maxAccountsForPlan } from "./accountCap.js";
import { fbPreviewEmail } from "./fbAccess.js";

export const GRAPH_HOST = "https://graph.facebook.com";
export const FB_DIALOG_HOST = "https://www.facebook.com";
export const APP_REDIRECT_URL = "https://www.sellerflowlive.com"; // where the callback bounces the browser back to
// App flows (started from the phone app's sign-in sheet) end on this custom-scheme URL: the
// sheet (iOS ASWebAuthenticationSession / Android Custom Tab + intent filter) catches it and
// closes. Carries ONLY ?fb=connected | ?fb=error&code=<reason> — never a code, state or token.
export const APP_AUTH_SCHEME = "com.sellerflow.live";
export const APP_AUTH_CALLBACK = `${APP_AUTH_SCHEME}://fb-auth`;
export const OAUTH_SCOPE = "pages_show_list,pages_read_engagement,pages_read_user_content";
export const POLL_ACTIVE_MS = 2000;   // cadence while comments are flowing
export const POLL_QUIET_MS = 5000;    // cadence when a poll returned nothing new
export const POLL_RATE_LIMIT_MS = 30 * 1000; // wait after a rate-limited comments poll
export const COMMENTS_PAGE_LIMIT = 100; // comments per poll request
export const MAX_COMMENT_PAGES = 3;     // fb_comment_paging: extra pages per tick at most (<= 400 comments)
export const GRAPH_TIMEOUT_MS = 10 * 1000; // every Graph GET gives up after this
export const MAX_AUTH_FAILURES = 3;   // consecutive auth failures → mark inactive + stop
export const MAX_FETCH_ERRORS = 3;    // consecutive hard comments-fetch errors → confirm-via-live-status then stop (fetch_error, NOT a session_end guess)
export const STATE_TTL_MS = 10 * 60 * 1000; // OAuth state nonce validity
export const REFRESH_SCAN_MS = 60 * 60 * 1000; // token re-validation timer cadence (page tokens live ~60d)
export const IDLE_STOP_MS = 10 * 60 * 1000; // F2: check the live status after this long with no NEW comments
// fb_stop_reasons (switch ON): every LIVE_RECHECK_MS ask Facebook whether the live is still on,
// whatever the comment activity (replay comments keep the idle clock fresh for hours).
export const LIVE_RECHECK_MS = 5 * 60 * 1000;
export const IDLE_RECHECK_MS = 60 * 1000;   // unreadable live status at the idle limit → ask again after this
export const MAX_IDLE_UNREADABLE = 3;       // unreadable checks in a row at the idle limit → stop(idle)
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // F2: hard ceiling
export const TOKEN_REREAD_MARGIN_MS = 10 * 60 * 1000; // F4: re-read the cached token this long before it expires
export const EMITTED_CAP = 1000;      // per-poller bounded set of emitted comment ids (fb_comment_paging: a 400-comment tick must stay inside it)
export const LONG_LIVED_USER_TTL_SEC = 60 * 24 * 60 * 60; // ~60d default when expires_in absent
export const FB_AUTH_ERROR_CODE = 190; // Graph OAuthException (invalid/expired/revoked token)
// Graph "(#200) Missing Permissions" on the live-comments edge = a FEATURE GATE (the app's
// Live Video API feature is not approved yet), NOT a bad token — the same token still
// reads /me/accounts + /{page}/live_videos. Arrives as HTTP 403, so it MUST be classified
// before the generic 401/403 → auth rule, else it deactivates a perfectly valid page.
export const FB_FEATURE_GATE_CODE = 200;
// Graph throttling codes (app / user / page / custom limits). HTTP 429 counts too.
export const FB_RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80006]);

// ── OAuth state nonce (bind the page authorization to the RIGHT seller) ──────
// Identical construction to shopeeLive.signState — state = base64url(userId).exp.HMAC.
// verifyState returns the userId only when the signature matches AND it has not
// expired, so a page can never be bound to a different seller by tampering.
// app = the flow was started from the phone app (the in-app sign-in sheet): a segment "a"
// INSIDE the HMAC'd body, so nobody can switch a flow between web and app. lang = the seller's
// app language ("l<code>", one of CONFIRM_LANGS) for the confirm page. Without app / lang the
// state keeps the exact 3-part format (byte-identical to before).
export const CONFIRM_LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
export const confirmLangOf = (v) => (CONFIRM_LANGS.includes(String(v || "")) ? String(v) : "");
// kind (Build 8) = which app flow minted the state: "fb" (default) or "ig", as "k<kind>" INSIDE the
// HMAC'd body; each callback accepts only its own kind (verifyStateDetail's expectKind).
export const STATE_KINDS = ["fb", "ig"];
export function signState({ userId, key, nowMs = Date.now(), ttlMs = STATE_TTL_MS, app = false, lang = "", kind = "fb" }) {
  const exp = nowMs + ttlMs;
  const l = confirmLangOf(lang);
  const k = STATE_KINDS.includes(kind) ? kind : "fb";
  const body = `${Buffer.from(String(userId)).toString("base64url")}.${exp}${app ? ".a" : ""}${l ? `.l${l}` : ""}.k${k}`;
  const mac = createHmac("sha256", String(key)).update(body).digest("hex");
  return `${body}.${mac}`;
}
// → { userId, app, lang } when the signature matches and the state has not expired, else null.
// Between the expiry and the signature: at most one "a", one "l<lang>", one "k<kind>", in that
// order. expectKind given → a state of another kind, or with no kind, is null (bad_state).
export function verifyStateDetail(state, key, nowMs = Date.now(), expectKind = null) {
  const parts = String(state || "").split(".");
  if (parts.length < 3 || parts.length > 6) return null;
  const extra = parts.slice(2, -1);
  let app = false, lang = "", kind = "", i = 0;
  if (extra[i] === "a") { app = true; i++; }
  if (i < extra.length && extra[i].startsWith("l") && confirmLangOf(extra[i].slice(1))) { lang = extra[i].slice(1); i++; }
  if (i < extra.length && extra[i].startsWith("k") && STATE_KINDS.includes(extra[i].slice(1))) { kind = extra[i].slice(1); i++; }
  if (i !== extra.length) return null;
  if (expectKind && kind !== expectKind) return null;
  const mac = parts[parts.length - 1];
  const body = parts.slice(0, -1).join(".");
  const [uidB64, expStr] = parts;
  const expect = createHmac("sha256", String(key)).update(body).digest("hex");
  if (mac.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowMs) return null; // expired
  let userId = null;
  try { userId = Buffer.from(uidB64, "base64url").toString("utf8") || null; } catch { userId = null; }
  return userId ? { userId, app, ...(lang ? { lang } : {}) } : null;
}
export function verifyState(state, key, nowMs = Date.now()) {
  const d = verifyStateDetail(state, key, nowMs);
  return d ? d.userId : null;
}

// ── OAuth confirm page (the person finishing the flow sees which account gets the Page) ──
// The state names the seller who STARTED the flow, so an Authorize link sent to another Page
// admin would save that person's Page under the sender's account. The callback therefore
// shows the receiving SellerFlowLive account and only a POST from this page saves anything.
export const COMPLETE_FORM_LIMIT = "8kb";
export const COMPLETE_REMEMBER_MS = 10 * 60 * 1000; // a finished connected / cap answer is repeated this long
export const COMPLETE_REMEMBER_MAX = 500;           // remembered answers kept (oldest dropped)
export const EXCHANGE_KEEP_MS = STATE_TTL_MS;       // a code's exchange answer is kept this long (confirm page → Connect)
export const EXCHANGE_KEEP_MAX = 500;
// Build 8: per-IP gates on the two routes a browser / Meta reach without a SellerFlowLive login.
export const COMPLETE_RATE_MAX = 30;      // POST /fb/oauth/complete per IP per minute
export const DEAUTH_RATE_MAX = 60;        // POST /fb/deauthorize per IP per minute
export const DEAUTH_MAX_AGE_S = 60 * 60;  // a signed_request older than this is refused (replay)
export const DEAUTH_SEEN_MAX = 2000;      // processed signatures remembered (a replay does nothing)
// fb=connected with Pages left out by the plan: saved=<n>&dropped=<m>&kept=<names>&names=<names>,
// at most PARTIAL_NAMES_MAX names each (cut to 60 characters), URL-encoded.
export const PARTIAL_NAMES_MAX = 3;
export function partialSaveQuery(kept, dropped) {
  const list = (a) => a.slice(0, PARTIAL_NAMES_MAX).map((n) => String(n || "").slice(0, 60)).join("\n");
  const q = new URLSearchParams({ saved: String(kept.length), dropped: String(dropped.length), kept: list(kept), names: list(dropped) });
  return q.toString();
}
export const CONFIRM_PAGE_HEADERS_BASE = { "Cache-Control": "no-store", "X-Frame-Options": "DENY" };

export function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c]);
}

// first 2 characters + "•••" + the last character before "@" + the full domain; a 1–3 character
// local part shows only its first character + "•••". No "@" → the same rule on the whole value.
export function maskEmail(email) {
  const e = String(email || "").trim();
  const at = e.lastIndexOf("@");
  const local = at >= 0 ? e.slice(0, at) : e;
  const domain = at >= 0 ? e.slice(at) : "";
  const chars = [...local];
  if (chars.length === 0) return `•••${domain}`;
  const masked = chars.length <= 3 ? `${chars[0]}•••` : `${chars.slice(0, 2).join("")}•••${chars[chars.length - 1]}`;
  return masked + domain;
}

// The one inline script on the confirm page: the first submit disables the button and shows
// its data-busy text ("Connecting…" in the page's language); any further submit is ignored.
// Allowed in the CSP by its sha256 hash only (one script for every language).
// Without scripts the page still works — /fb/oauth/complete answers repeats the same way.
export const CONFIRM_SCRIPT = 'var f=document.getElementById("c"),s=false;f.addEventListener("submit",function(e){if(s){e.preventDefault();return;}s=true;var b=f.querySelector("button");b.disabled=true;b.textContent=b.getAttribute("data-busy");});';
export const CONFIRM_SCRIPT_HASH = `sha256-${createHash("sha256").update(CONFIRM_SCRIPT, "utf8").digest("base64")}`;

// The form posts back to this server; after the POST the browser is redirected (303) to the
// app, and browsers apply form-action to that redirect too — so the app origin is allowed.
// App flows also allow the app's callback scheme (the 303 after "Connect" goes there); web
// flows keep exactly today's policy.
export function confirmPageCsp(appUrl, { app = false } = {}) {
  let appOrigin = "";
  try { appOrigin = new URL(appUrl).origin; } catch { appOrigin = ""; }
  return `default-src 'none'; script-src '${CONFIRM_SCRIPT_HASH}'; style-src 'unsafe-inline'; form-action 'self'${appOrigin ? ` ${appOrigin}` : ""}${app ? ` ${APP_AUTH_SCHEME}:` : ""}`;
}

// labels (optional, Instagram reuses this page with its own title/lead/action/param). The
// Facebook page is in the language from the signed state (FB_CONFIRM_TEXT, English fallback).
// The store name is the receiving account's OWN text, so it is shown only under a label that
// says so — never as a headline (an Authorize link sent to another Page admin must not look
// like that person's own account). pages = the Page names that will be connected (read before
// anything is saved).
export const FB_CONFIRM_TEXT = {
  en: { title: "Connect your Facebook Page", lead: "Your Facebook Page will be connected to this SellerFlowLive account:", storeLabel: "store name set by this account:", pagesLead: "These Pages will be connected:", warn: "Only continue if this is your own SellerFlowLive account.", connect: "Connect", busy: "Connecting\u2026", cancel: "Cancel", note: "This can take a few seconds." },
  fil: { title: "Ikonekta ang Facebook Page mo", lead: "Ikokonekta ang Facebook Page mo sa SellerFlowLive account na ito:", storeLabel: "pangalan ng tindahan na nilagay ng account na ito:", pagesLead: "Ito ang mga Page na ikokonekta:", warn: "Ituloy lang kung sa iyo talaga ang SellerFlowLive account na ito.", connect: "Ikonekta", busy: "Kinokonekta\u2026", cancel: "Huwag na", note: "Ilang segundo lang ito." },
  zh: { title: "连接你的 Facebook 主页", lead: "你的 Facebook 主页将连接到这个 SellerFlowLive 账号：", storeLabel: "此账号设置的店铺名称：", pagesLead: "将连接以下主页：", warn: "只有这是你自己的 SellerFlowLive 账号时才继续。", connect: "连接", busy: "连接中\u2026", cancel: "取消", note: "可能需要几秒钟。" },
  "zh-TW": { title: "連接你的 Facebook 粉專", lead: "你的 Facebook 粉專將連接到這個 SellerFlowLive 帳號：", storeLabel: "此帳號設定的商店名稱：", pagesLead: "將連接以下粉專：", warn: "只有這是你自己的 SellerFlowLive 帳號時才繼續。", connect: "連接", busy: "連接中\u2026", cancel: "取消", note: "可能需要幾秒鐘。" },
  vi: { title: "Kết nối Trang Facebook của bạn", lead: "Trang Facebook của bạn sẽ được kết nối với tài khoản SellerFlowLive này:", storeLabel: "tên cửa hàng do tài khoản này đặt:", pagesLead: "Các Trang sẽ được kết nối:", warn: "Chỉ tiếp tục nếu đây là tài khoản SellerFlowLive của chính bạn.", connect: "Kết nối", busy: "Đang kết nối\u2026", cancel: "Huỷ", note: "Việc này có thể mất vài giây." },
  th: { title: "เชื่อมต่อเพจ Facebook ของคุณ", lead: "เพจ Facebook ของคุณจะเชื่อมต่อกับบัญชี SellerFlowLive นี้:", storeLabel: "ชื่อร้านที่บัญชีนี้ตั้งไว้:", pagesLead: "เพจที่จะเชื่อมต่อ:", warn: "ทำต่อเฉพาะเมื่อนี่เป็นบัญชี SellerFlowLive ของคุณเอง", connect: "เชื่อมต่อ", busy: "กำลังเชื่อมต่อ\u2026", cancel: "ยกเลิก", note: "อาจใช้เวลาสักครู่" },
  id: { title: "Hubungkan Halaman Facebook Anda", lead: "Halaman Facebook Anda akan dihubungkan ke akun SellerFlowLive ini:", storeLabel: "nama toko yang diatur akun ini:", pagesLead: "Halaman yang akan dihubungkan:", warn: "Lanjutkan hanya jika ini akun SellerFlowLive milik Anda sendiri.", connect: "Hubungkan", busy: "Menghubungkan\u2026", cancel: "Batal", note: "Ini bisa memakan beberapa detik." },
  bg: { title: "Свържи своята Facebook страница", lead: "Твоята Facebook страница ще бъде свързана с този SellerFlowLive акаунт:", storeLabel: "име на магазина, зададено от този акаунт:", pagesLead: "Ще бъдат свързани тези страници:", warn: "Продължи само ако това е твоят собствен SellerFlowLive акаунт.", connect: "Свържи", busy: "Свързване\u2026", cancel: "Отказ", note: "Може да отнеме няколко секунди." },
};
export const FB_CONFIRM_LABELS = { ...FB_CONFIRM_TEXT.en, action: "/fb/oauth/complete", param: "fb" };
export const CONFIRM_PAGES_SHOWN = 20; // Page names listed at most
export function buildConfirmPage({ code, state, email, storeName, appUrl, app = false, labels = FB_CONFIRM_LABELS, lang = "en", pages = [] }) {
  const L = { ...FB_CONFIRM_LABELS, ...labels };
  const cancel = app ? `${APP_AUTH_CALLBACK}?fb=error&code=cancelled` : `${appUrl}/?${L.param}=error&code=cancelled`;
  const store = String(storeName || "").trim();
  const names = (Array.isArray(pages) ? pages : []).map((p) => String((p && (p.name || p.id)) || "").trim()).filter(Boolean);
  const shown = names.slice(0, CONFIRM_PAGES_SHOWN);
  const pagesHtml = shown.length ? `<p>${escapeHtml(L.pagesLead)}</p>
<ul class="pages">${shown.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}${names.length > shown.length ? `<li>+${names.length - shown.length}</li>` : ""}</ul>
` : "";
  return `<!doctype html>
<html lang="${escapeHtml(confirmLangOf(lang) || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(L.title)}</title>
<style>
body{margin:0;background:#f4f3fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1b2e}
main{max-width:420px;margin:0 auto;padding:32px 20px}
.card{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 6px 24px rgba(30,20,80,.08)}
h1{font-size:20px;margin:0 0 12px}
p{font-size:15px;line-height:1.5;margin:0 0 12px}
.acct{background:#f0eefc;border-radius:10px;padding:12px 14px;margin:0 0 12px;font-size:15px;word-break:break-all}
.acct b{display:block}
.acct span{display:block;margin-top:6px;font-size:13px;color:#6b6880}
.acct i{font-style:normal;color:#1d1b2e}
.pages{margin:0 0 12px;padding:0 0 0 20px;font-size:15px;line-height:1.5;font-weight:600}
.warn{color:#8a5a00;font-weight:600}
form{margin:20px 0 0}
button,a.btn{display:block;width:100%;box-sizing:border-box;text-align:center;font-size:16px;font-weight:700;padding:14px 0;border-radius:12px;text-decoration:none}
button{border:none;background:#4f46e5;color:#fff;cursor:pointer}
a.btn{margin-top:10px;background:#fff;color:#4f46e5;border:1px solid #c9c4f2}
button:disabled{opacity:.7;cursor:default}
.note{margin:12px 0 0;font-size:13px;color:#6b6880;text-align:center}
</style></head>
<body><main><div class="card">
<h1>${escapeHtml(L.title)}</h1>
<p>${escapeHtml(L.lead)}</p>
<div class="acct"><b>${escapeHtml(maskEmail(email))}</b>${store ? `<span>${escapeHtml(L.storeLabel)} <i>${escapeHtml(store)}</i></span>` : ""}</div>
${pagesHtml}<p class="warn">${escapeHtml(L.warn)}</p>
<form id="c" method="post" action="${escapeHtml(L.action)}">
<input type="hidden" name="code" value="${escapeHtml(code)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<button type="submit" data-busy="${escapeHtml(L.busy)}">${escapeHtml(L.connect)}</button>
</form>
<a class="btn" href="${escapeHtml(cancel)}">${escapeHtml(L.cancel)}</a>
<p class="note">${escapeHtml(L.note)}</p>
</div></main><script>${CONFIRM_SCRIPT}</script></body></html>`;
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
// Every Graph GET is cut off after timeoutMs (the abort makes it throw). Callers already treat
// a throw as their failure case: the poller keeps looping, the OAuth callback redirects with
// code=exception, and the helpers that never throw return their empty answer.
export async function graphGet({ fetchImpl, url, timeoutMs = GRAPH_TIMEOUT_MS }) {
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    let r;
    try {
      r = await fetchImpl(url, { method: "GET", ...(ac ? { signal: ac.signal } : {}) });
    } catch (e) {
      if (ac && ac.signal.aborted) throw new Error("graph_timeout"); // our timeout fired → name it
      throw e;
    }
    const status = r.status;
    const j = await r.json().catch(() => ({}));
    if (ac && ac.signal.aborted) throw new Error("graph_timeout"); // body cut off by the timeout
    return { status, body: j || {} };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
// Only a real invalid token (code 190 or HTTP 401) is an auth failure. A plain HTTP 403 is not:
// it also carries permission and throttling errors, and an auth failure sets the page inactive.
export function classifyGraphError(status, body) {
  const err = (body && body.error) || {};
  const code = Number(err.code);
  // Feature gate FIRST (code 200 arrives as HTTP 403): never an auth failure.
  const featureGate = code === FB_FEATURE_GATE_CODE;
  const rateLimited = status === 429 || FB_RATE_LIMIT_CODES.has(code);
  const authFail = !featureGate && !rateLimited && (code === FB_AUTH_ERROR_CODE || status === 401);
  return { authFail, featureGate, rateLimited, code, subcode: Number(err.error_subcode) || null, type: err.type ? String(err.type) : null, message: String(err.message || "") };
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
// Did this user grant pages_messaging? GET /me/permissions with the long-lived USER token
// → true only when an entry { permission: "pages_messaging", status: "granted" } exists.
// Declined / missing / non-200 / any error → false. Never throws.
export async function fetchMessagingGranted({ fetchImpl, userToken }) {
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl("/me/permissions", { access_token: userToken }) });
    if (status !== 200 || !Array.isArray(body.data)) return false;
    return body.data.some((p) => p && p.permission === "pages_messaging" && p.status === "granted");
  } catch { return false; }
}
// The Facebook user (app-scoped id) who is authorizing — GET /me?fields=id. "" on any failure.
// Saved next to each Page so Meta's Deauthorize Callback can find that person's Pages. Never throws.
export async function fetchMeId({ fetchImpl, userToken }) {
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl("/me", { fields: "id", access_token: userToken }) });
    const id = String((body && body.id) || "");
    return status === 200 && /^\d{1,40}$/.test(id) ? id : "";
  } catch { return ""; }
}
// Is this page currently live? Returns { liveVideoId, failed, authFail }: liveVideoId = the
// first status=LIVE video, most recent first ("" when none). status is uppercase-compared so
// only an ACTIVE broadcast matches — an ended one (VOD / LIVE_STOPPED / PROCESSING) is
// excluded, so we never attach to a stale broadcast. broadcast_start_time desc prefers the
// newest LIVE. failed = the question was not answered (Graph error, non-200, no data array,
// timeout / network); authFail = that failure was an invalid token (classifyGraphError).
// A failure also carries detail { httpStatus, code, subcode, type, timedOut, message } for the
// connect log — Facebook's own error fields only, never the token or the request URL.
// UNVERIFIED shape; never throws.
export async function fetchLiveVideos({ config, fetchImpl, pageId, pageToken }) {
  void config;
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${pageId}/live_videos`, { fields: "status,id,broadcast_start_time", access_token: pageToken }) });
    const cls = classifyGraphError(status, body);
    if (status !== 200 || cls.code > 0 || !Array.isArray(body.data)) {
      const detail = { httpStatus: status, code: cls.code > 0 ? cls.code : null, subcode: cls.subcode, type: cls.type, timedOut: false, message: cls.message };
      return { liveVideoId: "", failed: true, authFail: cls.authFail, detail };
    }
    const list = body.data.filter((v) => String(v.status || "").toUpperCase() === "LIVE");
    list.sort((a, b) => Date.parse(b.broadcast_start_time || 0) - Date.parse(a.broadcast_start_time || 0)); // newest LIVE first
    return { liveVideoId: list[0] ? String(list[0].id || "") : "", failed: false, authFail: false };
  } catch (e) {
    // AbortError = graphGet's 10 s timeout fired during the request; "graph_timeout" = during the body.
    const timedOut = !!e && (e.name === "AbortError" || e.message === "graph_timeout");
    return { liveVideoId: "", failed: true, authFail: false, detail: { httpStatus: null, code: null, subcode: null, type: null, timedOut, message: "" } };
  }
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
// ── Video path (no Live Video API) ────────────────────────────────────────────
// For people who are not admins / developers / testers of our Meta app, GET /{page}/live_videos
// answers (#10). The SAME Page token with the approved permissions can still read the Page's
// videos: the current broadcast appears there with live_status "LIVE" (a finished one "VOD"),
// and /{video}/comments returns the live comments (proven in production, Oct 6 2026).
export const FB_LIVE_API_REFUSED_CODE = 10;
export const VIDEO_LOOKUP_LIMIT = 10;
// The newest video whose live_status is LIVE. Same answer shape as fetchLiveVideos:
// { liveVideoId, failed, authFail, detail? } (liveVideoId = the VIDEO id). Never throws.
export async function fetchLiveVideoFromVideos({ fetchImpl, pageId, pageToken }) {
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${pageId}/videos`, { fields: "id,created_time,live_status", limit: VIDEO_LOOKUP_LIMIT, access_token: pageToken }) });
    const cls = classifyGraphError(status, body);
    if (status !== 200 || cls.code > 0 || !Array.isArray(body.data)) {
      const detail = { httpStatus: status, code: cls.code > 0 ? cls.code : null, subcode: cls.subcode, type: cls.type, timedOut: false, message: cls.message };
      return { liveVideoId: "", failed: true, authFail: cls.authFail, detail };
    }
    const list = body.data.filter((v) => v && v.id && String(v.live_status || "").toUpperCase() === "LIVE");
    list.sort((a, b) => (Date.parse(b.created_time || 0) || 0) - (Date.parse(a.created_time || 0) || 0)); // newest LIVE first
    return { liveVideoId: list[0] ? String(list[0].id) : "", failed: false, authFail: false };
  } catch (e) {
    const timedOut = !!e && (e.name === "AbortError" || e.message === "graph_timeout");
    return { liveVideoId: "", failed: true, authFail: false, detail: { httpStatus: null, code: null, subcode: null, type: null, timedOut, message: "" } };
  }
}
// fetchLiveStatus for the video path: GET /{video}?fields=live_status → uppercased value
// ("LIVE" | "VOD" | …) or "" when unreadable — the same contract as fetchLiveStatus.
export async function fetchVideoLiveStatus({ fetchImpl, videoId, pageToken }) {
  try {
    const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${videoId}`, { fields: "live_status", access_token: pageToken }) });
    if (status !== 200) return "";
    return String(body.live_status || "").toUpperCase();
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
  return (await fetchCommentsPage({ config, fetchImpl, liveVideoId, pageToken })).result;
}
// One page: the result above plus the raw body (for the next-page cursor). after = a cursor.
async function fetchCommentsPage({ config, fetchImpl, liveVideoId, pageToken, after }) {
  void config;
  const { status, body } = await graphGet({ fetchImpl, url: graphUrl(`/${liveVideoId}/comments`, {
    fields: "id,message,from{id,name,picture},created_time", filter: "stream", live_filter: "no_filter", order: "reverse_chronological", limit: COMMENTS_PAGE_LIMIT,
    ...(after ? { after } : {}), access_token: pageToken,
  }) });
  const hasData = Array.isArray(body.data);
  const list = hasData ? body.data : [];
  const cls = classifyGraphError(status, body);
  // A 200 WITHOUT a `data` array (non-JSON body → graphGet's {} fallback, or an unexpected
  // shape) is NOT "zero comments" — it used to be silently reported as comments=0. Treat it
  // as a hard error so it is logged (bodyKeys) and retried, never mistaken for an empty feed.
  const shapeAnomaly = status === 200 && !(cls.code > 0) && !hasData;
  const hardError = status !== 200 || cls.code > 0 || shapeAnomaly; // non-2xx, Graph error body, or bad shape
  return { body, result: {
    status, list, authFail: cls.authFail, featureGate: cls.featureGate, rateLimited: cls.rateLimited, hardError, shapeAnomaly,
    errorCode: cls.code || null, errorSubcode: cls.subcode, error: cls.message,
    bodyKeys: Object.keys(body || {}).join(",") || "(empty)", // key NAMES only — never values (token-free)
  } };
}

// The next-page cursor of a comments answer: paging.cursors.after, else the `after` of paging.next.
export function nextCommentsCursor(body) {
  const p = body && typeof body === "object" ? body.paging : null;
  if (!p || typeof p !== "object") return "";
  if (p.cursors && typeof p.cursors.after === "string" && p.cursors.after) return p.cursors.after;
  if (typeof p.next === "string") { try { return new URL(p.next).searchParams.get("after") || ""; } catch { return ""; } }
  return "";
}

// fb_comment_paging — the comments of one tick, following older pages while a code drop
// outruns the poll. The FIRST page is fetched and classified exactly like fetchComments (its
// result is what pollOnce acts on, unchanged). More pages are read only when (a) that first page
// is clean, FULL, ALL unseen and has a cursor (a new drop), or (b) the previous tick stopped at
// the page cap and left a cursor in state.pagingAfter (the rest of that drop). Then the switch is
// asked (allowMore) and up to maxPages more pages are read, each next one only while the page
// before it was full, all unseen and had a cursor. A failed follow-up page keeps what was fetched
// and stops (one token-free log line; that page is tried again next tick). Pages are appended
// newest → oldest, so the caller's pickNewComments(...).reverse() still emits oldest → newest.
// A follow-up page never throws.
export async function fetchCommentPages({ config, fetchImpl, liveVideoId, pageToken, emitted, allowMore, state = null, maxPages = MAX_COMMENT_PAGES, log = () => {}, pageId = "" }) {
  const first = await fetchCommentsPage({ config, fetchImpl, liveVideoId, pageToken });
  const r = first.result;
  if (r.hardError || r.authFail || r.featureGate || r.rateLimited || typeof allowMore !== "function") return r;
  const unseen = (list) => list.every((c) => !emitted.has(commentIdOf(c)));
  const wantsMore = (list, body) => list.length === COMMENTS_PAGE_LIMIT && unseen(list) && !!nextCommentsCursor(body);
  const fresh = wantsMore(r.list, first.body);
  const backlog = state && typeof state.pagingAfter === "string" ? state.pagingAfter : "";
  if (!fresh && !backlog) return r;
  let on = false;
  try { on = (await allowMore()) === true; } catch { on = false; }
  if (!on) { if (state) state.pagingAfter = ""; return r; }
  const list = [...r.list];
  let after = fresh ? nextCommentsCursor(first.body) : backlog;
  let left = "";                                 // a cursor still to read on a later tick
  for (let n = 1; n <= maxPages; n++) {
    let page;
    try { page = await fetchCommentsPage({ config, fetchImpl, liveVideoId, pageToken, after }); }
    catch (e) {
      log(`[FB] comments page ${n + 1} failed page=${pageId} lv=${liveVideoId} error=${e && e.message === "graph_timeout" ? "timeout" : "network"} — keeping ${list.length} comments`);
      left = after;
      break;
    }
    const pr = page.result;
    if (pr.hardError || pr.authFail || pr.featureGate || pr.rateLimited) {
      log(`[FB] comments page ${n + 1} failed page=${pageId} lv=${liveVideoId} http=${pr.status} code=${pr.errorCode ?? "-"} — keeping ${list.length} comments`);
      left = after;
      break;
    }
    list.push(...pr.list);
    if (!wantsMore(pr.list, page.body)) { left = ""; break; } // not full / reached known comments / no cursor
    after = nextCommentsCursor(page.body);
    left = after;                                             // the cap may end the loop here
  }
  // A new drop that finished keeps the older backlog for the next tick; a drop that hit the cap
  // (or failed) replaces it with its own cursor.
  if (state) state.pagingAfter = left || (fresh ? backlog : "");
  return { ...r, list };
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

// After a socket (re)joins the seller room: one platform_status per running Facebook poller of
// that seller, to that socket only. runtime may be null (Facebook off). Never throws.
export function replayFbStatus(runtime, sellerId, emailId, emit) {
  try {
    for (const p of runtime ? runtime.listPollers(sellerId) : []) {
      emit({ platform: "Facebook", connected: true, sellerId: emailId, username: p.scopeKey, sessionId: p.sessionId });
    }
  } catch { /* best effort — never break the room join */ }
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
    // fb_stop_reasons switch (server.js: cached app_settings read). OFF / missing → no extra
    // Graph call and no extra auto-receipt job; the stop reason is sent on the status either way.
    stopReasonsEnabled = async () => false,
    // fb_comment_paging switch (server.js: cached app_settings read). OFF / missing: one page per tick.
    commentPagingEnabled = async () => false,
    // fb_identity_v2 switch (server.js: cached app_settings read). Read ONCE per Connect; the
    // poller keeps that mode for its whole life. OFF / missing: the handle is the display name.
    identityV2Enabled = async () => false,
    renderUrl, appUrl = APP_REDIRECT_URL,
    fetchImpl: rawFetch = globalThis.fetch, now = () => Date.now(), log = () => {},
    makeFormParser = (limit) => express.urlencoded({ extended: false, limit }),
    setLoop = (fn, ms) => setTimeout(fn, ms), clearLoop = (h) => clearTimeout(h),
    setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (h) => clearInterval(h),
  } = deps;

  const pollers = new Map();   // liveKey → entry
  let refreshHandle = null;
  // Build 8: every Graph request that carries a token also carries appsecret_proof.
  const fetchImpl = withAppSecretProof(rawFetch, config.appSecret);
  // Facebook's own error text, safe for a log line (no token, no URL).
  const safe = (msg, token = "") => maskSecretText(msg, token, 200) || "-";

  const redirectUri = `${String(renderUrl).replace(/\/+$/, "")}/fb/oauth/callback`;

  // ---- OAuth ----
  // messaging = the user is on fb_receipt_access → also ask for pages_messaging. Everyone
  // else gets exactly OAUTH_SCOPE (unchanged).
  function buildAuthUrl(userId, { messaging = false, app = false, lang = "" } = {}) {
    const state = signState({ userId, key: config.appSecret, nowMs: now(), app, lang, kind: "fb" });
    const q = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: redirectUri,
      state,
      scope: messaging ? `${OAUTH_SCOPE},pages_messaging` : OAUTH_SCOPE,
      response_type: "code",
    });
    return `${FB_DIALOG_HOST}/${GRAPH_VERSION}/dialog/oauth?${q.toString()}`;
  }

  // ---- One code exchange per (code, state), shared by the confirm page and Connect ----
  // A Facebook code can be exchanged once. The confirm page (GET) exchanges it to list the Page
  // names; Connect (POST) reuses that answer instead of exchanging again. Nothing is saved by the
  // exchange. Kept in memory only (sha256(code|state) key), for EXCHANGE_KEEP_MS, at most
  // EXCHANGE_KEEP_MAX; dropped after Connect or on a failure (a reload then tries again). After a
  // server restart Connect exchanges by itself, as before.
  const exchanges = new Map(); // key → { at, promise }
  const exchangeKeyOf = (code, state) => createHash("sha256").update(`${code}|${state}`, "utf8").digest("hex");
  async function exchangeForPages(code) {
    const shortTok = await exchangeCodeForToken({ config, fetchImpl, code, redirectUri });
    if (!shortTok.ok) return { error: "token_exchange" };
    const longTok = await exchangeForLongLivedUserToken({ config, fetchImpl, shortToken: shortTok.access });
    if (!longTok.ok) return { error: "token_exchange" };
    const pages = await fetchPages({ config, fetchImpl, userToken: longTok.access });
    if (pages.length === 0) return { error: "no_pages" };
    // Recorded per page for a later Messenger receipt. Never throws; any doubt → false.
    const canMessage = await fetchMessagingGranted({ fetchImpl, userToken: longTok.access });
    const fbUserId = await fetchMeId({ fetchImpl, userToken: longTok.access }); // Build 8 (deauthorize)
    return { longTok, pages, canMessage, fbUserId };
  }
  function sharedExchange(code, state) {
    const key = exchangeKeyOf(code, state);
    const nowMs = now();
    for (const [k, v] of exchanges) { if (nowMs - v.at >= EXCHANGE_KEEP_MS) exchanges.delete(k); else break; }
    let e = exchanges.get(key);
    if (!e) {
      const promise = exchangeForPages(code).catch((err) => { log(`[FB] callback error: ${safe(err && err.message)}`); return { error: "exception" }; });
      e = { at: nowMs, promise };
      exchanges.set(key, e);
      while (exchanges.size > EXCHANGE_KEEP_MAX) exchanges.delete(exchanges.keys().next().value);
      void promise.then((r) => { if (r.error && exchanges.get(key) === e) exchanges.delete(key); });
    }
    return { key, promise: e.promise };
  }

  async function handleCallback({ code, state }) {
    const st = verifyStateDetail(state, config.appSecret, now(), "fb");
    // An unverified state cannot be trusted to say "app" → bad_state always goes to the web.
    if (!st) return { redirect: `${appUrl}/?fb=error&code=bad_state` };
    const userId = st.userId;
    const back = (q) => (st.app ? `${APP_AUTH_CALLBACK}?${q}` : `${appUrl}/?${q}`);
    if (!code) return { redirect: back("fb=error&code=missing_params") };
    const ex = sharedExchange(code, state);
    try {
      const got = await ex.promise;
      if (got.error) return { redirect: back(`fb=error&code=${got.error}`) };
      const { longTok, pages, canMessage, fbUserId } = got;

      // Per-plan cap (Option A: fb_pages rows vs maxAccountsForPlan) — re-auth of an
      // EXISTING page is always allowed; each NEW page counts against the cap.
      // A failed plan/count read is a shown error (read_failed), never "no limit".
      let plan, count;
      try {
        plan = await store.getPlan(userId);
        count = await store.countPages(userId);
      } catch (e) {
        log(`[FB] callback read_failed user=${userId}: ${safe(e && e.message)}`);
        return { redirect: back("fb=error&code=read_failed") };
      }
      const max = plan ? maxAccountsForPlan(plan) : Infinity;
      // ~60d reminder from the long-lived user-token window (see the deviation note).
      const expiresAtIso = new Date(now() + longTok.expireInSec * 1000).toISOString();
      let upserted = 0, capped = 0, failed = 0, limited = 0;
      const keptNames = [], droppedNames = []; // for the partial-save answer
      for (const p of pages) {
        let existing = null;
        try { existing = await store.getPage(userId, p.id); } catch { existing = null; }
        // F6-class TOCTOU (ACCEPTED, LOW — same as shopeeLive): two concurrent
        // callbacks could both pass the cap for two NEW pages. Soft business cap only.
        if (!existing && count >= max) { capped++; droppedNames.push(p.name || p.id); continue; }
        // A failed save is counted separately: it is not "saved" and does not use the cap.
        try {
          await store.upsertPage({
            user_id: userId, page_id: p.id, page_name: p.name || null, page_username: p.username || null,
            access_token: encryptToken(p.access_token, config.tokenKey),
            token_expires_at: expiresAtIso, active: true, can_message: canMessage,
          });
        } catch (e) {
          // The database's combined account limit (sql/84) refused this NEW page.
          if (e && e.message === "account_limit") { limited++; droppedNames.push(p.name || p.id); }
          else failed++;
          continue;
        }
        upserted++;
        keptNames.push(p.name || p.id);
        // Who authorized it (for the Deauthorize Callback). Best effort: before sql/111 the column
        // is missing and this fails quietly — the Page is saved either way.
        if (fbUserId && typeof store.setPageFbUser === "function") { try { await store.setPageFbUser(userId, p.id, fbUserId); } catch { /* best effort */ } }
        if (!existing) count++;
      }
      if (upserted === 0 && limited > 0) return { redirect: back("fb=error&code=account_limit") };
      if (upserted === 0 && failed > 0) {
        log(`[FB] callback save_failed user=${userId} failed=${failed}`);
        return { redirect: back("fb=error&code=save_failed") };
      }
      if (upserted === 0) return { redirect: back("fb=error&code=cap") };
      log(`[FB] callback ok user=${userId} pages=${upserted} capped=${capped} failed=${failed}`);
      // Some Pages did not fit the plan → say which (the app tells the seller; old apps ignore it).
      return { redirect: back(droppedNames.length ? `fb=connected&${partialSaveQuery(keptNames, droppedNames)}` : "fb=connected") };
    } catch (e) {
      log(`[FB] callback error: ${safe(e && e.message)}`);
      return { redirect: back("fb=error&code=exception") };
    } finally {
      if (exchanges.get(ex.key)) exchanges.delete(ex.key); // tokens leave memory after Connect
    }
  }

  // POST /fb/oauth/complete bookkeeping (see the route). Only hashed keys and redirect URLs.
  const completeInFlight = new Map(); // key → Promise<redirect>
  const completeDone = new Map();     // key → { redirect, at } (insertion order = age)
  async function runComplete(code, state, key) {
    try {
      const { redirect } = await handleCallback({ code, state });
      let reason = "";
      try { const u = new URL(redirect); if (u.searchParams.get("fb") === "error") reason = u.searchParams.get("code") || "unknown"; } catch { reason = ""; }
      if (reason) {
        const uid = verifyState(state, config.appSecret, now());
        log(`[FB] callback failed user=${uid ? String(uid).slice(0, 8) : "-"} reason=${reason}`);
      }
      if (!reason || reason === "cap") {
        const nowMs = now();
        for (const [k, v] of completeDone) { if (nowMs - v.at >= COMPLETE_REMEMBER_MS) completeDone.delete(k); else break; }
        completeDone.set(key, { redirect, at: nowMs });
        while (completeDone.size > COMPLETE_REMEMBER_MAX) completeDone.delete(completeDone.keys().next().value);
      }
      return redirect;
    } finally {
      completeInFlight.delete(key);
    }
  }

  // GET /fb/oauth/callback: verify state + code exactly like handleCallback (same error
  // redirects), read the receiving account, read the Pages (shared exchange — nothing saved)
  // and answer the confirm page in the state's language. → { redirect } or { html }.
  async function confirmCallback({ code, state }) {
    const st = verifyStateDetail(state, config.appSecret, now(), "fb");
    if (!st) return { redirect: `${appUrl}/?fb=error&code=bad_state` };
    const userId = st.userId;
    const back = (q) => (st.app ? `${APP_AUTH_CALLBACK}?${q}` : `${appUrl}/?${q}`);
    if (!code) return { redirect: back("fb=error&code=missing_params") };
    let label = null;
    try { label = typeof store.getAccountLabel === "function" ? await store.getAccountLabel(userId) : null; } catch { label = null; }
    if (!label || !String(label.email || "").trim()) return { redirect: back("fb=error&code=exception") };
    // Read the Pages now (nothing is saved) so the page can name them; Connect reuses this answer.
    const got = await sharedExchange(code, state).promise;
    if (got.error) return { redirect: back(`fb=error&code=${got.error}`) };
    const lang = st.lang || "en";
    const labels = { ...(FB_CONFIRM_TEXT[lang] || FB_CONFIRM_TEXT.en), action: "/fb/oauth/complete", param: "fb" };
    return { app: st.app, html: buildConfirmPage({ code, state, email: label.email, storeName: label.storeName, appUrl, app: st.app, labels, lang, pages: got.pages }) };
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
        log(`[FB] revalidate error page=${p.page_id}: ${safe(e && e.message)}`);
      }
    }
  }
  function startRefreshTimer() {
    if (refreshHandle) return;
    refreshHandle = setTimer(() => { void refreshDuePages(); }, REFRESH_SCAN_MS);
    if (refreshHandle && typeof refreshHandle.unref === "function") refreshHandle.unref();
  }

  // The switch read never throws (a failed read = off).
  const isStopReasonsOn = async () => { try { return (await stopReasonsEnabled()) === true; } catch { return false; } };
  const isCommentPagingOn = async () => { try { return (await commentPagingEnabled()) === true; } catch { return false; } };
  const isIdentityV2On = async () => { try { return (await identityV2Enabled()) === true; } catch { return false; } };

  // ---- Poller ----
  // The one thing the two modes do differently: where "is it still LIVE?" is read.
  // live_videos mode → /{live_video}?fields=status; video mode → /{video}?fields=live_status.
  // Same answer contract ("LIVE" | other status | "" unreadable).
  const readLiveStatus = (entry) => (entry.videoMode
    ? fetchVideoLiveStatus({ fetchImpl, videoId: entry.liveVideoId, pageToken: entry.accessToken })
    : fetchLiveStatus({ config, fetchImpl, liveVideoId: entry.liveVideoId, pageToken: entry.accessToken }));

  async function pollOnce(entry) {
    const nowMs = now();
    // F2 — orphan/idle caps.
    if (nowMs - entry.startedAtMs >= MAX_SESSION_MS) return { hadNew: false, stop: true, reason: "max_session" };
    // Idle limit. A session that was only ever feature-gated ends here with the honest reason.
    // Any other session asks Facebook whether the live is still on (below, after the token).
    const idleDue = nowMs - entry.lastActivityMs >= IDLE_STOP_MS;
    if (idleDue && entry.featureGated) return { hadNew: false, stop: true, reason: "feature_gate" };

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

    // Idle limit reached: a quiet room is not a finished live. LIVE → keep polling and look again
    // after the next IDLE_STOP_MS of quiet; any other status → the live ended; unreadable →
    // keep polling, ask again in IDLE_RECHECK_MS, and stop(idle) after MAX_IDLE_UNREADABLE in a row.
    const idleCheckDue = idleDue && nowMs >= (entry.idleRecheckAtMs || 0); // fb_stop_reasons: no 2nd status read in one tick
    if (idleDue && nowMs >= (entry.idleRecheckAtMs || 0)) {
      const liveStatus = await readLiveStatus(entry);
      if (entry.stopped) return { hadNew: false, stop: false };
      if (liveStatus === "LIVE") {
        entry.lastActivityMs = nowMs;
        entry.idleUnreadable = 0;
        entry.idleRecheckAtMs = 0;
      } else if (liveStatus) {
        return { hadNew: false, stop: true, reason: "session_end" };
      } else {
        entry.idleUnreadable = (entry.idleUnreadable || 0) + 1;
        if (entry.idleUnreadable >= MAX_IDLE_UNREADABLE) return { hadNew: false, stop: true, reason: "idle" };
        entry.idleRecheckAtMs = nowMs + IDLE_RECHECK_MS;
      }
    }

    // fb_stop_reasons (switch ON) — every LIVE_RECHECK_MS, whatever the comment activity: is the
    // live still on? LIVE / unreadable → note the time and go on (unreadable never stops here;
    // the idle path above owns that); any other status → the live ended.
    if (!idleCheckDue && nowMs - (entry.liveCheckedAtMs || entry.startedAtMs) >= LIVE_RECHECK_MS && (await isStopReasonsOn())) {
      if (entry.stopped) return { hadNew: false, stop: false };
      const liveStatus = await readLiveStatus(entry);
      if (entry.stopped) return { hadNew: false, stop: false };
      if (liveStatus && liveStatus !== "LIVE") return { hadNew: false, stop: true, reason: "session_end" };
      entry.liveCheckedAtMs = nowMs;
    }

    let res;
    try {
      // fb_comment_paging - the first page exactly as before; older pages only when that page is
      // full and all new (a code drop) and the switch is on. Never on the first poll after Connect.
      res = await fetchCommentPages({
        config, fetchImpl, liveVideoId: entry.liveVideoId, pageToken: entry.accessToken,
        emitted: entry.emitted, allowMore: entry.firstPollDone ? isCommentPagingOn : null, state: entry, log, pageId: entry.pageId,
      });
    } catch { return { hadNew: false, stop: false }; } // transient network / timeout → keep looping
    if (entry.stopped) return { hadNew: false, stop: false }; // stopped while the request was out: emit nothing

    // Order: feature-gate (#200) → rate limit / 5xx (wait) → auth-fail (190 / HTTP 401) →
    // other HARD error. NOTHING here concludes "ended" from a comments error —
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
        log(`[FB] comments blocked: Live Video API not approved (code 200) page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} subcode=${res.errorSubcode ?? "-"} msg=${safe(res.error, entry.accessToken)} — page kept active, session kept alive`);
      }
      return { hadNew: false, stop: false, backoff: true };
    }
    // Rate limited: wait POLL_RATE_LIMIT_MS before the next poll. Logged once per streak.
    if (res.rateLimited) {
      if (!entry.rateLimited) {
        entry.rateLimited = true;
        log(`[FB] comments rate-limited page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} code=${res.errorCode ?? "-"} — waiting ${POLL_RATE_LIMIT_MS / 1000}s between polls`);
      }
      return { hadNew: false, stop: false, backoff: true, delayMs: POLL_RATE_LIMIT_MS };
    }
    entry.rateLimited = false;
    if (res.status >= 500) return { hadNew: false, stop: false, backoff: true };
    if (res.authFail) {
      entry.authFails = (entry.authFails || 0) + 1;
      entry.reauth = true; // F4 — force a fresh token read + one retry on the next poll
      log(`[FB] comments auth-fail page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} code=${res.errorCode ?? "-"} subcode=${res.errorSubcode ?? "-"} msg=${safe(res.error, entry.accessToken)} (${entry.authFails}/${MAX_AUTH_FAILURES})`);
      if (entry.authFails >= MAX_AUTH_FAILURES) {
        try { await store.setActive(entry.userId, entry.pageId, false); } catch { /* best effort */ }
        return { hadNew: false, stop: true, reason: "auth" };
      }
      return { hadNew: false, stop: false };
    }
    // HARD ERROR (e.g. code 100 invalid-param, a transient 400): NEVER conclude ended
    // from the comments error alone (that was the bug). Log the full Graph error
    // (token-free), retry with backoff; after MAX_FETCH_ERRORS consecutive, CONFIRM
    // against live_videos status — not LIVE → session_end (authoritative); still
    // LIVE / unreadable → fetch_error (distinct, so a real invalid-param can't masquerade
    // as an ended live).
    if (res.hardError) {
      entry.fetchErrors = (entry.fetchErrors || 0) + 1;
      log(`[FB] comments error page=${entry.pageId} lv=${entry.liveVideoId} http=${res.status} code=${res.errorCode ?? "-"} subcode=${res.errorSubcode ?? "-"} msg=${safe(res.error, entry.accessToken)}${res.shapeAnomaly ? ` shape=no-data-array keys=${res.bodyKeys}` : ""} (${entry.fetchErrors}/${MAX_FETCH_ERRORS})`);
      if (entry.fetchErrors >= MAX_FETCH_ERRORS) {
        const liveStatus = await readLiveStatus(entry);
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
        // sessionId = the CONNECTING browser's session (NOT the live-video id — that is
        // liveVideoId/roomId). useLiveFeed drops any comment whose sessionId ≠ its own,
        // so this is what scopes the live flow to the device that tapped Connect.
        sellerId: entry.sellerId, sessionId: entry.sessionId,
        pageId: entry.pageId, liveVideoId: entry.liveVideoId, pageUsername: entry.scopeKey, nowMs,
        ...(entry.identityV2 ? { identityV2: true } : null), // fixed at Connect (startPoller)
      });
      if (asInitial) payload.initial = true; // display-only lane; dedup by msgId (initialKey)
      // → the real emitCommentScoped (sanitizes + per-account scoping). platform "Facebook".
      emitComment(entry.sellerId, entry.scopeKey, payload);
    }
    rememberEmitted(entry.emitted, fresh.map(commentIdOf));
    entry.firstPollDone = true;
    if (fresh.length > 0) { // F2 — reset the idle clock on real activity
      entry.lastActivityMs = nowMs;
      entry.idleUnreadable = 0;
      entry.idleRecheckAtMs = 0;
    }
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
      const delay = r.delayMs || (r.backoff ? POLL_QUIET_MS : nextPollDelay(r.hadNew));
      scheduleNext(entry, delay);
    }, delayMs);
  }

  // sessionId = the browser session of the device that tapped Connect (POST body), stamped
  // on every comment + platform_status — mirrors TikTok's relay (server.js /connect/tiktok).
  // "" (old client / missing) → the client's `c.sessionId && …` filter passes it through.
  // videoMode = the Live Video API was refused (code 10) and liveVideoId is a VIDEO id from
  // /{page}/videos: comments come from /{video}/comments (same request) and the live status from
  // /{video}?fields=live_status. Everything else is identical to the live_videos mode.
  // identityV2 = the fb_identity_v2 mode, read once by /fb/connect; fixed for this poller's life.
  function startPoller({ sellerId, userId, pageId, pageUsername, liveVideoId, sessionId = "", videoMode = false, identityV2 = false }) {
    const scopeKey = String(pageUsername || pageId); // the select_account scoping key
    const key = liveKey(sellerId, "Facebook", pageId);
    stopPoller(key, "restart"); // single poller per page
    const nowMs = now();
    const entry = {
      key, sellerId, userId, pageId: String(pageId), scopeKey, liveVideoId: String(liveVideoId), sessionId: String(sessionId || ""),
      emitted: new Set(), authFails: 0, fetchErrors: 0, featureGated: false, rateLimited: false, timer: null, stopped: false,
      idleUnreadable: 0, idleRecheckAtMs: 0,
      firstPollDone: false,                 // F1
      startedAtMs: nowMs, lastActivityMs: nowMs, // F2
      accessToken: null, tokenExpiresAtMs: 0, reauth: false, // F4
      videoMode: videoMode === true,
      identityV2: identityV2 === true,
    };
    pollers.set(key, entry);
    log(`[FB] poller start page=${String(pageId)} lv=${String(liveVideoId)} status=LIVE`);
    if (entry.videoMode) log(`[FB] video path user=${String(userId || "").slice(0, 8)} page=${String(pageId)} video=${String(liveVideoId)}`);
    statusEmit(sellerId, { connected: true, pageId: String(pageId), liveVideoId: String(liveVideoId), scopeKey, sessionId: entry.sessionId });
    scheduleNext(entry, 0);
    return entry;
  }

  function stopPoller(key, reason = "stopped") {
    const entry = pollers.get(key);
    if (!entry) return false;
    entry.stopped = true;
    if (entry.timer != null) { clearLoop(entry.timer); entry.timer = null; }
    pollers.delete(key);
    try { statusEmit(entry.sellerId, { connected: false, pageId: entry.pageId, liveVideoId: entry.liveVideoId, scopeKey: entry.scopeKey, sessionId: entry.sessionId, reason: String(reason || "") }); } catch { /* best effort */ }
    log(`[FB] poller stop page=${entry.pageId} reason=${reason}`);
    // B1 automatic receipt: the live ended → the store queues a job (only when its switch is on). Fire-and-forget, never blocks or throws.
    try { if ((reason === "session_end" || reason === "idle" || reason === "max_session") && typeof store.insertAutoReceiptJob === "function") Promise.resolve(store.insertAutoReceiptJob({ userId: entry.userId, pageId: entry.pageId, liveVideoId: entry.liveVideoId })).catch(() => {}); } catch { /* best effort */ }
    // fb_stop_reasons (switch ON): the seller's own Disconnect also queues it (the runner skips
    // buyers who already have a receipt and checks the seller's toggle and plan). Never on restart.
    if (reason === "disconnect" && typeof store.insertAutoReceiptJob === "function") {
      const job = { userId: entry.userId, pageId: entry.pageId, liveVideoId: entry.liveVideoId };
      void isStopReasonsOn().then((on) => (on ? store.insertAutoReceiptJob(job) : null)).catch(() => {});
    }
    return true;
  }

  // Running pollers of one seller (socket reconnect → status replay in server.js).
  function listPollers(sellerId) {
    const out = [];
    for (const e of pollers.values()) if (e.sellerId === sellerId && !e.stopped) out.push({ scopeKey: e.scopeKey, sessionId: e.sessionId, pageId: e.pageId });
    return out;
  }

  // Read-only (F2 sold-out reply ownership): did a running poller of THIS user emit this
  // comment id (optionally on this page)? Looks at the bounded emitted set only; changes
  // nothing.
  function wasEmitted(userId, commentId, pageId) {
    const id = String(commentId || "");
    if (!id || !userId) return false;
    for (const e of pollers.values()) {
      if (e.stopped || e.userId !== userId) continue;
      if (pageId && e.pageId !== String(pageId)) continue;
      if (e.emitted.has(id)) return true;
    }
    return false;
  }

  function stopAll() {
    for (const key of [...pollers.keys()]) stopPoller(key, "shutdown");
    if (refreshHandle) { clearTimer(refreshHandle); refreshHandle = null; }
  }

  // One line per failed live check on /fb/connect: Facebook's own error fields, never the token or
  // the request URL. The message is cut to 120 chars and any copy of the token is masked.
  function logConnectCheckFailed(userId, pageId, detail, token) {
    const d = detail || {};
    const msg = maskSecretText(d.message, token, 120);
    log(`[FB] connect check failed user=${String(userId || "").slice(0, 8)} page=${pageId} http=${d.httpStatus ?? "-"} code=${d.code ?? "-"} subcode=${d.subcode ?? "-"} type=${d.type ?? "-"} timeout=${d.timedOut === true} msg=${msg || "-"}`);
  }

  // ---- Routes ----
  const passThrough = (_req, _res, next) => next();
  function registerRoutes(app, requireAuth, extra = {}) {
    const requireConnectRate = extra.requireConnectRate || passThrough;
    const requirePlanActive = extra.requirePlanActive || passThrough;
    // Server-side Facebook lock (server/fbAccess.js): fb_enabled OR a preview account. On
    // start, pages and connect only — never on disconnect or the OAuth callback.
    const requireFbAvailable = extra.requireFbAvailable || passThrough;
    // Facebook-only plan check (server/fbAccess.js): a free plan must be "active" (mirrors the
    // client's isFbEligible). After requirePlanActive, on Authorize (start) and connect.
    const requireFbPlan = extra.requireFbPlan || passThrough;
    // Account total, Build 2 (sql/85): which accounts may go live. Default (tests / no
    // wiring) = allow. Asked only for a NEW connect (no poller running for it).
    const accountLiveCheck = extra.accountLiveCheck || (async () => ({ allow: true }));
    // Authorize runs the same plan checks as connect (requirePlanActive → requireFbPlan), except
    // that preview accounts skip requirePlanActive here so they always get their auth URL (the
    // client's isFbEligible bypasses the plan for them too). requireFbPlan already passes them.
    const startPlanActive = (req, res, next) => (fbPreviewEmail(req.userEmail) ? next() : requirePlanActive(req, res, next));

    app.get("/fb/oauth/start", requireAuth, requireFbAvailable, startPlanActive, requireFbPlan, async (req, res) => {
      let messaging = false;
      try { messaging = typeof store.hasReceiptAccess === "function" && (await store.hasReceiptAccess(req.authUserId)) === true; } catch { messaging = false; }
      // ?client=app → the phone app's sign-in sheet (the flow ends on the app scheme).
      const app = String((req.query && req.query.client) || "") === "app";
      const lang = confirmLangOf(req.query && req.query.lang); // the confirm page's language; "" = English
      try { return res.json({ url: buildAuthUrl(req.authUserId, { messaging, app, lang }) }); }
      catch { return res.status(500).json({ ok: false, error: "fb_start_failed" }); }
    });

    // Facebook redirects here. Nothing is saved yet: the confirm page shows which account
    // receives the Page, and only its "Connect" POST (below) runs the exchange.
    app.get("/fb/oauth/callback", async (req, res) => {
      const out = await confirmCallback({ code: String(req.query.code || ""), state: String(req.query.state || "") });
      if (out.redirect) return res.redirect(out.redirect);
      res.set({ ...CONFIRM_PAGE_HEADERS_BASE, "Content-Security-Policy": confirmPageCsp(appUrl, { app: out.app === true }), "Content-Type": "text/html; charset=utf-8" });
      return res.status(200).send(out.html);
    });

    // The confirm page's form. Its own small urlencoded parser (this route only); a body the
    // parser rejects counts as missing fields → the same error redirects as handleCallback.
    // Idempotent per code: a Facebook code can be exchanged once, so a double tap must not
    // run a second exchange (it would fail and end on ?fb=error although the Page was saved).
    // Key = sha256(code|state) — the raw code/state are never kept. In flight → a repeat waits
    // for the same result. Finished ?fb=connected / ?fb=error&code=cap → repeated for
    // COMPLETE_REMEMBER_MS (max COMPLETE_REMEMBER_MAX). Other errors are not remembered, so a
    // later retry runs again. Missing fields → handleCallback as before (no key).
    const formParser = makeFormParser(COMPLETE_FORM_LIMIT);
    const parseForm = (req, res, next) => formParser(req, res, (err) => { if (err) req.body = {}; next(); });
    const tooMany = (_req, res) => res.status(429).type("text/plain").send("Too many tries. Wait a minute and try again.");
    const completeGate = makeRateGate({ max: COMPLETE_RATE_MAX, windowMs: 60 * 1000, keyOf: ipOf, onLimit: tooMany, now });
    app.post("/fb/oauth/complete", completeGate, parseForm, async (req, res) => {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const code = typeof body.code === "string" ? body.code : "";
      const state = typeof body.state === "string" ? body.state : "";
      if (!code || !state) return res.redirect(303, (await handleCallback({ code, state })).redirect);
      const key = createHash("sha256").update(`${code}|${state}`, "utf8").digest("hex");
      const nowMs = now();
      const kept = completeDone.get(key);
      if (kept && nowMs - kept.at < COMPLETE_REMEMBER_MS) return res.redirect(303, kept.redirect);
      if (kept) completeDone.delete(key);
      let flight = completeInFlight.get(key);
      if (!flight) {
        flight = runComplete(code, state, key);
        completeInFlight.set(key, flight);
      }
      return res.redirect(303, await flight);
    });

    // Meta "Deauthorize Callback URL": a person removed the app in Facebook → every Page that
    // person authorized is deleted (all sellers) and its poller stopped. Body = signed_request
    // (form). Bad signature / shape / too old → 400 with no detail; otherwise 200 always. A
    // signature already handled answers 200 and does nothing. Logs a count only — no ids, no token.
    const deauthSeen = new Map(); // signature → time handled
    const deauthGate = makeRateGate({ max: DEAUTH_RATE_MAX, windowMs: 60 * 1000, keyOf: ipOf, onLimit: (_q, r) => r.status(429).end(), now });
    app.post("/fb/deauthorize", deauthGate, parseForm, async (req, res) => {
      const signed = req.body && typeof req.body.signed_request === "string" ? req.body.signed_request : "";
      const sr = parseSignedRequest(signed, config.appSecret);
      const nowS = Math.floor(now() / 1000);
      if (!sr || sr.issuedAt == null || sr.issuedAt < nowS - DEAUTH_MAX_AGE_S || sr.issuedAt > nowS + 300) return res.status(400).end();
      if (deauthSeen.has(sr.sig)) return res.status(200).json({ ok: true });
      deauthSeen.set(sr.sig, nowS);
      while (deauthSeen.size > DEAUTH_SEEN_MAX) deauthSeen.delete(deauthSeen.keys().next().value);
      let rows = [];
      try { rows = (typeof store.deletePagesByFbUser === "function" ? await store.deletePagesByFbUser(sr.userId) : []) || []; }
      catch { log("[FB] deauthorize delete failed"); }
      const gone = new Set(rows.map((r) => `${r.user_id}|${r.page_id}`));
      for (const [key, e] of [...pollers]) if (gone.has(`${e.userId}|${e.pageId}`)) stopPoller(key, "deauthorized");
      log(`[FB] deauthorize pages=${rows.length}`);
      return res.status(200).json({ ok: true });
    });

    // List own pages — id, name, username, active. NEVER the token column.
    app.get("/fb/pages", requireAuth, requireFbAvailable, async (req, res) => {
      try {
        const pages = await store.listPages(req.authUserId);
        return res.json({ ok: true, pages: (pages || []).map((p) => ({ page_id: String(p.page_id), name: p.page_name || "", username: p.page_username || "", active: !!p.active, token_expires_at: p.token_expires_at ? String(p.token_expires_at) : null })) });
      } catch { return res.status(500).json({ ok: false, error: "fb_pages_failed" }); }
    });

    // F3 — requireAuth → requireFbAvailable → requireConnectRate → requirePlanActive → requireFbPlan, MIRRORING
    // /connect/tiktok + /shopee/connect: an expired/inactive plan is 403'd here (no
    // poller starts), and the connect rate limit applies. The lock runs first, so a locked
    // caller makes no rate-limit entry and no plan read.
    // Shared by /fb/connect and /fb/live-check (fb_connect_v2): the page's live video, or the
    // exact answer /fb/connect has always given ({ status, json }). Never starts a poller.
    async function resolvePageLive(userId, pageId, page) {
      const token = decryptToken(page.access_token, config.tokenKey);
      if (!token) return { answer: { status: 409, json: { ok: false, error: "needs_reauth" } } };
      let live;
      try { live = await fetchLiveVideos({ config, fetchImpl, pageId, pageToken: token }); }
      catch { live = { liveVideoId: "", failed: true, authFail: false }; }
      // Live Video API refused (code 10: not an admin / developer / tester of our app) → the
      // video path: find the LIVE broadcast among the Page's videos. Its answer then goes
      // through exactly the same rules below (auth → 409, failed → 502, none → not_live).
      // Any other answer (including success) is today's path, untouched.
      let videoMode = false;
      if (live.failed && !live.authFail && live.detail && live.detail.code === FB_LIVE_API_REFUSED_CODE) {
        try { live = await fetchLiveVideoFromVideos({ fetchImpl, pageId, pageToken: token }); }
        catch { live = { liveVideoId: "", failed: true, authFail: false }; }
        videoMode = true;
      }
      // Invalid token → re-authorize (the page row is left as it is). Any other unanswered
      // check → 502. Only a clean answer without a LIVE video is "not live".
      if (live.authFail || live.failed) logConnectCheckFailed(userId, pageId, live.detail, token);
      if (live.authFail) return { answer: { status: 409, json: { ok: false, error: "needs_reauth" } } };
      if (live.failed) {
        const d = live.detail || {};
        return { answer: { status: 502, json: { ok: false, error: "fb_check_failed", fb_code: Number.isFinite(d.code) ? d.code : null, fb_http: Number.isFinite(d.httpStatus) ? d.httpStatus : null, fb_timeout: d.timedOut === true } } };
      }
      if (!live.liveVideoId) return { answer: { status: 200, json: { ok: false, reason: "not_live" } } };
      return { liveVideoId: live.liveVideoId, videoMode };
    }

    // fb_connect_v2 — "is this Page live right now?" BEFORE the app starts or switches a
    // session. Same ownership / active / token / live-video rules and answers as /fb/connect,
    // but it never starts a poller and never runs the account admission check.
    app.post("/fb/live-check", requireAuth, requireFbAvailable, requireConnectRate, async (req, res) => {
      const pageId = String((req.body || {}).page_id || "");
      if (!pageId) return res.status(400).json({ ok: false, error: "page_id required" });
      let page;
      try { page = await store.getPage(req.authUserId, pageId); }
      catch { return res.status(502).json({ ok: false, error: "fb_check_failed" }); }
      if (!page || !page.active) return res.status(404).json({ ok: false, error: "page_not_found" });
      const r = await resolvePageLive(req.authUserId, pageId, page);
      if (r.answer) return res.status(r.answer.status).json(r.answer.json);
      return res.json({ ok: true, live_video_id: r.liveVideoId });
    });

    app.post("/fb/connect", requireAuth, requireFbAvailable, requireConnectRate, requirePlanActive, requireFbPlan, async (req, res) => {
      const userId = req.authUserId;
      const sellerId = req.sellerId;
      const body = req.body || {};
      const pageId = String(body.page_id || "");
      if (!pageId) return res.status(400).json({ ok: false, error: "page_id required" });
      let page;
      try { page = await store.getPage(userId, pageId); }
      catch { return res.status(502).json({ ok: false, error: "fb_check_failed" }); } // database error ≠ no page
      if (!page || !page.active) return res.status(404).json({ ok: false, error: "page_not_found" });
      if (!pollers.has(liveKey(sellerId, "Facebook", pageId))) {
        const v = await accountLiveCheck(req, "facebook", pageId);
        if (!v.allow) return res.status(403).json({ ok: false, error: "account_not_covered" });
      }
      const live = await resolvePageLive(userId, pageId, page);
      if (live.answer) return res.status(live.answer.status).json(live.answer.json);
      // fb_identity_v2: read once here. A re-Connect to the SAME live keeps the running poller's
      // mode, so a session is never re-keyed mid-live when the switch flips.
      const prev = pollers.get(liveKey(sellerId, "Facebook", pageId));
      const identityV2 = prev && prev.liveVideoId === String(live.liveVideoId) ? prev.identityV2 === true : await isIdentityV2On();
      startPoller({ sellerId, userId, pageId, pageUsername: page.page_username || pageId, liveVideoId: live.liveVideoId, sessionId: String(body.sessionId || ""), videoMode: live.videoMode, identityV2 });
      return res.json({ ok: true, live_video_id: live.liveVideoId });
    });

    app.post("/fb/disconnect", requireAuth, (req, res) => {
      const pageId = String((req.body || {}).page_id || "");
      const key = liveKey(req.sellerId, "Facebook", pageId);
      const stopped = stopPoller(key, "disconnect");
      return res.json({ ok: true, stopped });
    });
  }

  return { registerRoutes, startRefreshTimer, stopAll, stopPoller, startPoller, listPollers, wasEmitted, pollOnce, refreshDuePages, handleCallback, confirmCallback, buildAuthUrl, _pollers: pollers, _completeDone: completeDone, _completeInFlight: completeInFlight };
}
