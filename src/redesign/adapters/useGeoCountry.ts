// useGeoCountry — reads the caller's IP country from our /api/geo Vercel function
// (x-vercel-ip-country). Used ONLY to PRE-FILL the signup country picker; the seller
// always confirms (never auto-submitted). One fetch, cached in-module so multiple mounts
// share it; SSR/failure-safe → null (the picker then keeps its default). No paid API.
import { useEffect, useState } from "react";

let cached: string | null | undefined; // undefined = not fetched; null = fetched, unknown
let inflight: Promise<string | null> | null = null;

// PURE: extract a valid ISO-2 country from the /api/geo JSON, else null.
export function parseGeo(body: unknown): string | null {
  const c = (body as { country?: unknown } | null)?.country;
  return typeof c === "string" && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
}

async function fetchGeo(): Promise<string | null> {
  if (cached !== undefined) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/geo", { headers: { accept: "application/json" } });
      cached = res.ok ? parseGeo(await res.json()) : null;
    } catch { cached = null; }
    inflight = null;
    return cached ?? null;
  })();
  return inflight;
}

// Returns the detected ISO-2 country (or null while loading / on failure). Reactive.
export function useGeoCountry(enabled = true): string | null {
  const [country, setCountry] = useState<string | null>(cached ?? null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void fetchGeo().then((c) => { if (live) setCountry(c); });
    return () => { live = false; };
  }, [enabled]);
  return country;
}

// Test-only reset of the module cache.
export function __resetGeoCache(): void { cached = undefined; inflight = null; }
