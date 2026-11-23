// SHOPEE LIVE BETA — access + locks (sql/135 `shopee_beta`, 2026-10-27).
//
// Rule (client AND server, same row): Shopee allowed = admin OR (row exists AND
// expires_at > now). Not plan-based. While the beta is active, a seller WITHOUT an active
// paid plan may use Shopee only (TikTok / Facebook / Instagram locked); an active paid plan
// keeps every platform. After the 30 days: Shopee locked ("contact Admin"). Admins: always
// allowed, never locked. The server re-checks the row on every /shopee/live/connect, so
// these helpers only decide what the seller sees.
import { useEffect, useState } from "react";
import { supabase } from "../../supabase";

export interface ShopeeBetaRow { expiresAt: string; shopeeUid: string | null }
export interface ShopeeBetaAccess { allowed: boolean; expired: boolean; daysLeft: number | null }
export type LockPlatform = "TikTok" | "Facebook" | "Instagram" | "Shopee";
export type LockKey = "rd_sh_lock_beta_only" | "rd_sh_lock_ended";
export type ShopeeBetaLocks = Partial<Record<LockPlatform, LockKey>>;

const DAY_MS = 86_400_000;

// sql/136 mirror: the free-tier cap does NOT apply to a Shopee order while the seller's beta
// row is active (the DB trigger neither blocks nor counts it). Every other order: unchanged.
export function freeCapAppliesTo(platform: string | undefined | null, betaRowActive: boolean): boolean {
  return !(betaRowActive && String(platform ?? "").trim() === "Shopee");
}

export function shopeeBetaAccess(o: { isAdmin: boolean; row: ShopeeBetaRow | null; now?: number }): ShopeeBetaAccess {
  if (o.isAdmin) return { allowed: true, expired: false, daysLeft: null };
  const exp = o.row ? Date.parse(o.row.expiresAt) : NaN;
  if (!Number.isFinite(exp)) return { allowed: false, expired: false, daysLeft: null };
  const left = exp - (o.now ?? Date.now());
  if (left <= 0) return { allowed: false, expired: true, daysLeft: 0 };
  return { allowed: true, expired: false, daysLeft: Math.ceil(left / DAY_MS) };
}

export function shopeeBetaLocks(o: { isAdmin: boolean; access: ShopeeBetaAccess; paidActive: boolean }): ShopeeBetaLocks {
  if (o.isAdmin) return {};
  if (o.access.allowed && !o.paidActive) return { TikTok: "rd_sh_lock_beta_only", Facebook: "rd_sh_lock_beta_only", Instagram: "rd_sh_lock_beta_only" };
  if (o.access.expired) return { Shopee: "rd_sh_lock_ended" };
  return {};
}

// ── SHOPEE FOR EVERY SELLER (sql/206, Jeff 2026-11-23) ───────────────────────────────────────────────
// Who has it: the switch shopee_public_enabled, OR the login has the feature key shopee_public, OR an
// admin — the same rule the server asks the database (shopee_public_on). Off = the beta rules above.
export function shopeePublicVisible(o: { isAdmin: boolean; previewKey: boolean; switchOn: boolean }): boolean {
  return o.isAdmin || o.previewKey || o.switchOn;
}

export interface ShopeeSellerView { linkOn: boolean; locks: ShopeeBetaLocks; daysLeft: number | null }
// What the seller sees.
//   publicOn false → the beta rules, unchanged: the Shopee box only with an allowed beta row (or an admin);
//                    an ended row locks Shopee.
//   publicOn true  → the Shopee box for every seller (same TW / PH market rule). A seller with an ACTIVE beta
//                    row keeps what the row gives today until it ends (the days line, and TikTok / Facebook /
//                    Instagram locked on a free / expired plan). An ENDED row locks nothing and shows no days:
//                    the seller follows the plan like everyone else.
export function shopeeSellerView(o: { isAdmin: boolean; access: ShopeeBetaAccess; paidActive: boolean; marketOk: boolean; publicOn: boolean }): ShopeeSellerView {
  const locks = shopeeBetaLocks({ isAdmin: o.isAdmin, access: o.access, paidActive: o.paidActive });
  if (!o.publicOn) return { linkOn: o.access.allowed && o.marketOk, locks, daysLeft: o.access.daysLeft };
  const open: ShopeeBetaLocks = { ...locks };
  delete open.Shopee;
  return { linkOn: o.marketOk, locks: open, daysLeft: o.access.allowed ? o.access.daysLeft : null };
}

// The beta reads TW and PH lives only (tw.shp.ee / ph.shp.ee). adminUnion = "View as: All".
export function shopeeBetaMarketOk(m: { market: { country: string }; adminUnion: boolean }): boolean {
  return m.adminUnion || m.market.country === "TW" || m.market.country === "PH";
}

// The caller's own row (RPC my_shopee_beta, SECURITY INVOKER). Any error / no row → null.
export async function loadMyShopeeBeta(): Promise<ShopeeBetaRow | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("my_shopee_beta");
    if (error || !data) return null;
    const r = (Array.isArray(data) ? data[0] : data) as { expires_at?: string; shopee_uid?: string | null } | null;
    if (!r || !r.expires_at) return null;
    return { expiresAt: String(r.expires_at), shopeeUid: r.shopee_uid ? String(r.shopee_uid) : null };
  } catch {
    return null;
  }
}

// One read per signed-in user, keyed by authUserId so a sign-in switch never reuses the
// previous user's row (the parcel-check access pattern).
export function useShopeeBeta(authed: boolean, userId: string): ShopeeBetaRow | null {
  const [st, setSt] = useState<{ uid: string; row: ShopeeBetaRow | null } | null>(null);
  useEffect(() => {
    if (!authed || !userId) return;
    let alive = true;
    void loadMyShopeeBeta().then((row) => { if (alive) setSt({ uid: userId, row }); });
    return () => { alive = false; };
  }, [authed, userId]);
  return authed && !!userId && st?.uid === userId ? st.row : null;
}
