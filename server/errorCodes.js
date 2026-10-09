// Build 10 — every JSON answer the app can see on /fb, /connect, /shopee, /ig, /parcel and
// /admin keeps its HTTP status, but its `error` / `reason` strings leave as short codes.
// The descriptive text stays in the server log only ([ERR] lines). App-read words share
// their codes with the app (src/lib/errCodes.js); the words below are server-only and their
// codes never reach the app bundle. NEVER renumber or reuse a code (E1–E99 = shared table).
import { ERR_CODES, ERR_TEMPLATES } from "../src/lib/errCodes.js";

export const SERVER_ONLY_CODES = Object.freeze({
  already_connected: "E101", already_replied: "E102", already_running: "E103",
  anthropic_bad_json: "E104", auth: "E105", bad_gm_shape: "E106", bad_image: "E107",
  bad_json_in_response: "E108", bad_media_type: "E109", bad_request: "E110",
  bad_store_id: "E111", cannot_reply_privately: "E112", credit_unavailable: "E113",
  draw_or_send_failed: "E114", fb_check_failed: "E115", fb_not_available: "E116",
  fb_pages_failed: "E117", fb_start_failed: "E118", feature_gate: "E119", fetch_error: "E120",
  fetch_failed: "E121", ig_accounts_failed: "E122", ig_check_failed: "E123",
  ig_not_available: "E124", ig_start_failed: "E125", "ig_user_id required": "E126",
  insert_failed: "E127", max_session: "E128", model_refused: "E129",
  no_json_in_response: "E130", no_service_role: "E131", not_owned: "E132",
  "page_id required": "E133", poll_not_configured: "E134", rate_limited: "E135",
  scan_not_configured: "E136", select_failed: "E137", seller_off: "E138", session_end: "E139",
  "shop_id required": "E140", shop_not_found: "E141", shopee_start_failed: "E142",
  sweep_not_configured: "E143", too_many_attempts: "E144", translation_not_configured: "E145",
  truncated: "E146", upload_failed: "E147", "Server auth is not configured": "E148",
  try_later: "E149", insufficient_credits: "E150", not_signed_in: "E151", bad_amount: "E152",
  connect_failed: "E153", not_found: "E154",
});

const BY_WORD = Object.freeze({ ...SERVER_ONLY_CODES, ...ERR_CODES });
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TEMPLATE_RX = Object.entries(ERR_TEMPLATES).map(([code, t]) => [new RegExp(`^${t.split("{v}").map(escape).join("([\\s\\S]+?)")}$`), code]);

// word → code; a sentence with one changing part → "E41:<part>"; anything else → "E0".
export function encodeErr(v) {
  if (typeof v !== "string") return v;
  if (Object.prototype.hasOwnProperty.call(BY_WORD, v)) return BY_WORD[v];
  for (const [rx, code] of TEMPLATE_RX) { const m = rx.exec(v); if (m) return `${code}:${m[1]}`; }
  return "E0";
}

export const OPAQUE_PREFIXES = ["/fb", "/connect", "/shopee", "/ig", "/parcel", "/admin"];
// Called only by cron-job.org / Meta, never by the app — they keep their words.
export const OPAQUE_SKIP = ["/admin/parcel-tracking-poll", "/admin/product-images-sweep", "/fb/deauthorize"];

const underPrefix = (path) => OPAQUE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || (p === "/parcel" && path.startsWith(p)));

// Express middleware: wraps res.json for the routes above. Statuses are never touched.
export function opaqueErrors({ log = console.log } = {}) {
  return (req, res, next) => {
    if (!underPrefix(req.path) || OPAQUE_SKIP.includes(req.path)) return next();
    const json = res.json.bind(res);
    res.json = (body) => {
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(body);
      let out = body;
      for (const k of ["error", "reason"]) {
        if (typeof body[k] !== "string") continue;
        const code = encodeErr(body[k]);
        if (code === body[k]) continue;
        if (out === body) out = { ...body };
        out[k] = code;
        if (res.statusCode >= 400 || code === "E0") log(`[ERR] ${req.method} ${req.path} ${res.statusCode} ${k}=${code} ${String(body[k]).slice(0, 300)}`);
      }
      return json(out);
    };
    next();
  };
}
