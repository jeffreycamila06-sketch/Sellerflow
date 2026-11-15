// Seller Website Phase 1 gate (sql/163): the switch app_settings seller_website_enabled = 'true' for
// every seller, or the feature key seller_website for testers while the switch is off. Off = nothing
// of the website shows anywhere in the seller app.
export function sellerWebsiteVisible(switchOn: boolean, featureKey: boolean): boolean {
  return switchOn === true || featureKey === true;
}
