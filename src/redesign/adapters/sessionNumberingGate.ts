// Staged release of the session-numbering fix (buyer numbers restarting mid-session). ALL of
// the fix's behaviour sits behind this gate; every other account runs today's code path.
// Decided from the signed-in email ONLY (no database read that could race). Email not known
// yet → "wait" (the session hooks stay off) — never the old path for a listed account.
// Going public = one line: SESSION_NUMBERING_FIX_PUBLIC = true.
export const SESSION_NUMBERING_FIX_PUBLIC = false;
export const SESSION_NUMBERING_FIX_EMAILS = [
  "camilajeffrey1@gmail.com",
  "googletest@gmail.com",
  "googletest@sellerflowlive.com",
  "cristycabanas34@gmail.com",
  "tincabanas13@gmail.com",
  "ronaldgantiga77@gmail.com",
  // multi-day sellers — the fix is exercised where the bug is
  "aubreylucero15@yahoo.com",
  "716030huan@gmail.com",
  "bardagulanjavier@gmail.com",
  "zandracruz@icloud.com",
  "chungmaychilleann@gmail.com",
  // sellers who started a multi-day session on Oct 6
  "gee383838@icloud.com",
  "rominamagat@gmail.com",
  "juvieho0725@gmail.com",
  "clarabhie@gmail.com",
  "mersteve17@gmail.com",
  // sellers who started a multi-day session on Oct 5
  "jinkyrosepenana@gmail.com",
  "basaomenchie6@gmail.com",
  "jaszhu127@gmail.com",
  "leinapan@gmail.com",
  "jobelleolivas80@gmail.com",
  "merriamalmirante194@gmail.com",
  "apzelejorde@yahoo.com",
  "s076561908@hotmail.com",
  "ailun09291990@gmail.com",
  "ganggang0958@yahoo.com",
  "abeyverdera@yahoo.com",
  "christinechen769@gmail.com",
  "z30983359299@gmail.com",
  "vans0814@gmail.com",
  "rodelio.martinjr@gmail.com",
  "michellesebios86@gmail.com",
  "nashtex@abv.bg",
  "leahsangalang1215@gmail.com",
  "sanggalanglhea@gmail.com",
  "ukaydaily1@gmail.com",
  "lheyukay@gmail.com",
];

export type SessionNumberingGate = "on" | "off" | "wait";

// authed=false → "off" (the session hooks are disabled anyway — today's behaviour).
// authed + no email yet → "wait". Otherwise on for the list (or everyone once public).
export function sessionNumberingGate(authed: boolean, email: string | null | undefined): SessionNumberingGate {
  if (!authed) return "off";
  if (SESSION_NUMBERING_FIX_PUBLIC) return "on";
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "wait";
  return SESSION_NUMBERING_FIX_EMAILS.includes(e) ? "on" : "off";
}
