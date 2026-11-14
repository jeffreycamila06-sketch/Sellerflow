// 7-11 CHECKER LOGIN — the Render server logs in to 7-11 (OPENPOINT) itself, once, with the admin
// typing phone + password + 驗證碼 (picture) + SMS code in Admin → 7-11 Login. The server keeps the
// session (encrypted, sql/158) and, when myship has logged it out, tries ONCE the page's own one-tap
// 快速登入 for a remembered device. The probe's STORE step (server/pcServerProbe.js) uses this session.
//
// This talks to the REAL OPENPOINT login, which is NOT a plain HTML form — it is a set of jQuery
// $.ajax (POST, application/x-www-form-urlencoded, X-Requested-With: XMLHttpRequest, Accept:
// application/json) calls under https://bu-group.openpoint.com.tw/auth/service. HTTP 2xx = success
// (JSON); non-2xx = error with JSON { codeId, codeDescription }.
//
// HARD RULES
//   - The password and the picture code live in the server's MEMORY ONLY, inside the one login flow
//     (7-11 asks for them again at the SMS step). The SMS code is used once. NONE is ever stored in
//     the database, written to a log, or returned to the client. All are wiped on: connected, any
//     error that ends the flow, Back to step 1, a new Connect, the 10-minute expiry, disconnect, and
//     a server restart (memory only).
//   - No request or response BODY is ever logged.
//   - Every password / SMS request goes ONLY to bu-group.openpoint.com.tw (the ajax() base is pinned).
//     Allowed hosts overall: myship.7-11.com.tw, bu-group.openpoint.com.tw, the two E-Map hosts.
//     Anything else is refused BEFORE any request. /cart/finish is never requested.
//   - Logs: `[PC711_LOGIN] <step> http=<n> ms=<n> <words>` only (a sanitized codeId at most).
//   - The session is saved only encrypted (AES-256-GCM, key = env PC711_SESSION_KEY). No key →
//     state key_missing, every route refuses, nothing is stored.
//   - Quick re-login: at most 1 try per 10 minutes and 6 per Taipei day. Anything that asks for a
//     passkey / password / picture / SMS → state needs_login, stop. It never types a password.
//
// ⚠️ NOT PROVEN on the real site (the container that wrote this cannot reach 7-11): the exact route
// paths, field names, the OidcRedirect form post and the 快速登入 (quick-login) JSON calls. They were
// read from OPENPOINT's own login scripts in a browser (nothing typed or sent). Every test uses a
// fake server built from those names.

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
export const PC711_IMAGE_MAX = 300 * 1024;
const MYSHIP = "myship.7-11.com.tw";
const OPENPOINT = "bu-group.openpoint.com.tw"; // the password and the SMS code may only be sent here
const AUTHORIZE_REF = `https://${OPENPOINT}/auth/service/authorize`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TAG = "[PC711_LOGIN]";

// OPENPOINT routes (pic.context = "/auth", requestService = "/auth/service"). ⚠️ NOT PROVEN.
export const PC711_ROUTES = {
  captcha: "/auth/service/getCaptcha",
  validate: "/auth/service/ajax/login/validate",
  doLogin: "/auth/service/ajax/login/doLoginForOidc",
  resend: "/auth/service/ajax/login/member/resend-sms-code",
  redirect: "/auth/service/OidcRedirect.html",
  redirectAlt: "/auth/OidcRedirect.html",
  quickCandidates: "/auth/service/ajax/login/oidc/quick-login/candidates",
  quickSelect: "/auth/service/ajax/login/oidc/quick-login/select",
  quickHandoff: "/auth/service/OidcQuickLoginHandoff.html",
};
// the inline-script values read from the authorize page; a client id (one of the first two) + the rest
export const PC711_PAGE_VARS = ["oidc_client_id", "clientId", "state", "nonce", "scope", "maxAge", "codeChallenge", "loginTxId", "redirectUri", "token"];
// these must be PRESENT AND NON-EMPTY (+ a client id, checked separately). On the real page maxAge and
// token are present but EMPTY, and scope may vary — none of those are required to be non-empty.
const REQUIRED_NONEMPTY = ["state", "nonce", "codeChallenge", "loginTxId", "redirectUri"];
// 7-11 codeIds for a wrong picture code (fetch a new picture); 704 = password; 735 = too many wrong SMS
const WRONG_CAPTCHA = ["B111002", "B111003", "B151002"];
const QUICK_SECRET_RE = /passkey|webauthn|credential|fido|password|passwd|captcha|otp|smscode|verifycode/i;

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

