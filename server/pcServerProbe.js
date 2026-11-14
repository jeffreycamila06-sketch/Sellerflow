// 7-11 SERVER PROBE — diagnostic only.
// Question it answers: can THIS server do the two checks the Parcel Checker extension does
// today (restricted phone, full store)? It only logs what happened. It never writes to a
// parcel, never changes the checker, never touches the database (it reads three settings).
//
// OFF unless env PC_SERVER_PROBE is exactly "1". Importing this file starts nothing.
//   PHONE step  — mirrors chrome-extension/myship-711.js checkRestricted with anon=true.
//   STORE step  — only with the saved 7-11 login session (server/pc711Login.js, connected by
//                 the admin in Admin → 7-11 Login). Mirrors chrome-extension/emap-711.js.
//
// HARD RULES
//   - Every request goes through one wrapper with a URL allowlist (below). Anything else is
//     refused BEFORE any request. /cart/finish is never requested.
//   - No retry loops. 10 s per request, 40 s for the whole run.
//   - Logs and results hold only: step name, http status, host + path, content-type, byte
//     length, counts, booleans, verdict, ms. Never a cookie, token, guid, phone, name or any
//     form value.
//   - The hour never stops a run. maint = the run started 01:00–05:00 Asia/Taipei (the
//     extension's maintenance hours); it is only reported.

export const PC_PROBE_REQUEST_MS = 10_000;
export const PC_PROBE_RUN_MS = 40_000;
export const PC_PROBE_BOOT_DELAY_MS = 90_000;
export const PC_PROBE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // route: 1 run per 10 minutes, whole server
export const PC_PROBE_STORE_ID = "195965";   // store id sent in the phone check body
export const PC_PROBE_EMAP_STORE = "198002"; // store asked in the full-store check
export const PC_PROBE_MAX_HOPS = 3;
export const PC_PROBE_BODY_MAX = 1024 * 1024; // 1 MB per answer (the real cart page is about 160 KB)
export const PC_PROBE_SETTINGS_MS = 10_000;
export const PC_PROBE_PARSE_MS = 250; // hard clock limit for reading the forms of one page
const CART_DETAIL_URL = "https://myship.7-11.com.tw/cart/detail";
const SAFE_CT_RE = /^[a-z0-9/+.-]{1,60}$/;
const MAINT_START_H = 1, MAINT_END_H = 5;    // Asia/Taipei hours [1, 5) — same as the extension

const MYSHIP = "myship.7-11.com.tw";
const EMAP_HOSTS = ["emap.unipcsc.com.tw", "emap.pcsc.com.tw"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const RESTRICTION_RE = /多次未取|限制使用取貨付款|無法於平台成立訂單/;
const TOKEN_RE = /var\s+tokenID\s*=\s*'([^']+)'/;
const GUID_RE = /eshop[Gg]uid\s*[:=]\s*["']([^"']{8,})["']/;
const PROBE_NAME = "王小明"; // a placeholder receiver name for the validation body (not a buyer)

export const pcProbeEnabled = (env = process.env) => String(env?.PC_SERVER_PROBE ?? "") === "1";

export function isMaintWindow(nowMs) {
  const h = (new Date(nowMs).getUTCHours() + 8) % 24;
  return h >= MAINT_START_H && h < MAINT_END_H;
}

// ── allowlist ────────────────────────────────────────────────────────────────
const MYSHIP_PATHS = [
  /^\/cart\/easy\/GM\d{6,20}$/,
  /^\/CPF3101\/CheckoutValidation\/$/,
  /^\/cart\/detail$/,
  /^\/CPF3101\/MAP\/$/,
  /^\/eMap\/MM1\/GM\d{6,20}$/i,
];
const EMAP_PATHS = [/^\/(ecmap|mobilemap)\/(default|byIDData)\.aspx$/i];

export function isAllowedProbeUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  if (u.hostname === MYSHIP) return MYSHIP_PATHS.some((re) => re.test(u.pathname));
  if (EMAP_HOSTS.includes(u.hostname)) return EMAP_PATHS.some((re) => re.test(u.pathname));
  return false;
}

