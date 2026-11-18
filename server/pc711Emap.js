// The server's E-Map store-search session — a copy of how the Chrome extension keeps its E-Map tab
// (chrome-extension/background.js 1.14.0–1.14.8 + chrome-extension/emap-711.js). Jeff 2026-11-18:
// copy the extension's rules, add only what the server needs to run them. Every number below is the
// extension's (test-pinned against that file). The only differences are the ones a server must have:
//   • the extension's E-Map tab        → one kept session (cookies + eshopGuid + page URL) in memory;
//   • a store check in the tab         → the same byIDData POST, sent with the kept session's cookies;
//   • the GET re-navigation of the tab → a GET of the same page URL with the kept cookies;
//   • the 選擇取貨門市 click (re-mint)  → the requests that click makes (open(): cart → detail → MAP →
//                                         E-Map, server/pcServerProbe.js openOnly — never a login request).
// Logs never hold a store number, phone, name, cookie, token or guid: words, counts, http and ms only.
import { createGuardedFetch, createJar, readCapped, parseFrozenAnswer, byIdRawWord, PC_PROBE_UA, PC_PROBE_GUID_RE } from "./pcServerProbe.js";

// ── chrome-extension/background.js (test-pinned) ───────────────────────────────
export const EMAP_RECENT_MS = 6 * 60 * 1000;               // PC_RECENT_MS
export const EMAP_KEEPALIVE_MS = 5 * 60 * 1000;            // PC_KEEPALIVE_MS
export const EMAP_KEEPALIVE_STORE = "198002";              // PC_KEEPALIVE_STORE
export const EMAP_RELOAD_COOLDOWN_MS = 60 * 1000;          // PC_RELOAD_COOLDOWN_MS
export const EMAP_MAX_RELOADS = 2;                         // PC_MAX_RELOADS
export const EMAP_RECOVER_VERDICT_GUARD_MS = 5 * 60 * 1000; // PC_RECOVER_VERDICT_GUARD_MS
export const EMAP_RECOVER_MIN_MISSES = 3;                  // PC_RECOVER_MIN_MISSES
export const EMAP_RECOVER_MIN_SPAN_MS = 2 * 60 * 1000;     // PC_RECOVER_MIN_SPAN_MS
export const EMAP_STORE_VERDICTS = ["open", "full", "company", "not_found"]; // PC_STORE_VERDICTS
// ── chrome-extension/emap-711.js (test-pinned) ────────────────────────────────
export const EMAP_REQUEST_MS = 10000;                      // TIMEOUT_MS
// ── chrome-extension/emap-frozen-711.js + frozen-check.js (test-pinned; NOT the warm-up) ───────────
export const EMAP_FROZEN_REQUEST_MS = 2500;                // emap-frozen-711.js TIMEOUT_MS (headers AND body)
export const EMAP_FROZEN_STORE_GAP_MS = 10 * 60 * 1000;    // frozen-check.js STORE_GAP_MS
export const EMAP_FROZEN_SLOW_PAUSE_MS = 10 * 60 * 1000;   // frozen-check.js SLOW_PAUSE_MS
// ── Jeff 2026-11-18 (server only — the extension waits for a person here) ───────────────────────────
export const EMAP_OPEN_RETRY_MS = 2 * 60 * 1000;           // after two failed opens in a row: one try every 2 min
const EMAP_HOSTS = ["emap.unipcsc.com.tw", "emap.pcsc.com.tw"];
const TAG = "[PC711_EMAP]";

const isStoreVerdict = (v) => EMAP_STORE_VERDICTS.includes(v);

