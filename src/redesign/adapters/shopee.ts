// SHOPEE LIVE — Phase 3 client adapter. Every server call sits behind the global
// app_settings 'shopee_enabled' flag (loaded by loadShopeeEnabled; the caller gates
// all UI on it). Mirrors connect.ts for the HTTP shape: SERVER base + the Supabase
// JWT bearer. shopee_shops rows are read/deleted via RLS (own rows only) and this
// adapter NEVER selects the token columns (defense-in-depth on top of RLS).
//
// ⚠️ SESSION-ID PASTE IS TEMPORARY (P2/P3): there is no confirmed "current live
// session for shop" endpoint yet, so shopeeConnect takes a client-supplied
// session_id. When a detect endpoint is confirmed, resolve it server-side and this
// arg goes away — kept isolated so removing it is a one-line change here + the modal.
import { supabase, isSupabaseConfigured } from "../../supabase";
import { SERVER, browserSessionId } from "./serverIdentity";
import { getAppSetting } from "./appSettings";
import { isActivePaid, planDaysLeft } from "../../lib/planWindow";
import { isAdminRole } from "../../lib/roles";

// Item 7 — Authorize + Connect require an ACTIVE PAID plan (admin bypasses; the
// server also enforces requirePlanActive on /shopee/connect). Module-level so the
// Date.now() lives OUTSIDE any component render (react-hooks impure rule — same
// pattern as Subscription.daysLeftDisplay). Reads the AccountUser-shaped fields.
export function isShopeeEligible(a: { plan?: string; planStatus?: string; planExpiry?: string; role?: string } | null | undefined): boolean {
  if (!a) return false;
  if (isAdminRole(a.role)) return true;
  return isActivePaid({ plan: a.plan || "", planStatus: a.planStatus || "", daysLeft: planDaysLeft(a.planExpiry, Date.now()) });
}

// ── Global kill switch (fail-closed, mirrors parcel_manual_enabled) ──────────
// Only the literal string "true" opens Shopee; missing row / error / RLS deny /
// any other value → false. A read failure must HIDE Shopee, never expose it.
export const SHOPEE_ENABLED_KEY = "shopee_enabled";
export async function loadShopeeEnabled(): Promise<boolean> {
  const row = await getAppSetting(SHOPEE_ENABLED_KEY);
  return row?.value === "true";
}

export interface ShopeeShop { id: string; shopId: number; shopName: string; active: boolean }

// List the seller's authorized shops. NEVER selects access_token / refresh_token /
// token_expires_at (RLS also blocks writes; this keeps tokens off the client too).
export async function listShopeeShops(): Promise<ShopeeShop[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("shopee_shops")
      .select("id,shop_id,shop_name,active")
      .order("shop_id", { ascending: true });
    if (error || !Array.isArray(data)) return [];
    return data.map((r) => {
      const row = r as { id?: unknown; shop_id?: unknown; shop_name?: unknown; active?: unknown };
      return {
        id: String(row.id ?? ""),
        shopId: Number(row.shop_id ?? 0),
        shopName: row.shop_name == null ? "" : String(row.shop_name),
        active: row.active !== false,
      };
    });
  } catch {
    return [];
  }
}

// Delete an OWN shop row (RLS scopes the delete to auth.uid()). Returns ok/error.
export async function removeShopeeShop(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  try {
    const { error } = await supabase.from("shopee_shops").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "delete failed" };
  }
}

// Attach the seller's Supabase JWT (mirror connect.ts). Returns "" when unavailable.
async function bearer(): Promise<string> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    return session?.access_token || "";
  } catch {
    return "";
  }
}

// GET /shopee/oauth/start → { url }. The caller renders `url` as a REAL <a href>
// (iOS-safe: a direct anchor tap, never window.open / a JS-triggered open — the
// SLIDE→BUTTON lesson). Pre-fetch on screen mount so the href is present before
// the tap. The signed state inside the URL has a ~10-min TTL (STATE_TTL_MS).
export async function startShopeeAuth(): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const r = await fetch(`${SERVER}/shopee/oauth/start`, {
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

export interface ShopeeConnectResult { ok: boolean; reason?: string; error?: string; unreachable?: boolean; sessionId?: string }

// POST /shopee/connect { shop_id, session_id, sessionId }. Server: requireAuth →
// requireConnectRate → requirePlanActive (403 on expired plan) → starts the poller.
// { ok:false, reason:"not_live" } when no session was supplied / shop offline.
// TWO ids — do not conflate:
//   session_id = the SHOPEE live session the seller pasted (what the server polls);
//   sessionId  = THIS browser's session (browserSessionId(), the same value connect.ts
//     sends for TikTok and fb.ts for Facebook). The server stamps it on every relayed
//     Shopee comment + platform_status, and useLiveFeed drops any event whose sessionId ≠
//     its own — so only the device that tapped Connect receives the live flow (the
//     duplicate-auto-order safeguard on multi-device sellers).
export async function shopeeConnect(shopId: number | string, shopSessionId: string): Promise<ShopeeConnectResult> {
  try {
    const r = await fetch(`${SERVER}/shopee/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
      body: JSON.stringify({ shop_id: String(shopId), session_id: String(shopSessionId || ""), sessionId: browserSessionId() }),
    });
    const j = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; error?: string; session_id?: string }));
    if (r.status === 401) return { ok: false, error: j.error || "Unauthorized" };
    if (r.status === 403) return { ok: false, error: j.error || "plan_expired" };
    if (r.status >= 500) return { ok: false, error: j.error || "Server error" };
    if (j.ok === false) return { ok: false, reason: j.reason, error: j.error };
    // Result `sessionId` = the Shopee live session (unchanged contract for callers).
    return { ok: true, sessionId: j.session_id ? String(j.session_id) : String(shopSessionId) };
  } catch {
    return { ok: false, unreachable: true, error: "Can't reach the live server." };
  }
}

// POST /shopee/disconnect { shop_id } → stops the poller. Best-effort.
export async function shopeeDisconnect(shopId: number | string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${SERVER}/shopee/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
      body: JSON.stringify({ shop_id: String(shopId) }),
    });
    const j = await r.json().catch(() => ({} as { ok?: boolean; error?: string }));
    return { ok: r.ok && j.ok !== false, error: j.error };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

// Pure — parse the OAuth-callback return param on app load (the callback redirects
// back to APP_REDIRECT_URL with ?shopee=connected | ?shopee=error&code=...). Returns
// null when there is no shopee param. The caller toasts + clears the query.
export function parseShopeeReturn(search: string): { status: "connected" | "error"; code?: string } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(String(search || "").replace(/^\?/, "")); } catch { return null; }
  const s = params.get("shopee");
  if (s === "connected") return { status: "connected" };
  if (s === "error") return { status: "error", code: params.get("code") || undefined };
  return null;
}
