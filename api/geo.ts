// Vercel serverless function — returns the caller's country from Vercel's free
// `x-vercel-ip-country` edge header (no paid geo API). PER-REQUEST, never cached
// (Cache-Control: no-store) so it reflects THIS device's IP. Used ONLY to PRE-FILL the
// signup country picker — the seller always confirms; the value is never auto-submitted.
//
// Same-origin from the app (Vercel + the Capacitor thin shell both load
// www.sellerflowlive.com), so a browser/app `fetch('/api/geo')` hits Vercel with the
// real device IP. In `vite dev`/local the header is absent → returns { country: null }
// → the picker falls back to its default. Typed loosely to avoid a @vercel/node dep;
// `api/` is outside tsconfig, so this never enters `npm run typecheck`.
interface Req { headers: Record<string, string | string[] | undefined> }
interface Res { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (b: unknown) => void } }

export default function handler(req: Req, res: Res): void {
  const raw = req.headers["x-vercel-ip-country"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const country = value && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null; // ISO-2 or null
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ country });
}
