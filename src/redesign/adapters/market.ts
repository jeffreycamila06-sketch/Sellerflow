// MARKET CONFIG — the per-country "manage centrally, deliver locally" resolver. ONE app;
// a seller's seller_profiles.country picks which market renders in the shared slots.
// NULL/blank/"TW" → the TW market (today's behaviour, byte-for-byte). Any non-TW country
// → the PH market (TW-only features OFF, currency ₱/PHP, PH shipping slot reserved). Only
// TW + PH exist today; add a MARKETS entry to introduce another. PURE — unit-tested.
import { isAdminRole } from "../../lib/roles";

export type ShippingModule = "tw-711" | "ph";
export interface Market {
  country: string;          // "TW" | "PH"
  currency: string;         // "TWD" | "PHP" (curSymbol maps → NT$ / ₱)
  shippingModule: ShippingModule; // reserved slot; a future PH module drops in without touching TW
  features: { parcelScan: boolean; pickupStatus: boolean; stickerQr: boolean };
}

const TW: Market = { country: "TW", currency: "TWD", shippingModule: "tw-711", features: { parcelScan: true, pickupStatus: true, stickerQr: true } };
const PH: Market = { country: "PH", currency: "PHP", shippingModule: "ph", features: { parcelScan: false, pickupStatus: false, stickerQr: false } };
export const MARKETS: Record<string, Market> = { TW, PH };
export const DEFAULT_MARKET = TW;

// The market for a stored country. NULL/""/"TW" → TW; every other value → PH (the single
// non-TW market for now — "PH or any known non-TW"). Add MARKETS keys to split further.
export function marketFor(country: string | null | undefined): Market {
  const c = String(country || "").trim().toUpperCase();
  if (!c || c === "TW") return TW;
  return MARKETS[c] ?? PH;
}

export type ViewAs = "all" | "TW" | "PH";

// The EFFECTIVE market the UI renders as, for THIS user:
//  • non-admin  → their profile country's market (TW-only features hidden off-market).
//  • admin      → the UNION of all markets (sees everything) UNLESS they pick a "view as"
//                 market in the Admin panel, in which case render EXACTLY as that market's
//                 seller would (per-session preview; never writes the profile).
// Returns { market, adminUnion }: adminUnion=true means "don't hide anything" (admin, All).
export function effectiveMarket(opts: { role?: string | null; country?: string | null; viewAs?: ViewAs }): { market: Market; adminUnion: boolean } {
  if (isAdminRole(opts.role)) {
    const va = opts.viewAs ?? "all";
    if (va === "all") return { market: marketFor(opts.country), adminUnion: true };
    return { market: marketFor(va), adminUnion: false }; // preview AS that market (hide applies)
  }
  return { market: marketFor(opts.country), adminUnion: false };
}

// Feature-hidden helper: a feature is market-hidden when the effective market has it off
// AND we're not in the admin union view. The 3 gates take the resulting boolean.
export function marketHides(feature: keyof Market["features"], eff: { market: Market; adminUnion: boolean }): boolean {
  return !eff.adminUnion && !eff.market.features[feature];
}
