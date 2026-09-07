// ── Preview/dev environment gate — the ONE source of truth ───────────────────
// Decides whether dev affordances ("+ Test comment" / __sflInject, the
// ?preview_expiry / ?preview_update overrides) are available. Replaces three
// duplicated hostname-only checks (useLiveFeed / planExpiryModal /
// nativeVersion) after a release-blocking field finding: a NATIVE SHELL whose
// page origin is not the production hostname (the local-bundle dev APK at
// https://localhost, a preview-URL shell, or a drifted server.url) passed the
// old "hostname !== production" heuristic and showed the test button.
//
// The rule, per environment:
//   - vite dev server (import.meta.env.DEV)            → preview (dev machine)
//   - NATIVE SHELL (window.Capacitor present):
//       · https://localhost / 127.0.0.1 (the documented local-bundle dev APK)
//                                                       → preview (device testing)
//       · ANY OTHER origin — production, *.vercel.app, or a drifted server.url
//                                                       → PRODUCTION. A store
//         binary must never show test features no matter what URL it loads.
//   - browser (no Capacitor): production hostnames      → production;
//       anything else (Vercel previews, localhost)      → preview.
export function computePreviewEnv(dev: boolean, hostname: string, nativeShell: boolean): boolean {
  if (dev) return true;
  if (nativeShell) return hostname === "localhost" || hostname === "127.0.0.1";
  return hostname !== "www.sellerflowlive.com" && hostname !== "sellerflowlive.com";
}

export function isPreviewEnv(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  const nativeShell = !!(window as unknown as { Capacitor?: unknown }).Capacitor;
  return computePreviewEnv(false, window.location.hostname, nativeShell);
}
