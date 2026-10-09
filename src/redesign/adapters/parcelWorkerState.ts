// Admin-card view of the parcel-checker extension's per-tab health (the blob the
// worker pushes via admin_set_parcel_worker_state, sql/54). PURE — display-only.
export type WorkerLevel = "ok" | "warn" | "bad" | "off";
export type WorkerStateBlob = {
  v?: string; at?: number; bootAt?: number;
  sfl?: string | null; myship?: string | null; emap?: string | null; emapDomain?: string | null;
  lastStoreVerdictAt?: number | null; lastStoreMissAt?: number | null; lastPhoneVerdictAt?: number | null; queue?: number | null;
};

// The worker pushes at least every 60s; twice that with no push = the laptop /
// worker is down (the worst silent failure — call it out in red).
export const WORKER_SILENT_MS = 3 * 60 * 1000;
const BAD = new Set(["expired", "dead", "dead_script", "no_tab", "no_token", "no_config", "signed_out"]);
const WARN = new Set(["stale", "guid_missing", "recovering", "degraded", "reminting", "asleep", "healing", "issue", "paused", "refreshing"]);

function levelOf(s: string | null | undefined): WorkerLevel {
  if (!s || s === "starting") return "off";
  if (BAD.has(s)) return "bad";
  if (WARN.has(s)) return "warn";
  if (s === "ok" || s === "connected") return "ok";
  return "warn";
}
const worst = (a: WorkerLevel, b: WorkerLevel): WorkerLevel => {
  const rank = { bad: 3, warn: 2, off: 1, ok: 0 };
  return rank[a] >= rank[b] ? a : b;
};
const ago = (t: number | null | undefined, now: number): string =>
  typeof t === "number" && t > 0 ? `${Math.max(0, Math.round((now - t) / 60000))}m ago` : "never";

export function describeWorkerState(raw: unknown, now: number): { level: WorkerLevel; text: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as WorkerStateBlob;
  if (typeof w.at !== "number") return null;
  const silentFor = now - w.at;
  if (silentFor > WORKER_SILENT_MS) {
    return { level: "bad", text: `Checker: Needs attention — no signal ${ago(w.at, now)}` };
  }
  // 1.14.4: a recent verdict never hides a definitive latest miss — same rule as the worker
  const latestStoreFailed = typeof w.lastStoreMissAt === "number" && w.lastStoreMissAt > (typeof w.lastStoreVerdictAt === "number" ? w.lastStoreVerdictAt : 0);
  const emapShown = w.emap === "ok" && latestStoreFailed ? "degraded" : w.emap;
  const level = [levelOf(w.sfl), levelOf(w.myship), levelOf(emapShown)].reduce(worst, "ok" as WorkerLevel);
  // Build 10: plain words only — no tab, partner-system or setting names in the bundle.
  return { level, text: level === "ok" ? "Checker: OK" : "Checker: Needs attention" };
}
