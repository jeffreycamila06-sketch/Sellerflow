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

// Instagram (phase 1): the comment's name and handle are BOTH the username → the same
// name-once rule (owner decision). Only an "Instagram" platform reaches this branch.
export function isInstagramPlatform(platform: string | null | undefined): boolean {
  return String(platform ?? "").trim().toLowerCase() === "instagram";
}

// true = show/print the name only (no "@handle" line) for this buyer.
export function fbNameOnly(platform: string | null | undefined, name: string | null | undefined): boolean {
  if (!isFacebookPlatform(platform) && !isInstagramPlatform(platform)) return false;
  const n = String(name ?? "").trim();
  return n !== "" && n !== FB_UNKNOWN_NAME;
}

// IDENTITY V2 (fb_identity_v2): a Facebook buyer's handle is the commenter's id, never something
// to show. true = a Facebook row with a real name whose handle is NOT that name (an id) → show the
// name in place of the handle. Rows saved before the switch (handle = name), "Unknown" rows and
// every other platform → false, so those keep today's output exactly.
const bareHandle = (s: string | null | undefined): string => String(s ?? "").trim().replace(/^@/, "").trim().toLowerCase();
export function fbHandleIsId(platform: string | null | undefined, name: string | null | undefined, handle: string | null | undefined): boolean {
  return isFacebookPlatform(platform) && fbNameOnly(platform, name) && bareHandle(handle) !== bareHandle(name);
}

// Same idea where the data carries NO platform (Sales tab top buyers: sales_report groups by
// name). A Facebook id is 10+ digits; a hidden commenter is "fb-anon-…".
// ponytail: shape check, not the platform — exact once sales_report returns the platform.
export function looksLikeFbId(handle: string | null | undefined): boolean {
  return /^(\d{10,}|fb-anon-.+)$/i.test(bareHandle(handle));
}
