// 7-11 LOGIN WALK — diagnostic only (read-only).
// Question it answers: what does the 7-11 member login (uniOPEN) look like to a NEW device —
// this server, with no cookies of its own? It does NOT log in and never types anything.
//
// OFF unless env PC_SERVER_PROBE is exactly "1" (the probe's own switch). Off = no request.
// server.js runs it once, right after the probe's boot run.
//
// HARD RULES
//   - GET only. Never a POST, never a body.
//   - A fresh cookie jar for this walk only; a cookie is sent back only to the host that set it.
//     PC_PROBE_MYSHIP_COOKIE is never read.
//   - Hosts: myship.7-11.com.tw, and uniopen.com / uniopen.com.tw / openpoint.com.tw (or a host
//     ending in "." + one of them). Anything else → `refused host=<host>`, stop.
//   - 10 s per request, 40 s for the whole walk, at most 12 requests, 1 MB per answer
//     (the probe's reader).
//   - Logs hold only: hop number, host, path (no query, no fragment), http status, bytes,
//     content-type, form id / method / action host+path, field NAMES and TYPES, yes/no flags,
//     script paths. Never a value of a field, a cookie or a query.

import { readCapped, pcProbeEnabled } from "./pcServerProbe.js";

export const PC_WALK_START_URL = "https://myship.7-11.com.tw/Member/Login/";
export const PC_WALK_MAX_REDIRECTS = 6;
export const PC_WALK_REQUEST_MS = 10_000;
export const PC_WALK_RUN_MS = 40_000;
export const PC_WALK_MAX_REQUESTS = 12;
export const PC_WALK_MAX_FIELDS = 30;
export const PC_WALK_MAX_SCRIPTS_LISTED = 10;
export const PC_WALK_MAX_SCRIPTS_FETCHED = 3;
export const PC_WALK_MAX_SCRIPT_PATHS = 40;
export const PC_WALK_JS_APP_FIELDS = 3; // fewer fields than this on the last page = a JS app

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TAG = "[PC_LOGIN_WALK]";
const SUFFIX_HOSTS = ["uniopen.com", "uniopen.com.tw", "openpoint.com.tw"];
const SCRIPT_WORD_RE = /login|otp|captcha|verif|device|quick|token|auth|member/i;
const CAPTCHA_IMG_RE = /captcha|verif|valid|code/i;

export function isAllowedWalkHost(host) {
  const h = String(host || "").toLowerCase();
  if (h === "myship.7-11.com.tw") return true;
  return SUFFIX_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}
export function isAllowedWalkUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  return u.protocol === "https:" && !u.port && !u.username && !u.password && isAllowedWalkHost(u.hostname);
}

// ── safe words for a log line ───────────────────────────────────────────────
const safeHost = (h) => (/^[a-z0-9.-]{1,100}$/i.test(String(h)) ? String(h).toLowerCase() : "?");
const safePath = (p) => (/^[A-Za-z0-9_./~-]{1,120}$/.test(String(p)) ? String(p) : "?");
const safeName = (n) => { const s = String(n ?? ""); return /^[A-Za-z0-9_.\-[\]]{1,60}$/.test(s) ? s : "?"; };
const safeType = (t) => { const s = String(t ?? "").toLowerCase(); return /^[a-z-]{1,20}$/.test(s) ? s : "?"; };
const safeCt = (ct) => { const s = String(ct || "").split(";")[0].trim().toLowerCase(); return /^[a-z0-9/+.-]{1,60}$/.test(s) ? s : (s ? "?" : "-"); };
// host + path of a URL (no query, no fragment); "-" when there is none
function hostPathOf(raw, base) {
  if (raw == null || raw === "") return "-";
  try { const u = new URL(String(raw), base); return `${safeHost(u.hostname)}${safePath(u.pathname)}`; } catch { return "?"; }
}

