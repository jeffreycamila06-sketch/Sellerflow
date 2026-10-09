// Build 16 — Shipping is "Coming soon" for sellers (display / gating only). Jeff: SellerFlowLive
// doesn't really offer shipping yet (production: 7 rows from 3 accounts, last one Oct 4).
//   open   = the Shipping screen opens as before (admins);
//   soon   = every entry point shows "Coming soon" and does NOT open the screen (every other seller);
//   hidden = the market has no 7-11 shipping module → no entry point at all (unchanged).
// Shipping data, tables, export code and the build11_enabled logic are untouched.
export type ShippingAccess = "open" | "soon" | "hidden";

export function shippingAccess(isAdmin: boolean, marketHidesShipping: boolean): ShippingAccess {
  if (marketHidesShipping) return "hidden";
  return isAdmin ? "open" : "soon";
}
