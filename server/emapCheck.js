// 7-11 E-Map store-code check — shared core imported by server.js (the
// /admin/parcel-emap-check route) AND unit-tested by vitest. Best-effort,
// NEVER-BLOCKING validation of a 6-digit 7-11 store code against 7-11's public
// EMapSDK.aspx locator, so a wrong/typo'd code is caught at scan time.
//
// ⚠️ EGRESS NOTE (why the shapes below are "documented" not "measured"): this
// build's sandbox egress policy blocks emap.pcsc.com.tw, so the probe against
// real store IDs could not run here — it must not be routed around. The request
// shape and response parsing below follow the widely-documented public
// EMapSDK.aspx contract, and are made SAFE against being slightly wrong three
// ways: (1) the lookup command/param are ENV-OVERRIDABLE (EMAP_LOOKUP_COMMAND /
// EMAP_LOOKUP_PARAM) so the owner can correct the shape without a redeploy;
// (2) the route logs a bounded RAW snippet on every not_found/unknown so the
// FIRST real lookups on Render reveal the true XML shape; (3) any ambiguity
// degrades to 'unknown', which the UI shows as "can't verify" and never blocks.
//
// What EMapSDK.aspx exposes: store existence + name + address + phone + coords.
// It does NOT expose 交貨便 parcel-accept / "full" status — so there is no
// 'no_service' verdict (see sql/26 header). A full store reads as 'valid'.

export const EMAP_ENDPOINT = process.env.EMAP_ENDPOINT || "https://emap.pcsc.com.tw/EMapSDK.aspx";
export const EMAP_LOOKUP_COMMAND = process.env.EMAP_LOOKUP_COMMAND || "SearchStore";
export const EMAP_LOOKUP_PARAM = process.env.EMAP_LOOKUP_PARAM || "StoreName";
export const EMAP_TIMEOUT_MS = Number(process.env.EMAP_TIMEOUT_MS) || 5000;

// ── Query-shape variant (EMAP_LOOKUP_VARIANT, default "id") ───────────────────
// The 6-digit store CODE goes in the wrong field with StoreName= (that field is
// for the store NAME / wildcard), which is why SearchStore returned 連線成功 but
// ZERO <GeoPosition>. A real working lookup used the full SearchStore param set
// with the code in the ID field. Variants (env-selectable, no redeploy):
//   "id"        — commandid=SearchStore, ID=<code>, all other known fields
//                 blank/False (the working full param set). DEFAULT.
//   "storename" — commandid=<command>, <param>=<code> (the old single-field
//                 shape; <param> = EMAP_LOOKUP_PARAM so ANY field is env-tunable).
//   "both"      — try "id"; if it returns 0 <GeoPosition>, retry once "storename".
export const EMAP_LOOKUP_VARIANT = String(process.env.EMAP_LOOKUP_VARIANT || "id").toLowerCase();

// The named fields present in the known-working SearchStore call, all sent
// blank/False except the ID (the code). Extra/unknown fields are ignored by
// E-Map; the discriminator is ID. Owner can still switch to "storename" +
// EMAP_LOOKUP_PARAM to drop the code into any other single field from env.
export function emapBody(variant, id, command, param) {
  const enc = encodeURIComponent;
  if (variant === "storename") {
    return `commandid=${enc(command)}&${enc(param)}=${enc(id)}`;
  }
  // "id" (default): full param set, code in ID, everything else blank/False.
  return [
    `commandid=${enc(command)}`,
    `ID=${enc(id)}`,
    "StoreName=", "address=", "roadname=", "city=", "town=", "SpecialStore_Kind=",
    "is7WiFi=False", "isATM=False",
  ].join("&");
}

// Count store nodes in a decoded E-Map body (the "both" retry gate + logging).
export function countPois(text) {
  const m = String(text || "").match(/<GeoPosition[\s>]/gi);
  return m ? m.length : 0;
}

// AUDIT S1 cry-wolf gate: until the owner has confirmed on Render that a known-
// valid code (e.g. 982063) returns a real store match (the request/parse shape
// could not be verified in the build sandbox — egress-blocked), a wrong query
// shape could flag EVERY valid store as not_found. So while this is unset/false,
// a not_found verdict is DOWNGRADED to 'unknown' (grey "can't verify"), never a
// red ❌ — and the raw XML is logged so the owner can confirm the shape, then
// flip EMAP_CHECK_CONFIRMED=true (env change, no redeploy) to enable real
// wrong-code detection. Safe-by-default first session.
export const EMAP_CHECK_CONFIRMED = /^(1|true|yes|on)$/i.test(String(process.env.EMAP_CHECK_CONFIRMED || "").trim());

const RAW_SNIPPET = 500;
const FIELD_CAP = 120; // storeName / address display cap

const clip = (s, n) => String(s == null ? "" : s).trim().slice(0, n);

// Charset sniff: UTF-8 is self-validating, so try it in FATAL mode first — a
// clean decode means the body really was UTF-8; a throw means the bytes aren't
// valid UTF-8, i.e. Big5 (E-Map's historical charset), so fall back to Big5.
// This gets the Chinese storeName/address right whichever charset E-Map serves,
// without guessing. (The valid/not_found DECISION rests only on ASCII tags +
// the numeric POIID, which survive either decoding regardless.)
export function decodeEmapBytes(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch { /* not valid UTF-8 → probably Big5 */ }
  try {
    const s = new TextDecoder("big5").decode(buf);
    if (s) return s;
  } catch { /* Big5 unsupported in this runtime → last-resort lenient UTF-8 */ }
  try { return new TextDecoder("utf-8").decode(buf); } catch { return ""; }
}