// The JS string values set in the authorize page's inline scripts: `name = "x"` / `name: "x"` /
// `"name":"x"`. A name that is PRESENT keeps its value (which may be the empty string ""); a name that
// is NOT found is simply absent from the map. So the real page's `var maxAge = '';` reads back as "".
export function readScriptVars(html, names = PC711_PAGE_VARS) {
  const src = String(html);
  const found = {};
  for (const n of names) {
    const re = new RegExp(`["']?\\b${n}\\b["']?\\s*[:=]\\s*(["'])([^"']*)\\1`);
    const m = src.match(re);
    if (m) found[n] = m[2]; // present → value (possibly ""); absent → not set
  }
  return found;
}

export function normalizeMobile(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("886")) d = d.slice(3);
  if (/^9\d{8}$/.test(d)) d = `0${d}`;
  return /^09\d{8}$/.test(d) ? d : "";
}

const taipeiDay = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
const word = (w) => String(w || "").replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "-";
const sanCode = (c) => (String(c ?? "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 12) || "-");
const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");
const codeOf = (j) => (j && (j.codeId ?? j.code ?? j.codeID)) ?? "";
const descOf = (j) => { const d = j && (j.codeDescription ?? j.message ?? j.msg); return typeof d === "string" && d.trim() ? d.trim().slice(0, 200) : ""; };

// ── the login ────────────────────────────────────────────────────────────────
// opts: fetchImpl, now, log, store ({ load, save, clear }), env, readSetting, newId.
export function createPc711Login(opts = {}) {
  const { fetchImpl = fetch, now = Date.now, log = console.log, store = null, env = process.env, readSetting = null } = opts;
  const newId = opts.newId || (() => crypto.randomBytes(16).toString("hex"));
  const key = sessionKeyFrom(env);
  let row = null;          // the saved row (blob + state fields)
  let phoneTail = "";      // from the blob
  let flow = null;         // the one login flow in progress (holds the password/picture in memory only)

  const say = (step, http, ms, w) => { try { log(`${TAG} ${step} http=${http ?? 0} ms=${ms ?? 0} ${word(w)}`); } catch { /* never stops */ } };
  const sayWords = (step, http, ms, words) => { try { log(`${TAG} ${step} http=${http ?? 0} ms=${ms ?? 0} ${words}`); } catch { /* never stops */ } };

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
      try { next = new URL(cur.location, cur.url).toString(); } catch { return { fail: "bad_redirect", ms: cur.ms, hops }; }
      hops += 1;
      cur = await request(jar, next, { headers: { referer: referer || cur.url } });
    }
    if (!cur.fail && cur.location) return { fail: "too_many_redirects", ms: cur.ms, hops };
    return { ...cur, hops };
  }

  // The ONE way a password / SMS request is sent — always to OPENPOINT, urlencoded, as jQuery $.ajax.
  async function ajax(jar, path, fields, referer) {
    const res = await request(jar, `https://${OPENPOINT}${path}`, {
      method: "POST",
      body: new URLSearchParams(fields).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest", accept: "application/json",
        origin: `https://${OPENPOINT}`, referer: referer || AUTHORIZE_REF,
      },
    });
    if (res.fail) return { fail: res.fail, ms: res.ms, status: 0, json: null };
    let json = null;
    try { json = JSON.parse(res.text); } catch { json = null; }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, json, ms: res.ms, ct: res.ct };
  }

  // Same, but the body is JSON (OPENPOINT's quick-login postQuickLoginJson sends application/json).
  async function ajaxJson(jar, path, obj, referer) {
    const res = await request(jar, `https://${OPENPOINT}${path}`, {
      method: "POST",
      body: JSON.stringify(obj || {}),
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest", accept: "application/json",
        origin: `https://${OPENPOINT}`, referer: referer || AUTHORIZE_REF,
      },
    });
    if (res.fail) return { fail: res.fail, ms: res.ms, status: 0, json: null };
    let json = null;
    try { json = JSON.parse(res.text); } catch { json = null; }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, json, ms: res.ms, ct: res.ct };
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

  // The picture: POST getCaptcha (empty body) → JSON { imgInfo: <base64> } → a data: GIF URL.
  async function fetchCaptcha(jar, referer) {
    const res = await ajax(jar, PC711_ROUTES.captcha, {}, referer);
    if (res.fail || !res.ok) { say("captcha", res.status || 0, res.ms || 0, res.fail || "no_img"); return null; }
    const img = res.json && typeof res.json.imgInfo === "string" ? res.json.imgInfo : "";
    if (!/^[A-Za-z0-9+/=]{50,400000}$/.test(img)) { say("captcha", res.status, res.ms, "no_img"); return null; }
    say("captcha", res.status, res.ms, "ok");
    return `data:image/gif;base64,${img}`;
  }

  // The OidcRedirect form post (lgtk + oidc ids) → follow to myship. 404 on the /auth/service path →
  // try the /auth path once; log which.
  async function oidcRedirect(jar, fields, referer) {
    const body = new URLSearchParams(fields).toString();
    const headers = { "content-type": "application/x-www-form-urlencoded", origin: `https://${OPENPOINT}`, referer: referer || `https://${OPENPOINT}/` };
    let res = await follow(jar, await request(jar, `https://${OPENPOINT}${PC711_ROUTES.redirect}`, { method: "POST", body, headers }), referer);
    let path = "service";
    if (!res.fail && res.status === 404) {
      res = await follow(jar, await request(jar, `https://${OPENPOINT}${PC711_ROUTES.redirectAlt}`, { method: "POST", body, headers }), referer);
      path = "auth";
    }
    return { ...res, path };
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
  const wipeSecrets = (f) => { if (f) { f.pw = ""; f.vc = ""; } };
  // memory only, at most PC711_FLOW_MS: an abandoned flow is wiped + dropped by its own timer.
  const clearFlowTimer = (f) => { if (f && f.timer) { try { clearTimeout(f.timer); } catch { /* ignore */ } f.timer = null; } };
  const armFlowTimer = (f) => {
    f.timer = setTimeout(() => {
      if (flow && flow === f) { wipeSecrets(f); f.sms = null; flow = null; say("expire", 0, 0, "flow"); }
    }, PC711_FLOW_MS);
    if (f.timer && typeof f.timer.unref === "function") f.timer.unref();
  };

  // STEP 1 opens: GET myship login → follow to the OPENPOINT authorize page → read its inline vars →
  // get the picture.
  async function start() {
    if (!key) return { error: "key_missing" };
    if (flow) clearFlowTimer(flow);
    flow = null;
    // keep the saved OPENPOINT cookies (a remembered device may be asked fewer questions); drop myship
    const saved = sessionCookies() || {};
    const jar = createPc711Jar(Object.fromEntries(Object.entries(saved).filter(([h]) => h !== MYSHIP)));
    const res = await follow(jar, await request(jar, PC711_LOGIN_URL));
    if (res.fail) { say("start", 0, res.ms, res.fail); return { error: res.fail === "refused" ? "refused_host" : "unreachable" }; }
    if (res.host === MYSHIP) {
      // a remembered device landed straight back on myship — already logged in?
      const li = await checkLoggedIn(jar);
      if (li.ok) {
        await saveSession(jar.dump(), { since: new Date(now()).toISOString(), last_ok_at: new Date(now()).toISOString(), auto_logins: Number(row?.auto_logins || 0) });
        say("start", res.status, res.ms, "myship_connected");
        return { step: "connected" };
      }
      say("start", res.status, res.ms, "myship_not_logged");
      return { error: "login_page_changed" };
    }
    const found = readScriptVars(res.text, PC711_PAGE_VARS);
    const cid = found.oidc_client_id || found.clientId || "";
    // state/nonce/codeChallenge/loginTxId/redirectUri + a client id must be present AND non-empty;
    // maxAge and token may be empty (the real page has them empty) and are sent as "" exactly as served
    const missing = REQUIRED_NONEMPTY.filter((n) => !found[n]);
    if (!cid) missing.unshift("client_id");
    if (missing.length) { sayWords("start", res.status, res.ms, `missing=${missing.slice(0, 8).join(",")}`); return { error: "login_page_changed" }; }
    const token = found.token || "";
    sayWords("start", res.status, res.ms, `page bu=${token ? 1 : 0}`);
    const f = { id: newId(), at: now(), jar, pageUrl: res.url, vars: { ...found, oidc_client_id: cid, maxAge: found.maxAge ?? "", scope: found.scope ?? "" }, token, mobile: "", pw: "", vc: "", sms: null, timer: null };
    flow = f;
    armFlowTimer(f);
    const pic = await fetchCaptcha(jar, res.url);
    if (!pic) return { flowId: f.id, captcha: null, error: "captcha_not_found" };
    return { flowId: f.id, captcha: pic };
  }

  // refresh the picture (↻) = getCaptcha again.
  async function captcha({ flowId } = {}) {
    if (!key) return { error: "key_missing" };
    if (!flowAlive(flowId)) return { error: "flow_expired" };
    const pic = await fetchCaptcha(flow.jar, flow.pageUrl);
    return pic ? { captcha: pic } : { error: "captcha_not_found" };
  }

  // STEP 1 → 2: validate (sends the SMS). Keeps the password + picture code in memory for step 3.
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
    const cid = f.vars.oidc_client_id;
    const fields = { mobileCountry: "886", mobile: m, passwd: b64(pw), verify: vc, verifyType: "sms", oidc_client_id: cid };
    if (f.token) fields.token = f.token;
    const res = await ajax(f.jar, PC711_ROUTES.validate, fields, f.pageUrl);
    phoneTail = m.slice(-3);
    if (res.fail) { say("validate", 0, res.ms, res.fail); return { step: "error", message: "unreachable" }; }
    say("validate", res.status, res.ms, `code=${sanCode(codeOf(res.json))}`);
    if (res.ok) {
      f.mobile = m; f.pw = pw; f.vc = vc; // memory only, wiped on connect / error / back / expiry
      const j = res.json || {};
      const prefix = typeof j.identifier === "string" ? j.identifier.slice(0, 16) : "";
      const alnum = Boolean(j.isOtpAlnum);
      if (typeof j.token === "string" && j.token) f.token = j.token;
      f.sms = { prefix, alnum };
      return { step: "sms", phoneTail, prefix, alnum };
    }
    wipeSecrets(f); // a wrong input never stays in memory
    const code = String(codeOf(res.json));
    const msg = descOf(res.json);
    if (WRONG_CAPTCHA.includes(code)) {
      const pic = await fetchCaptcha(f.jar, f.pageUrl);
      return pic ? { step: "error", message: msg || "bad_code", captcha: pic } : { step: "error", message: msg || "bad_code" };
    }
    return { step: "error", message: msg || (code === "704" ? "bad_password" : "login_failed") };
  }

  // STEP 2: doLoginForOidc (the SMS code) → OidcRedirect form post → myship → save.
  async function sms({ flowId, code } = {}) {
    if (!key) return { error: "key_missing" };
    if (!flowAlive(flowId) || !flow || !flow.sms) return { step: "error", message: "flow_expired" };
    const f = flow;
    const c = String(code ?? "").replace(/\s/g, "").toUpperCase();
    const good = f.sms.alnum ? /^[A-Z0-9]{4,8}$/.test(c) : /^\d{4,8}$/.test(c);
    if (!good) return { step: "error", message: "bad_sms" };
    if (!f.pw || !f.vc) return { step: "error", message: "flow_expired" }; // secrets gone → restart
    const v = f.vars;
    const cid = v.oidc_client_id;
    const fields = {
      mobileCountry: "886", mobile: f.mobile, passwd: b64(f.pw), verify: f.vc, smsCode: c,
      oidc_client_id: cid, state: v.state, nonce: v.nonce, scope: v.scope ?? "", max_age: String(v.maxAge ?? ""),
      code_challenge: v.codeChallenge, trust_browser: "Y", login_tx_id: v.loginTxId,
    };
    if (f.token) fields.token = f.token;
    const res = await ajax(f.jar, PC711_ROUTES.doLogin, fields, f.pageUrl);
    if (res.fail) { say("login", 0, res.ms, res.fail); return { step: "error", message: "unreachable" }; }
    say("login", res.status, res.ms, `code=${sanCode(codeOf(res.json))}`);
    if (!res.ok) {
      const code = String(codeOf(res.json));
      const msg = descOf(res.json);
      if (code === "735") { // too many wrong SMS codes → flow ended, back to step 1 with a new picture
        wipeSecrets(f); f.sms = null;
        const pic = await fetchCaptcha(f.jar, f.pageUrl);
        return { step: "restart", flowId: f.id, message: msg || "too_many_sms", ...(pic ? { captcha: pic } : {}) };
      }
      return { step: "error", message: msg || "login_failed" };
    }
    // 2xx → the OidcRedirect form post (lgtk + oidc ids), then follow to myship
    const j = res.json || {};
    const red = (j.redirect && typeof j.redirect === "object") ? j.redirect : {};
    const redFields = {
      lgtk: red.lgtk || j.lgtk || "", oidc_client_id: cid, state: red.state || j.state || v.state,
      redirectUri: red.redirect_uri || v.redirectUri, login_tx_id: v.loginTxId,
    };
    const rr = await oidcRedirect(f.jar, redFields, f.pageUrl);
    wipeSecrets(f); // the password is no longer needed once the redirect is posted
    if (rr.fail) { say("redirect", 0, rr.ms || 0, rr.fail); return { step: "error", message: rr.fail === "refused" ? "refused_host" : "unreachable" }; }
    const onMyship = rr.host === MYSHIP;
    sayWords("redirect", rr.status || 0, rr.ms || 0, `hops=${rr.hops ?? 0} myship=${onMyship ? 1 : 0} path=${rr.path}`);
    const li = await checkLoggedIn(f.jar);
    if (!li.ok) return { step: "error", message: "login_failed" };
    await saveSession(f.jar.dump(), { since: new Date(now()).toISOString(), last_ok_at: new Date(now()).toISOString(), auto_logins: Number(row?.auto_logins || 0) });
    clearFlowTimer(f);
    flow = null;
    return { step: "connected" };
  }

  // STEP 2 "Send again": resend the SMS; stay on step 2 (no new picture, no password).
  async function resend({ flowId } = {}) {
    if (!key) return { error: "key_missing" };
    if (!flowAlive(flowId) || !flow || !flow.sms) return { step: "error", message: "flow_expired" };
    const f = flow;
    const fields = { mobile: f.mobile, mobileCountry: "886", oidc_client_id: f.vars.oidc_client_id };
    if (f.token) fields.token = f.token;
    const res = await ajax(f.jar, PC711_ROUTES.resend, fields, f.pageUrl);
    if (res.fail) { say("resend", 0, res.ms, res.fail); return { step: "error", message: "unreachable" }; }
    say("resend", res.status, res.ms, `code=${sanCode(codeOf(res.json))}`);
    if (!res.ok) return { step: "error", message: descOf(res.json) || "login_failed" };
    return { step: "sms", resent: true, phoneTail, prefix: f.sms.prefix, alnum: f.sms.alnum };
  }

  // STEP 2 "Back": wipe the password + picture code from memory, return to step 1 with a new picture.
  async function back({ flowId } = {}) {
    if (!key) return { error: "key_missing" };
    if (!flowAlive(flowId) || !flow) return { step: "error", message: "flow_expired" };
    const f = flow;
    wipeSecrets(f); f.sms = null;
    clearFlowTimer(f); armFlowTimer(f); // back to step 1 → a fresh 10-minute window
    const pic = await fetchCaptcha(f.jar, f.pageUrl);
    say("back", 0, 0, pic ? "ok" : "no_img");
    return pic ? { step: "login", captcha: pic } : { step: "login", captcha: null, error: "captcha_not_found" };
  }

  async function disconnect() {
    if (!key) return { error: "key_missing" };
    if (flow) clearFlowTimer(flow);
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

  // ONE quick re-login with the saved session (no password): the page's own JSON quick-login. ⚠️ NOT
  // PROVEN. Any step that asks for a passkey / password / picture / SMS → needs_login, stop.
  async function quickRelogin() {
    if (!key || !row || !row.blob || row.state === "needs_login") return null;
    const t = now();
    const day = taipeiDay(t);
    const lastAt = row.last_quick_at ? Date.parse(row.last_quick_at) : 0;
    const dayCount = row.quick_day === day ? Number(row.quick_day_count || 0) : 0;
    if (lastAt && t - lastAt < PC711_QUICK_GAP_MS) { say("quick", 0, 0, "too_soon"); return null; }
    if (dayCount >= PC711_QUICK_PER_DAY) { say("quick", 0, 0, "day_limit"); return null; }
    await persist({ last_quick_at: new Date(t).toISOString(), quick_day: day, quick_day_count: dayCount + 1 });
    const needsLogin = async (w) => { say("quick", 0, 0, w); await persist({ state: "needs_login", last_problem: "needs_login" }); return null; };
    const jar = createPc711Jar(sessionCookies() || {});
    const auth = await follow(jar, await request(jar, PC711_LOGIN_URL));
    if (auth.fail) { say("quick", 0, auth.ms, auth.fail); await persist({ last_problem: auth.fail }); return null; }
    if (auth.host === MYSHIP) {
      const li = await checkLoggedIn(jar);
      if (li.ok) { await saveSession(jar.dump(), { last_ok_at: new Date(now()).toISOString(), auto_logins: Number(row.auto_logins || 0) + 1 }); say("quick", li.res?.status, li.res?.ms, "ok_cookie"); return { cookies: jar.dump() }; }
      return needsLogin("asks_login");
    }
    const vars = readScriptVars(auth.text, PC711_PAGE_VARS);
    const cid = vars.oidc_client_id || vars.clientId || "";
    if (!cid) return needsLogin("asks_login");
    const tokenF = vars.token ? { token: vars.token } : {};
    // the quick-login calls are JSON (postQuickLoginJson), not urlencoded
    const cand = await ajaxJson(jar, PC711_ROUTES.quickCandidates, { oidc_client_id: cid, ...tokenF }, auth.url);
    if (cand.fail) { say("quick", 0, cand.ms, cand.fail); await persist({ last_problem: cand.fail }); return null; }
    if (!cand.ok) return needsLogin("candidates_no");
    if (QUICK_SECRET_RE.test(JSON.stringify(cand.json || {}))) return needsLogin("asks_secret");
    const list = Array.isArray(cand.json?.candidates) ? cand.json.candidates : Array.isArray(cand.json?.data) ? cand.json.data : [];
    const pick = list[0];
    const pid = pick && (pick.id ?? pick.candidateId ?? pick.key ?? "");
    if (!pid) return needsLogin("no_candidate");
    const sel = await ajaxJson(jar, PC711_ROUTES.quickSelect, {
      oidc_client_id: cid, candidate_id: String(pid), state: vars.state, nonce: vars.nonce, scope: vars.scope ?? "",
      max_age: String(vars.maxAge ?? ""), code_challenge: vars.codeChallenge, trust_browser: "Y", login_tx_id: vars.loginTxId, ...tokenF,
    }, auth.url);
    if (sel.fail) { say("quick", 0, sel.ms, sel.fail); await persist({ last_problem: sel.fail }); return null; }
    if (!sel.ok) return needsLogin("select_no");
    if (QUICK_SECRET_RE.test(JSON.stringify(sel.json || {}))) return needsLogin("asks_secret");
    const sj = sel.json || {};
    const red = (sj.redirect && typeof sj.redirect === "object") ? sj.redirect : {};
    const redFields = {
      lgtk: red.lgtk || sj.lgtk || "", oidc_client_id: cid, state: red.state || sj.state || vars.state,
      redirect_uri: red.redirect_uri || vars.redirectUri, login_tx_id: vars.loginTxId,
    };
    const body = new URLSearchParams(redFields).toString();
    const rr = await follow(jar, await request(jar, `https://${OPENPOINT}${PC711_ROUTES.quickHandoff}`, {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${OPENPOINT}`, referer: auth.url },
    }), auth.url);
    if (rr.fail) { say("quick", 0, rr.ms || 0, rr.fail); await persist({ last_problem: rr.fail }); return null; }
    if (rr.host !== MYSHIP) return needsLogin("no_myship");
    const li = await checkLoggedIn(jar);
    if (!li.ok) return needsLogin("not_logged");
    await saveSession(jar.dump(), { last_ok_at: new Date(now()).toISOString(), auto_logins: Number(row.auto_logins || 0) + 1 });
    say("quick", li.res?.status, li.res?.ms, "ok");
    return { cookies: jar.dump() };
  }

  return { load, status, start, captcha, submit, sms, resend, back, disconnect, getSession, saveCookies, quickRelogin, hasKey: () => Boolean(key), _flow: () => flow };
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
    resend: guard((b) => login.resend({ flowId: String(b.flowId || "") })),
    back: guard((b) => login.back({ flowId: String(b.flowId || "") })),
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