// ── page reading (names and types only) ─────────────────────────────────────
// Attributes of one tag; values are only ever used for the few attributes we read
// (name, type, id, method, action, src) and every one of them goes through a safe-word filter.
function attrsOf(tag) {
  const out = {};
  const re = /(?<![\w:-])([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

// One regex pass over the page; tags in page order. Bounded tag length → linear time.
const TAG_RE = /<(\/?)(form|input|select|textarea|button|img|script)\b([^>]{0,4000})>/gi;
export function readPage(html, pageUrl) {
  const text = String(html ?? "");
  let host = "";
  try { host = new URL(pageUrl).hostname; } catch { /* nothing */ }
  const forms = [];
  const loose = { id: "-", method: "-", action: "-", fields: [], loose: true }; // fields outside any form
  let cur = null;
  let fieldCount = 0;
  let captchaPath = null;
  const scripts = [];
  const scriptUrls = [];
  for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (name === "form") {
      if (closing) { cur = null; continue; }
      const a = attrsOf(m[3]);
      const method = String(a.method || "GET").toUpperCase();
      cur = { id: a.id ? safeName(a.id) : "-", method: method === "GET" || method === "POST" ? method : "?", action: hostPathOf(a.action ?? pageUrl, pageUrl), fields: [] };
      forms.push(cur);
      continue;
    }
    if (closing) continue;
    const a = attrsOf(m[3]);
    if (name === "img") {
      if (captchaPath === null && a.src && CAPTCHA_IMG_RE.test(a.src)) {
        try { captchaPath = safePath(new URL(a.src, pageUrl).pathname); } catch { captchaPath = "?"; }
      }
      continue;
    }
    if (name === "script") {
      if (!a.src) continue;
      let u;
      try { u = new URL(a.src, pageUrl); } catch { continue; }
      if (u.protocol !== "https:" || u.hostname !== host) continue;
      const p = safePath(u.pathname);
      if (scripts.includes(p) || scripts.length >= PC_WALK_MAX_SCRIPTS_LISTED) continue;
      scripts.push(p);
      u.hash = "";
      scriptUrls.push(u.toString());
      continue;
    }
    // a field
    if (fieldCount >= PC_WALK_MAX_FIELDS) { fieldCount++; continue; }
    fieldCount++;
    const type = name === "input" ? (a.type || "text") : name === "button" ? (a.type || "submit") : name;
    (cur || loose).fields.push(`${a.name != null ? safeName(a.name) : "-"}:${safeType(type)}`);
  }
  if (loose.fields.length) forms.push(loose);
  return {
    forms,
    fieldCount,
    captchaPath,
    flags: {
      recaptcha: /recaptcha/i.test(text),
      hcaptcha: /hcaptcha/i.test(text),
      turnstile: /turnstile|challenges\.cloudflare\.com/i.test(text),
      驗證碼: text.includes("驗證碼"),
      OTP: /\bOTP\b/i.test(text),
      簡訊: text.includes("簡訊"),
      快速登入: text.includes("快速登入"),
    },
    scripts,
    scriptUrls,
  };
}

// Quoted URL paths inside a script that hold one of the walk's words. Path only, safe chars only.
const QUOTED_RE = /(["'`])([^"'`\s]{1,300})\1/g;
export function scriptPathsOf(source) {
  const out = new Set();
  const text = String(source ?? "");
  for (let m = QUOTED_RE.exec(text); m; m = QUOTED_RE.exec(text)) {
    let s = m[2];
    if (/^https?:\/\//i.test(s)) { try { s = new URL(s).pathname; } catch { continue; } }
    s = s.split(/[?#]/)[0];
    if (!s.includes("/") || !SCRIPT_WORD_RE.test(s)) continue;
    if (!/^[A-Za-z0-9_./-]{1,100}$/.test(s)) continue;
    out.add(s);
  }
  return [...out];
}

// ── the cookie jar (this walk only; a cookie goes back only to the host that set it) ──
function createWalkJar() {
  const hosts = new Map();
  return {
    header: (host) => [...(hosts.get(host) || new Map())].map(([k, v]) => `${k}=${v}`).join("; "),
    store: (host, headers) => {
      const list = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
      const single = list.length ? [] : [headers?.get?.("set-cookie")].filter(Boolean);
      for (const c of [...list, ...single]) {
        const first = String(c).split(";")[0];
        const eq = first.indexOf("=");
        if (eq <= 0) continue;
        if (!hosts.has(host)) hosts.set(host, new Map());
        hosts.get(host).set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
      }
    },
  };
}

// ── the walk ────────────────────────────────────────────────────────────────
export async function runPcLoginWalk(opts = {}) {
  const env = opts.env ?? process.env;
  const lines = [];
  if (!pcProbeEnabled(env)) return { skipped: true, lines };
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const log = opts.log ?? ((l) => console.log(l));
  const now = opts.now ?? (() => Date.now());
  const say = (msg) => { const l = `${TAG} ${msg}`; lines.push(l); try { log(l); } catch { /* nothing */ } };
  const t0 = now();
  const deadline = t0 + (opts.runMs ?? PC_WALK_RUN_MS);
  const requestMs = opts.requestMs ?? PC_WALK_REQUEST_MS;
  const jar = createWalkJar();
  let requests = 0;

  // The ONLY way this walk makes a request: GET, allowed host, within the limits.
  async function get(url, accept) {
    if (!isAllowedWalkUrl(url)) return { refused: true };
    if (requests >= PC_WALK_MAX_REQUESTS) return { error: "max_requests" };
    const left = deadline - now();
    if (left <= 0) return { error: "run_timeout" };
    requests++;
    const u = new URL(url);
    const headers = { "user-agent": UA, accept };
    const cookie = jar.header(u.hostname);
    if (cookie) headers.cookie = cookie;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.min(requestMs, left));
    try {
      const r = await fetchImpl(u.toString(), { method: "GET", headers, redirect: "manual", signal: ac.signal });
      jar.store(u.hostname, r.headers);
      const text = await readCapped(r);
      return { r, text };
    } catch (e) {
      return { error: ac.signal.aborted ? "timeout" : "network", e };
    } finally {
      clearTimeout(timer);
    }
  }

  let url = PC_WALK_START_URL;
  let page = null;
  for (let hop = 1; hop <= PC_WALK_MAX_REDIRECTS + 1; hop++) {
    let u;
    try { u = new URL(url); } catch { say(`hop=${hop} bad_url`); break; }
    if (!isAllowedWalkUrl(url)) { say(`refused host=${safeHost(u.hostname)}`); break; }
    const res = await get(url, "text/html,application/xhtml+xml,*/*;q=0.8");
    const where = `hop=${hop} host=${safeHost(u.hostname)} path=${safePath(u.pathname)}`;
    if (res.error) { say(`${where} error=${res.error}`); break; }
    const { r, text } = res;
    say(`${where} http=${r.status} bytes=${text == null ? "too_big" : text.length} ct=${safeCt(r.headers?.get?.("content-type"))}`);
    const loc = r.headers?.get?.("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      if (hop === PC_WALK_MAX_REDIRECTS + 1) { say("too_many_redirects"); break; }
      try { url = new URL(loc, url).toString(); } catch { say(`hop=${hop} bad_location`); break; }
      continue;
    }
    if (text == null) break;
    page = { url, text };
    break;
  }

  if (page) {
    const info = readPage(page.text, page.url);
    say(`page host=${hostPathOf(page.url, page.url)} forms=${info.forms.length} fields=${info.fieldCount}`);
    info.forms.slice(0, 10).forEach((f, i) => {
      say(`form i=${i + 1} id=${f.id} method=${f.method} action=${f.action} fields=${f.fields.join(",") || "-"}`);
    });
    say(`captcha_img=${info.captchaPath ? `yes path=${info.captchaPath}` : "no"}`);
    const yn = (b) => (b ? "yes" : "no");
    say(`flags recaptcha=${yn(info.flags.recaptcha)} hcaptcha=${yn(info.flags.hcaptcha)} turnstile=${yn(info.flags.turnstile)} 驗證碼=${yn(info.flags.驗證碼)} OTP=${yn(info.flags.OTP)} 簡訊=${yn(info.flags.簡訊)} 快速登入=${yn(info.flags.快速登入)}`);
    say(`scripts=${info.scripts.join(",") || "-"}`);
    if (info.fieldCount < PC_WALK_JS_APP_FIELDS && info.scriptUrls.length) {
      const found = new Set();
      for (const s of info.scriptUrls.slice(0, PC_WALK_MAX_SCRIPTS_FETCHED)) {
        const su = new URL(s);
        const res = await get(s, "*/*");
        const where = `script=${safePath(su.pathname)}`;
        if (res.refused) { say(`${where} refused`); continue; }
        if (res.error) { say(`${where} error=${res.error}`); if (res.error === "run_timeout" || res.error === "max_requests") break; continue; }
        const paths = res.text == null ? [] : scriptPathsOf(res.text);
        say(`${where} http=${res.r.status} bytes=${res.text == null ? "too_big" : res.text.length} found=${paths.length}`);
        for (const p of paths) { if (found.size >= PC_WALK_MAX_SCRIPT_PATHS) break; found.add(p); }
      }
      say(`script_paths=${[...found].join(",") || "-"}`);
    }
  }
  say(`done requests=${requests} ms=${now() - t0}`);
  return { skipped: false, requests, lines };
}
