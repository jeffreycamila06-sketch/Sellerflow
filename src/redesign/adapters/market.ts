// MARKET CONFIG — the per-country "manage centrally, deliver locally" resolver. ONE app;
// a seller's seller_profiles.country picks which market renders in the shared slots.
// NULL/blank/"TW" → the TW market (today's behaviour, byte-for-byte). Any non-TW country
// → the PH market (TW-only features OFF, currency ₱/PHP, PH shipping slot reserved). Only
// TW + PH exist today; add a MARKETS entry to introduce another. PURE — unit-tested.
import { isAdminRole } from "../../lib/roles";

// 'none' = no shipping module for this market yet → the shipping slot renders nothing
// (cleanly). 'tw-711' = the current TW 7-11/賣貨便 module; 'ph' = a future PH module.
export type ShippingModule = "tw-711" | "ph" | "none";
export interface Market {
  country: string;          // ISO-2 ("TW" | "PH" | "VN" | "TH" | "ID" | "MY" | …)
  currency: string;         // ISO currency (curSymbol maps → NT$/₱/₫/฿/Rp/RM). "" = no
                            //   market default → keep the app default / the seller's pick.
  shippingModule: ShippingModule;
  features: { parcelScan: boolean; pickupStatus: boolean; stickerQr: boolean };
}

const ALL_OFF = { parcelScan: false, pickupStatus: false, stickerQr: false } as const;
const TW: Market = { country: "TW", currency: "TWD", shippingModule: "tw-711", features: { parcelScan: true, pickupStatus: true, stickerQr: true } };
// Non-TW markets: TW-only features hidden. PH has a (future) shipping slot; the rest have
// none yet. Currencies must exist in data.ts CURRENCIES (curSymbol) — TWD/PHP/VND/THB/IDR/MYR.
const PH: Market = { country: "PH", currency: "PHP", shippingModule: "ph", features: ALL_OFF };
const VN: Market = { country: "VN", currency: "VND", shippingModule: "none", features: ALL_OFF };
const TH: Market = { country: "TH", currency: "THB", shippingModule: "none", features: ALL_OFF };
const ID: Market = { country: "ID", currency: "IDR", shippingModule: "none", features: ALL_OFF };
const MY: Market = { country: "MY", currency: "MYR", shippingModule: "none", features: ALL_OFF };
export const MARKETS: Record<string, Market> = { TW, PH, VN, TH, ID, MY };
export const DEFAULT_MARKET = TW;

// The market for a stored country. NULL/""/"TW" → TW (unchanged). A KNOWN non-TW country →
// its own market (correct currency). Any OTHER/unknown non-TW → TW-only features hidden,
// currency "" (no market default → the app default / the seller's explicit pick wins),
// shippingModule 'none'.
export function marketFor(country: string | null | undefined): Market {
  const c = String(country || "").trim().toUpperCase();
  if (!c || c === "TW") return TW;
  return MARKETS[c] ?? { country: c, currency: "", shippingModule: "none", features: ALL_OFF };
}

export type ViewAs = "all" | "TW" | "PH" | "VN" | "TH" | "ID" | "MY";
export const VIEW_AS_OPTIONS: ViewAs[] = ["all", "TW", "PH", "VN", "TH", "ID", "MY"];

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
