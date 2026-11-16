// 7-11 Evidence block (Admin) on a fake server, for phone-width screenshots (NOT in the app build).
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import Pc711EvidenceBlock from "../../../../src/redesign/components/Pc711Evidence";

const TOTALS = {
  rows: 30, rechecks: 3, flags: 1, reasked: 1, errors: { after: 2, mirror: 1 },
  pairs: [
    { mode: "after", kind: "phone", source: "fresh", compared: 412, agree: 412 }, { mode: "after", kind: "phone", source: "remembered", compared: 21, agree: 19 },
    { mode: "after", kind: "store", source: "fresh", compared: 380, agree: 380 }, { mode: "after", kind: "store", source: "remembered", compared: 44, agree: 37 },
    { mode: "after", kind: "store", source: "unknown", compared: 60, agree: 60 }, { mode: "mirror", kind: "phone", source: "fresh", compared: 3, agree: 3 },
  ],
  mirror: { n: 4, serverFirst: 3, extensionFirst: 1, avgFirstByMs: 1800, late: 1, timeout: 0 },
  storeAge: { n: 484, avgS: 640, maxS: 3428 }, restricted: { agree: 6, disagree: 2 },
};
const ROWS = [
  { id: 7, at: "2026-11-16T15:51:47Z", kind: "phone", round: 1, mode: "after", match: false, ext_verdict: "restricted", srv_verdict: "ok", ext_source: "remembered", reask_n: 2, reask1_word: "ok", reask2_word: "ok", srv_ms: 800 },
  { id: 8, at: "2026-11-16T15:52:00Z", kind: "store", round: 1, mode: "after", match: null, fail_step: "store.byid", fail_http: 429, fail_reason: "http", fail_at: "2026-11-16T15:52:01Z", srv_ms: 300 },
  { id: 9, at: "2026-11-16T15:53:00Z", kind: "phone", round: 2, mode: "after", match: true, ext_verdict: "ok", srv_verdict: "ok", ext_source: "fresh", flag: "phone_changed_verdict_kept", srv_ms: 700 },
  { id: 10, at: "2026-11-16T15:54:00Z", kind: "phone", round: 1, mode: "mirror", match: true, ext_verdict: "ok", srv_verdict: "ok", ext_source: "fresh", ext_late: true, first: "server", first_by_ms: 1500, srv_ms: 700, pair_closed: true, ext_at: "2026-11-16T16:10:00Z" },
];
const DETAIL = { ...ROWS[0], scan_id: "00000000-0000-0000-0000-000000000597", seller_id: "5d7e1c1a-0b8f-4a63-9c2e-1f0a2b3c4d5e", store_id: "151003", phone: "0912345678",
  parcel_created_at: "2026-11-16T15:51:37Z", ext_at: "2026-11-16T15:51:42Z", ext_message: "此手機號碼暫停服務至2026/11/30，請改用其他手機號碼", ext_restricted_until: "2026-11-30",
  ext_cache_at: "2026-11-16T10:00:00Z", srv_started_at: "2026-11-16T15:51:46Z", srv_finished_at: "2026-11-16T15:51:47Z", srv_raw: "Status:true", queue_waiting: 3,
  reask1_at: "2026-11-16T15:52:17Z", reask2_at: "2026-11-16T15:56:47Z" };
globalThis.fetch = (async (url: string) => {
  const p = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
  const body = p === "/evidence/totals" ? { day: "today", mirrorEnabled: false, totals: TOTALS } : p === "/evidence" ? { page: 0, more: true, rows: ROWS } : p === "/evidence/7" ? { row: DETAIL } : {};
  return { ok: true, status: 200, json: async () => body } as Response;
}) as typeof fetch;
const dark = new URLSearchParams(location.search).get("dark") === "1";
createRoot(document.getElementById("root")!).render(
  <TProvider lang={new URLSearchParams(location.search).get("lang") || "en"}>
    <div data-redesign="" data-theme={dark ? "dark" : "light"} style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-ui)", padding: 16 }}>
      <Pc711EvidenceBlock />
    </div>
  </TProvider>,
);
