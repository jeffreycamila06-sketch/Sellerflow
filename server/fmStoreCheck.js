// FamilyMart (全家) store # check — shared core imported by server.js (the /admin/fm-store-check
// route) AND unit-tested by vitest. Best-effort, NEVER-BLOCKING: asks FamilyMart's public store
// map whether a 6-digit store # exists, so a wrong number is caught when the parcel is saved.
//
// MEASURED from a browser (Jeff, 2026-11-12) — NOT yet from Render:
//   GET <FM_STORE_ENDPOINT>?cvsname=WWW.FAMILY.COM.TW&cvsid=1&cvstemp=test&exchange=true&cvslink=
//       &city=&area=&pkey=<6 digits>&searchType=2&searchWord=<6 digits>
//   - no such store: a short body "抱歉無此店鋪"                          (e.g. 015905)
//   - exists: HTML with "店鋪代號：" + "<code> (全家…店)" + "地址："       (e.g. 022131)
//   - some stores carry the extra words "封閉型店舖" (e.g. 024563) — still VALID; only logged (closed=true)
// NOT known: whether a cookie is needed (the browser opened default.aspx first), the charset,
// and whether Render can reach the site. So: plain GET first; when the answer has none of the
// known shapes, open default.aspx, keep its cookies and ask ONCE more. Anything that is not
// one of the known shapes (timeout, non-200, another page) = 'unknown', which never blocks.

export const FM_STORE_ENDPOINT = process.env.FM_STORE_ENDPOINT || "https://mfme.map.com.tw/store.aspx";
export const FM_STORE_DEFAULT_URL = process.env.FM_STORE_DEFAULT_URL || "https://mfme.map.com.tw/default.aspx";
export const FM_STORE_QUERY = process.env.FM_STORE_QUERY || "cvsname=WWW.FAMILY.COM.TW&cvsid=1&cvstemp=test&exchange=true&cvslink=&city=&area=";
export const FM_STORE_TIMEOUT_MS = Number(process.env.FM_STORE_TIMEOUT_MS) || 5000;
export const FM_STORE_CACHE_MS = 12 * 60 * 60 * 1000;      // a store that exists is kept 12 hours
export const FM_STORE_NOT_FOUND_CACHE_MS = 10 * 60 * 1000;  // "no such store" is kept 10 minutes only
// CANARY — never a false "wrong store code". Before this server answers 'not_found' for any
// store, a store that really exists must have answered 'valid' from THIS server in the last
// 10 minutes. If it did not (the site blocks this server, answers everything "sorry", changed
// its page), the answer is 'unknown'. (FamilyMart's version of the 7-11 gate EMAP_CHECK_CONFIRMED.)
export const FM_STORE_CANARY = /^\d{6}$/.test(String(process.env.FM_STORE_CANARY || "").trim()) ? String(process.env.FM_STORE_CANARY).trim() : "022131";
export const FM_STORE_CANARY_FRESH_MS = 10 * 60 * 1000;
export const FM_STORE_CHECK_MAX_PER_MIN = 120; // per seller — one batch is 40–70 parcels
export const FM_STORE_CACHE_MAX = 5000;
export const FM_STORE_BODY_MAX = 512 * 1024; // a store page is a few KB; anything bigger is not it

const RAW_SNIPPET = 160;

export function fmStoreUrl(id, endpoint = FM_STORE_ENDPOINT, query = FM_STORE_QUERY) {
  return `${endpoint}?${query}&pkey=${id}&searchType=2&searchWord=${id}`;
}

