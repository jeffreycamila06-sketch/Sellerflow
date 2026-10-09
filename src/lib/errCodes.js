// Build 10 — the error/reason words the live server sends travel as short codes, so the
// Network tab shows "E8", not "not_live". Shared: the server turns word → code
// (server/errorCodes.js), the app turns code → word (decodeServerJson) right where it reads
// the answer, so every check in the app still compares the same words as before.
// Only words the APP reads or shows are listed here (they are in the app bundle already);
// server-only words get their codes in server/errorCodes.js and never reach the bundle.
// NEVER renumber or reuse a code: an old app and a new server must agree during a deploy.
// "E0" = text the server made up on the spot (raw errors) — the app keeps it as "E0".

export const ERR_CODES = Object.freeze({
  Unauthorized: "E1",
  forbidden: "E2",
  plan_expired: "E3",
  no_profile: "E4",
  too_many_requests: "E5",
  account_limit: "E6",
  account_not_covered: "E7",
  not_live: "E8",
  needs_reauth: "E9",
  page_not_found: "E10",
  account_not_found: "E11",
  no_pages: "E12",
  token_exchange: "E13",
  exception: "E14",
  busy: "E15",
  mixed_buyer: "E16",
  needs_messaging: "E17",
  no_access: "E18",
  no_orders: "E19",
  none_left: "E20",
  send_failed: "E21",
  unknown_result: "E22",
  server_error: "E23",
  empty: "E24",
  empty_image: "E25",
  disabled: "E26",
  partial: "E27",
  claim_failed: "E28",
  scan_failed: "E29",
  idle: "E30",
  inactive: "E31",
  disconnect: "E32",
  live_session_ended: "E33",
  no_token: "E34",
  // TikTok connect: the app shows these sentences as they are.
  "Account is not live right now. Start your TikTok LIVE first.": "E35",
  "Facebook page is required": "E36",
  "Seller account is required before connecting live": "E37",
  "TikTok connection is already starting. Please wait before trying again.": "E38",
  "TikTok username is required": "E39",
  "You're already connecting a live on another device. Please try again.": "E40",
});

// Sentences with one changing part: "{v}" travels after a colon ("E41:12").
export const ERR_TEMPLATES = Object.freeze({
  E41: "TikTok connection is on cooldown after a rate limit. Try again in {v} minutes.",
  E42: "TikTok rate limit reached. Try again in about {v}.",
});

const WORD_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(ERR_CODES).map(([w, c]) => [c, w])));

// Code → the word the app always compared against. Anything that is not a known code
// (an old server still sending words, "E0", a server-only code) comes back unchanged.
/** @param {unknown} v @returns {unknown} */
export function decodeErr(v) {
  if (typeof v !== "string") return v;
  const m = /^(E\d+)(?::([\s\S]*))?$/.exec(v);
  if (!m) return v;
  if (m[2] !== undefined) return ERR_TEMPLATES[m[1]] ? ERR_TEMPLATES[m[1]].replace("{v}", m[2]) : v;
  return WORD_BY_CODE[m[1]] ?? v;
}

// What a screen may print from a server answer: an app word (a key of ERR_CODES without a
// space), else "" so the screen falls back to its own generic seller text. Codes (E0,
// server-only, unknown) and raw server sentences never reach a seller.
/** @param {unknown} v @returns {string} */
export function sellerSafeWord(v) {
  return typeof v === "string" && !/\s/.test(v) && Object.prototype.hasOwnProperty.call(ERR_CODES, v) ? v : "";
}

// A server answer with its `error` / `reason` decoded (a new object only when something changed).
/** @template T @param {T} j @returns {T} */
export function decodeServerJson(j) {
  if (!j || typeof j !== "object" || Array.isArray(j)) return j;
  let out = j;
  for (const k of ["error", "reason"]) {
    const d = decodeErr(j[k]);
    if (d !== j[k]) { if (out === j) out = { ...j }; out[k] = d; }
  }
  return out;
}
