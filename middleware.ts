// Vercel Routing Middleware — ONLY for "/" and "/index.html" (config.matcher below).
// Why: on Vercel the filesystem takes precedence over vercel.json rewrites, so "/" (= index.html,
// a real file) was served to <sub>.sellerflowlive.com before the host rewrite could run → the
// seller app booted and its guard sent the buyer to www.sellerflowlive.com/s/<sub>. Middleware runs
// BEFORE the filesystem, so a shop host's home page now gets the shop (api/shop.ts: shop.html +
// link-preview tags) on the subdomain itself. Every other path of a shop host is already rewritten
// by vercel.json (they are not files).
// Any other host (www, the apex, *.vercel.app previews, reserved names like app./api.) → next():
// the request continues exactly as before this file existed. Any error → next() too.
// No dependency: rewrite() / next() send the same headers as @vercel/functions/middleware
// (x-middleware-rewrite / x-middleware-next) — that package pulls in ~19 more packages.
import { subFromHost } from "./src/website/route.js";

export const config = { runtime: "nodejs", matcher: ["/", "/index.html"] }; // Node.js runtime (Vercel: "edge" is deprecated for middleware)

const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });
const rewrite = (to: URL) => new Response(null, { headers: { "x-middleware-rewrite": String(to) } });

export default function middleware(request: Request): Response {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
    const sub = subFromHost(host);
    if (sub) return rewrite(new URL(`/api/shop?sub=${encodeURIComponent(sub)}`, url));
  } catch { /* never break the app's home page */ }
  return next();
}
