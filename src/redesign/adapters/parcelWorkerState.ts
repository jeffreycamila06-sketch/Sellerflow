// Admin-card view of the parcel-checker extension's per-tab health (the blob the
// worker pushes via admin_set_parcel_worker_state, sql/54). PURE — display-only.
export type WorkerLevel = "ok" | "warn" | "bad" | "off";
export type WorkerStateBlob = {
  v?: string; at?: number; bootAt?: number;
  sfl?: string | null; myship?: string | null; emap?: string | null; emapDomain?: string | null;
  lastStoreVerdictAt?: number | null; lastPhoneVerdictAt?: number | null; queue?: number | null;
};

// The worker pushes at least every 60s; twice that with no push = the laptop /
// worker is down (the worst silent failure — call it out in red).
export const WORKER_SILENT_MS = 3 * 60 * 1000;
const BAD = new Set(["expired", "dead", "dead_script", "no_tab", "no_token", "no_config"]);
const WARN = new Set(["stale", "guid_missing", "recovering", "asleep", "healing", "issue", "paused"]);

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
    return { level: "bad", text: `worker v${w.v ?? "?"} SILENT — last heartbeat ${ago(w.at, now)} (laptop asleep / extension stopped?)` };
  }
  const parts = [`sfl ${w.sfl ?? "—"}`, `myship ${w.myship ?? "—"} (phone ${ago(w.lastPhoneVerdictAt, now)})`, `emap ${w.emap ?? "—"} (store ${ago(w.lastStoreVerdictAt, now)}${w.emapDomain ? ` · ${w.emapDomain}` : ""})`];
  const level = [levelOf(w.sfl), levelOf(w.myship), levelOf(w.emap)].reduce(worst, "ok" as WorkerLevel);
  return { level, text: `worker v${w.v ?? "?"} · ${parts.join(" · ")} · heartbeat ${ago(w.at, now)}` };
}