/** pcKeepaliveDue — only while no pending row needs the store half, every 5 min. */
export function emapKeepaliveDue(now, lastAt, anyNeedStore) {
  return !anyNeedStore && (now - lastAt) >= EMAP_KEEPALIVE_MS;
}
/** pcRecoveryDue — inMaint = the 01:00–05:00 Taipei window (pcInMaintenance). */
export function emapRecoveryDue(now, e, inMaint) {
  if (inMaint) return false;
  if (e.lastVerdictAt && now - e.lastVerdictAt < EMAP_RECOVER_VERDICT_GUARD_MS) return false;
  if (e.misses < EMAP_RECOVER_MIN_MISSES) return false;
  if (!e.firstMissAt || now - e.firstMissAt < EMAP_RECOVER_MIN_SPAN_MS) return false;
  if (e.reloads >= EMAP_MAX_RELOADS) return false;
  if (e.reloadAt && now - e.reloadAt < EMAP_RELOAD_COOLDOWN_MS) return false;
  return true;
}
/** pcDeriveEmap ("reminting" never happens here: the re-mint requests are answered in the same call). */
export function emapDerive(now, e, inMaint) {
  if (!e.present) return "no_tab";
  if (e.error) return "expired";
  const recent = Boolean(e.lastVerdictAt) && now - e.lastVerdictAt <= EMAP_RECENT_MS;
  const latestFailed = (e.lastMissAt || 0) > (e.lastVerdictAt || 0);
  if (recent && !latestFailed) return "ok";
  if (e.reloads >= EMAP_MAX_RELOADS && e.misses > 0) return "dead";
  if (e.reloadAt && now - e.reloadAt < EMAP_RELOAD_COOLDOWN_MS) return "recovering";
  if (emapRecoveryDue(now, e, inMaint)) return "guid_missing";
  if (recent && latestFailed) return "degraded";
  return "stale";
}
/** emap-711.js parseByIdData: field 3 enable → open · disable → full · close → company; "NO2" → not_found; else null. */
export function emapParseByIdData(text) {
  const raw = String(text).trim();
  if (raw === "NO2") return "not_found";
  const rec = raw.split(";")[1];
  const field = rec ? rec.split("+")[3] : "";
  if (field === "enable") return "open";
  if (field === "disable") return "full";
  if (field === "close") return "company";
  return null;
}
/** emap-711.js sectionOf + endpointCandidates, with the remembered endpoint first. */
export function emapSectionOf(pathname) {
  const m = /^\/(mobilemap|ecmap)\//i.exec(String(pathname || ""));
  return m ? m[1].toLowerCase() : "ecmap";
}
export function emapEndpointOrder(section, known) {
  const own = section === "mobilemap" ? "mobilemap" : "ecmap";
  const other = own === "mobilemap" ? "ecmap" : "mobilemap";
  const list = [`/${own}/byIDData.aspx`, `/${other}/byIDData.aspx`];
  return known ? [known, ...list.filter((p) => p !== known)] : list;
}
const isErrorAspx = (location, base) => {
  try { return /\/(ecmap|mobilemap)\/error\.aspx/i.test(new URL(String(location), base).pathname); } catch { return false; }
};

