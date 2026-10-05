// FACEBOOK LIVE — Phase 3 client adapter. Mirrors adapters/shopee.ts (which mirrors
// connect.ts for the HTTP shape: SERVER base + the Supabase JWT bearer). Every server
// call sits behind the global app_settings 'fb_enabled' flag (loadFbEnabled) OR the
// owner-only FB_PREVIEW_EMAILS allowlist (adapters/fbPreview) — the caller gates all UI
// on that. fb_pages rows are read/deleted via RLS (own rows only) and this adapter
// NEVER selects the token column (defense-in-depth on top of RLS + the server omitting
// it from /fb/pages).
import { supabase, isSupabaseConfigured } from "../../supabase";
import { SERVER, browserSessionId } from "./serverIdentity";
import { getAppSetting } from "./appSettings";
import { isActivePaid, isFreePlan, planDaysLeft } from "../../lib/planWindow";
import { isAdminRole } from "../../lib/roles";
import { fbPreviewEnabled } from "./fbPreview";
import { tpl, type RedesignT } from "../i18n";

// Authorize + Connect are open to EVERY plan while it is active: an ACTIVE free plan
// (planStatus "active"; free has no expiry) or an ACTIVE PAID plan (status "active" and
// not past expiry). Expired / pending plans are blocked; admin bypasses. Page caps are
// unchanged (maxAcc: free 1, basic 1, plus 2, pro 3, master 5 — the OAuth callback
// enforces the same numbers server-side; /fb/connect runs requirePlanActive, which
// already lets free through). Module-level so Date.now() lives OUTSIDE any component
// render (react-hooks impure rule — mirror isShopeeEligible). This is the PLAN gate
// only; the allowlist + flag VISIBILITY gate is fbEnabled in RedesignApp.
export function isFbEligible(a: { email?: string; plan?: string; planStatus?: string; planExpiry?: string; role?: string } | null | undefined): boolean {
  if (!a) return false;
  if (isAdminRole(a.role)) return true;
  // ⚠️ PERMANENT — FB_PREVIEW_EMAILS accounts skip the plan check (Facebook screens
  // ONLY; this helper gates nothing else). test@gmail.com is the Meta App Review test
  // account and is on the FREE plan; without this bypass the reviewer hits the upgrade
  // prompt instead of the Facebook OAuth flow, and Meta re-tests approved apps
  // periodically. Lives in code so it can never lapse with a plan expiry. Do NOT remove
  // in future cleanups. Non-allowlisted sellers are unaffected (and never see FB screens).
  if (fbPreviewEnabled(a.email)) return true;
  if (isFreePlan(a.plan)) return a.planStatus === "active";
  return isActivePaid({ plan: a.plan || "", planStatus: a.planStatus || "", daysLeft: planDaysLeft(a.planExpiry, Date.now()) });
}

// ── Global kill switch (fail-closed, mirrors shopee_enabled) ─────────────────
// Only the literal string "true" opens Facebook; missing row / error / RLS deny / any
// other value → false. A read failure must HIDE Facebook, never expose it.
export const FB_ENABLED_KEY = "fb_enabled";
export async function loadFbEnabled(): Promise<boolean> {
  const row = await getAppSetting(FB_ENABLED_KEY);
  return row?.value === "true";
}

export interface FbPage { id: string; pageId: string; name: string; username: string; active: boolean }

// List the seller's authorized pages. NEVER selects access_token / token_expires_at
// (RLS also blocks writes; this keeps tokens off the client too — the server's
// /fb/pages likewise omits them, so this direct read matches).
export async function listFbPages(): Promise<FbPage[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("fb_pages")
      .select("id,page_id,page_name,page_username,active")
      .order("page_id", { ascending: true });
    if (error || !Array.isArray(data)) return [];
    return data.map((r) => {
      const row = r as { id?: unknown; page_id?: unknown; page_name?: unknown; page_username?: unknown; active?: unknown };
      return {
        id: String(row.id ?? ""),
        pageId: String(row.page_id ?? ""),
        name: row.page_name == null ? "" : String(row.page_name),
        username: row.page_username == null ? "" : String(row.page_username),
        active: row.active !== false,
      };
    });
  } catch {
    return [];
  }
}

