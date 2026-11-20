// The REAL Admin → 7-11 Login panel with the REAL "Who is checking" card, on a fake server — for
// screenshots at phone and laptop widths (NOT part of the app build).
//   ?panel=connected | out | notconnected | keymissing     the state of the panel
//   ?card=normal | duty | dutyout | off | failed            what GET /admin/pc711/duty answers
//   ?reason=silent | degraded    ?hist=1 | 0    ?dark=1
//   ?store=ready | opening | not_ready                       the "Store session" line (2026-11-20; absent = no line)
// The screenshot script fixes the page's clock at 2026-11-18 14:08 Taipei, so the times below read
// "4 s ago" and "11/18 13:46 (22 min)".
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import { AdminPanel } from "../../../../src/redesign/screens/Admin";

const q = new URLSearchParams(location.search);
const panel = q.get("panel") || "connected";
const card = q.get("card") || "normal";
const reason = q.get("reason") === "degraded" ? "degraded" : "silent";
const hist = q.get("hist") === "1";
const dark = q.get("dark") === "1";
const store = q.get("store");

const NOW = Date.parse("2026-11-18T06:08:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const STATUS: Record<string, unknown> = panel === "out"
  ? { state: "needs_login", since: "2026-11-16T09:30:00Z", lastOkAt: "2026-11-18T05:40:40Z", autoLogins: 1, phoneTail: "678", lastProblem: "cart_logged_out",
      loggedOutSince: "2026-11-18T05:46:12Z", passive: { lastAt: "2026-11-18T06:06:12Z", nextAt: "2026-11-18T06:16:12Z", kind: "logged_out" } }
  : panel === "notconnected" ? { state: "not_connected", since: null, lastOkAt: null, autoLogins: 0, phoneTail: "" }
  : panel === "keymissing" ? { state: "key_missing", since: null, lastOkAt: null, autoLogins: 0, phoneTail: "" }
  : { state: "connected", since: "2026-11-16T17:21:07Z", lastOkAt: "2026-11-18T05:58:26Z", autoLogins: 1, phoneTail: "678" };
const onDuty = card === "duty" || card === "dutyout";
const DUTY = {
  backup: card === "off" ? "off" : "on", onDuty, loggedOut: card === "dutyout" || panel === "out",
  reason: onDuty ? reason : null, since: onDuty ? iso(NOW - 22 * 60_000) : null, answered: onDuty ? 37 : null, answeredMore: false,
  checker: { label: "Lenovo", lastCallAt: iso(NOW - 4000) },
  last: hist ? { start: "2026-11-16T19:12:00Z", end: "2026-11-16T19:58:00Z", reason: "silent" } : null,
  ...(store ? { storeSession: store } : {}),
  now: iso(NOW),
};
const PART = { n: 0, matchPct: null, errors: 0 };
const SHADOW = { enabled: true, waiting: 0, pausedUntil: null, days: [], today: { n: 0, compared: 0, matchPct: null, errors: 0, store: PART, phone: PART, frozen: PART, avgMs: null, errorsByStep: {} } };
globalThis.fetch = (async (url: string) => {
  const p = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
  if (p === "/duty" && card === "failed") return { ok: false, status: 500, json: async () => ({ error: "failed" }) } as Response;
  const body = p === "/status" ? STATUS : p === "/duty" ? DUTY : p === "/shadow" ? SHADOW : p === "/shadow/history" ? { page: 0, more: false, rows: [], days: {} }
    : p === "/evidence/totals" ? { day: "today", mirrorEnabled: false, totals: null } : p === "/evidence" ? { page: 0, more: false, rows: [] } : {};
  return { ok: true, status: 200, json: async () => body } as Response;
}) as typeof fetch;

createRoot(document.getElementById("root")!).render(
  <TProvider lang={q.get("lang") || "en"}>
    <div data-redesign="" data-theme={dark ? "dark" : "light"} style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <AdminPanel panel="pc711" onClose={() => {}} cur="NT$" />
    </div>
  </TProvider>,
);