// open() → the probe's result in openOnly mode: { store: { emap?: { cookies, guid, pageUrl }, kind, steps } }.
export function createPc711Emap({ open, fetchImpl = fetch, now = Date.now, log = console.log, random = Math.random }) {
  const guarded = createGuardedFetch(fetchImpl);
  // pcEv.emap (the same fields; tabId → present)
  const e = { present: false, guid: false, error: false, lastVerdictAt: 0, lastMissAt: 0, misses: 0, firstMissAt: 0, lastMissReason: "",
    reloadAt: 0, reloads: 0, state: null, remint: { tried: false, result: "" } };
  let verdictGen = 0;                       // pcEv.verdictGen
  let lastKeepaliveAt = 0;                  // pcLastKeepaliveAt
  let s = null;                             // the kept session: { jar, guid, pageUrl, host, section, known }
  // Jeff 2026-11-18 — the open schedule (the extension waits for a person here):
  let openFails = 0;           // opens in a row that gave no answer: failed, or opened and died before any answer
  let nextOpenAt = 0;          // no try before this (2 min after the last try)
  let loginKick = false;       // a 7-11 login happened: the next refresh may try at once
  let unanswered = false;      // the kept session was opened and has not given an answer yet
  let deathCounted = false;    // its death (before any answer) is already counted in openFails
  const say = (line) => { try { log(line); } catch { /* a log never stops a check */ } };

  // pcEmapVerdict / pcEmapMiss — the ONLY writers of the miss ladder
  let requeueDue = false;                   // pcEv.requeueDue = "recovery" (background.js:597, :732)
  function verdict(t) {
    // the lane is back after a real outage (a streak of counted misses, or a re-load) → given-up stores go back in the queue
    if (e.misses >= EMAP_RECOVER_MIN_MISSES || e.reloads > 0) requeueDue = true;
    e.lastVerdictAt = t; e.misses = 0; e.firstMissAt = 0; e.lastMissReason = ""; e.reloads = 0;
    verdictGen += 1;
    e.remint = { tried: false, result: "" };
    openFails = 0; nextOpenAt = 0; unanswered = false; // a session gave an answer: the open schedule is over
  }
  function miss(t, reason, transient, inMaint) {
    if (transient) return;
    if (inMaint) return;
    e.misses += 1; if (!e.firstMissAt) e.firstMissAt = t; e.lastMissAt = t; e.lastMissReason = String(reason || "");
  }

  // One request with the kept session's cookies: 10 s, redirects NOT followed (an error.aspx bounce is
  // read from Location), every URL through the probe's allowlist. → { status, text, location, ms } | { fail, ms }
  async function request(url, init) {
    const t0 = now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Number(init.timeoutMs) > 0 ? Number(init.timeoutMs) : EMAP_REQUEST_MS);
    let u;
    try { u = new URL(url); } catch { clearTimeout(timer); return { fail: "refused", ms: 0 }; }
    try {
      const headers = { "user-agent": PC_PROBE_UA, ...(init.headers || {}) };
      const cookie = s.jar.header(u.hostname);
      if (cookie) headers.cookie = cookie;
      const r = await guarded(url, { method: init.method || "GET", headers, body: init.body, redirect: "manual", signal: ctl.signal });
      s.jar.store(u.hostname, r.headers);
      const text = await readCapped(r);
      if (text === null) return { fail: "too_big", ms: now() - t0, status: r.status };
      return { status: r.status, text, ms: now() - t0, location: r.status >= 300 && r.status < 400 ? String(r.headers?.get?.("location") || "") : "" };
    } catch (err) {
      if (err?.refused) return { fail: "refused", ms: 0 };
      return { fail: err?.name === "AbortError" || ctl.signal.aborted ? "timeout" : "network", ms: now() - t0 };
    } finally { clearTimeout(timer); }
  }

  // emap-711.js postByIdData + checkFullStore. frozen = the frozen lane's cate=27 (no ladder evidence).
  // → { verdict: word|"unknown", kind, transient, http, ms, raw, steps }
  async function check(storeId, { frozen = false } = {}) {
    const step = frozen ? "frozen.byid" : "store.byid";
    const t0 = now();
    if (!/^\d{6}$/.test(String(storeId || ""))) return { verdict: "unknown", kind: "bad_input", transient: false, http: 0, ms: 0, raw: "", steps: [{ step: "store.config", http: 0, ms: 0, ok: false, note: "kind=bad_input" }] };
    if (!s || !s.guid) return { verdict: "unknown", kind: "guid_missing", transient: false, http: 0, ms: 0, raw: "", steps: [{ step, http: 0, ms: 0, ok: false, note: "kind=guid_missing" }] };
    const steps = []; let allTransient = true; let last = { http: 0, raw: "", kind: "" };
    for (const endpoint of emapEndpointOrder(s.section, s.known)) {
      const url = `https://${s.host}${endpoint}?rnd=${random()}`;
      const body = new URLSearchParams([
        ["mode", ""], ["k", String(storeId)], ["cate", frozen ? "27" : "3"], ["eshopparid", "7M0"], ["eshopid", "7M0"],
        ["multiple_type", ""], ["Guid", s.guid], ["Nan4AjaxTrickNumber", String(now())],
      ]).toString();
      const res = await request(url, { method: "POST", body, headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest",
        origin: `https://${s.host}`, referer: s.pageUrl,
      } });
      let kind = "", transient = false, answer = null;
      if (res.fail) { kind = res.fail; transient = res.fail === "timeout" || res.fail === "network"; }
      else if (res.location && isErrorAspx(res.location, url)) kind = "error_aspx";
      else if (res.status < 200 || res.status >= 300) { kind = "http"; transient = res.status >= 500; }
      else {
        answer = frozen ? parseFrozenAnswer(res.text) : emapParseByIdData(res.text);
        if (answer === null) kind = "unexpected_answer";
      }
      last = { http: res.status || 0, raw: res.text !== undefined && !res.fail ? byIdRawWord(res.text) : "", kind };
      steps.push({ step, http: res.status || 0, ms: res.ms || 0, ok: answer !== null, note: kind ? `kind=${kind}` : "" });
      if (answer !== null) {
        s.known = endpoint;
        return { verdict: answer, kind: "", transient: false, http: res.status, ms: now() - t0, raw: last.raw, steps };
      }
      if (!transient) allTransient = false;
    }
    return { verdict: "unknown", kind: last.kind, transient: allTransient, http: last.http, ms: now() - t0, raw: last.raw, steps };
  }

  // emap-frozen-711.js postFrozen + checkFrozenStore: ONE endpoint per check (its own section memory),
  // 2.5 s for headers and body; a real non-answer (not a blip) → the other section NEXT time.
  async function frozenCheck(storeId) {
    const t0 = now();
    if (!/^\d{6}$/.test(String(storeId || ""))) return { verdict: "unknown", kind: "bad_input", transient: false, http: 0, ms: 0, raw: "", steps: [{ step: "store.config", http: 0, ms: 0, ok: false, note: "kind=bad_input" }] };
    if (!s || !s.guid) return { verdict: "unknown", kind: "guid_missing", transient: false, http: 0, ms: 0, raw: "", steps: [{ step: "frozen.byid", http: 0, ms: 0, ok: false, note: "kind=guid_missing" }] };
    const url = `https://${s.host}/${s.frozenSection}/byIDData.aspx?rnd=${random()}`;
    const body = new URLSearchParams([
      ["mode", ""], ["k", String(storeId)], ["cate", "27"], ["eshopparid", "7M0"], ["eshopid", "7M0"],
      ["multiple_type", ""], ["Guid", s.guid], ["Nan4AjaxTrickNumber", String(now())],
    ]).toString();
    const res = await request(url, { method: "POST", body, timeoutMs: EMAP_FROZEN_REQUEST_MS, headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest",
      origin: `https://${s.host}`, referer: s.pageUrl,
    } });
    let kind = "", transient = false, answer = null;
    if (res.fail) { kind = res.fail; transient = res.fail === "timeout" || res.fail === "network"; }
    else if (res.location && isErrorAspx(res.location, url)) kind = "error_aspx";
    else if (res.status < 200 || res.status >= 300) { kind = "http"; transient = res.status >= 500; }
    else { answer = parseFrozenAnswer(res.text); if (answer === null) kind = "unexpected_answer"; }
    if (answer === null && !transient) s.frozenSection = s.frozenSection === "mobilemap" ? "ecmap" : "mobilemap";
    const raw = res.text !== undefined && !res.fail ? byIdRawWord(res.text) : "";
    return { verdict: answer ?? "unknown", kind: answer === null ? kind : "", transient, http: res.status || 0, ms: now() - t0, raw,
      steps: [{ step: "frozen.byid", http: res.status || 0, ms: res.ms || 0, ok: answer !== null, note: kind ? `kind=${kind}` : "" }] };
  }

  /** pcPickEmapTab: a kept session without a guid (and not on error.aspx) → one definitive miss per pass. */
  function pick(inMaint) {
    if (e.present && !e.error && !e.guid) miss(now(), "probe: eshopGuid not found", false, inMaint);
  }
  /** doStore needs the tab: present and not on error.aspx (the extension's emapTabId). */
  const usable = () => Boolean(e.present && !e.error);
  /** The kept session still answers: there is one, it is not on error.aspx, and it has not been given up
   *  ("dead": two re-loads and still no answer). Then a lost 7-11 login stops no check (server/pc711Shadow.js)
   *  — the login is only needed to open the NEXT session. */
  const answering = () => usable() && emapDerive(now(), e, false) !== "dead";

  /** The store half of a parcel: the check + the extension's evidence (verdict / miss handled by the caller's ladder). */
  async function checkStore(storeId) { return check(storeId); }
  async function checkFrozen(storeId) { return frozenCheck(storeId); }

  /** pcEmapKeepalive: store 198002 every 5 min while nothing needs the store half. not_found = a miss. */
  async function keepalive(anyNeedStore, inMaint) {
    const t = now();
    if (!emapKeepaliveDue(t, lastKeepaliveAt, anyNeedStore)) return null;
    if (!usable()) return null;
    lastKeepaliveAt = t;
    const r = await check(EMAP_KEEPALIVE_STORE);
    const alive = isStoreVerdict(r.verdict) && r.verdict !== "not_found";
    if (alive) verdict(t); else miss(t, `keepalive: ${r.kind || r.verdict}`, r.transient, inMaint);
    say(`${TAG} keepalive verdict=${r.verdict} alive=${alive ? 1 : 0} http=${r.http} ms=${r.ms}${r.kind ? ` kind=${r.kind}` : ""}`);
    return { alive, verdict: r.verdict };
  }

  // the GET re-navigation of the E-Map tab (chrome.tabs.update(url)): a live session re-mints the guid;
  // a dead one lands on error.aspx → expired
  async function reload() {
    const res = await request(s.pageUrl, { method: "GET", headers: { referer: s.pageUrl } });
    if (!res.fail && res.location && isErrorAspx(res.location, s.pageUrl)) { e.error = true; e.guid = false; s.guid = ""; return "error_aspx"; }
    const g = !res.fail && res.status === 200 ? (res.text.match(PC_PROBE_GUID_RE) || [])[1] || "" : "";
    s.guid = g; e.guid = Boolean(g); e.error = false;
    return res.fail || (g ? "guid" : res.status === 200 ? "no_guid" : "http");
  }

  // pcTryRemint + pcAdoptRemintedTab: the 選擇取貨門市 click's requests (open()).
  // → { ok, kind (one word), http (last step), step (last step name) }. One log line: the outcome word.
  async function remint() {
    e.remint.tried = true;
    let r = null;
    try { r = await open(); } catch { r = null; }
    const st = r && r.store;
    const got = st && st.emap && st.emap.guid ? st.emap : null;
    const steps = st && Array.isArray(st.steps) ? st.steps : [];
    const lastStep = steps.length ? steps[steps.length - 1] : null;
    const info = { ok: false, kind: String((st && st.kind) || "error"), http: Number(lastStep && lastStep.http) || 0, step: String((lastStep && lastStep.step) || "store.cart") };
    let host = "", path = "";
    if (got) { try { const u = new URL(got.pageUrl); host = u.hostname; path = u.pathname; } catch { host = ""; } }
    if (got && !EMAP_HOSTS.includes(host)) info.kind = "emap_host";
    if (!got || !EMAP_HOSTS.includes(host)) {
      e.remint.result = `open_failed:${info.kind}`;
      say(`${TAG} open result=${noteOf(info.kind) || "error"}`);
      return info;
    }
    const jar = createJar(Object.fromEntries(Object.entries(got.cookies || {}).filter(([h]) => EMAP_HOSTS.includes(h))));
    const section = emapSectionOf(path);
    s = { jar, guid: got.guid, pageUrl: got.pageUrl, host, section, known: null, frozenSection: section };
    // adopt: a fresh ladder, verify at once (pcAdoptRemintedTab)
    e.present = true; e.guid = true; e.error = false;
    e.remint.result = ""; e.reloads = 0; e.misses = 0; e.firstMissAt = 0; e.reloadAt = 0; lastKeepaliveAt = 0;
    requeueDue = true;                      // the session was re-opened (pcAdoptRemintedTab)
    say(`${TAG} open result=ok`);
    return { ok: true, kind: "", http: info.http, step: info.step };
  }

  // Jeff 2026-11-18 — an open that gives no answer (it failed, or it opened and the session died before any
  // answer): one try at once; then one try every 2 min until a session gives an answer; at once after a
  // 7-11 login; never 01:00–05:00. hooks.onOpenFail(info) → true when the shadow's safety brake paused (then
  // no further try now); hooks.onOpenOk() → a successful open breaks the brake's run of refusals.
  async function openTry(hooks) {
    const info = await remint();
    if (info.ok) {
      // opened: the next try (if this session dies before any answer) not before 2 min from this one
      nextOpenAt = now() + EMAP_OPEN_RETRY_MS; unanswered = true; deathCounted = false;
      if (hooks && hooks.onOpenOk) { try { hooks.onOpenOk(); } catch { /* never stops the pass */ } }
      return { info, paused: false };
    }
    openFails += 1;
    nextOpenAt = now() + EMAP_OPEN_RETRY_MS;
    let paused = false;
    if (hooks && hooks.onOpenFail) { try { paused = Boolean(await hooks.onOpenFail(info)); } catch { paused = false; } }
    return { info, paused };
  }

  /** pcRefreshTabStatus: the recovery GET, then the re-mint. inMaint = 01:00–05:00 Taipei. */
  async function refresh(inMaint, hooks = null) {
    const t = now();
    let state = emapDerive(t, e, inMaint);
    if (state === "guid_missing") {
      e.reloadAt = t; e.reloads += 1; lastKeepaliveAt = 0;
      const how = await reload();
      say(`${TAG} recover reason=${noteOf(e.lastMissReason) || "no_guid"} misses=${e.misses} lastVerdictAgo=${e.lastVerdictAt ? Math.round((t - e.lastVerdictAt) / 1000) : "never"}s attempt=${e.reloads}/${EMAP_MAX_RELOADS} via=GET result=${how}`);
      state = "recovering";
    }
    // the server's "賣貨便 tab parked on /cart/detail" = the saved 7-11 login, which the caller checks before every pass
    const remintable = state === "dead" || state === "expired" || state === "no_tab";
    const lastFailed = e.remint.result.startsWith("open_failed");
    // the opened session died before giving any answer → it counts like a failed open (once per session)
    let atOnce = false;
    if (remintable && unanswered && !deathCounted && !inMaint) { deathCounted = true; openFails += 1; atOnce = openFails === 1; }
    // the extension: once per episode; Jeff: an open with no answer → again at once, then every 2 min; at once after a login
    const due = remintable && !inMaint && (!e.remint.tried || loginKick || atOnce || ((lastFailed || unanswered) && now() >= nextOpenAt));
    if (due) {
      loginKick = false;
      let r = await openTry(hooks);
      // one failed open (not after the brake paused) → one more try right away, to confirm it really cannot open
      if (!r.info.ok && openFails === 1 && !r.paused) r = await openTry(hooks);
      state = r.info.ok ? "ok" : e.present ? emapDerive(now(), e, inMaint) : "no_tab";
    }
    e.state = state;
    return state;
  }
  /** a 7-11 login happened (the saved login's `since` changed): open at once if the session is not usable. */
  function onLogin() { loginKick = true; }

  return {
    pick, usable, answering, checkStore, checkFrozen, keepalive, refresh, onLogin,
    /** the keepalive's clock (frozen-check.js laneBusy is NOT copied: the server sends one request at a time) */
    /** the store half's verdict / miss (pcEmapVerdict / pcEmapMiss), and the once-per-generation counter */
    verdict: () => verdict(now()),
    miss: (reason, transient, inMaint) => miss(now(), reason, transient, inMaint),
    gen: () => verdictGen,
    /** true once after a recovery / re-open (then cleared): the backup checker re-queues given-up stores */
    takeRequeueDue: () => { const d = requeueDue; requeueDue = false; return d; },
    state: () => ({ state: e.state, present: e.present, guid: e.guid, error: e.error, misses: e.misses, reloads: e.reloads, lastVerdictAt: e.lastVerdictAt || null, remintTried: e.remint.tried, remintResult: e.remint.result, openFails, nextOpenAt: nextOpenAt || null, unanswered }),
    _e: () => e, _session: () => s, _lastKeepaliveAt: () => lastKeepaliveAt,
  };
}

// a reason → one safe word (no data in logs)
function noteOf(reason) {
  return String(reason || "").toLowerCase().replace(/[^a-z0-9_:]/g, "_").replace(/_+/g, "_").slice(0, 40);
}
