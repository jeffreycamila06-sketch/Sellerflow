// Proof (2026-11-19, claude/fm-pickup-accuracy-2): the 7-11 scopes are the same as main's.
// Runs main's server/parcelTrackingWorker.js and this branch's side by side over generated jobs.
//   node docs/design/fm-pickup-accuracy-2/proof/seven-scopes-vs-main.mjs <folder with main's server/>
// Get main's folder with: mkdir -p /tmp/m/server && git archive origin/main server | tar -x -C /tmp/m
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const mainDir = process.argv[2];
if (!mainDir) { console.error("give the folder that holds main's server/"); process.exit(2); }
const MAIN = await import(pathToFileURL(resolve(mainDir, "server/parcelTrackingWorker.js")).href);
const MAIN_AUTO = await import(pathToFileURL(resolve(mainDir, "server/parcelTrackingAuto.js")).href);
const HERE = await import(pathToFileURL(resolve("server/parcelTrackingWorker.js")).href);
const HERE_AUTO = await import(pathToFileURL(resolve("server/parcelTrackingAuto.js")).href);

let seed = 20261119;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NOWS = ["2026-11-19T03:00:00.000Z", "2026-11-19T15:59:00.000Z", "2026-11-19T16:01:00.000Z", "2026-12-31T20:00:00.000Z"].map((s) => new Date(s));
const KINDS = ["manual", "new_parcels", "urgent", "health", "auto", "weird", undefined];
const STATUSES = ["at_store", "in_transit", "created", "picked_up", "returned", null];
const H = 3600000;
const makeRows = (now) => Array.from({ length: Math.floor(rnd() * 9) }, (_, i) => ({
  id: `r${i}`, status: pick(STATUSES), tracking_no: pick(["F12345678901", "16300000001", null]),
  pickup_deadline: pick([null, "2026-11-10", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-30", "2027-01-02"]),
  last_polled_at: pick([null, new Date(now - H).toISOString(), new Date(now - 25 * H).toISOString(), new Date(now - 72 * H).toISOString()]),
  created_at: pick([new Date(now - 60000).toISOString(), new Date(now - 10 * 60000).toISOString(), new Date(now - 48 * H).toISOString(), "2026-11-01T00:00:00.000Z"]),
}));

let cases = 0, sevenSame = 0, scopeSame = 0, fmNonManualSame = 0, fmNonManual = 0, fmManualDiffer = 0, fmManual = 0, autoSame = 0;
const diffs = [];
for (let i = 0; i < 4000; i++) {
  const now = pick(NOWS);
  const job = { kind: pick(KINDS), requested_at: new Date(now.getTime() - pick([0, 2, 10]) * 60000).toISOString() };
  const rows = makeRows(now.getTime());
  const caps = { parcels: pick([1, 3, 60, 300]) };
  cases++;
  const a = JSON.stringify(MAIN.sevenScopeForJob(job, rows, now, caps)), b = JSON.stringify(HERE.sevenScopeForJob(job, rows, now, caps));
  if (a === b) sevenSame++; else diffs.push(["sevenScopeForJob", job.kind]);
  const c = JSON.stringify(MAIN.scopeForJob(job, rows, now, caps)), d = JSON.stringify(HERE.scopeForJob(job, rows, now, caps));
  if (c === d) scopeSame++; else diffs.push(["scopeForJob", job.kind]);
  // the 全家 part: main used scopeForJob; this branch uses fmScopeForJob
  const fm = JSON.stringify(HERE.fmScopeForJob(job, rows, now, caps));
  if (job.kind === "manual") { fmManual++; if (fm !== c) fmManualDiffer++; }
  else { fmNonManual++; if (fm === c) fmNonManualSame++; else diffs.push(["fmScopeForJob vs main scopeForJob", job.kind]); }
  // the automatic check's scope (unchanged file)
  const auto = { maxParcels: caps.parcels, cooldownHours: pick([6, 12, 24]), dueDays: pick([1, 3, 5]), memPct: 80 };
  const tier = pick(["normal", "urgent_only"]);
  const e = JSON.stringify(MAIN_AUTO.autoScope(rows, now, auto, tier)), f = JSON.stringify(HERE_AUTO.autoScope(rows, now, auto, tier));
  if (e === f) autoSame++; else diffs.push(["autoScope", tier]);
}
console.log(`generated jobs: ${cases}`);
console.log(`7-11 part (sevenScopeForJob): same as main in ${sevenSame} of ${cases}`);
console.log(`scopeForJob: same as main in ${scopeSame} of ${cases}`);
console.log(`automatic check (autoScope): same as main in ${autoSame} of ${cases}`);
console.log(`全家 part, urgent / new_parcels / health / other: same as main in ${fmNonManualSame} of ${fmNonManual}`);
console.log(`全家 part, a seller's press (manual): different from main in ${fmManual ? fmManualDiffer : 0} of ${fmManual} (by design: no 24-hour skip, the 7-11 order)`);
if (diffs.length) { console.log("DIFFERENCES:", diffs.slice(0, 20)); process.exit(1); }
