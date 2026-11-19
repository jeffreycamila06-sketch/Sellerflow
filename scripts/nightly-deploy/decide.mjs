// Nightly Render deploy — the DECISION. Pure: no network, no git, no clock, no environment.
//
// .github/workflows/nightly-render-deploy.yml runs scripts/nightly-deploy/run.mjs several times a
// night, all planned between 03:30 and 05:30 Asia/Taipei. run.mjs collects the facts and asks the
// functions below what to do. How Jeff uses it: docs/ops/nightly-render-deploy.md.
//
// The rule (Jeff, 2026-11-18) — the Render Deploy Hook is called ONLY when all three hold:
//   1. main differs from the last deployed commit in a file the server is built from;
//   2. the CI run of that exact main commit finished and passed;
//   3. the repository secret RENDER_DEPLOY_HOOK_URL is set.
// The time rule (Jeff, 2026-11-19) — asked BEFORE those three, and again right before the hook:
//   0. a run that was not started by hand may deploy ONLY between 03:30 and 05:30 Asia/Taipei.
//      GitHub starts scheduled runs late: the first one, planned for 04:00, started at 09:50.
// Anything else ends green with ONE line that says why. A broken setting ends red (nothing deployed).
//
// Every sentence below is fixed. The only values put into one are: a 7-character commit, a count,
// a date that passed the date check, a time of day made here from a clock reading (HH:MM), a CI word
// from CI_WORDS, and repository file names that passed SAFE_NAME. Never the hook, never anything
// read from a response.

/** The branch the Render server is deployed from. */
export const DEPLOY_BRANCH = "main";
/** The tag this workflow moves: the last commit it sent to Render. Nothing else writes it. */
export const DEPLOYED_TAG = "render-deployed";
/** The workflow file whose result for the commit must be "passed". */
export const CI_WORKFLOW = "ci.yml";
/** The repository secret with the Render Deploy Hook, and the variable that pauses the nightly run. */
export const HOOK_SECRET = "RENDER_DEPLOY_HOOK_URL";
export const PAUSE_VARIABLE = "NIGHTLY_DEPLOY_PAUSE_UNTIL";
/** Render Deploy Hooks live here: https://api.render.com/deploy/srv-…?key=… */
export const HOOK_HOST = "api.render.com";

// ── What the Render server is built from ─────────────────────────────────────────────────────────
// A change in any of these (since the last deployed commit) is a server change; a change anywhere
// else (src/redesign, docs, sql, tests, the Chrome extension, this folder …) never deploys.
//   server.js, server/**              the server's own code (server/fonts too)
//   package.json, package-lock.json   what Render installs
//   three files in src/lib            code the server imports from the folder it shares with the app
//   render.yaml, .node-version, .nvmrc, .npmrc   files Render or npm read when building; none exists
//                                     today — listed so that adding one is deployed
// NOT here on purpose: docs/support/sfl-guide.md. The help bot reads the guide from the database
// (support_guide, 5-minute cache); the file is only its fallback, and it changes with almost every
// app change — it would restart the server most nights for nothing.
// nightlyDeploy.paths.test.ts walks the server's real imports and fails when a file is missing here.
export const SERVER_DIRS = ["server/"];
export const SERVER_FILES = [
  "server.js",
  "package.json",
  "package-lock.json",
  "src/lib/errCodes.js",
  "src/lib/helpBotGuard.js",
  "src/lib/receiptLayout.js",
  "render.yaml",
  ".node-version",
  ".nvmrc",
  ".npmrc",
];

/** PURE — is this repository path something the Render server is built from? */
export function isServerPath(path) {
  const p = String(path ?? "");
  if (!p) return false;
  if (SERVER_FILES.includes(p)) return true;
  return SERVER_DIRS.some((dir) => p.startsWith(dir) && p.length > dir.length);
}
/** PURE — the server files in a list of changed paths (order kept, no doubles). */
export function serverFilesIn(files) {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) if (isServerPath(f) && !out.includes(f)) out.push(f);
  return out;
}

// ── Small readers of the raw facts ───────────────────────────────────────────────────────────────
const SHA_RE = /^[0-9a-f]{40}$/;
/** PURE — a full commit id, lower case, or "" */
export function fullSha(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return SHA_RE.test(s) ? s : "";
}
/** PURE — the 7 characters shown to people, or "" */
export const sha7 = (value) => fullSha(value).slice(0, 7);