// The charset the answer names (Content-Type header, else a <meta> tag in the first bytes).
export function charsetOf(contentType, buf) {
  const h = /charset\s*=\s*["']?([\w-]+)/i.exec(String(contentType || ""));
  if (h) return h[1].toLowerCase();
  let head = "";
  try { head = new TextDecoder("latin1").decode(new Uint8Array(buf).subarray(0, 2048)); } catch { /* no latin1 → no sniff */ }
  const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : "";
}

// Bytes → text by the answer's own charset; none named → UTF-8 when the bytes are valid UTF-8,
// else Big5 (Taiwan's older charset). Never throws.
export function decodeFmBytes(buf, contentType) {
  const named = charsetOf(contentType, buf);
  if (named) {
    try { return new TextDecoder(named).decode(buf); } catch { /* unknown label → sniff below */ }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { /* not UTF-8 */ }
  try { return new TextDecoder("big5").decode(buf); } catch { /* no Big5 in this runtime */ }
  try { return new TextDecoder("utf-8").decode(buf); } catch { return ""; }
}

const plain = (html) => String(html || "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();

// PURE. The verdict for one decoded answer:
//   { status: 'valid' | 'not_found' | 'unknown', closed? }   (closed = the page says 封閉型店舖; log only)
export function parseFmStoreVerdict(storeId, body) {
  const id = String(storeId || "").trim();
  const text = plain(body);
  if (!text) return { status: "unknown" };
  // The store block: "店鋪代號：022131 (全家樹林新柑園店)". The code on the page must be the one asked.
  const m = /店[鋪舖]代號\s*[：:]\s*(\d{6})\s*[(（]\s*[^)）]{1,80}?\s*[)）]/.exec(text);
  if (m) {
    if (m[1] !== id || !/地址\s*[：:]/.test(text)) return { status: "unknown" };
    return { status: "valid", closed: /封閉型店[舖鋪]/.test(text) };
  }
  // Measured: the WHOLE answer for a missing store is this one sentence. A page that merely
  // contains it is not that answer.
  if (text === "抱歉無此店鋪" || text === "抱歉無此店舖") return { status: "not_found" };
  return { status: "unknown" };
}

// ── cache: one entry per store #, bounded size. 'valid' 12 hours, 'not_found' 10 minutes,
// 'unknown' never.
export function createFmStoreCache({ ttlMs = FM_STORE_CACHE_MS, notFoundTtlMs = FM_STORE_NOT_FOUND_CACHE_MS, max = FM_STORE_CACHE_MAX } = {}) {
  const map = new Map();
  const life = (v) => (v.status === "not_found" ? notFoundTtlMs : ttlMs);
  return {
    get(id, now = Date.now()) {
      const e = map.get(id);
      if (!e) return null;
      if (now - e.at >= life(e.v)) { map.delete(id); return null; }
      return e.v;
    },
    set(id, v, now = Date.now()) {
      if (!v || (v.status !== "valid" && v.status !== "not_found")) return;
      map.delete(id);
      map.set(id, { at: now, v });
      while (map.size > max) map.delete(map.keys().next().value); // oldest first
    },
    size: () => map.size,
  };
}
const sharedCache = createFmStoreCache();
const sharedCanary = { okAt: 0 }; // when the canary store last answered 'valid' from this server

function cookiesOf(resp) {
  let list = [];
  try {
    if (resp.headers && typeof resp.headers.getSetCookie === "function") list = resp.headers.getSetCookie();
    else if (resp.headers && typeof resp.headers.get === "function") { const one = resp.headers.get("set-cookie"); if (one) list = [one]; }
  } catch { /* no cookies */ }
  return list.map((c) => String(c).split(";")[0].trim()).filter((c) => /^[^=\s]+=/.test(c)).slice(0, 20).join("; ");
}

// One GET under the caller's abort signal. { ok, text, resp } or { ok:false, raw }. Never throws.
async function getText(url, { fetchImpl, signal, cookie }) {
  let resp;
  try {
    resp = await fetchImpl(url, { method: "GET", headers: { Accept: "text/html,*/*", ...(cookie ? { Cookie: cookie } : {}) }, redirect: "follow", signal });
  } catch (e) {
    return { ok: false, raw: `fetch_error:${(e && e.name) || "error"}` };
  }
  if (!resp || !resp.ok) return { ok: false, raw: `http_${resp ? resp.status : "no_response"}`, resp };
  try {
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > FM_STORE_BODY_MAX) return { ok: false, raw: "too_big", resp };
    const ct = resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("content-type") : "";
    return { ok: true, text: decodeFmBytes(buf, ct), resp };
  } catch (e) {
    return { ok: false, raw: `read_error:${(e && e.name) || "error"}`, resp };
  }
}

// One store asked on the site: plain GET; an answer of none of the known shapes → open
// default.aspx, keep its cookies, ask ONCE more. (A timeout / network error is not retried: the
// time is already spent.) Runs under the caller's abort signal. Never throws.
async function lookupStore(id, { fetchImpl, signal, endpoint, defaultUrl, query }) {
  const url = fmStoreUrl(id, endpoint, query);
  const first = await getText(url, { fetchImpl, signal });
  let verdict = first.ok ? parseFmStoreVerdict(id, first.text) : { status: "unknown" };
  let raw = first.ok ? first.text : first.raw;
  let retried = false;
  if (verdict.status === "unknown" && !signal.aborted && (first.ok || first.resp)) {
    retried = true;
    const home = await getText(`${defaultUrl}?${query}`, { fetchImpl, signal });
    const cookie = [first.resp ? cookiesOf(first.resp) : "", home.resp ? cookiesOf(home.resp) : ""].filter(Boolean).join("; ");
    if (!signal.aborted) {
      const second = await getText(url, { fetchImpl, signal, cookie });
      if (second.ok) { verdict = parseFmStoreVerdict(id, second.text); raw = second.text; } else raw = second.raw;
    }
  }
  return { verdict, raw, retried };
}

// Full lookup. Returns { storeId, status, closed?, cached?, retried?, raw?, canaryFailed? }.
// raw is for the SERVER log only (a short piece of FamilyMart's page — never buyer data).
// opts.fresh = the seller tapped Re-check: the cache is not READ (the new answer is still stored).
// Never throws.
export async function checkFmStore(storeId, opts = {}) {
  const id = String(storeId || "").trim();
  const {
    fetchImpl = fetch, timeoutMs = FM_STORE_TIMEOUT_MS, endpoint = FM_STORE_ENDPOINT,
    defaultUrl = FM_STORE_DEFAULT_URL, query = FM_STORE_QUERY, cache = sharedCache, now = Date.now(),
    fresh = false, canary = FM_STORE_CANARY, canaryState = sharedCanary,
  } = opts;
  if (!/^\d{6}$/.test(id)) return { storeId: id, status: "unknown" };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs); // ONE limit for the whole lookup (the canary included)
  const site = { fetchImpl, signal: ctl.signal, endpoint, defaultUrl, query };
  // 'not_found' may be answered only with a fresh canary. null = OK, else what the canary said.
  const canaryProblem = async () => {
    if (id === canary) return null; // the canary's own lookup is never judged by the canary
    if (canaryState.okAt > 0 && now - canaryState.okAt < FM_STORE_CANARY_FRESH_MS) return null;
    const c = ctl.signal.aborted ? { verdict: { status: "unknown" } } : await lookupStore(canary, site);
    if (c.verdict.status === "valid") { canaryState.okAt = now; cache.set(canary, { status: "valid", closed: c.verdict.closed === true }, now); return null; }
    return c.verdict.status;
  };
  try {
    const hit = fresh ? null : cache.get(id, now);
    if (hit) {
      if (hit.status !== "not_found") return { storeId: id, ...hit, cached: true };
      const bad = await canaryProblem();
      return bad ? { storeId: id, status: "unknown", cached: true, canaryFailed: { store: canary, got: bad } } : { storeId: id, ...hit, cached: true };
    }
    const { verdict, raw, retried } = await lookupStore(id, site);
    const out = { storeId: id, status: verdict.status };
    if (retried) out.retried = true;
    if (verdict.status === "valid") {
      out.closed = verdict.closed === true;
      if (id === canary) canaryState.okAt = now;
      cache.set(id, { status: "valid", closed: out.closed }, now);
    } else if (verdict.status === "not_found") {
      const bad = await canaryProblem();
      if (bad) { out.status = "unknown"; out.canaryFailed = { store: canary, got: bad }; } // not cached
      else cache.set(id, { status: "not_found" }, now);
    } else {
      out.raw = plain(raw).slice(0, RAW_SNIPPET);
    }
    return out;
  } catch {
    return { storeId: id, status: "unknown", raw: "error" };
  } finally {
    clearTimeout(timer);
  }
}
