// Seller Website — where am I? Two ways to reach a shop:
//   <sub>.sellerflowlive.com/…        (needs the wildcard DNS + domain on Vercel)
//   sellerflowlive.com/s/<sub>/…      (works today — the fallback)
// Pages: "" home · p/<id> product · cart · checkout · store · sent/<token> · o/<token> order link.
// PURE (unit-tested).
export type ShopPage =
  | { page: "home" } | { page: "product"; id: number } | { page: "cart" } | { page: "checkout" }
  | { page: "store" } | { page: "sent"; token: string } | { page: "order"; token: string } | { page: "missing" };
export interface ShopLocation { sub: string | null; base: string; route: ShopPage }

const APEX = ["sellerflowlive.com", "www.sellerflowlive.com"];
const SUB_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;
/** Never a shop (the same list is in vercel.json's host rewrite — a test keeps them equal). */
export const NOT_SHOPS = new Set(["www", "app", "admin", "api", "mail", "help", "support", "static", "assets", "cdn"]);
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** The shop of a host name: "budgetukay.sellerflowlive.com" → "budgetukay"; anything else → null. */
export function subFromHost(host: string): string | null {
  const h = String(host || "").toLowerCase().replace(/:\d+$/, "");
  if (APEX.includes(h) || !h.endsWith(".sellerflowlive.com")) return null;
  const sub = h.slice(0, -".sellerflowlive.com".length);
  return SUB_RE.test(sub) && !NOT_SHOPS.has(sub) ? sub : null;
}

export function parsePage(rest: string): ShopPage {
  const parts = rest.split("/").filter(Boolean);
  if (!parts.length) return { page: "home" };
  const [a, b] = parts;
  if (a === "p" && b && /^\d{1,16}$/.test(b) && parts.length === 2) return { page: "product", id: Number(b) };
  if (a === "cart" && parts.length === 1) return { page: "cart" };
  if (a === "checkout" && parts.length === 1) return { page: "checkout" };
  if (a === "store" && parts.length === 1) return { page: "store" };
  if (a === "sent" && b && TOKEN_RE.test(b)) return { page: "sent", token: b };
  if (a === "o" && b && TOKEN_RE.test(b)) return { page: "order", token: b };
  return { page: "missing" };
}

/** host + path → the shop and the page. */
export function parseShopLocation(host: string, pathname: string): ShopLocation {
  const path = String(pathname || "/").replace(/\/{2,}/g, "/");
  const sub = subFromHost(host);
  if (sub) return { sub, base: "", route: parsePage(path) };
  const m = /^\/s\/([^/]+)(\/.*)?$/.exec(path);
  if (m && SUB_RE.test(m[1].toLowerCase())) return { sub: m[1].toLowerCase(), base: `/s/${m[1].toLowerCase()}`, route: parsePage(m[2] || "/") };
  return { sub: null, base: "", route: { page: "missing" } };
}

export function pagePath(base: string, r: ShopPage): string {
  const tail = r.page === "home" || r.page === "missing" ? "" : r.page === "product" ? `p/${r.id}` : r.page === "sent" ? `sent/${r.token}` : r.page === "order" ? `o/${r.token}` : r.page;
  return `${base}/${tail}`.replace(/\/$/, "") || "/";
}
/** The public address of a shop (path fallback until the wildcard domain is live). */
export const shopUrl = (sub: string, useSubdomain = false) => (useSubdomain ? `https://${sub}.sellerflowlive.com` : `https://www.sellerflowlive.com/s/${sub}`);