// The ONLY way this module makes a request.
export function createGuardedFetch(fetchImpl) {
  return async function guardedFetch(url, init) {
    if (!isAllowedProbeUrl(url)) throw Object.assign(new Error("pc_probe_url_refused"), { refused: true });
    return fetchImpl(String(url), init);
  };
}

// ── small helpers ────────────────────────────────────────────────────────────
// Named and numeric entities, decoded in ONE pass (so "&amp;#38;" stays the text "&#38;").
const NAMED_ENTITIES = { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" };
const decodeEntities = (s) => String(s).replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(quot|apos|lt|gt|amp));/g, (m, dec, hex, named) => {
  if (named) return NAMED_ENTITIES[named];
  const cp = dec ? Number(dec) : parseInt(hex, 16);
  return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
});

// The attribute regex starts only at the beginning of a name (lookbehind), so a long run of
// name characters is tried once — linear time on any input.
function attrsOf(tag) {
  const out = {};
  const re = /(?<![\w:-])([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

// A tag's text with every quoted attribute value taken out, so a word inside a value
// (title="not checked") is never read as the attribute itself.
const bareOf = (attrs) => attrs.replace(/"[^"]*"|'[^']*'/g, " ");
const FLAG_RE = {
  checked: /(?:^|[\s/])checked(?=[\s=/]|$)/i,
  selected: /(?:^|[\s/])selected(?=[\s=/]|$)/i,
  disabled: /(?:^|[\s/])disabled(?=[\s=/]|$)/i,
};
const hasFlag = (bare, word) => FLAG_RE[word].test(bare);

// indexOf inside [from, to) ONLY. A plain indexOf that finds nothing keeps reading to the end of
// the page; on a page of many small elements that is the whole page once per element.
const idx = (s, needle, from, to) => {
  if (from >= to) return -1;
  const i = s.substring(from, to).indexOf(needle);
  return i < 0 ? -1 : i + from;
};

// Next "<name" tag that lies wholly inside [from, to). Returns { start, attrs, end } or null.
// A tag with no ">" before `to` is not a tag. `over()` is the clock guard.
function nextTag(lower, html, name, from, to, over) {
  const needle = `<${name}`;
  for (let i = idx(lower, needle, from, to); i >= 0; i = idx(lower, needle, i + needle.length, to)) {
    if (over()) return null;
    const after = lower.charCodeAt(i + needle.length);
    const boundary = after === 62 || after === 47 || after === 32 || after === 9 || after === 10 || after === 13; // > / space tab LF CR
    if (!boundary) continue;
    const gt = idx(html, ">", i + needle.length, to);
    if (gt < 0) return null;
    return { start: i, attrs: html.slice(i + needle.length, gt), end: gt + 1 };
  }
  return null;
}

// Forms of a page: [{ id, action, method, fields: [[name, value], …] }] — fields in page order, as a
// browser's FormData would send them (unchecked boxes, disabled controls, buttons and files are
// left out). Linear time: every search stays inside the element that contains it (the page for a
// form, the form for a field, the select for an option); an element that is never closed is
// skipped. Hard limit: past `budgetMs` on the clock the answer is an EMPTY list with .slow = true.
export function parseForms(html, { budgetMs = PC_PROBE_PARSE_MS } = {}) {
  const t0 = performance.now();
  let slow = false;
  const over = () => slow || (slow = performance.now() - t0 >= budgetMs);
  const tooSlow = () => Object.assign([], { slow: true });
  const src = String(html);
  let lower = src.toLowerCase();
  // a few letters change length when lowered (İ); the two strings must line up index for index
  if (lower.length !== src.length) lower = src.replace(/[A-Z]+/g, (m) => m.toLowerCase());
  const forms = [];
  let pos = 0;
  for (;;) {
    if (over()) return tooSlow();
    const open = nextTag(lower, src, "form", pos, src.length, over);
    if (!open) break;
    const close = idx(lower, "</form", open.end, src.length);
    if (close < 0) break; // never closed: this form (and anything after it) is skipped
    const a = attrsOf(open.attrs);
    const fields = [];
    // the three kinds of field, walked in page order; each "next" is looked up again only once passed
    const kinds = ["input", "select", "textarea"];
    const next = kinds.map((k) => nextTag(lower, src, k, open.end, close, over));
    let at = open.end;
    for (;;) {
      if (over()) return tooSlow();
      let pick = -1;
      for (let k = 0; k < kinds.length; k++) if (next[k] && (pick < 0 || next[k].start < next[pick].start)) pick = k;
      if (pick < 0) break;
      const tag = next[pick];
      const bare = bareOf(tag.attrs);
      const disabled = hasFlag(bare, "disabled");
      at = tag.end;
      if (pick === 0) {
        const ia = attrsOf(tag.attrs);
        const type = String(ia.type || "text").toLowerCase();
        const skip = disabled || !ia.name || ["submit", "button", "image", "file", "reset"].includes(type)
          || ((type === "checkbox" || type === "radio") && !hasFlag(bare, "checked"));
        if (!skip) fields.push([ia.name, ia.value ?? (type === "checkbox" || type === "radio" ? "on" : "")]);
      } else {
        const end = idx(lower, pick === 1 ? "</select" : "</textarea", tag.end, close);
        if (end < 0) { next[pick] = null; continue; } // never closed inside this form: skipped (and so is every later one)
        const name = disabled ? "" : attrsOf(tag.attrs).name;
        if (pick === 1) {
          let chosen = null, chosenEnd = end;
          for (let o = nextTag(lower, src, "option", tag.end, end, over); o && name; o = nextTag(lower, src, "option", o.end, end, over)) {
            if (over()) return tooSlow();
            const selected = hasFlag(bareOf(o.attrs), "selected");
            if (!chosen || selected) {
              // the option's text ends at the next "<option" or "</option", looked for inside the select only
              const stop = [idx(lower, "<option", o.end, end), idx(lower, "</option", o.end, end)].filter((x) => x >= 0);
              chosen = o; chosenEnd = stop.length ? Math.min(...stop) : end;
              if (selected) break;
            }
          }
          if (name && chosen) fields.push([name, attrsOf(chosen.attrs).value ?? decodeEntities(src.slice(chosen.end, chosenEnd).trim())]);
        } else if (name) {
          fields.push([name, decodeEntities(src.slice(tag.end, end))]);
        }
        at = end;
      }
      for (let k = 0; k < kinds.length; k++) if (next[k] && next[k].start < at) next[k] = nextTag(lower, src, kinds[k], at, close, over);
    }
    forms.push({ id: a.id || "", action: a.action || "", method: String(a.method || "get").toLowerCase(), fields });
    pos = close + 6;
  }
  return slow ? tooSlow() : forms;
}

const fieldOf = (form, name) => { const f = form.fields.find((x) => x[0] === name); return f ? f[1] : undefined; };
function withFields(fields, patch) {
  const out = fields.map((x) => [x[0], x[1]]);
  for (const [k, v] of Object.entries(patch)) {
    const at = out.findIndex((x) => x[0] === k);
    if (at >= 0) out[at][1] = String(v); // a name the form does not have is never added
  }
  return out;
}
const encode = (fields) => new URLSearchParams(fields).toString();

// The answer as text, never more than PC_PROBE_BODY_MAX bytes in memory. null = too big.
export async function readCapped(r) {
  const declared = Number(r.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > PC_PROBE_BODY_MAX) { try { await r.body?.cancel?.(); } catch { /* nothing */ } return null; }
  const reader = r.body?.getReader?.();
  if (!reader) { // no stream (a test double): the text, still refused past the cap
    const t = String(await r.text());
    return t.length > PC_PROBE_BODY_MAX ? null : t;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PC_PROBE_BODY_MAX) { try { await reader.cancel(); } catch { /* nothing */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder("utf-8").decode(all);
}

// ── diagnostics for a cart page that is not a usable logged-in form ─────────
// Cookie NAMES only (never a value): at most 15, each cut to 40 characters; a name with any
// character outside [A-Za-z0-9_.-] becomes "?".
const COOKIE_NAME_MAX = 15;
export function safeCookieNames(names) {
  return (names || []).slice(0, COOKIE_NAME_MAX)
    .map((n) => { const s = String(n ?? ""); return /^[A-Za-z0-9_.-]+$/.test(s) ? s.slice(0, 40) : "?"; })
    .join(",");
}
// The name part of each Set-Cookie header (the text before the first "=").
function setCookieNamesOf(headers) {
  const list = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
  const single = list.length ? [] : [headers?.get?.("set-cookie")].filter(Boolean);
  return [...list, ...single].map((c) => { const first = String(c).split(";")[0]; const eq = first.indexOf("="); return eq > 0 ? first.slice(0, eq).trim() : ""; }).filter(Boolean);
}
// One word for what the page looks like; the first match wins.
export function pageKind(text) {
  const t = String(text ?? "");
  if (/OpenPoint|登入|login/i.test(t)) return "login";
  if (/Runtime Error|Server Error|系統錯誤|發生錯誤/i.test(t)) return "server_error";
  if (/Access Denied|Forbidden|Request Rejected|captcha/i.test(t)) return "blocked";
  return "other";
}
// The path of a redirect target only (no host, no query); odd characters → "?".
export function safeLocPath(location, base) {
  let path = "";
  try { path = new URL(String(location), base).pathname; } catch { return "?"; }
  return /^[A-Za-z0-9_./~-]{1,120}$/.test(path) ? path : "?";
}

function createJar(seed) {
  const hosts = new Map();
  const of = (host) => { if (!hosts.has(host)) hosts.set(host, new Map()); return hosts.get(host); };
  const put = (host, pair) => {
    const first = String(pair).split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) return;
    of(host).set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  };
  for (const [host, raw] of Object.entries(seed || {})) String(raw || "").split(";").forEach((p) => put(host, p));
  const header = (host) => [...of(host)].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    header,
    names: (host) => [...of(host).keys()],
    dump: () => Object.fromEntries([...hosts.keys()].map((h) => [h, header(h)]).filter(([, v]) => v)),
    store: (host, headers) => {
      const list = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
      const single = list.length ? [] : [headers?.get?.("set-cookie")].filter(Boolean);
      [...list, ...single].forEach((c) => put(host, c));
    },
  };
}

function parseByIdData(text) {
  const raw = String(text).trim();
  if (raw === "NO2") return "not_found";
  const rec = raw.split(";")[1];
  const field = rec ? rec.split("+")[3] : "";
  if (field === "enable") return "open";
  if (field === "disable") return "full";
  if (field === "close") return "company";
  return "unknown";
}

export function parseProbeConfig({ gms, sender, buyer }) {
  let gm = "";
  try {
    const list = JSON.parse(String(gms ?? ""));
    if (Array.isArray(list)) gm = list.map((x) => String(x)).find((x) => /^GM\d{6,}$/.test(x)) || "";
  } catch { gm = ""; }
  const phone = (v) => (/^09\d{8}$/.test(String(v ?? "").trim()) ? String(v).trim() : "");
  return { gm, sender: phone(sender), buyer: phone(buyer) };
}

// ── the run ──────────────────────────────────────────────────────────────────
// opts: fetchImpl, now (() => ms), log, readSetting (async key → string|null), env, parseBudgetMs,
// session ({ get, relogin, save } from server/pc711Login.js: the saved 7-11 login).
// Never throws.
export async function runPcServerProbe(opts = {}) {
  const { fetchImpl = fetch, now = Date.now, log = console.log, readSetting, env = process.env, parseBudgetMs = PC_PROBE_PARSE_MS, session = null } = opts;
  const parse = (html) => parseForms(html, { budgetMs: parseBudgetMs });
  if (!pcProbeEnabled(env)) return { disabled: true };
  const startedAt = now();
  const maintWindow = isMaintWindow(startedAt);
  const maint = `maint=${maintWindow ? 1 : 0}`;
  const guarded = createGuardedFetch(fetchImpl);
  const phone = { verdict: "unknown", kind: "", steps: [] };
  const store = { verdict: "unknown", kind: "", steps: [] };

  const record = (part, s) => {
    part.steps.push(s);
    try { log(`[PC_PROBE] ${s.step} http=${s.http} ms=${s.ms} ${s.note} ${maint}`); } catch { /* a log never stops the probe */ }
    return s;
  };

  // One request. Returns { status, path, host, ct, text, location } or { fail: kind }.
  const request = async (jar, url, init = {}) => {
    const left = PC_PROBE_RUN_MS - (now() - startedAt);
    if (left <= 0) return { fail: "budget", ms: 0 };
    let u;
    try { u = new URL(url); } catch { return { fail: "refused", ms: 0 }; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(PC_PROBE_REQUEST_MS, left));
    const t0 = now();
    try {
      const headers = { "user-agent": UA, ...(init.headers || {}) };
      const cookie = jar ? jar.header(u.hostname) : "";
      if (cookie) headers.cookie = cookie;
      const sentNames = cookie ? jar.names(u.hostname) : [];
      const r = await guarded(url, { method: init.method || "GET", headers, body: init.body, redirect: "manual", signal: ctl.signal });
      if (jar) jar.store(u.hostname, r.headers);
      const setNames = setCookieNamesOf(r.headers);
      const text = await readCapped(r);
      if (text === null) return { fail: "too_big", ms: now() - t0, host: u.hostname, path: u.pathname, sentNames, setNames };
      const ct = String(r.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
      return {
        status: r.status, host: u.hostname, path: u.pathname, text, ms: now() - t0, sentNames, setNames,
        ct: SAFE_CT_RE.test(ct) ? ct : "",
        location: r.status >= 300 && r.status < 400 ? String(r.headers?.get?.("location") || "") : "",
      };
    } catch (e) {
      // a refused URL came from the far side (a redirect / a form action): only the word is recorded
      if (e?.refused) return { fail: "refused", ms: 0 };
      const kind = e?.name === "AbortError" || ctl.signal.aborted ? "timeout" : "network";
      return { fail: kind, ms: now() - t0, host: u.hostname, path: u.pathname };
    } finally {
      clearTimeout(timer);
    }
  };

  // Follows redirects by hand (each hop goes through the allowlist and the jar).
  const follow = async (jar, first, baseUrl) => {
    let res = first, base = baseUrl, hops = 0;
    while (!res.fail && res.location && hops < PC_PROBE_MAX_HOPS) {
      let next;
      try { next = new URL(res.location, base).toString(); } catch { return { ...res, fail: "bad_redirect", hops }; }
      hops += 1;
      base = next;
      res = await request(jar, next, { headers: { referer: baseUrl } });
    }
    if (!res.fail && res.location) return { fail: "too_many_redirects", ms: res.ms, hops };
    return { ...res, hops, finalUrl: base };
  };

  const stepOf = (step, res, ok, note) => ({
    step, http: res?.status ?? 0, path: res?.host ? `${res.host}${res.path}` : "", ms: res?.ms ?? 0, ok, note,
  });

  // ── config (three settings; nothing is requested when it is missing) ────────
  let cfg = { gm: "", sender: "", buyer: "" };
  try {
    if (typeof readSetting === "function") {
      let settingsTimer;
      const tooSlow = new Promise((_res, rej) => { settingsTimer = setTimeout(() => rej(new Error("settings_timeout")), PC_PROBE_SETTINGS_MS); });
      try {
        const [gms, sender, buyer] = await Promise.race([Promise.all([
          readSetting("parcel_check_shared_gms"), readSetting("parcel_check_sender_phone"), readSetting("parcel_check_probe_buyer"),
        ]), tooSlow]);
        cfg = parseProbeConfig({ gms, sender, buyer });
      } finally { clearTimeout(settingsTimer); }
    }
  } catch { cfg = { gm: "", sender: "", buyer: "" }; }
  const cartUrl = cfg.gm ? `https://${MYSHIP}/cart/easy/${cfg.gm}` : "";

  // ── PHONE (no cookies at all) ────────────────────────────────────────────────
  try {
    if (!cfg.gm || !cfg.sender || !cfg.buyer) {
      phone.kind = "config_missing";
      record(phone, stepOf("phone.config", null, false, "config_missing"));
    } else {
      const page = await request(null, cartUrl);
      const token = !page.fail && page.status === 200 ? (page.text.match(TOKEN_RE) || [])[1] || "" : "";
      const pageKind = page.fail ? page.fail : page.status >= 300 && page.status < 400 ? "redirect" : page.status !== 200 ? "http" : token ? "" : "html";
      record(phone, stepOf("phone.token", page, !pageKind, `ct=${page.ct || "-"} bytes=${page.text ? page.text.length : 0} token=${token ? 1 : 0}${pageKind ? ` kind=${pageKind}` : ""}`));
      if (pageKind) phone.kind = pageKind;
      else {
        const body = encode([
          ["rcvName", PROBE_NAME], ["revPhone", ""], ["revMobile", cfg.buyer], ["ordPhone", ""], ["ordMobile", cfg.sender],
          ["Cgdm_Id", cfg.gm], ["Carm_Cgptshiptype", "1"], ["Carm_Cgptpaymenttype", "1"], ["RcvStoreID", PC_PROBE_STORE_ID],
        ]);
        const res = await request(null, `https://${MYSHIP}/CPF3101/CheckoutValidation/`, {
          method: "POST", body,
          headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest",
            VerificationToken: token, origin: `https://${MYSHIP}`, referer: cartUrl,
          },
        });
        let verdict = "unknown", kind = "";
        if (res.fail) kind = res.fail;
        else if (res.status >= 300 && res.status < 400) kind = "redirect";
        else if (res.status < 200 || res.status >= 300) kind = "http";
        else if (!res.ct.includes("json")) kind = "html";
        else {
          let j = null;
          try { j = JSON.parse(res.text); } catch { j = null; }
          if (j && j.Status === true) verdict = "ok";
          else if (j && j.Status === false) { if (RESTRICTION_RE.test(String(j.Message || ""))) verdict = "restricted"; else kind = "rejected"; }
          else kind = "bad_json";
        }
        phone.verdict = verdict; phone.kind = kind;
        record(phone, stepOf("phone.validate", res, verdict !== "unknown", `ct=${res.ct || "-"} bytes=${res.text ? res.text.length : 0} verdict=${verdict}${kind ? ` kind=${kind}` : ""}`));
      }
    }
  } catch {
    phone.kind = "error";
  }

  // ── STORE (only with the saved 7-11 login session) ───────────────────────────
  try {
    const call = async (fn) => { try { return typeof fn === "function" ? await fn() : null; } catch { return null; } };
    const saved = session ? await call(session.get) : null;
    if (!saved || !saved.cookies) { store.kind = "no_session"; record(store, stepOf("store.skip", null, false, "no_session")); }
    else if (!cfg.gm) { store.kind = "config_missing"; record(store, stepOf("store.config", null, false, "config_missing")); }
    else {
      let jar = createJar(saved.cookies);
      const stop = (kind) => { store.kind = kind; };
      // 1. the cart page
      const openCart = async () => {
        const p1 = await request(jar, cartUrl);
        const forms1 = !p1.fail && p1.status === 200 ? parse(p1.text) : [];
        if (forms1.slow) p1.fail = "parse_too_slow";
        const f1 = forms1.find((f) => f.id === "MyCart") || null;
        const sidLen = f1 ? String(fieldOf(f1, "MemberSid") ?? "").length : 0;
        return { p1, f1, loggedIn: sidLen >= 4 };
      };
      let { p1, f1, loggedIn } = await openCart();
      // logged out (no form / an error page / the login page) → ONE quick re-login with the saved
      // session (pc711Login decides; it never types a password), then the cart page once more
      if (!(f1 && loggedIn) && p1.fail !== "parse_too_slow" && session && typeof session.relogin === "function") {
        const again = await call(session.relogin);
        record(store, stepOf("store.relogin", null, Boolean(again && again.cookies), again && again.cookies ? "ok" : "no"));
        if (again && again.cookies) { jar = createJar(again.cookies); ({ p1, f1, loggedIn } = await openCart()); }
      }
      if (f1 && loggedIn && session) await call(() => session.save && session.save(jar.dump()));
      // not a usable logged-in form → what was sent / set and what the page looks like (names and words only)
      const diag = Boolean(f1) && loggedIn ? "" : [
        ` sent_cookies=${(p1.sentNames || []).length}`,
        ` cookie_names=${safeCookieNames(p1.sentNames)}`,
        ` set_cookie_names=${safeCookieNames(p1.setNames)}`,
        ` page=${pageKind(p1.text)}`,
        p1.location ? ` loc=${safeLocPath(p1.location, cartUrl)}` : "",
      ].join("");
      record(store, stepOf("store.cart", p1, Boolean(f1) && loggedIn, `bytes=${p1.text ? p1.text.length : 0} form=${f1 ? 1 : 0} fields=${f1 ? f1.fields.length : 0} logged_in=${loggedIn ? 1 : 0}${p1.fail ? ` kind=${p1.fail}` : ""}${diag}`));
      if (p1.fail) stop(p1.fail);
      else if (!f1) stop("cart_form_missing");
      else if (!loggedIn) stop("login_not_accepted");
      else {
        // 2. the cart form → page 2. Measured on the real page: the fee is the NAMED field
        //    fullAmountFee_1; eight fields get the values the browser sends for one item (name
        //    "test", price 62, qty 1); every other field goes exactly as served — CarQty included
        //    (the page's jsNext() never changes it, so it is not set and not required). A field
        //    name the served form does not have is never added.
        const feeRaw = fieldOf(f1, "fullAmountFee_1");
        const fee = feeRaw === undefined || String(feeRaw).trim() === "" ? NaN : Number(feeRaw);
        const patch = Number.isFinite(fee) ? {
          item_name_1: "test", item_price_1: 62, item_qty_1: 1, item_amt_1: 62, Sum: 62,
          Carm_Cgptshipprice: fee, Total: 62 + fee, Seller_GoodsTotalAmt: 62 + fee,
        } : {};
        const missing = Object.keys(patch).filter((name) => fieldOf(f1, name) === undefined);
        let url2 = "";
        try { url2 = new URL(f1.action || "/cart/detail", cartUrl).toString(); } catch { url2 = ""; }
        const p2 = url2 !== CART_DETAIL_URL ? { fail: "cart_action_refused", ms: 0 }
          : !Number.isFinite(fee) ? { fail: "fee_missing", ms: 0 }
          : missing.length ? { fail: "cart_field_missing", ms: 0 }
          : await follow(jar, await request(jar, url2, {
            method: "POST", body: encode(withFields(f1.fields, patch)),
            headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${MYSHIP}`, referer: cartUrl },
          }), url2);
        const forms2 = !p2.fail && p2.status === 200 ? parse(p2.text) : [];
        if (forms2.slow) p2.fail = "parse_too_slow";
        const f2 = forms2.find((f) => f.id === "MyCart") || null;
        record(store, stepOf("store.detail", p2, Boolean(f2), `bytes=${p2.text ? p2.text.length : 0} form=${f2 ? 1 : 0} fields=${f2 ? f2.fields.length : 0}${Number.isFinite(fee) ? ` fee=${fee}` : ""}${p2.fail ? ` kind=${p2.fail}` : ""}${missing.length ? ` missing=${missing.join(",")}` : ""}`));
        if (p2.fail) stop(p2.fail);
        else if (!f2) stop("detail_form_missing");
        else {
          // 3. the same fields to the store-map hop (what the page's own store button does)
          const url3 = `https://${MYSHIP}/CPF3101/MAP/`;
          const p3 = await follow(jar, await request(jar, url3, {
            method: "POST", body: encode(f2.fields),
            headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${MYSHIP}`, referer: p2.finalUrl || url2 },
          }), url3);
          const forms3 = !p3.fail && p3.status === 200 ? parse(p3.text) : [];
          if (forms3.slow) p3.fail = "parse_too_slow";
          const f3 = forms3.length === 1 ? forms3[0] : null;
          let action3 = null;
          try { action3 = f3 ? new URL(f3.action, p3.finalUrl || url3) : null; } catch { action3 = null; }
          const hostOk = Boolean(action3) && EMAP_HOSTS.includes(action3.hostname);
          record(store, stepOf("store.map", p3, Boolean(f3) && hostOk, `bytes=${p3.text ? p3.text.length : 0} hops=${p3.hops ?? 0} forms=${forms3.length} fields=${f3 ? f3.fields.length : 0} emap_host=${hostOk ? 1 : 0}${p3.fail ? ` kind=${p3.fail}` : ""}`));
          if (p3.fail) stop(p3.fail);
          else if (!f3) stop("map_form_missing");
          else if (!hostOk) stop("emap_host_refused");
          else {
            // 4. the served form → the E-Map page
            const url4 = action3.toString();
            const p4 = await follow(jar, await request(jar, url4, {
              method: "POST", body: encode(f3.fields),
              headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${MYSHIP}`, referer: `https://${MYSHIP}/` },
            }), url4);
            const guid = !p4.fail && p4.status === 200 ? (p4.text.match(GUID_RE) || [])[1] || "" : "";
            record(store, stepOf("store.emap", p4, Boolean(guid), `bytes=${p4.text ? p4.text.length : 0} hops=${p4.hops ?? 0} guid=${guid ? 1 : 0}${p4.fail ? ` kind=${p4.fail}` : ""}`));
            if (p4.fail) stop(p4.fail);
            else if (!guid) stop("guid_missing");
            else {
              // 5. the full-store lookup
              const page4 = new URL(p4.finalUrl || url4);
              const section = /^\/mobilemap\//i.test(page4.pathname) ? "mobilemap" : "ecmap";
              const url5 = `https://${page4.hostname}/${section}/byIDData.aspx?rnd=${Math.random()}`;
              const p5 = await request(jar, url5, {
                method: "POST",
                body: encode([
                  ["mode", ""], ["k", PC_PROBE_EMAP_STORE], ["cate", "3"], ["eshopparid", "7M0"], ["eshopid", "7M0"],
                  ["multiple_type", ""], ["Guid", guid], ["Nan4AjaxTrickNumber", String(now())],
                ]),
                headers: {
                  "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest",
                  origin: `https://${page4.hostname}`, referer: `https://${page4.hostname}${page4.pathname}`,
                },
              });
              const verdict = !p5.fail && p5.status === 200 ? parseByIdData(p5.text) : "unknown";
              store.verdict = verdict;
              store.kind = p5.fail ? p5.fail : p5.status !== 200 ? "http" : verdict === "unknown" ? "unexpected_answer" : "";
              record(store, stepOf("store.byid", p5, verdict !== "unknown", `bytes=${p5.text ? p5.text.length : 0} verdict=${verdict}${store.kind ? ` kind=${store.kind}` : ""}`));
            }
          }
        }
      }
    }
  } catch {
    store.kind = "error";
  }

  return { maintWindow, ms: now() - startedAt, phone, store };
}

// ── wiring helpers (server.js mounts these) ─────────────────────────────────
// POST /admin/pc-server-probe (behind requireAuth + requireAdmin).
export function createPcProbeHandler({ run, allowed, enabled = () => pcProbeEnabled() }) {
  return async function pcProbeHandler(_req, res) {
    if (!enabled()) return res.status(404).json({ success: false, error: "disabled" });
    if (!allowed("server")) return res.status(429).json({ success: false, error: "rate_limited" });
    try {
      return res.json({ success: true, result: await run() });
    } catch {
      return res.status(500).json({ success: false, error: "probe_failed" });
    }
  };
}

// One run after the server started. With the probe off: no timer at all (returns null).
export function schedulePcProbeBoot({ run, enabled = pcProbeEnabled(), delayMs = PC_PROBE_BOOT_DELAY_MS, setTimeoutImpl = setTimeout, log = console.log }) {
  if (!enabled) return null;
  const timer = setTimeoutImpl(() => {
    try {
      Promise.resolve().then(run).catch(() => { try { log("[PC_PROBE] boot run failed"); } catch { /* nothing */ } });
    } catch { /* never throws */ }
  }, delayMs);
  if (timer && typeof timer.unref === "function") timer.unref();
  return timer;
}