// Delete an OWN page row (RLS scopes the delete to auth.uid()). Returns ok/error.
export async function removeFbPage(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  try {
    const { error } = await supabase.from("fb_pages").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "delete failed" };
  }
}

// Attach the seller's Supabase JWT (mirror shopee.ts / connect.ts). "" when unavailable.
async function bearer(): Promise<string> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    return session?.access_token || "";
  } catch {
    return "";
  }
}

// GET /fb/oauth/start → { url }. The caller renders `url` as a REAL <a href> (iOS-safe:
// a direct anchor tap, never window.open — the SLIDE→BUTTON lesson). Pre-fetch on
// screen mount so the href is present before the tap. The signed state inside the URL
// has a ~10-min TTL (STATE_TTL_MS).
export async function startFbAuth(): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const r = await fetch(`${SERVER}/fb/oauth/start`, {
      method: "GET",
      headers: { Authorization: `Bearer ${await bearer()}` },
    });
    const j = await r.json().catch(() => ({} as { url?: string; error?: string }));
    if (!r.ok || !j.url) return { ok: false, error: j.error || `HTTP ${r.status}` };
    return { ok: true, url: String(j.url) };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

// fbCode / fbTimeout: what Facebook answered when the server's live check failed (502
// fb_check_failed) — shown after the generic text so a tester can report it.
export interface FbConnectResult { ok: boolean; reason?: string; error?: string; unreachable?: boolean; liveVideoId?: string; fbCode?: number; fbTimeout?: boolean }

