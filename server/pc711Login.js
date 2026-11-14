// 7-11 CHECKER LOGIN — the Render server logs in to 7-11 (OPENPOINT) itself, once, with the admin
// typing phone + password + 驗證碼 + SMS code in Admin → 7-11 Login. 7-11 is asked to remember the
// server (trust_browser); the server keeps the session (encrypted, sql/158) and, when myship has
// logged it out, tries ONCE the page's own one-tap 快速登入 for a remembered device.
// The probe's STORE step (server/pcServerProbe.js) uses this session.
//
// HARD RULES
//   - The password and the SMS code are used once (one request each), never stored, never logged,
//     never returned. No request or response body is ever logged.
//   - Hosts: myship.7-11.com.tw, bu-group.openpoint.com.tw and the two E-Map hosts. Anything else
//     is refused BEFORE any request. /cart/finish is never requested.
//   - Logs: `[PC711_LOGIN] <step> http=<n> ms=<n> <one word>` only.
//   - The session is saved only encrypted (AES-256-GCM, key = env PC711_SESSION_KEY). No key →
//     state key_missing, every route refuses, nothing is stored.
//   - Quick re-login: at most 1 try per 10 minutes and 6 per Taipei day. Anything that asks for a
//     password / 驗證碼 / SMS code → state needs_login, stop. It never types a password.
//
// ⚠️ NOT PROVEN on the real site (the container that wrote this cannot reach 7-11): how the page
// loads its 驗證碼 picture and what its 快速登入 control is. Both are FOUND on the page at run time
// (see captchaCandidates / findQuickLogin) and the way they were found is logged as one word.

import crypto from "node:crypto";
import { parseForms, parseProbeConfig } from "./pcServerProbe.js";

export const PC711_HOSTS = ["myship.7-11.com.tw", "bu-group.openpoint.com.tw", "emap.unipcsc.com.tw", "emap.pcsc.com.tw"];
export const PC711_LOGIN_URL = "https://myship.7-11.com.tw/Member/Login/";
export const PC711_FLOW_MS = 10 * 60 * 1000;
export const PC711_REQUEST_MS = 15_000;
export const PC711_MAX_HOPS = 6;
export const PC711_QUICK_GAP_MS = 10 * 60 * 1000;
export const PC711_QUICK_PER_DAY = 6;
export const PC711_BODY_MAX = 1024 * 1024;
export const PC711_IMAGE_MAX = 200 * 1024;
const MYSHIP = "myship.7-11.com.tw";
const OPENPOINT = "bu-group.openpoint.com.tw"; // the password and the SMS code may only be sent here
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TAG = "[PC711_LOGIN]";

// ── hosts ────────────────────────────────────────────────────────────────────
export function isAllowedPc711Url(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  if (!PC711_HOSTS.includes(u.hostname)) return false;
  if (/^\/cart\/finish/i.test(u.pathname)) return false;
  return true;
}

