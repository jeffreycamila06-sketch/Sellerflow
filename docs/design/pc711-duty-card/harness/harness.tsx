// PICTURES ONLY — the "Who is checking" card is NOT built yet (waiting for approval, 2026-11-18).
// This page shows the REAL Admin → 7-11 Login panel on a fake server and puts a drawing of the
// proposed card where it would sit. Nothing here is part of the app build.
//   ?panel=connected | out | notconnected | keymissing     the state of the real panel
//   ?card=normal | duty | dutyout | off                    the four states of the card
//   ?reason=silent | degraded    ?hist=1 | 0    ?dark=1
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import { AdminPanel } from "../../../../src/redesign/screens/Admin";
import DutyCardDrawing, { type DutyCardState } from "./DutyCardDrawing";

const q = new URLSearchParams(location.search);
const panel = q.get("panel") || "connected";
const cardState = (q.get("card") || "normal") as DutyCardState;
const reason = q.get("reason") === "degraded" ? "degraded" : "silent";
const hist = q.get("hist") === "1";
const dark = q.get("dark") === "1";

// ── the fake server (the real panel reads these) ─────────────────────────────────────────────
const STATUS: Record<string, unknown> = panel === "out"
  ? { state: "needs_login", since: "2026-11-16T09:30:00Z", lastOkAt: "2026-11-18T05:40:40Z", autoLogins: 1, phoneTail: "678", lastProblem: "cart_logged_out",
      loggedOutSince: "2026-11-18T05:46:12Z", passive: { lastAt: "2026-11-18T06:06:12Z", nextAt: "2026-11-18T06:16:12Z", kind: "logged_out" } }
  : panel === "notconnected" ? { state: "not_connected", since: null, lastOkAt: null, autoLogins: 0, phoneTail: "" }
  : panel === "keymissing" ? { state: "key_missing", since: null, lastOkAt: null, autoLogins: 0, phoneTail: "" }
  : { state: "connected", since: "2026-11-16T17:21:07Z", lastOkAt: "2026-11-18T05:58:26Z", autoLogins: 1, phoneTail: "678" };
const PART = { n: 0, matchPct: null, errors: 0 };
const SHADOW = { enabled: true, waiting: 0, pausedUntil: null, days: [], today: { n: 0, compared: 0, matchPct: null, errors: 0, store: PART, phone: PART, frozen: PART, avgMs: null, errorsByStep: {} } };
globalThis.fetch = (async (url: string) => {
  const p = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
  const body = p === "/status" ? STATUS : p === "/shadow" ? SHADOW : p === "/shadow/history" ? { page: 0, more: false, rows: [], days: {} }
    : p === "/evidence/totals" ? { day: "today", mirrorEnabled: false, totals: null } : p === "/evidence" ? { page: 0, more: false, rows: [] } : {};
  return { ok: true, status: 200, json: async () => body } as Response;
}) as typeof fetch;

createRoot(document.getElementById("root")!).render(
  <TProvider lang="en">
    <div data-redesign="" data-theme={dark ? "dark" : "light"} style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <AdminPanel panel="pc711" onClose={() => {}} cur="NT$" />
    </div>
  </TProvider>,
);

// Put the drawing where the card would sit: under the state's main card AND its button(s)
// (Test now / Disconnect · Log in · Connect), above "Telegram alerts".
const anchorOf = (): Element | null => {
  const test = document.querySelector("[data-testid=pc711-test]");
  if (test) return test.parentElement;
  return document.querySelector("[data-testid=pc711-begin]") || document.querySelector("[data-testid=pc711-key-missing]");
};
const place = () => {
  const a = anchorOf();
  if (!a) { requestAnimationFrame(place); return; }
  const mount = document.createElement("div");
  a.after(mount);
  createRoot(mount).render(<DutyCardDrawing state={cardState} reason={reason} hist={hist} />);
};
place();
