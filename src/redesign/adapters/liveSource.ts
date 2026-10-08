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
// ⚠️ Account total, Build 2 (sql/85): this flow's "type a name, connect, then save it" path
// connects to a name that is NOT yet registered. It needs app_settings
// account_live_unregistered_enforce OFF (missing / not 'true'), or that connect is refused.
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

// H1 (session-RPC v2) — SERVER-ANCHORED switch. `serverPlatform` = the running session's
// OWN platform from session_status() (sql/46), NOT in-memory ttEff/shopeeEff flags. A real
// cross-platform switch (buyer# → #1) iff the running session has a platform that differs
// from the one being connected. NULL serverPlatform (legacy/unknown session, or a degraded
// status read) → NOT a switch → continue (today's behavior; a missed reset never corrupts
// numbering, a wrongful reset does). This supersedes isPlatformSwitch(livePlatformOf(...))
// as the connect-flow anchor — it can't be fooled by a stale/recovering client flag.
export function isServerPlatformSwitch(serverPlatform: string | null | undefined, next: SourcePlatform): boolean {
  return !!serverPlatform && serverPlatform !== next;
}

// sql/86 — the connect-time switch rule. A known server platform decides (H1). Unknown
// (NULL: a session from before sql/46, or a failed status read) → today's in-app check
// on the live flags, for that case only (the pre-v2 rule).
export function connectIsSwitch(serverPlatform: string | null | undefined, next: SourcePlatform, f: { ttEff: boolean; shopeeEff: boolean }): boolean {
  return serverPlatform ? isServerPlatformSwitch(serverPlatform, next) : isPlatformSwitch(livePlatformOf(f), next);
}

// Only TikTok and Shopee are connectable today (Facebook = activation gate, Instagram =
// coming soon). switchSource is called only for these; this guards the orchestration.
export function isConnectableSource(p: SourcePlatform): p is "TikTok" | "Shopee" {
  return p === "TikTok" || p === "Shopee";
}
