// Seller Website Phase 1 gate (sql/163): the switch app_settings seller_website_enabled = 'true' for
// every seller, or the feature key seller_website for testers while the switch is off. Off = nothing
// of the website shows anywhere in the seller app.
export function sellerWebsiteVisible(switchOn: boolean, featureKey: boolean): boolean {
  return switchOn === true || featureKey === true;
}

// The website teaser (sql/169): sellers WITHOUT the website see its Settings card / Sales row with "Soon",
// a tap opens the support Telegram chat. Its own switch; never for a seller who has the website (they see
// the real thing) and never for an admin. Switch off → exactly as before.
export function websiteTeaserVisible(o: { switchOn: boolean; hasWebsite: boolean; isAdmin: boolean }): boolean {
  return o.switchOn === true && !o.hasWebsite && !o.isAdmin;
}
