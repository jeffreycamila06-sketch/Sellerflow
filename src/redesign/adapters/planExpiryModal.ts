// Plan-expiry modal logic (pure). Tier from the SAME shared lib/planWindow math
// the Settings expiry display uses (no drift, no new query, no poll) — the caller
// passes daysLeft = planDaysLeft(profile.planExpiry, Date.now()). Dismissal is
// session-scoped and keyed by tier + expiry date so each tier prompts once per
// session and a NEW tier (as days pass) re-prompts even after an earlier dismiss.
import { isTimeLimitedPlan } from "../../lib/planWindow";

export type ExpiryTier = "7d" | "3d" | "1d" | "expired";

// Which sighting applies right now (null = don't show: free/no-expiry/pending/
// >7 days). expired = status expired OR the day count has hit 0.
export function computeExpiryTier(plan: string | null | undefined, planStatus: string | null | undefined, daysLeft: number): ExpiryTier | null {
  if (!isTimeLimitedPlan(plan)) return null;        // free = cap-limited, never time-expired
  if (planStatus === "pending") return null;        // pending has its own surface
  if (planStatus === "expired" || daysLeft <= 0) return "expired";
  if (!Number.isFinite(daysLeft)) return null;      // no/invalid expiry (Infinity)
  if (daysLeft === 1) return "1d";
  if (daysLeft <= 3) return "3d";
  if (daysLeft <= 7) return "7d";
  return null;                                       // >7 days out
}

// Tone escalates amber → red as expiry nears. fill = slider gradient; accent =
// icon-chip colour. Fixed palette (like the landing/slide controls) so the
// urgency reads the same across themes/accents.
export interface ExpiryTone { fill: string; accent: string; soft: string }
export function expiryTone(tier: ExpiryTier): ExpiryTone {
  switch (tier) {
    case "7d": return { fill: "linear-gradient(90deg,#f59e0b,#fbbf24)", accent: "#b45309", soft: "rgba(245,158,11,.16)" };
    case "3d": return { fill: "linear-gradient(90deg,#f97316,#fb923c)", accent: "#c2410c", soft: "rgba(249,115,22,.16)" };
    case "1d": return { fill: "linear-gradient(90deg,#ef4444,#f87171)", accent: "#b91c1c", soft: "rgba(239,68,68,.16)" };
    case "expired": return { fill: "linear-gradient(90deg,#dc2626,#ef4444)", accent: "#991b1b", soft: "rgba(220,38,38,.18)" };
  }
}

// sessionStorage dismissal, keyed per tier + expiry date (YYYY-MM-DD). Survives
// in-app navigation, clears on WebView destroy (full close) → re-checks next cold
// open. A different tier or a new expiry date = a fresh key = a new prompt.
export function expiryDismissKey(tier: ExpiryTier, expiry: string | null | undefined): string {
  const d = expiry ? String(expiry).slice(0, 10) : "none";
  return `sfl_exp_seen_${tier}_${d}`;
}
export function wasExpiryDismissed(tier: ExpiryTier, expiry: string | null | undefined): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(expiryDismissKey(tier, expiry)) === "1";
  } catch {
    return false;
  }
}
export function markExpiryDismissed(tier: ExpiryTier, expiry: string | null | undefined): void {
  try {
    sessionStorage.setItem(expiryDismissKey(tier, expiry), "1");
  } catch {
    /* private mode — just won't persist within the session */
  }
}

// Cold-open priority (pure, mirrors the RedesignApp coordinator): when a stale
// binary AND an expiring plan both qualify, only ONE shows per open and EXPIRY
// wins (time-critical); the update waits for the next open.
export function coldModalPriority(hasExpiry: boolean, hasUpdate: boolean): "expiry" | "update" | null {
  if (hasExpiry) return "expiry";
  if (hasUpdate) return "update";
  return null;
}

// Dev/preview-only tier override so Jeff can see every tier + both platform
// variants in a plain browser: ?preview_expiry=7|3|1|0 (0 = expired), gated to
// non-production hosts (never force-shows for real production web users).
export function previewExpiryTier(): ExpiryTier | null {
  if (typeof window === "undefined") return null;
  try {
    const v = new URLSearchParams(window.location.search).get("preview_expiry");
    if (v == null) return null;
    const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    const h = window.location.hostname;
    if (!dev && h === "www.sellerflowlive.com") return null;
    if (!dev && h === "sellerflowlive.com") return null;
    return v === "7" ? "7d" : v === "3" ? "3d" : v === "1" ? "1d" : v === "0" ? "expired" : null;
  } catch {
    return null;
  }
}
