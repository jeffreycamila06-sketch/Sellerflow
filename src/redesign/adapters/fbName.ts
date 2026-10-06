// FACEBOOK BUYER NAME — one rule for prints and screens.
//
// A Facebook comment carries the commenter's display name in BOTH `name` and `handle`
// (server/fbComment.js), so "Name" + "@Name" shows the same name twice. For a Facebook
// buyer we show/print the name ONCE. Decided by the order's / comment's PLATFORM only —
// never by "the name equals the handle" (a TikTok buyer whose nickname equals the username
// keeps both lines).
//
// Guard: when Graph omits the commenter, the server sends name "Unknown" and handle = the
// commenter id. Such a buyer keeps today's output (the handle line is the only thing that
// tells two of them apart).
export const FB_UNKNOWN_NAME = "Unknown";

export function isFacebookPlatform(platform: string | null | undefined): boolean {
  return String(platform ?? "").trim().toLowerCase() === "facebook";
}

// true = show/print the name only (no "@handle" line) for this buyer.
export function fbNameOnly(platform: string | null | undefined, name: string | null | undefined): boolean {
  if (!isFacebookPlatform(platform)) return false;
  const n = String(name ?? "").trim();
  return n !== "" && n !== FB_UNKNOWN_NAME;
}
