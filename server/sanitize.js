// #3 PRINTING INJECTION - shared, PURE control-character neutralizer imported by
// server.js AND unit-tested by vitest (server.js has no test harness; same
// convention as server/connectionHealth.js / broadcastTranslate.js).
//
// THE VULNERABILITY: buyer names / comment text come from ANY anonymous TikTok
// live viewer and flow RAW into the thermal-printer command streams (TSPL for the
// sticker - a newline-delimited protocol where TEXT "..." ends at a CR/LF; ESC/POS
// for the slip - control bytes ESC 0x1B / GS 0x1D). A raw newline in a name breaks
// out of the quoted value and the printer parses the remainder as new commands
// (PRINT n / CLS / cut / drawer). CWE-77 / CWE-93 (CRLF) / CWE-150 (escape/control).
//
// THE FIX (server-side, at the emitCommentScoped choke-point - covers the live,
// initial, and reuse-re-emit relays in ONE place): replace every C0 control byte
// (0x00-0x1F, incl. CR/LF/ESC/GS/NUL/TAB) and DEL (0x7F) with a SPACE - this
// neutralizes the break-out while keeping readability ("A"+LF+"PRINT 9" becomes
// "A PRINT 9", one literal TEXT value, no command break). Everything >= 0x20
// except 0x7F is preserved BYTE-IDENTICALLY, so all CJK, emoji and printable
// Unicode are untouched. It is applied ONLY to the buyer-text fields
// (comment/name/handle); msgId/avatar/timestamps are never touched. The
// byte-parity TSPL builders are NOT modified - they simply never receive a
// control char again (zero native rebuild, zero golden change). Idempotent:
// sanitize(sanitize(x)) === sanitize(x).

// C0 controls (0x00-0x1F) + DEL (0x7F) -> space. Built via new RegExp with an
// ASCII-only escaped source string (no literal control bytes in this file).
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

// Generous anti-abuse ceilings ONLY - far above any real value (TikTok comments
// are ~150 chars; the sticker builders already truncate name->30 / item->12), so
// the cap NEVER fires for legit data. It only stops an absurd payload from
// bloating the socket/DB.
export const COMMENT_MAX = 1000;
export const NAME_MAX = 200;
export const HANDLE_MAX = 100;

// Surrogate-safe slice: never cut in the middle of an emoji (a surrogate PAIR).
// If the last kept UTF-16 unit is a lone HIGH surrogate (0xD800-0xDBFF), drop it.
function sliceSafe(s, maxLen) {
  if (s.length <= maxLen) return s;
  let end = maxLen;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

// Strip control bytes -> space, then cap. Non-string input -> "" (defensive).
export function sanitizeCommentText(value, maxLen) {
  if (value == null) return "";
  const s = String(value).replace(CONTROL_CHARS, " ");
  return sliceSafe(s, maxLen);
}

// Sanitize ONLY the buyer-text fields of a comment payload, returning a NEW object
// (the original - e.g. the server-internal reuse ring - is left untouched). msgId,
// avatar, sessionId, timestamps and everything else pass through unchanged.
export function sanitizeCommentPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    comment: sanitizeCommentText(payload.comment, COMMENT_MAX),
    name: sanitizeCommentText(payload.name, NAME_MAX),
    handle: sanitizeCommentText(payload.handle, HANDLE_MAX),
  };
}
