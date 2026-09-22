// LIVE SOURCE (Option E) — the single "Live source" control that replaces the 3
// header chips. ONE active source at a time (TikTok / Facebook / Shopee / Instagram).
//
// OWNER-GATED ROLLOUT: the new header renders only for LIVE_SOURCE_EMAILS (the owner)
// so it can be validated live on the high-traffic Live screen before widening to all
// 85 sellers — everyone else keeps the current 3-chip header, byte-for-byte. Widen =
// add emails / remove the gate. INSTANT REVERT = empty the array. Mirrors the
// SESSION_V2 / shopeePreview allowlist pattern.
// SOFT-REVERTED 2026-09-23: emptied to turn the connect-flow redesign OFF for everyone
// (owner + googletest included) → the old 3-chip header + old dropdown render; the
// LiveSourceSheet / LiveConnectModal / ChannelsList / compact button never mount (inert
// dead code). Re-add an email here to re-enable the new flow for that account.
export const LIVE_SOURCE_EMAILS: string[] = [];

export function liveSourcePreviewEnabled(email: string | undefined | null): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && LIVE_SOURCE_EMAILS.includes(e);
}

export type SourcePlatform = "TikTok" | "Facebook" | "Shopee" | "Instagram";

// The platform the CURRENTLY-LIVE session belongs to, derived from the effective
// connected flags (in-memory — no DB). Facebook never connects (design-only gate);
// Instagram is a placeholder. null = nothing live right now (fresh open / ended).
export function livePlatformOf(f: { ttEff: boolean; shopeeEff: boolean }): SourcePlatform | null {
  if (f.ttEff) return "TikTok";
  if (f.shopeeEff) return "Shopee";
  return null;
}

// Does picking `next` while `live` is the running session's platform require a NEW
// session (buyer# → #1)? ONLY a real PLATFORM switch: a different platform WHILE one
// is live. Same platform (account/shop switch) → false (continue). Nothing live
// (livePlatform null — fresh open / crash reconnect) → false = DEFAULT CONTINUE (the
// safe direction: a missed reset never corrupts numbering; a wrongful reset does).
export function isPlatformSwitch(livePlatform: SourcePlatform | null, next: SourcePlatform): boolean {
  return livePlatform !== null && livePlatform !== next;
}

// Only TikTok and Shopee are connectable today (Facebook = activation gate, Instagram =
// coming soon). switchSource is called only for these; this guards the orchestration.
export function isConnectableSource(p: SourcePlatform): p is "TikTok" | "Shopee" {
  return p === "TikTok" || p === "Shopee";
}
