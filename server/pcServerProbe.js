// 7-11 SERVER PROBE — diagnostic only.
// Question it answers: can THIS server do the two checks the Parcel Checker extension does
// today (restricted phone, full store)? It only logs what happened. It never writes to a
// parcel, never changes the checker, never touches the database (it reads three settings).
//
// OFF unless env PC_SERVER_PROBE is exactly "1". Importing this file starts nothing.
//   PHONE step  — mirrors chrome-extension/myship-711.js checkRestricted with anon=true.
//   STORE step  — only with env PC_PROBE_MYSHIP_COOKIE (the Cookie header of a logged-in
//                 賣貨便 session, set by the owner). Mirrors chrome-extension/emap-711.js.
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
const MAINT_START_H = 1, MAINT_END_H = 5;    // Asia/Taipei hours [1, 5) — same as the extension

const MYSHIP = "myship.7-11.com.tw";
const EMAP_HOSTS = ["emap.unipcsc.com.tw", "emap.pcsc.com.tw"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
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
  /^\/cart\/easy\/GM\d+$/,
  /^\/CPF3101\/CheckoutValidation\/$/,
  /^\/cart\/detail$/,
  /^\/CPF3101\/MAP\/$/,
  /^\/eMap\/MM1\/GM\d+$/i,
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
const decodeEntities = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function attrsOf(tag) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

// Forms of a page: [{ id, action, method, fields: [[name, value], …] }] — fields as a browser
// would send them (unchecked boxes, buttons and files are left out).
export function parseForms(html) {
  const forms = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  for (let f = formRe.exec(String(html)); f; f = formRe.exec(String(html))) {
    const a = attrsOf(f[1]);
    const body = f[2];
    const fields = [];
    const inputRe = /<input\b([^>]*)>/gi;
    for (let i = inputRe.exec(body); i; i = inputRe.exec(body)) {
      const ia = attrsOf(i[1]);
      const type = String(ia.type || "text").toLowerCase();
      if (!ia.name || ["submit", "button", "image", "file", "reset"].includes(type)) continue;
      if ((type === "checkbox" || type === "radio") && !/\schecked\b/i.test(i[1])) continue;
      fields.push([ia.name, ia.value ?? (type === "checkbox" || type === "radio" ? "on" : "")]);
    }
    const selRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
    for (let s = selRe.exec(body); s; s = selRe.exec(body)) {
      const sa = attrsOf(s[1]);
      if (!sa.name) continue;
      const opts = [...s[2].matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/option>|$)/gi)];
      const pick = opts.find((o) => /\sselected\b/i.test(o[1])) || opts[0];
      if (!pick) continue;
      const oa = attrsOf(pick[1]);
      fields.push([sa.name, oa.value ?? decodeEntities(pick[2].trim())]);
    }
    const taRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
    for (let t = taRe.exec(body); t; t = taRe.exec(body)) {
      const ta = attrsOf(t[1]);
      if (ta.name) fields.push([ta.name, decodeEntities(t[2])]);
    }
    forms.push({ id: a.id || "", action: a.action || "", method: String(a.method || "get").toLowerCase(), fields });
  }
  return forms;
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
  return {
    header: (host) => [...of(host)].map(([k, v]) => `${k}=${v}`).join("; "),
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
// opts: fetchImpl, now (() => ms), log, readSetting (async key → string|null), env.
// Never throws.
export async function runPcServerProbe(opts = {}) {
  const { fetchImpl = fetch, now = Date.now, log = console.log, readSetting, env = process.env } = opts;
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
    const u = new URL(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(PC_PROBE_REQUEST_MS, left));
    const t0 = now();
    try {
      const headers = { "user-agent": UA, ...(init.headers || {}) };
      const cookie = jar ? jar.header(u.hostname) : "";
      if (cookie) headers.cookie = cookie;
      const r = await guarded(url, { method: init.method || "GET", headers, body: init.body, redirect: "manual", signal: ctl.signal });
      if (jar) jar.store(u.hostname, r.headers);
      const text = await r.text();
      return {
        status: r.status, host: u.hostname, path: u.pathname, text, ms: now() - t0,
        ct: String(r.headers?.get?.("content-type") || "").split(";")[0].trim(),
        location: r.status >= 300 && r.status < 400 ? String(r.headers?.get?.("location") || "") : "",
      };
    } catch (e) {
      const kind = e?.refused ? "refused" : e?.name === "AbortError" || ctl.signal.aborted ? "timeout" : "network";
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
    return { ...res, hops, finalUrl: base };
  };

  const stepOf = (step, res, ok, note) => ({
    step, http: res?.status ?? 0, path: res?.host ? `${res.host}${res.path}` : "", ms: res?.ms ?? 0, ok, note,
  });

  // ── config (three settings; nothing is requested when it is missing) ────────
  let cfg = { gm: "", sender: "", buyer: "" };
  try {
    if (typeof readSetting === "function") {
      const [gms, sender, buyer] = await Promise.all([
        readSetting("parcel_check_shared_gms"), readSetting("parcel_check_sender_phone"), readSetting("parcel_check_probe_buyer"),
      ]);
      cfg = parseProbeConfig({ gms, sender, buyer });
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

  // ── STORE (only with the owner's logged-in cookie) ───────────────────────────
  try {
    const seed = String(env?.PC_PROBE_MYSHIP_COOKIE ?? "").trim();
    if (!seed) { store.kind = "no_cookie"; record(store, stepOf("store.skip", null, false, "no_cookie")); }
    else if (!cfg.gm) { store.kind = "config_missing"; record(store, stepOf("store.config", null, false, "config_missing")); }
    else {
      const jar = createJar({ [MYSHIP]: seed });
      const stop = (kind) => { store.kind = kind; };
      // 1. the cart page
      const p1 = await request(jar, cartUrl);
      const f1 = !p1.fail && p1.status === 200 ? parseForms(p1.text).find((f) => f.id === "MyCart") : null;
      const sidLen = f1 ? String(fieldOf(f1, "MemberSid") ?? "").length : 0;
      const loggedIn = sidLen >= 4;
      record(store, stepOf("store.cart", p1, Boolean(f1) && loggedIn, `bytes=${p1.text ? p1.text.length : 0} form=${f1 ? 1 : 0} fields=${f1 ? f1.fields.length : 0} logged_in=${loggedIn ? 1 : 0}${p1.fail ? ` kind=${p1.fail}` : ""}`));
      if (p1.fail) stop(p1.fail);
      else if (!f1) stop("cart_form_missing");
      else if (!loggedIn) stop("login_not_accepted");
      else {
        // 2. the cart form → page 2. Measured on the real page: the fee is the NAMED field
        //    fullAmountFee_1; nine fields get the values the browser sends for one item (name
        //    "test", price 62, qty 1); every other field goes exactly as served. A field name the
        //    served form does not have is never added.
        const feeRaw = fieldOf(f1, "fullAmountFee_1");
        const fee = feeRaw === undefined || String(feeRaw).trim() === "" ? NaN : Number(feeRaw);
        const patch = Number.isFinite(fee) ? {
          item_name_1: "test", item_price_1: 62, item_qty_1: 1, item_amt_1: 62, Sum: 62, CarQty: 1,
          Carm_Cgptshipprice: fee, Total: 62 + fee, Seller_GoodsTotalAmt: 62 + fee,
        } : {};
        const missing = Object.keys(patch).filter((name) => fieldOf(f1, name) === undefined);
        const url2 = new URL(f1.action || "/cart/detail", cartUrl).toString();
        const p2 = !Number.isFinite(fee) ? { fail: "fee_missing", ms: 0 }
          : missing.length ? { fail: "cart_field_missing", ms: 0 }
          : await follow(jar, await request(jar, url2, {
            method: "POST", body: encode(withFields(f1.fields, patch)),
            headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${MYSHIP}`, referer: cartUrl },
          }), url2);
        const f2 = !p2.fail && p2.status === 200 ? parseForms(p2.text).find((f) => f.id === "MyCart") : null;
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
          const forms3 = !p3.fail && p3.status === 200 ? parseForms(p3.text) : [];
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
