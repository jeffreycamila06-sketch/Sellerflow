// 7-11 Login panel (Admin) on a fake server, for phone-width screenshots (NOT in the app build).
// ?scene=out      — logged out: needs Jeff, since when, checks paused, the passive look every 10 min
// ?scene=evidence — the evidence block: mirror stopped itself (login_lost) + the remembered count
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import Pc711Panel from "../../../../src/redesign/components/Pc711Panel";
import Pc711EvidenceBlock from "../../../../src/redesign/components/Pc711Evidence";

const q = new URLSearchParams(location.search);
const scene = q.get("scene") || "out";
const STATUS = {
  state: "needs_login", since: "2026-11-16T09:30:00Z", lastOkAt: "2026-11-17T00:05:40Z", autoLogins: 0, phoneTail: "678", lastProblem: "cart_logged_out",
  loggedOutSince: "2026-11-17T00:06:12Z", passive: { lastAt: "2026-11-17T00:56:12Z", nextAt: "2026-11-17T01:06:12Z", kind: "logged_out" },
};
const TOTALS = {
  rows: 30, rechecks: 3, flags: 1, reasked: 1, errors: { after: 2, mirror: 1 },
  pairs: [
    { mode: "after", kind: "phone", source: "fresh", compared: 412, agree: 412 }, { mode: "after", kind: "store", source: "fresh", compared: 380, agree: 380 },
    { mode: "mirror", kind: "phone", source: "fresh", compared: 41, agree: 41 }, { mode: "mirror", kind: "phone", source: "remembered", compared: 7, agree: 7 },
  ],
  mirror: { n: 48, serverFirst: 33, extensionFirst: 8, avgFirstByMs: 2100, late: 1, timeout: 0, remembered: 7 },
  storeAge: { n: 484, avgS: 640, maxS: 3428 }, restricted: { agree: 6, disagree: 2 },
};
globalThis.fetch = (async (url: string) => {
  const p = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
  const body = p === "/status" ? STATUS
    : p === "/evidence/totals" ? { day: "today", mirrorEnabled: false, totals: TOTALS, selfStop: { silentSince: null, lastCheckAt: null, lastStop: { at: "2026-11-17T00:06:20Z", rule: "login_lost", value: null, parcels: null } } }
    : p === "/evidence" ? { page: 0, more: false, rows: [] } : {};
  return { ok: true, status: 200, json: async () => body } as Response;
}) as typeof fetch;
const dark = q.get("dark") === "1";
createRoot(document.getElementById("root")!).render(
  <TProvider lang={q.get("lang") || "en"}>
    <div data-redesign="" data-theme={dark ? "dark" : "light"} style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)", padding: 16 }}>
      {scene === "evidence" ? <Pc711EvidenceBlock /> : <Pc711Panel />}
    </div>
  </TProvider>,
);