// ── the key and the encrypted blob ───────────────────────────────────────────
// PC711_SESSION_KEY = 64 hex characters, or base64 of 32 bytes (used as-is). Any other string of
// ≥ 32 characters (a Render "Generate" value) is hashed with SHA-256 to the 32-byte key. Shorter
// than 32 characters → no key (state key_missing).
export function sessionKeyFrom(env = process.env) {
  const raw = String(env?.PC711_SESSION_KEY ?? "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch { /* not base64 */ }
  if (raw.length >= 32) return crypto.createHash("sha256").update(raw, "utf8").digest();
  return null;
}
export function encryptBlob(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
}
export function decryptBlob(blob, key) {
  try {
    const s = String(blob || "");
    if (!s.startsWith("v1.") || !key) return null;
    const b = Buffer.from(s.slice(3), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
  } catch { return null; }
}

// ── a cookie jar (per host; dumped as { host: "a=b; c=d" }) ──────────────────
export function createPc711Jar(seed = {}) {
  const hosts = new Map();
  const of = (h) => { if (!hosts.has(h)) hosts.set(h, new Map()); return hosts.get(h); };
  const putPair = (h, pair) => {
    const eq = pair.indexOf("=");
    if (eq <= 0) return;
    of(h).set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  };
  for (const [h, raw] of Object.entries(seed || {})) String(raw || "").split(";").forEach((p) => putPair(h, p));
  const header = (h) => [...of(h)].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    header,
    has: (h) => of(h).size > 0,
    store(h, headers, now = Date.now()) {
      const list = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
      const single = list.length ? [] : [headers?.get?.("set-cookie")].filter(Boolean);
      for (const c of [...list, ...single]) {
        const parts = String(c).split(";");
        const first = parts[0];
        const eq = first.indexOf("=");
        if (eq <= 0) continue;
        const name = first.slice(0, eq).trim();
        const attrs = parts.slice(1).map((x) => x.trim().toLowerCase());
        const maxAge = attrs.find((a) => a.startsWith("max-age="));
        const expires = attrs.find((a) => a.startsWith("expires="));
        const gone = (maxAge && Number(maxAge.slice(8)) <= 0) || (expires && Date.parse(expires.slice(8)) <= now);
        if (gone) of(h).delete(name);
        else of(h).set(name, first.slice(eq + 1).trim());
      }
    },
    dump: () => Object.fromEntries([...hosts.keys()].map((h) => [h, header(h)]).filter(([, v]) => v)),
  };
}

// ── page reading ─────────────────────────────────────────────────────────────
const fieldOf = (form, name) => { const f = form.fields.find((x) => x[0] === name); return f ? f[1] : undefined; };
const hasField = (form, re) => form.fields.some((x) => re.test(x[0]));
const SECRET_FIELD_RE = /^(passwd|password|pwd|verifycode|captcha|smscode|smsverify)/i;

export function pageInfo(html) {
  const forms = parseForms(html, { budgetMs: 250 });
  const loginForm = forms.find((f) => f.id === "loginForm") || forms.find((f) => hasField(f, /^passwd_d$/)) || null;
  const smsForm = forms.find((f) => f.id === "smsCodeForm") || forms.find((f) => hasField(f, /^smsCode$/)) || null;
  const consentForm = forms.find((f) => f.id === "oidcDialogForm") || null;
  return { forms, loginForm, smsForm, consentForm, slow: Boolean(forms.slow) };
}

// The value of a checkbox (checked or not) inside the form with that id. Default "on".
export function checkboxValue(html, formId, name) {
  const src = String(html);
  const at = src.search(new RegExp(`<form\\b[^>]{0,400}id=["']${formId}["']`, "i"));
  if (at < 0) return "on";
  const end = src.indexOf("</form", at);
  const part = src.slice(at, end < 0 ? Math.min(src.length, at + 200000) : end);
  const m = part.match(new RegExp(`<input\\b[^>]{0,400}name=["']${name}["'][^>]{0,400}>`, "i"));
  if (!m) return "on";
  const v = m[0].match(/\bvalue=["']([^"']{0,40})["']/i);
  return v ? v[1] : "on";
}

const CAPTCHA_RE = /captcha|verif|valid|vcode|checkcode|imgcode|randcode|驗證/i;
const CAPTCHA_PATH_RE = /["']((?:https?:\/\/[A-Za-z0-9.-]{1,80})?\/?[A-Za-z0-9_\-./]{0,120}(?:captcha|verifycode|validatecode|validcode|vcode|checkcode|imgcode|randcode)[A-Za-z0-9_\-./]{0,80}(?:\?[A-Za-z0-9_\-.=&%]{0,120})?)["']/gi;

// Where the 驗證碼 picture may come from, in order: an <img> that looks like one; a quoted path in
// the page's own script text. (Scripts loaded by <script src> are read by the caller.)
export function captchaCandidates(html, pageUrl) {
  const src = String(html);
  const out = [];
  const add = (raw, source) => {
    try {
      if (/^data:image\//i.test(raw)) { out.push({ data: raw, source }); return; }
      const u = new URL(raw, pageUrl).toString();
      if (!out.some((c) => c.url === u)) out.push({ url: u, source });
    } catch { /* not a URL */ }
  };
  const imgRe = /<img\b([^>]{0,800})>/gi;
  for (let m = imgRe.exec(src); m; m = imgRe.exec(src)) {
    const attrs = m[1];
    if (!CAPTCHA_RE.test(attrs)) continue;
    const s = attrs.match(/\b(?:data-)?src\s*=\s*["']([^"']{1,4000})["']/i);
    if (s && s[1] && !/^(about:|javascript:|#)/i.test(s[1])) add(s[1], /^data:/i.test(s[1]) ? "img_data" : "img");
  }
  for (let m = CAPTCHA_PATH_RE.exec(src); m; m = CAPTCHA_PATH_RE.exec(src)) {
    if (/\.(js|css)(\?|$)/i.test(m[1]) || !m[1].includes("/")) continue; // a real path, not "#captchaImg"
    add(m[1], "inline");
  }
  CAPTCHA_PATH_RE.lastIndex = 0;
  return out.slice(0, 6);
}
export function captchaPathsInScript(text, pageUrl) {
  const out = [];
  const src = String(text);
  for (let m = CAPTCHA_PATH_RE.exec(src); m; m = CAPTCHA_PATH_RE.exec(src)) {
    if (/\.(js|css)(\?|$)/i.test(m[1]) || !m[1].includes("/")) continue;
    try { out.push(new URL(m[1], pageUrl).toString()); } catch { /* skip */ }
  }
  CAPTCHA_PATH_RE.lastIndex = 0;
  return [...new Set(out)].slice(0, 4);
}
export function firstPartyScripts(html, pageUrl) {
  let host = "";
  try { host = new URL(pageUrl).hostname; } catch { return []; }
  const out = [];
  const re = /<script\b[^>]{0,400}\bsrc\s*=\s*["']([^"']{1,400})["']/gi;
  const src = String(html);
  for (let m = re.exec(src); m && out.length < 8; m = re.exec(src)) {
    try {
      const u = new URL(m[1], pageUrl);
      if (u.hostname === host && u.protocol === "https:") out.push(u.toString());
    } catch { /* skip */ }
  }
  return out;
}

// A picture answer → a data URL (image/* bytes, a data: string, or JSON carrying one).
export function pictureFrom(res) {
  if (!res || res.fail || res.status !== 200) return null;
  const ct = String(res.ct || "");
  if (ct.startsWith("image/") && res.bytes && res.bytes.length > 50 && res.bytes.length <= PC711_IMAGE_MAX) {
    const safe = /^image\/[a-z0-9.+-]{1,20}$/.test(ct) ? ct : "image/png";
    return `data:${safe};base64,${Buffer.from(res.bytes).toString("base64")}`;
  }
  const text = res.bytes ? Buffer.from(res.bytes).toString("utf8") : "";
  const d = text.match(/data:image\/[a-z0-9.+-]{1,20};base64,[A-Za-z0-9+/=]{100,300000}/i);
  if (d) return d[0];
  if (/json/.test(ct)) {
    try {
      const j = JSON.parse(text);
      const walk = (v, depth) => {
        if (depth > 3 || v == null) return null;
        if (typeof v === "string" && /^[A-Za-z0-9+/=]{200,300000}$/.test(v)) return `data:image/png;base64,${v}`;
        if (typeof v === "object") for (const x of Object.values(v)) { const r = walk(x, depth + 1); if (r) return r; }
        return null;
      };
      return walk(j, 0);
    } catch { return null; }
  }
  return null;
}

// The one-tap 快速登入 control for a remembered device: a form (no password / 驗證碼 / SMS field)
// or a link / button URL that says 快速登入 or "quick". Never a form that asks for a secret.
const QUICK_RE = /quick|fast|oneclick|express/i;
export function findQuickLogin(html, forms, pageUrl) {
  for (const f of forms) {
    if (f.id === "loginForm" || f.id === "smsCodeForm" || f.id === "appSmsCodeForm" || f.id === "oidcDialogForm") continue;
    if (!(QUICK_RE.test(f.id) || QUICK_RE.test(f.action))) continue;
    if (hasField(f, SECRET_FIELD_RE)) continue;
    return { kind: "form", form: f };
  }
  const src = String(html);
  const aRe = /<a\b([^>]{0,600})>([\s\S]{0,300}?)<\/a>/gi;
  for (let m = aRe.exec(src); m; m = aRe.exec(src)) {
    const text = m[2].replace(/<[^>]{0,200}>/g, "");
    if (!(text.includes("快速登入") || QUICK_RE.test(m[1]))) continue;
    const h = m[1].match(/\bhref\s*=\s*["']([^"']{1,600})["']/i);
    if (!h || /^(javascript:|#)/i.test(h[1])) continue;
    try { return { kind: "link", url: new URL(h[1], pageUrl).toString() }; } catch { /* skip */ }
  }
  const bRe = /<(?:button|input|div|span)\b([^>]{0,600})>([\s\S]{0,200}?)(?=<)/gi;
  for (let m = bRe.exec(src); m; m = bRe.exec(src)) {
    const said = m[2].includes("快速登入") || /value=["'][^"']*快速登入/.test(m[1]) || QUICK_RE.test(m[1]);
    if (!said) continue;
    const on = m[1].match(/location(?:\.href)?\s*=\s*\\?["']([^"'\\]{1,600})\\?["']/i);
    if (!on) continue;
    try { return { kind: "onclick", url: new URL(on[1], pageUrl).toString() }; } catch { /* skip */ }
  }
  return null;
}

// The page's own error text (≤ 120 characters), never anything the admin typed.
export function pageErrorText(html, secrets = []) {
  const src = String(html);
  const tries = [];
  const al = src.match(/\balert\(\s*(["'])([^"'\n]{1,200})\1/);
  if (al) tries.push(al[2]);
  const elRe = /<(div|span|p|label|li|small)\b[^>]{0,300}?(?:id|class)\s*=\s*["'][^"']{0,120}(?:error|errmsg|err-|alert|msg|warn|validation)[^"']{0,120}["'][^>]{0,300}>([\s\S]{1,400}?)<\/\1>/gi;
  for (let m = elRe.exec(src); m && tries.length < 8; m = elRe.exec(src)) tries.push(m[2]);
  for (const raw of tries) {
    const text = raw.replace(/<[^>]{0,300}>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const cut = text.slice(0, 120);
    if (secrets.some((x) => x && String(x).length >= 3 && cut.includes(String(x)))) return null;
    if (/\d{6,}/.test(cut)) return null; // a number this long could be a phone or a code
    return cut;
  }
  return null;
}

export function normalizeMobile(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("886")) d = d.slice(3);
  if (/^9\d{8}$/.test(d)) d = `0${d}`;
  return /^09\d{8}$/.test(d) ? d : "";
}

// Does the answer actually SHOW the SMS step? The measured login page always carries #smsCodeForm,
// so its presence is not enough — a wrong 驗證碼 / password returns the same page. A marker is: the
// page says the code was sent (已發送 / 已寄送 / …sent), a JSON answer says so, or the SMS block is
// shown while the login block is hidden. Words only; nothing the admin typed is read.
export function smsShownMarker(html, ct = "") {
  const src = String(html);
  if (/已發送|已寄送|已傳送|簡訊(?:驗證碼)?(?:已|即將)?(?:發送|寄送|傳送)|(?:verification|sms|otp)[^<]{0,24}\bsent\b|\bcode\b[^<]{0,8}\bsent\b/i.test(src)) return true;
  if (/json/i.test(ct)) {
    try {
      const flat = JSON.stringify(JSON.parse(src)).toLowerCase();
      if (/"(?:smssent|sent|sendsms|issmssent|otpsent)"\s*:\s*(?:true|1|"?y)/.test(flat)) return true;
      if (/"(?:step|next|stage)"\s*:\s*"?sms/.test(flat)) return true;
    } catch { /* not json */ }
  }
  const hiddenNear = (id) => {
    const at = src.search(new RegExp(`<form\\b[^>]{0,400}id=["']${id}["']`, "i"));
    if (at < 0) return null; // the form is absent
    const gt = src.indexOf(">", at); // the form's OWN opening tag only (a sibling form must not bleed in)
    const tag = src.slice(at, gt < 0 ? at + 400 : gt + 1);
    return /display\s*:\s*none|visibility\s*:\s*hidden|\b(?:hidden|d-none|is-hidden|hide)\b/i.test(tag);
  };
  return hiddenNear("smsCodeForm") === false && hiddenNear("loginForm") === true;
}

// The host a form would post / get to. The password and the SMS code go only to OPENPOINT.
const actionHost = (form, pageUrl) => { try { return new URL(form.action || pageUrl, pageUrl).hostname; } catch { return ""; } };

const taipeiDay = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
const word = (w) => String(w || "").replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "-";

// ── the login ────────────────────────────────────────────────────────────────
// opts: fetchImpl, now, log, store ({ load, save, clear }), env, readSetting, newId.
export function createPc711Login(opts = {}) {
  const { fetchImpl = fetch, now = Date.now, log = console.log, store = null, env = process.env, readSetting = null } = opts;
  const newId = opts.newId || (() => crypto.randomBytes(16).toString("hex"));
  const key = sessionKeyFrom(env);
  let row = null;          // the saved row (blob + state fields)
  let phoneTail = "";      // from the blob
  let flow = null;         // the one login flow in progress

  const say = (step, http, ms, w) => { try { log(`${TAG} ${step} http=${http ?? 0} ms=${ms ?? 0} ${word(w)}`); } catch { /* never stops */ } };
  // submit logs several fixed words (the form ids are sanitized; everything else is 0/1/html/json)
  const sayWords = (step, http, ms, words) => { try { log(`${TAG} ${step} http=${http ?? 0} ms=${ms ?? 0} ${words}`); } catch { /* never stops */ } };
  const idWord = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 24);

  // One request through the host list, the jar and a 15 s limit. binary=true keeps the bytes.
  async function request(jar, url, init = {}) {
    if (!isAllowedPc711Url(url)) return { fail: "refused", ms: 0 };
    const u = new URL(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PC711_REQUEST_MS);
    const t0 = now();
    try {
      const headers = { "user-agent": UA, "accept-language": "zh-TW,zh;q=0.9,en;q=0.8", ...(init.headers || {}) };
      const cookie = jar.header(u.hostname);
      if (cookie) headers.cookie = cookie;
      const r = await fetchImpl(u.toString(), { method: init.method || "GET", headers, body: init.body, redirect: "manual", signal: ctl.signal });
      jar.store(u.hostname, r.headers, now());
      const bytes = await readBytes(r);
      if (bytes === null) return { fail: "too_big", ms: now() - t0, host: u.hostname };
      const ct = String(r.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
      return {
        status: r.status, url: u.toString(), host: u.hostname, ct, bytes, ms: now() - t0,
        text: init.binary ? "" : Buffer.from(bytes).toString("utf8"),
        location: r.status >= 300 && r.status < 400 ? String(r.headers?.get?.("location") || "") : "",
      };
    } catch (e) {
      return { fail: e?.name === "AbortError" || ctl.signal.aborted ? "timeout" : "network", ms: now() - t0, host: u.hostname };
    } finally { clearTimeout(timer); }
  }
  async function readBytes(r) {
    const declared = Number(r.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > PC711_BODY_MAX) { try { await r.body?.cancel?.(); } catch { /* nothing */ } return null; }
    const reader = r.body?.getReader?.();
    if (!reader) {
      const buf = typeof r.arrayBuffer === "function" ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array(Buffer.from(String(await r.text())));
      return buf.length > PC711_BODY_MAX ? null : buf;
    }
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PC711_BODY_MAX) { try { await reader.cancel(); } catch { /* nothing */ } return null; }
      chunks.push(value);
    }
    const all = new Uint8Array(size); let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    return all;
  }
  // Redirects by hand (≤ 6), each hop through the host list. A POST that is redirected becomes a GET.
  async function follow(jar, res, referer) {
    let hops = 0, cur = res;
    while (!cur.fail && cur.location && hops < PC711_MAX_HOPS) {
      let next;
      try { next = new URL(cur.location, cur.url).toString(); } catch { return { fail: "bad_redirect", ms: cur.ms }; }
      hops += 1;
      cur = await request(jar, next, { headers: { referer: referer || cur.url } });
    }
    if (!cur.fail && cur.location) return { fail: "too_many_redirects", ms: cur.ms };
    return cur;
  }
  async function submitForm(jar, form, pageUrl, fields) {
    let action;
    try { action = new URL(form.action || pageUrl, pageUrl); } catch { return { fail: "bad_action", ms: 0 }; }
    const body = new URLSearchParams(fields).toString();
    const origin = (() => { try { return new URL(pageUrl).origin; } catch { return ""; } })();
    if (String(form.method || "get").toLowerCase() === "post") {
      return follow(jar, await request(jar, action.toString(), {
        method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", origin, referer: pageUrl },
      }), pageUrl);
    }
    action.search = body;
    return follow(jar, await request(jar, action.toString(), { headers: { referer: pageUrl } }), pageUrl);
  }

  // Logged in on myship = the cart page carries a MemberSid (≥ 4 characters), as the probe checks.
  async function checkLoggedIn(jar) {
    let gm = "";
    try { gm = parseProbeConfig({ gms: readSetting ? await readSetting("parcel_check_shared_gms") : "" }).gm; } catch { gm = ""; }
    if (!gm) return { ok: false, word: "config_missing" };
    const res = await request(jar, `https://${MYSHIP}/cart/easy/${gm}`);
    if (res.fail) return { ok: false, word: res.fail, res };
    const forms = res.status === 200 ? parseForms(res.text, { budgetMs: 250 }) : [];
    const cart = forms.find((f) => f.id === "MyCart");
    const ok = Boolean(cart) && String(fieldOf(cart, "MemberSid") ?? "").length >= 4;
    return { ok, word: ok ? "logged_in" : "logged_out", res };
  }

  // ── saved row ───────────────────────────────────────────────────────────────
  async function persist(patch) {
    row = { ...(row || {}), ...patch, updated_at: new Date(now()).toISOString() };
    if (store) await store.save(row);
  }
  async function saveSession(jarDump, extra = {}) {
    const blob = encryptBlob({ v: 1, cookies: jarDump, phoneTail }, key);
    await persist({ blob, state: "connected", last_problem: null, ...extra });
  }
  const sessionCookies = () => {
    if (!key || !row || !row.blob) return null;
    const b = decryptBlob(row.blob, key);
    return b && b.cookies && typeof b.cookies === "object" ? b.cookies : null;
  };

  async function load() {
    if (!key || !store) return;
    try {
      row = (await store.load()) || null;
      const b = row && row.blob ? decryptBlob(row.blob, key) : null;
      phoneTail = b && typeof b.phoneTail === "string" ? b.phoneTail : "";
      if (row && row.blob && !b) row = { ...row, state: "needs_login", last_problem: "decrypt_failed" };
      say("load", 0, 0, row && row.blob ? row.state || "connected" : "empty");
    } catch { say("load", 0, 0, "store_error"); }
  }

  function status() {
    if (!key) return { state: "key_missing", since: null, lastOkAt: null, autoLogins: 0, phoneTail: "", lastProblem: "key_missing" };
    if (!row || !row.blob) return { state: "not_connected", since: null, lastOkAt: null, autoLogins: 0, phoneTail: "", lastProblem: row?.last_problem ? word(row.last_problem) : null };
    return {
      state: row.state === "needs_login" ? "needs_login" : "connected",
      since: row.since || null, lastOkAt: row.last_ok_at || null, autoLogins: Number(row.auto_logins || 0),
      phoneTail, lastProblem: row.last_problem ? word(row.last_problem) : null,
    };
  }

  // ── the admin login flow ─────────────────────────────────────────────────────
  const flowAlive = (id) => flow && flow.id === id && now() - flow.at < PC711_FLOW_MS;

  async function fetchPicture(f) {
    for (const c of f.candidates) {
      if (c.data) { f.captchaUrl = null; return { data: c.data, source: c.source }; }
      const res = await request(f.jar, c.url, { binary: true, headers: { referer: f.pageUrl, accept: "image/*,*/*;q=0.8" } });
      say("captcha", res.status, res.ms, res.fail || c.source);
      const data = pictureFrom(res);
      if (data) { f.captchaUrl = c.url; f.captchaSource = c.source; return { data, source: c.source }; }
    }
    return null;
  }

  async function start() {
    if (!key) return { error: "key_missing" };
    flow = null;
    // the saved OPENPOINT cookies go along, so a remembered server may be asked fewer questions
    const saved = sessionCookies() || {};
    const jar = createPc711Jar(Object.fromEntries(Object.entries(saved).filter(([h]) => h !== MYSHIP)));
    const res = await follow(jar, await request(jar, PC711_LOGIN_URL));
    if (res.fail) { say("start", 0, res.ms, res.fail); return { error: res.fail === "refused" ? "refused_host" : "unreachable" }; }
    const info = pageInfo(res.text);
    say("start", res.status, res.ms, info.loginForm ? "login_form" : res.host === MYSHIP ? "myship" : "no_form");
    if (!info.loginForm) return { error: "login_form_missing" };
    const f = { id: newId(), at: now(), jar, pageUrl: res.url, html: res.text, loginForm: info.loginForm, candidates: captchaCandidates(res.text, res.url), captchaUrl: null, sms: null };
    // the picture is not a plain <img> on the measured page → also look in the page's own scripts
    if (!f.candidates.some((c) => c.source === "img" || c.source === "img_data")) {
      for (const s of firstPartyScripts(res.text, res.url).slice(0, 4)) {
        const sr = await request(jar, s, { headers: { referer: res.url } });
        if (sr.fail || sr.status !== 200) continue;
        for (const u of captchaPathsInScript(sr.text, res.url)) if (!f.candidates.some((c) => c.url === u)) f.candidates.push({ url: u, source: "script" });
        if (f.candidates.length >= 6) break;
      }
    }
    flow = f;
    const pic = await fetchPicture(f);
    if (!pic) { say("captcha", 0, 0, "not_found"); return { flowId: f.id, captcha: null, error: "captcha_not_found" }; }
    return { flowId: f.id, captcha: pic.data };
  }

  async function captcha({ flowId } = {}) {
    if (!key) return { error: "key_missing" };
    if (!flowAlive(flowId)) return { error: "flow_expired" };
    if (!flow.captchaUrl) { const pic = await fetchPicture(flow); return pic ? { captcha: pic.data } : { error: "captcha_not_found" }; }
    const u = new URL(flow.captchaUrl);
    u.searchParams.set("_", String(now()));
    const res = await request(flow.jar, u.toString(), { binary: true, headers: { referer: flow.pageUrl, accept: "image/*,*/*;q=0.8" } });
    say("captcha", res.status, res.ms, res.fail || "refresh");
    const data = pictureFrom(res);
    return data ? { captcha: data } : { error: "captcha_not_found" };
  }

  async function submit({ flowId, mobile, password, verifyCode } = {}) {
    if (!key) return { error: "key_missing" };
    if (!flowAlive(flowId)) return { step: "error", message: "flow_expired" };
    const m = normalizeMobile(mobile);
    const pw = typeof password === "string" ? password : "";
    const vc = String(verifyCode ?? "").trim();
    if (!m) return { step: "error", message: "bad_mobile" };
    if (!pw || pw.length > 64) return { step: "error", message: "bad_password" };
    if (!/^[A-Za-z0-9]{3,10}$/.test(vc)) return { step: "error", message: "bad_code" };
    const f = flow;
    // the password + the 驗證碼 go ONLY to OPENPOINT: the login form's action host is pinned here
    if (actionHost(f.loginForm, f.pageUrl) !== OPENPOINT) { say("submit", 0, 0, "refused_host"); return { step: "error", message: "refused_host" }; }
    const patch = { mobile: m, passwd_d: pw, verifyCode: vc };
    const fields = f.loginForm.fields.map(([k, v]) => [k, Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : v]);
    for (const k of Object.keys(patch)) if (!fields.some((x) => x[0] === k)) fields.push([k, patch[k]]);
    // "Remember this server": the trust_browser checkbox is sent checked, with its served value
    if (!fields.some((x) => x[0] === "trust_browser")) fields.push(["trust_browser", checkboxValue(f.html, "loginForm", "trust_browser")]);
    const res = await submitForm(f.jar, f.loginForm, f.pageUrl, fields);
    if (res.fail) { say("submit", 0, res.ms, res.fail); return { step: "error", message: "unreachable" }; }
    const info = pageInfo(res.text);
    phoneTail = m.slice(-3);
    // decide by what the answer shows, NOT just that #smsCodeForm is on the page (it always is)
    const ctKind = /json/i.test(res.ct) ? "json" : "html";
    const errText = pageErrorText(res.text, [m, pw, vc]);
    const smsMarker = smsShownMarker(res.text, res.ct);
    const formIds = (info.forms.map((x) => idWord(x.id)).filter(Boolean).slice(0, 6).join(",")) || "-";
    sayWords("submit", res.status, res.ms, `forms=${formIds} err=${errText ? 1 : 0} ct=${ctKind} sms_marker=${smsMarker ? 1 : 0}`);
    // (a) the page shows an error → wrong 驗證碼 / password / etc.
    if (errText) return { step: "error", message: errText };
    // (b) reached myship = logged in
    if (res.host === MYSHIP) {
      const li = await finishLogin(f.jar, res);
      if (li.ok) { flow = null; return { step: "connected" }; }
      return { step: "error", message: li.word };
    }
    // (c) SMS step — ONLY when it is really shown (login form gone, or an explicit sent marker)
    if (info.smsForm && (!info.loginForm || smsMarker)) {
      f.sms = { form: info.smsForm, url: res.url };
      return { step: "sms", phoneTail };
    }
    // (d)
    return { step: "error", message: "login_failed" };
  }

  async function finishLogin(jar, res) {
    let cur = res;
    for (let i = 0; i < 3 && !cur.fail && cur.host !== MYSHIP; i++) {
      const info = pageInfo(cur.text);
      if (!info.consentForm) break;
      cur = await submitForm(jar, info.consentForm, cur.url, info.consentForm.fields);
      say("consent", cur.status, cur.ms, cur.fail || "sent");
    }
    if (cur.fail) return { ok: false, word: cur.fail };
    const li = await checkLoggedIn(jar);
    if (!li.ok) return li;
    await saveSession(jar.dump(), { since: new Date(now()).toISOString(), last_ok_at: new Date(now()).toISOString(), auto_logins: Number(row?.auto_logins || 0) });
    return { ok: true, word: "connected" };
  }

  async function sms({ flowId, code } = {}) {
    if (!key) return { error: "key_missing" };
    if (!flowAlive(flowId) || !flow.sms) return { step: "error", message: "flow_expired" };
    const c = String(code ?? "").replace(/\s/g, "");
    if (!/^\d{4,8}$/.test(c)) return { step: "error", message: "bad_sms" };
    const f = flow;
    // the SMS code goes ONLY to OPENPOINT: the SMS form's action host is pinned here
    if (actionHost(f.sms.form, f.sms.url) !== OPENPOINT) { say("sms", 0, 0, "refused_host"); return { step: "error", message: "refused_host" }; }
    let k = 0;
    const fields = f.sms.form.fields.map(([n, v]) => {
      if (n === "smsCode") return [n, c];
      if (/^smsVerify/.test(n)) { const d = c[k] ?? ""; k += 1; return [n, d]; }
      return [n, v];
    });
    if (!fields.some((x) => x[0] === "smsCode")) fields.push(["smsCode", c]);
    const res = await submitForm(f.jar, f.sms.form, f.sms.url, fields);
    if (res.fail) { say("sms", 0, res.ms, res.fail); return { step: "error", message: "unreachable" }; }
    const info = pageInfo(res.text);
    if (res.host !== MYSHIP && info.smsForm && !info.consentForm) {
      const msg = pageErrorText(res.text, [c]);
      say("sms", res.status, res.ms, "sms_again");
      return { step: "error", message: msg || "sms_failed" };
    }
    const li = await finishLogin(f.jar, res);
    say("sms", res.status, res.ms, li.ok ? "connected" : li.word);
    if (!li.ok) return { step: "error", message: li.word };
    flow = null;
    return { step: "connected" };
  }

  async function disconnect() {
    if (!key) return { error: "key_missing" };
    flow = null; phoneTail = "";
    row = null;
    if (store) await store.clear();
    say("disconnect", 0, 0, "ok");
    return { ok: true };
  }

  // ── for the probe ─────────────────────────────────────────────────────────────
  async function getSession() {
    if (!row || row.state === "needs_login") return null;
    const cookies = sessionCookies();
    return cookies ? { cookies } : null;
  }
  async function saveCookies(dump) {
    if (!key || !row || !row.blob || !dump || typeof dump !== "object") return;
    const merged = { ...(sessionCookies() || {}) };
    for (const [h, v] of Object.entries(dump)) if (PC711_HOSTS.includes(h) && v) merged[h] = String(v);
    await saveSession(merged, { last_ok_at: new Date(now()).toISOString() });
  }
  // ONE quick re-login with the saved session: limits first, then the page's own 快速登入.
  async function quickRelogin() {
    if (!key || !row || !row.blob || row.state === "needs_login") return null;
    const t = now();
    const day = taipeiDay(t);
    const lastAt = row.last_quick_at ? Date.parse(row.last_quick_at) : 0;
    const dayCount = row.quick_day === day ? Number(row.quick_day_count || 0) : 0;
    if (lastAt && t - lastAt < PC711_QUICK_GAP_MS) { say("quick", 0, 0, "too_soon"); return null; }
    if (dayCount >= PC711_QUICK_PER_DAY) { say("quick", 0, 0, "day_limit"); return null; }
    await persist({ last_quick_at: new Date(t).toISOString(), quick_day: day, quick_day_count: dayCount + 1 });
    const jar = createPc711Jar(sessionCookies() || {});
    let res = await follow(jar, await request(jar, PC711_LOGIN_URL));
    let used = "";
    for (let i = 0; i < 3 && !res.fail && res.host !== MYSHIP; i++) {
      const info = pageInfo(res.text);
      if (info.consentForm) { res = await submitForm(jar, info.consentForm, res.url, info.consentForm.fields); used = "consent"; continue; }
      const q = findQuickLogin(res.text, info.forms, res.url);
      if (q && q.kind === "form") { res = await submitForm(jar, q.form, res.url, q.form.fields); used = "form"; continue; }
      if (q) { res = await follow(jar, await request(jar, q.url, { headers: { referer: res.url } }), res.url); used = q.kind; continue; }
      const w = info.smsForm ? "asks_sms" : info.loginForm ? "asks_password" : "unknown_page";
      say("quick", res.status, res.ms, w);
      if (info.smsForm || info.loginForm) await persist({ state: "needs_login", last_problem: "needs_login" });
      else await persist({ last_problem: w });
      return null;
    }
    if (res.fail) { say("quick", 0, res.ms, res.fail); await persist({ last_problem: res.fail }); return null; }
    if (res.host !== MYSHIP) { say("quick", res.status, res.ms, "no_myship"); await persist({ last_problem: "no_myship" }); return null; }
    const li = await checkLoggedIn(jar);
    if (!li.ok) {
      say("quick", li.res?.status, li.res?.ms, li.word);
      if (li.word === "logged_out") await persist({ state: "needs_login", last_problem: "needs_login" });
      else await persist({ last_problem: li.word });
      return null;
    }
    await saveSession(jar.dump(), { last_ok_at: new Date(now()).toISOString(), auto_logins: Number(row.auto_logins || 0) + 1 });
    say("quick", li.res?.status, li.res?.ms, used ? `ok_${used}` : "ok");
    return { cookies: jar.dump() };
  }

  return { load, status, start, captcha, submit, sms, disconnect, getSession, saveCookies, quickRelogin, hasKey: () => Boolean(key), _flow: () => flow };
}

// ── routes (server.js mounts these behind requireAuth + requireAdmin + its own limiter) ──
// allowed = the login limiter (the costly routes); statusAllowed = the read-only status limiter,
// kept separate so polling status never uses up the login budget. Default: status is unlimited.
export function createPc711Handlers(login, { allowed = () => Boolean(1), statusAllowed = () => Boolean(1) } = {}) {
  const guard = (fn) => async (req, res) => {
    if (!allowed(req.authUserId || "admin")) return res.status(429).json({ error: "rate_limited" });
    try {
      const out = await fn(req.body || {});
      if (out && out.error === "key_missing") return res.status(503).json({ error: "key_missing" });
      return res.json(out);
    } catch {
      return res.status(500).json({ error: "failed" });
    }
  };
  return {
    start: guard(() => login.start()),
    captcha: guard((b) => login.captcha({ flowId: String(b.flowId || "") })),
    submit: guard((b) => login.submit({ flowId: String(b.flowId || ""), mobile: b.mobile, password: b.password, verifyCode: b.verifyCode })),
    sms: guard((b) => login.sms({ flowId: String(b.flowId || ""), code: b.code })),
    disconnect: guard(() => login.disconnect()),
    status: async (req, res) => {
      if (!statusAllowed(req.authUserId || "admin")) return res.status(429).json({ error: "rate_limited" });
      return res.json(login.status());
    },
  };
}

// The saved row in Supabase (sql/158), service role only.
export function createPc711Store(serviceSb) {
  if (!serviceSb) return null;
  const T = "pc711_session";
  return {
    async load() {
      const { data, error } = await serviceSb.from(T).select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async save(r) {
      const { error } = await serviceSb.from(T).upsert({
        id: 1, blob: r.blob ?? null, state: r.state ?? null, since: r.since ?? null, last_ok_at: r.last_ok_at ?? null,
        auto_logins: Number(r.auto_logins || 0), last_quick_at: r.last_quick_at ?? null, quick_day: r.quick_day ?? null,
        quick_day_count: Number(r.quick_day_count || 0), last_problem: r.last_problem ?? null, updated_at: r.updated_at ?? new Date().toISOString(),
      });
      if (error) throw error;
    },
    async clear() {
      const { error } = await serviceSb.from(T).delete().eq("id", 1);
      if (error) throw error;
    },
  };
}
