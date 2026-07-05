// Batch E (#13) — SINGLE SOURCE OF TRUTH for the live-server URL and the
// seller/browser identity the socket + connect POSTs use. Before, connect.ts
// and useLiveFeed.ts each carried their own byte-identical copy (and App.tsx —
// the rollback app — keeps a third, deliberately untouched); a drift in any
// copy silently splits the seller across live rooms or points connect at the
// wrong server. CONNECTIVITY-CRITICAL: parity-tested against all three copies
// (serverIdentity.parity.test.ts) — do NOT change names, URLs, storage key, or
// JSON format.

// Pure resolution (unit-testable): local dev hosts → the local dev server;
// anything else → Render. An explicit VITE_SERVER_URL always wins; trailing
// slash stripped. Same logic as App.tsx:169-173.
export function resolveServer(envUrl: string | undefined, hostname: string | undefined): string {
  const def = hostname !== undefined && ["localhost", "127.0.0.1"].includes(hostname)
    ? "http://localhost:3001"
    : "https://sellerflow-live-server.onrender.com";
  return String(envUrl || def).replace(/\/$/, "");
}

export const SERVER = resolveServer(
  import.meta.env.VITE_SERVER_URL as string | undefined,
  typeof window !== "undefined" ? window.location.hostname : undefined,
);

// Seller identity — the live-room key (App.tsx:155).
export const sellerIdOf = (email: string): string => email.trim().toLowerCase();

// Same browser-session id production uses (App.tsx:148-154), same storage
// key/format (LS.get/LS.set are JSON) so the redesign joins the SAME live room
// as a prod-rollback tab in this browser.
export const browserSessionId = (): string => {
  try {
    const raw = localStorage.getItem("sf_browser_session");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const next = `sf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem("sf_browser_session", JSON.stringify(next)); } catch { /* ignore */ }
  return next;
};
