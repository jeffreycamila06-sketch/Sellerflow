// "‹ Back" goes to where the screen was opened from (Jeff 2026-11-11). Pure, tested.
//
// One small record: screen → the screen it was opened from. Opening a screen writes its own entry;
// a bottom-nav tab (Live, Sales, Orders, Products, Settings — and Admin's own nav button) clears it
// all (a fresh start). The record never grows past one entry per screen — no long history.
// The Parcel Scan ⇄ (7-11 ↔ FamilyMart) never adds a step: the new one takes the old one's origin.

export type NavOrigins = Readonly<Record<string, string>>;

/** The bottom-nav tabs: never a Back. */
export const HOME_SCREENS: readonly string[] = ["dashboard", "salestab", "orders", "products", "menu"];
/** Signed-out roots: never a Back. */
export const ROOT_SCREENS: readonly string[] = ["landing", "login"];
const BRIDGE: readonly string[] = ["parcelscan", "fmparcelscan"];

/** Where Back goes when the record has nothing (a fallback only — every normal open writes an origin). */
export const DEFAULT_BACK: Readonly<Record<string, string>> = {
  settings: "menu", customers: "menu", subscription: "settings", support: "settings", admin: "menu",
  shipping: "menu", customerdata: "menu", legal: "menu", delete: "settings",
  printersettings: "settings", printpattern: "settings",
  ttchannels: "settings", fbchannels: "settings", shopeechannels: "settings", fbpages: "settings", igaccounts: "settings",
  parcelscan: "menu", fmparcelscan: "menu", customerdetails: "menu", parceltracking: "menu",
  receiptformat: "menu", print: "orders", signup: "login",
};

/** Opening `to` while on `from` (a tile, a link, a popup button, …). */
export function navigateOrigins(origins: NavOrigins, from: string, to: string): NavOrigins {
  if (to === from) return origins;
  if (HOME_SCREENS.includes(to)) return {};
  const next: Record<string, string> = { ...origins };
  if (BRIDGE.includes(from) && BRIDGE.includes(to)) {
    next[to] = origins[from] ?? DEFAULT_BACK[from] ?? "menu"; // ⇄: same way out as the screen it replaces
    delete next[from];
    return next;
  }
  if (origins[from] === to) return origins; // going back up the way we came: keep to's own origin (no loop)
  next[to] = from;
  return next;
}

/** A bottom-nav tab (incl. Admin's own nav button): a fresh start. */
export function tabOrigins(): NavOrigins {
  return {};
}

/** Back from `screen`: where to go, and the record after it. */
export function backFrom(origins: NavOrigins, screen: string, fallback?: string): { to: string; origins: NavOrigins } {
  const to = origins[screen] ?? fallback ?? DEFAULT_BACK[screen] ?? "menu";
  if (HOME_SCREENS.includes(to)) return { to, origins: {} };
  const next: Record<string, string> = { ...origins };
  delete next[screen];
  return { to, origins: next };
}

/** Does this screen show a Back? Home tabs and roots never; Admin only when opened from the Settings tile. */
export function showsBack(origins: NavOrigins, screen: string): boolean {
  if (HOME_SCREENS.includes(screen) || ROOT_SCREENS.includes(screen)) return false;
  if (screen === "admin") return origins.admin !== undefined;
  return true;
}
