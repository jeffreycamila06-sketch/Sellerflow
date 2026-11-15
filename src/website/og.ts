// Seller Website — link preview tags (Facebook / LINE read these; they do not run the app). PURE:
// api/shop.ts reads website_og (sql/163) and puts these tags into shop.html for /s/<sub>.
export interface ShopOg { online: boolean; title?: string; description?: string; image?: string }
export const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
/** The tags for a shop. Offline → a neutral title and nothing about the shop. */
export function ogTags(og: ShopOg | null, pageUrl: string, imageBase: string): string {
  if (!og || !og.online || !og.title) return `<meta property="og:title" content="SellerFlowLive" /><meta name="robots" content="noindex" />`;
  const img = og.image ? `${imageBase.replace(/\/$/, "")}/${og.image.split("/").map(encodeURIComponent).join("/")}` : "";
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(og.title)}" />`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    og.description ? `<meta property="og:description" content="${escapeHtml(og.description)}" />` : "",
    og.description ? `<meta name="description" content="${escapeHtml(og.description)}" />` : "",
    img ? `<meta property="og:image" content="${escapeHtml(img)}" />` : "",
    `<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}" />`,
  ];
  return tags.filter(Boolean).join("");
}
/** shop.html + tags (+ the shop name as the page title). */
export function injectOg(html: string, og: ShopOg | null, pageUrl: string, imageBase: string): string {
  const withTags = html.replace("<!--sfl-og-->", ogTags(og, pageUrl, imageBase));
  return og && og.online && og.title ? withTags.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(og.title)}</title>`) : withTags;
}
export const validSub = (s: unknown) => typeof s === "string" && /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/.test(s.toLowerCase());