// POST /fb/connect { page_id, sessionId }. Server: requireAuth → requireConnectRate →
// requirePlanActive (403 on expired plan) → live-detect → starts the poller.
// { ok:false, reason:"not_live" } when the page has no LIVE video. Success needs BOTH a 2xx
// status AND ok === true in the body; HTTP 429 → error "too_many_requests".
// ⚠️ sessionId = THIS browser's session id (the same value connect.ts sends for TikTok).
// The server stamps it on every relayed FB comment + platform_status, and useLiveFeed
// drops any event whose sessionId ≠ its own — so only the device that tapped Connect
// receives the live flow (the duplicate-auto-order safeguard on multi-device sellers).
// Without it the server stamped the live-video id → the client dropped EVERY FB event.
export async function fbConnect(pageId: string): Promise<FbConnectResult> {
  try {
    const r = await fetch(`${SERVER}/fb/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
      body: JSON.stringify({ page_id: String(pageId), sessionId: browserSessionId() }),
    });
    const j = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; error?: string; live_video_id?: string; fb_code?: unknown; fb_timeout?: unknown }));
    if (r.status === 429) return { ok: false, error: "too_many_requests" };
    if (r.status === 401) return { ok: false, error: j.error || "Unauthorized" };
    if (r.status === 403) return { ok: false, error: j.error || "plan_expired" };
    if (r.status >= 500) {
      return {
        ok: false, error: j.error || "Server error",
        ...(typeof j.fb_code === "number" && Number.isFinite(j.fb_code) ? { fbCode: j.fb_code } : {}),
        ...(j.fb_timeout === true ? { fbTimeout: true } : {}),
      };
    }
    if (r.status >= 200 && r.status < 300 && j.ok === true) return { ok: true, liveVideoId: j.live_video_id ? String(j.live_video_id) : undefined };
    if (j.ok === false) return { ok: false, reason: j.reason, error: j.error };
    return { ok: false, error: j.error || `HTTP ${r.status}` };
  } catch {
    return { ok: false, unreachable: true, error: "Can't reach the live server." };
  }
}

// The toast for a failed Facebook Connect — never a raw server code. (The iOS plan_expired
// popup is handled by the caller before this.)
export function fbConnectFailText(r: FbConnectResult, t: RedesignT): string {
  if (r.reason === "not_live") return t.rd_fb_not_live;
  if (r.unreachable) return t.rd_cm_cant_reach;
  const e = r.error || "";
  if (e === "needs_reauth" || e === "page_not_found") return t.rd_fb_reauth_toast;
  if (e === "too_many_requests") return t.rd_fb_too_many;
  if (typeof r.fbCode === "number") return `${t.rd_cm_conn_failed} (FB ${r.fbCode})`;
  if (r.fbTimeout) return `${t.rd_cm_conn_failed} (FB timeout)`;
  return t.rd_cm_conn_failed;
}

// The toast for the OAuth return (?fb=connected | ?fb=error&code=…): code "cap" = the plan's
// page limit was hit → the cap text (with the plan's limit); code "cancelled" = the seller
// tapped Cancel on the confirm page on purpose → null (no toast); any other error → generic.
export function fbReturnText(ret: { status: "connected" | "error"; code?: string }, t: RedesignT, maxPages: number): string | null {
  if (ret.status === "connected") return t.rd_fb_authorized_toast;
  if (ret.code === "cancelled") return null;
  if (ret.code === "cap") return tpl(t.rd_fb_cap, { max: maxPages });
  return t.rd_fb_auth_error_toast;
}

// ── Page picker with 2+ Pages ────────────────────────────────────────────────
// The server scopes FB status by page username || page id (the platform_status username).
const pageKey = (s: string) => String(s || "").trim().replace(/^@+/, "").toLowerCase();
export const fbPageScopeKey = (p: Pick<FbPage, "username" | "pageId">): string => p.username || p.pageId;

// The Page that is really connected: the one whose scope key the server last reported as
// connected (liveFeed.activeAccounts.Facebook). null when none is connected or the key
// matches no listed page.
export function fbLivePageOf(connected: boolean, liveKey: string, pages: FbPage[]): FbPage | null {
  const k = pageKey(liveKey);
  if (!connected || !k) return null;
  return pages.find((p) => pageKey(fbPageScopeKey(p)) === k) || null;
}

// What the Facebook chip shows and does. connected = the platform is connected (and not
// locally disconnected). The pill is green only for the Page that is really connected (a
// connection we cannot attribute to a listed page keeps today's behaviour). Disconnect always
// stops the connected Page; connecting a different Page first stops the connected one.
export type FbChipAction =
  | { kind: "disconnect"; pageId: string }
  | { kind: "switch"; stopPageId: string; page: FbPage }
  | { kind: "connect"; page: FbPage }
  | { kind: "none" };
export function fbChipState(a: { connected: boolean; livePage: FbPage | null; selected: FbPage | null }): { chipConnected: boolean; action: FbChipAction } {
  const { connected, livePage, selected } = a;
  const selectedIsLive = !livePage || !selected || livePage.pageId === selected.pageId;
  if (connected && selectedIsLive) {
    const stop = livePage || selected;
    return { chipConnected: true, action: stop ? { kind: "disconnect", pageId: stop.pageId } : { kind: "none" } };
  }
  if (!selected) return { chipConnected: false, action: { kind: "none" } };
  if (connected && livePage) return { chipConnected: false, action: { kind: "switch", stopPageId: livePage.pageId, page: selected } };
  return { chipConnected: false, action: { kind: "connect", page: selected } };
}

// POST /fb/disconnect { page_id } → stops the poller. Best-effort.
export async function fbDisconnect(pageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${SERVER}/fb/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
      body: JSON.stringify({ page_id: String(pageId) }),
    });
    const j = await r.json().catch(() => ({} as { ok?: boolean; error?: string }));
    return { ok: r.ok && j.ok !== false, error: j.error };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

// Pure — parse the OAuth-callback return param on app load (the callback redirects back
// to APP_REDIRECT_URL with ?fb=connected | ?fb=error&code=...). Returns null when there
// is no fb param. The caller toasts + clears the query. Mirror parseShopeeReturn.
export function parseFbReturn(search: string): { status: "connected" | "error"; code?: string } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(String(search || "").replace(/^\?/, "")); } catch { return null; }
  const s = params.get("fb");
  if (s === "connected") return { status: "connected" };
  if (s === "error") return { status: "error", code: params.get("code") || undefined };
  return null;
}