/** PURE — the hook secret: "missing" (not set), "bad" (set, but not a Render Deploy Hook), "set". */
export function hookState(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "missing";
  let u;
  try { u = new URL(s); } catch { return "bad"; }
  if (u.protocol !== "https:" || u.hostname !== HOOK_HOST || u.port || u.username || u.password) return "bad";
  if (!/^\/deploy\/srv-[A-Za-z0-9]+$/.test(u.pathname)) return "bad";
  if (!(u.searchParams.get("key") || "").trim()) return "bad";
  return "set";
}

/** PURE — the Taipei calendar day (YYYY-MM-DD) of a moment. Taiwan has no summer time: always UTC+8. */
export function taipeiDay(ms) {
  return new Date(Number(ms) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s) => DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
/**
 * PURE — the pause variable: "off" (empty), "on" (today is that day or earlier), "over" (the day has
 * passed: the nightly run works again by itself), "bad" (not a date like 2026-11-20).
 */
export function pauseState(raw, today) {
  const s = String(raw ?? "").trim();
  if (!s) return "off";
  if (!realDay(s) || !realDay(String(today ?? ""))) return "bad";
  return String(today) <= s ? "on" : "over";
}

// ── The time window ──────────────────────────────────────────────────────────────────────────────
// 03:30 to 05:30 Asia/Taipei, read to the minute, both minutes included: 03:30:00 is inside,
// 05:30:59 is still 05:30 and inside, 05:31:00 is outside. It is the same every day of the year.
export const WINDOW_FROM_MIN = 3 * 60 + 30;
export const WINDOW_TO_MIN = 5 * 60 + 30;
/** The one event that is "started by hand" (the Run workflow button). Every other event is bound by the window. */
export const BY_HAND_EVENT = "workflow_dispatch";

const TAIPEI_AHEAD_MS = 8 * 60 * 60 * 1000;
const MAX_CLOCK_MS = 8.6e15;                       // the last moment a Date can hold, minus the 8 hours
/**
 * PURE — the minutes after midnight in Taipei (0 … 1439) of a clock reading (ms since 1970),
 * or -1 when the value is not a clock reading (not a number, not finite, out of range).
 */
export function taipeiMinuteOfDay(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || Math.abs(ms) > MAX_CLOCK_MS) return -1;
  const d = new Date(ms + TAIPEI_AHEAD_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** PURE — the Taipei time of day of a clock reading as "HH:MM", or "" when it is not a clock reading. */
export function taipeiClock(ms) {
  const m = taipeiMinuteOfDay(ms);
  return m < 0 ? "" : hhmm(m);
}
/** PURE — is this moment inside the deploy window? A value that is not a clock reading is NOT. */
export function inDeployWindow(ms) {
  const m = taipeiMinuteOfDay(ms);
  return m >= WINDOW_FROM_MIN && m <= WINDOW_TO_MIN;
}
/** The window as people read it: "03:30" and "05:30". */
export const WINDOW_FROM = hhmm(WINDOW_FROM_MIN);
export const WINDOW_TO = hhmm(WINDOW_TO_MIN);

// GitHub tells a scheduled run which schedule line started it (github.event.schedule), e.g.
// "7 20 * * *" (UTC). Only that exact shape — a minute, an hour, every day — is read; the text
// itself is never printed, only the time of day worked out from its two numbers.
const SCHEDULE_LINE = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/;
/** PURE — the Taipei time of day ("HH:MM") a daily schedule line stands for, or "". */
export function plannedClock(line) {
  const m = SCHEDULE_LINE.exec(String(line ?? "").trim());
  if (!m) return "";
  return hhmm((Number(m[2]) * 60 + Number(m[1]) + 8 * 60) % (24 * 60));
}

// CI conclusions GitHub can give that are not "success" — the only words a "did not pass" line may hold.
export const CI_WORDS = ["failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", "stale", "startup_failure"];
/**
 * PURE — the CI result for ONE commit, from GitHub's list of runs of the CI workflow.
 * Only a run of that exact commit on the deploy branch counts; of several, the newest one decides
 * (a re-run flips the same run, so a re-run that passed counts).
 * → { state: "passed" | "running" | "failed" | "none", word }
 */
export function ciState(runs, sha) {
  const want = fullSha(sha);
  const mine = (Array.isArray(runs) ? runs : []).filter((r) => r && want && fullSha(r.head_sha) === want && r.head_branch === DEPLOY_BRANCH);
  if (!mine.length) return { state: "none", word: "" };
  mine.sort((a, b) => (Number(b.run_number) || 0) - (Number(a.run_number) || 0) || (Number(b.run_attempt) || 0) - (Number(a.run_attempt) || 0));
  const run = mine[0];
  if (run.status !== "completed") return { state: "running", word: "" };
  if (run.conclusion === "success") return { state: "passed", word: "" };
  return { state: "failed", word: CI_WORDS.includes(run.conclusion) ? run.conclusion : "" };
}

// ── The decision: the time rule, then three steps (run.mjs asks them in this order and stops at
//    the first answer, so a run that is skipped early never needs the later facts) ───────────────
const skip = (code, line) => ({ action: "skip", code, line });
const stop = (code, line) => ({ action: "stop", code, line });
const SAFE_NAME = /^[A-Za-z0-9._/-]{1,80}$/;
const files = (n) => `${n} file${n === 1 ? "" : "s"}`;
/** PURE — at most 3 file names for the deploy line (names that are not plain are left out). */
export function nameList(list) {
  const plain = (Array.isArray(list) ? list : []).filter((f) => SAFE_NAME.test(String(f)));
  const shown = plain.slice(0, 3);
  const more = (Array.isArray(list) ? list.length : 0) - shown.length;
  return shown.join(", ") + (more > 0 ? `${shown.length ? " " : ""}(+${more} more)` : "");
}

/**
 * The time rule — asked FIRST (when the run begins), and AGAIN right before the hook is called.
 * f: { event, nowMs (the real clock, ms since 1970), planned (the schedule line that started the run, or "") }
 * when: "start" | "hook"
 * → a result, or null (the time allows a deploy).
 * A run started by hand is not bound: Jeff chose the moment. Every other run is — also one whose
 * event is not known. A clock that cannot be read never deploys.
 */
export function checkWindow(f, when = "start") {
  if (f?.event === BY_HAND_EVENT) return null;
  const at = taipeiClock(f?.nowMs);
  if (!at) return stop("no_clock", `Stopped: the time could not be read, so the deploy window could not be checked. Nothing was deployed.`);
  if (inDeployWindow(f.nowMs)) return null;
  const rule = `A scheduled run deploys only between ${WINDOW_FROM} and ${WINDOW_TO} Taiwan time.`;
  const next = "the next scheduled run inside that window tries again.";
  if (when === "hook") {
    return skip("window_closed", `Skipped: the deploy window closed before Render was called: it is now ${at} Taiwan time. ${rule} The Deploy Hook was not called; ${next}`);
  }
  const plan = plannedClock(f.planned);
  return skip("outside_window", `Skipped: this run started at ${at} Taiwan time${plan ? ` (GitHub had it planned for ${plan})` : ""}. ${rule} Nothing was deployed; ${next}`);
}

/** PURE — what "only tell me" says about the time: would a scheduled run be allowed to deploy now? */
export function windowLine(nowMs) {
  const at = taipeiClock(nowMs);
  const span = `(window: ${WINDOW_FROM} to ${WINDOW_TO} Taiwan time)`;
  if (!at) return `Time now: could not be read. A scheduled run would not deploy ${span}.`;
  return inDeployWindow(nowMs)
    ? `Time now: ${at} Taiwan time. A scheduled run starting now would be allowed to deploy ${span}.`
    : `Time now: ${at} Taiwan time. A scheduled run starting now would NOT be allowed to deploy ${span}. A run started by hand is not bound by the window.`;
}

/**
 * Step 1 — before anything is read from GitHub.
 * f: { onMain, event, hook: "set"|"missing"|"bad", pause: "off"|"on"|"over"|"bad", pauseUntil }
 * → a result, or null (go on).
 */
export function checkSetup(f) {
  if (f?.onMain !== true) return skip("not_main", `Skipped: this run is not on ${DEPLOY_BRANCH}. The nightly deploy only works from ${DEPLOY_BRANCH}.`);
  if (f.hook === "missing") return skip("no_hook", `Skipped: the Render Deploy Hook is not saved yet (repository secret ${HOOK_SECRET}).`);
  if (f.hook !== "set") return stop("bad_hook", `Stopped: the saved secret ${HOOK_SECRET} is not a Render Deploy Hook address. Copy it again from Render. Nothing was deployed.`);
  // The pause is for the nightly run only: a run started by hand is a deliberate act.
  if (f.event === "schedule") {
    if (f.pause === "bad") return stop("bad_pause", `Stopped: the variable ${PAUSE_VARIABLE} is not a date like 2026-11-20. Fix it or delete it. Nothing was deployed.`);
    if (f.pause === "on") return skip("paused", `Skipped: the nightly deploy is paused until ${DAY_RE.test(String(f.pauseUntil)) ? f.pauseUntil : "the saved day"} (variable ${PAUSE_VARIABLE}).`);
  }
  return null;
}

/**
 * Step 2 — is there anything new for the server?
 * f: { headSha, deployedSha (""/null = no deploy noted yet), changed (file list, or null = unknown) }
 * → a skip, or null (the server may differ: go on to CI).
 */
export function checkChange(f) {
  const head = fullSha(f?.headSha);
  if (!head) return stop("no_head", `Stopped: could not read the newest commit of ${DEPLOY_BRANCH}. Nothing was deployed.`);
  const deployed = fullSha(f.deployedSha);
  if (!deployed) return null;                       // nothing noted yet: the first deploy
  if (deployed === head) return skip("nothing_new", `Skipped: nothing new on ${DEPLOY_BRANCH} since the last deploy (${sha7(head)}).`);
  if (!Array.isArray(f.changed)) return null;       // the difference could not be worked out: treat as changed
  if (serverFilesIn(f.changed).length === 0) {
    return skip("web_only", `Skipped: ${files(f.changed.length)} changed since the last deploy (${sha7(deployed)}), none of them is server code.`);
  }
  return null;
}

/**
 * Step 3 — did CI pass for that exact commit?
 * f: { headSha, ci: { state, word } }  → a skip, or null (deploy).
 */
export function checkCi(f) {
  const short = sha7(f?.headSha);
  const state = f?.ci?.state;
  if (state === "passed") return null;
  if (state === "running") return skip("ci_running", `Skipped: CI is still running for ${short}. The next run tries again.`);
  if (state === "failed") {
    const word = CI_WORDS.includes(f.ci.word) ? ` (${f.ci.word})` : "";
    return skip("ci_failed", `Skipped: CI did not pass for ${short}${word}. The server code was not deployed.`);
  }
  if (state === "none") return skip("ci_none", `Skipped: CI has no finished run for ${short} yet. The next run tries again.`);
  return skip("ci_unknown", `Skipped: the CI result for ${short} could not be read. The server code was not deployed.`);
}

/** PURE — the sentence printed right before the hook is called. */
export function deployLine(f) {
  const short = sha7(f?.headSha);
  if (!fullSha(f?.deployedSha)) return `Deploying ${short}: no nightly deploy is noted yet, and CI passed.`;
  if (!Array.isArray(f.changed)) return `Deploying ${short}: the last deployed commit (${sha7(f.deployedSha)}) is not in the repository any more, and CI passed.`;
  const mine = serverFilesIn(f.changed);
  return `Deploying ${short}: ${files(mine.length)} of the server changed since ${sha7(f.deployedSha)} (${nameList(mine)}), and CI passed.`;
}

/**
 * PURE — the three steps without the time rule. Used by "only tell me" (which says the time in a
 * line of its own) and by decide() below. It is NOT the decision of a real run.
 */
export function decideApartFromTime(f) {
  return checkSetup(f) || checkChange(f) || checkCi(f) || { action: "deploy", code: "deploy", line: deployLine(f) };
}

/**
 * PURE — the whole decision from all the facts at once (the time rule, then the three steps).
 * → { action: "deploy" | "skip" | "stop", code, line }
 *    deploy = call the hook · skip = end green with this one line · stop = end red, nothing deployed
 */
export function decide(f) {
  return checkWindow(f) || decideApartFromTime(f);
}
