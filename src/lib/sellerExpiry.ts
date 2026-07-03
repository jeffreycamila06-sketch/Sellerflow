// Pure seller-expiry display state for the More menu (Phase: seller-facing
// expiry). NO side effects, NO clock reads — caller passes `now` (ms), which
// in the app is the existing 60s nowTick. Zero new Supabase egress: every
// input is already loaded with the session.

// Structural subset of App.tsx's User — keeps this module import-cycle-free.
export interface SellerExpiryUser {
  plan: string;
  planStatus: string;
  planExpiry: string;
  role?: string;
}

export type SellerExpiryTier = "urgent" | "warning" | "normal";

export interface SellerExpiryState {
  show: boolean;
  days: number;
  tier: SellerExpiryTier;
  expiryDate: string;
}

import { planDaysLeft } from "./planWindow";

// Fixed en-GB locale so the date renders identically on every device and in
// tests ("15 Aug 2026"); the surrounding label text is what gets translated.
const formatExpiry = (expiry: string) => {
  const d = new Date(expiry);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export function sellerExpiryState(user: SellerExpiryUser | null | undefined, now: number): SellerExpiryState | null {
  if (!user) return null;
  if (user.role === "admin") return null;           // admin is master/120mo — never shown
  if (user.plan === "free") return null;            // cap-limited, not time-limited
  if (user.planStatus === "pending") return null;   // not yet approved — different flow
  if (!user.planExpiry) return null;

  // Shared core (lib/planWindow); invalid dates come back Infinity = no expiry.
  const days = planDaysLeft(user.planExpiry, now);
  if (!Number.isFinite(days)) return null;
  const tier: SellerExpiryTier = days <= 2 ? "urgent" : days <= 7 ? "warning" : "normal";

  return { show: true, days, tier, expiryDate: formatExpiry(user.planExpiry) };
}