// Pure verdict from a decoded E-Map response body. Exported for unit tests.
//   { status: "valid"|"not_found"|"unknown", storeName?, address? }
export function parseEmapVerdict(storeId, xml) {
  const text = String(xml || "");
  const id = String(storeId || "").trim();

  // A store node present → the store exists. Match the queried id against the
  // POIID of a returned node to be sure it's THE store (a name-search can echo
  // several). Node present but no id match → ambiguous → unknown (never a false
  // "wrong code").
  if (/<GeoPosition[\s>]/i.test(text)) {
    const blocks = text.split(/<GeoPosition[^>]*>/i).slice(1);
    for (const b of blocks) {
      const poi = (b.match(/<POIID>\s*([^<\s]+)\s*<\/POIID>/i) || [])[1];
      if (poi && poi === id) {
        return {
          status: "valid",
          storeName: clip((b.match(/<POIName>([\s\S]*?)<\/POIName>/i) || [])[1], FIELD_CAP),
          address: clip((b.match(/<Address>([\s\S]*?)<\/Address>/i) || [])[1], FIELD_CAP),
        };
      }
    }
    return { status: "unknown" };
  }

  // No store node. A well-formed E-Map XML response with zero stores = the code
  // does not exist → not_found. Guard against an HTML error page or an empty /
  // non-XML body (those are 'unknown', not a real "no such store").
  const looksXml = /</.test(text) && !/<html[\s>]/i.test(text);
  return looksXml ? { status: "not_found" } : { status: "unknown" };
}

// One fetch+decode attempt, timer spanning BOTH the fetch AND the body read.
// AUDIT B1: fetch() resolves on HEADERS; the body is read via arrayBuffer()
// below, so the abort timer must stay live until the body is fully read
// (an abort mid-body rejects arrayBuffer() → read_error → unknown). One
// try/finally clears the timer on every exit path. Returns { ok, text } or
// { ok:false, raw }. Never throws.
async function fetchEmapText(body, { fetchImpl, timeoutMs, endpoint }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let resp;
    try {
      resp = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: ctl.signal,
      });
    } catch (e) {
      return { ok: false, raw: `fetch_error:${(e && e.message) || String(e)}` };
    }
    if (!resp || !resp.ok) return { ok: false, raw: `http_${resp ? resp.status : "no_response"}` };
    try {
      const buf = await resp.arrayBuffer(); // still under the abort timer (B1)
      return { ok: true, text: decodeEmapBytes(buf) };
    } catch (e) {
      return { ok: false, raw: `read_error:${(e && e.message) || String(e)}` };
    }
  } finally {
    clearTimeout(timer);
  }
}

// Full lookup. fetchImpl injectable for tests; defaults to global fetch (Node
// 20+ on Render). Returns { storeId, status, variant, pois, storeName?,
// address?, raw?, note? }; raw/variant/pois are for SERVER-console logging only
// (the route logs them), never forwarded to the client. Never throws.
export async function checkEmapStore(storeId, opts = {}) {
  const id = String(storeId || "").trim();
  const {
    fetchImpl = fetch,
    timeoutMs = EMAP_TIMEOUT_MS,
    endpoint = EMAP_ENDPOINT,
    command = EMAP_LOOKUP_COMMAND,
    param = EMAP_LOOKUP_PARAM,
    variant = EMAP_LOOKUP_VARIANT,
    confirmed = EMAP_CHECK_CONFIRMED,
  } = opts;

  if (!/^\d{6}$/.test(id)) return { storeId: id, status: "unknown", variant, pois: 0 }; // malformed → never a verdict

  // "both" → id then storename (retry only when id yields 0 GeoPosition);
  // "storename" → just storename; anything else → just id (the safe primary).
  const order = variant === "both" ? ["id", "storename"] : [variant === "storename" ? "storename" : "id"];

  let last = null;
  for (const v of order) {
    const r = await fetchEmapText(emapBody(v, id, command, param), { fetchImpl, timeoutMs, endpoint });
    if (!r.ok) {
      // Hard failure (timeout/network/http/read) → unknown, best-effort. Never block.
      return { storeId: id, status: "unknown", variant: v, pois: 0, raw: r.raw };
    }
    const pois = countPois(r.text);
    last = { v, text: r.text, pois, verdict: parseEmapVerdict(id, r.text) };
    if (pois > 0) break; // got store data — stop (no need to try the next variant)
  }

  const { v, text, pois, verdict } = last;
  // AUDIT S1: downgrade not_found → unknown until the shape is confirmed.
  const status = verdict.status === "not_found" && !confirmed ? "unknown" : verdict.status;
  const out = { storeId: id, status, variant: v, pois };
  if (verdict.storeName) out.storeName = verdict.storeName;
  if (verdict.address) out.address = verdict.address;
  if (verdict.status === "not_found" && !confirmed) out.note = "unconfirmed_downgrade";
  // Raw (bounded) for SERVER-console logging only — never forwarded to the
  // client. Attach on any non-valid verdict AND on a valid verdict while
  // UNCONFIRMED, so the owner gets a positive "[EMAP_CHECK] ... result=valid
  // pois=1" + RAW confirmation to prove the shape before flipping the gate.
  if (verdict.status !== "valid" || !confirmed) out.raw = clip(text, RAW_SNIPPET);
  return out;
}
