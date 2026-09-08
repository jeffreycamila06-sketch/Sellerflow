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

// Full lookup. fetchImpl injectable for tests; defaults to global fetch (Node
// 20+ on Render). Returns { storeId, status, storeName?, address?, raw? } where
// raw (bounded) is present on not_found/unknown for SERVER-console logging only
// — never forwarded to the client. Never throws.
export async function checkEmapStore(storeId, opts = {}) {
  const id = String(storeId || "").trim();
  const {
    fetchImpl = fetch,
    timeoutMs = EMAP_TIMEOUT_MS,
    endpoint = EMAP_ENDPOINT,
    command = EMAP_LOOKUP_COMMAND,
    param = EMAP_LOOKUP_PARAM,
    confirmed = EMAP_CHECK_CONFIRMED,
  } = opts;

  if (!/^\d{6}$/.test(id)) return { storeId: id, status: "unknown" }; // malformed → never a verdict

  // AUDIT B1: the abort timer must span BOTH the fetch AND the body read.
  // fetch() resolves on HEADERS, but the body is read below via arrayBuffer();
  // clearing the timer between them would leave a slow/stalled body with no
  // ceiling. One try/finally around the whole exchange keeps abort live until
  // the body is fully read (an abort mid-body rejects arrayBuffer() → caught →
  // read_error → unknown), and clears the timer on every exit path.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let resp;
    try {
      resp = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `commandid=${encodeURIComponent(command)}&${encodeURIComponent(param)}=${encodeURIComponent(id)}`,
        signal: ctl.signal,
      });
    } catch (e) {
      // Timeout (abort) or network error → unknown, best-effort. Never block.
      return { storeId: id, status: "unknown", raw: `fetch_error:${(e && e.message) || String(e)}` };
    }

    if (!resp || !resp.ok) {
      return { storeId: id, status: "unknown", raw: `http_${resp ? resp.status : "no_response"}` };
    }

    let text;
    try {
      const buf = await resp.arrayBuffer(); // still under the abort timer (B1)
      text = decodeEmapBytes(buf);
    } catch (e) {
      // Includes an abort DURING a slow/stalled body → resolves to unknown, never hangs.
      return { storeId: id, status: "unknown", raw: `read_error:${(e && e.message) || String(e)}` };
    }

    const verdict = parseEmapVerdict(id, text);
    // AUDIT S1: downgrade not_found → unknown until the shape is confirmed.
    const status = verdict.status === "not_found" && !confirmed ? "unknown" : verdict.status;
    const out = { storeId: id, status };
    if (verdict.storeName) out.storeName = verdict.storeName;
    if (verdict.address) out.address = verdict.address;
    if (verdict.status === "not_found" && !confirmed) out.note = "unconfirmed_downgrade";
    // Raw (bounded) for SERVER-console logging only — never forwarded to the
    // client. Attach on any non-valid verdict (as before) AND on a valid verdict
    // while UNCONFIRMED, so the owner gets a positive "[EMAP_CHECK] valid store=
    // 982063" + RAW confirmation to prove the shape before flipping the gate.
    if (verdict.status !== "valid" || !confirmed) out.raw = clip(text, RAW_SNIPPET);
    return out;
  } finally {
    clearTimeout(timer);
  }
}
