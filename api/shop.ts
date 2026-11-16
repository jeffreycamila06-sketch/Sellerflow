// Vercel serverless function — a Seller Website page (/s/<sub>/… and <sub>.sellerflowlive.com/…).
// Returns shop.html with the shop's link-preview tags (og:title / og:description / og:image) so a
// shared link shows the shop on Facebook / LINE. Reads ONLY website_og (sql/163: title, tagline,
// cover/logo path of an ONLINE shop). The app itself (shop.html) then loads the shop in the browser.
// `api/` is outside tsconfig (typed loosely, no @vercel/node dependency).
import { injectOg, validSub, type ShopOg } from "../src/website/og.js";

interface Req { query: Record<string, string | string[] | undefined>; headers: Record<string, string | string[] | undefined> }
interface Res { setHeader: (k: string, v: string) => void; status: (n: number) => { send: (b: string) => void } }
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

export default async function handler(req: Req, res: Res): Promise<void> {
  const sub = one(req.query.sub).toLowerCase();
  const host = one(req.headers["x-forwarded-host"]) || one(req.headers.host) || "www.sellerflowlive.com";
  const proto = one(req.headers["x-forwarded-proto"]) || "https";
  let html: string;
  try { html = await (await fetch(`${proto}://${host}/shop.html`)).text(); } catch { html = ""; }
  if (!html.includes('id="shop-root"')) { res.status(502).send("Shop unavailable"); return; }
  let og: ShopOg | null = null;
  const url = process.env.VITE_SUPABASE_URL || "";
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (validSub(sub) && url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/website_og`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_sub: sub }) });
      if (r.ok) og = (await r.json()) as ShopOg;
    } catch { og = null; }
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  const onSubdomain = host.endsWith(".sellerflowlive.com") && !host.startsWith("www.");
  const pageUrl = onSubdomain ? `${proto}://${host}/` : `${proto}://${host}/s/${sub}`;
  res.status(200).send(injectOg(html, og, pageUrl, `${url}/storage/v1/object/public/product-images`));
}
