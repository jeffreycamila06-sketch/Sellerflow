// Nightly Render deploy — the RUN. Collects the facts, asks decide.mjs, and acts.
//   node scripts/nightly-deploy/run.mjs      (started by .github/workflows/nightly-render-deploy.yml)
//
// What it does, in order, stopping at the first answer:
//   1. setup    on main? the hook secret set? paused?                (nothing is read from GitHub)
//   2. change   the tag "render-deployed" (GitHub) + the files that differ from it (git)
//   3. CI       the CI run of that exact commit (GitHub)
//   4. deploy   ONE call to the Render Deploy Hook for that exact commit, then the tag is moved.
//               It does not wait for Render.
//
// HARD RULES
//   • The hook address is never printed, never put in an error, and nothing Render answers is read
//     or printed — only the HTTP status number.
//   • Every printed line is a fixed sentence from decide.mjs or from this file. An error object is
//     never printed (it can hold an address).
//   • The GitHub token goes to the GitHub API only; the hook goes to api.render.com only.
//   • No packages: Node's own fetch, fs and child_process.
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  DEPLOY_BRANCH, DEPLOYED_TAG, CI_WORKFLOW, HOOK_SECRET, PAUSE_VARIABLE,
  checkSetup, checkChange, checkCi, decide, deployLine, ciState, hookState, pauseState, taipeiDay, fullSha, sha7, serverFilesIn,
} from "./decide.mjs";

export const HOOK_TIMEOUT_MS = 30 * 1000;
export const GITHUB_TIMEOUT_MS = 20 * 1000;
const NOTHING = "Nothing was deployed.";

/** A stop with words that are safe to print. Anything else that is thrown is printed as "unexpected". */
export class Stop extends Error {
  constructor(code, line) { super(code); this.name = "Stop"; this.code = code; this.line = line; }
}

// ── git (read only) ──────────────────────────────────────────────────────────────────────────────
function execGit(args, cwd) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      resolve({ ok: !error, out: String(stdout ?? "") });
    });
  });
}
/** The three git questions the run asks. `exec` is injectable for the tests. */
export function createGit({ cwd = process.cwd(), exec = execGit } = {}) {
  return {
    /** the newest commit of the deploy branch as GitHub has it → full sha or "" */
    async headOfMain() {
      const r = await exec(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${DEPLOY_BRANCH}^{commit}`], cwd);
      return r.ok ? fullSha(r.out) : "";
    },
    /** is this commit in the clone? */
    async hasCommit(sha) {
      if (!fullSha(sha)) return false;
      return (await exec(["cat-file", "-e", `${fullSha(sha)}^{commit}`], cwd)).ok;
    },
    /** the files that differ between two commits (a rename = the old and the new name) → list, or null */
    async changedFiles(from, to) {
      if (!fullSha(from) || !fullSha(to)) return null;
      const r = await exec(["diff", "--name-only", "--no-renames", "-z", fullSha(from), fullSha(to)], cwd);
      return r.ok ? r.out.split("\0").filter(Boolean) : null;
    },
  };
}

// ── GitHub API (the tag, the CI result) ──────────────────────────────────────────────────────────
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export function createGithub({ token, repo, apiUrl = "https://api.github.com", fetchImpl = fetch, timeoutMs = GITHUB_TIMEOUT_MS }) {
  const base = String(apiUrl || "").replace(/\/+$/, "");
  const usable = Boolean(String(token || "").trim()) && REPO_RE.test(String(repo || "")) && /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9/_.-]*)?$/.test(base);
  /** → { status, json } ; never throws (status 0 = no answer) */
  async function call(method, path, body) {
    if (!usable) return { status: 0, json: null };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/repos/${repo}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${String(token).trim()}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "sellerflow-nightly-render-deploy",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: ctl.signal,
      });
      const status = Number(res && res.status) || 0;
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { status, json };
    } catch {
      return { status: 0, json: null };
    } finally { clearTimeout(timer); }
  }
  const tagRef = `refs/tags/${DEPLOYED_TAG}`;
  return {
    usable: () => usable,
    /** The tag → { exists, sha } ("" when it does not point straight at a commit). Stops on any other answer. */
    async readTag() {
      const r = await call("GET", `/git/ref/tags/${DEPLOYED_TAG}`);
      if (r.status === 404) return { exists: false, sha: "" };
      if (r.status !== 200 || !r.json || r.json.ref !== tagRef) throw new Stop("tag_read", `Stopped: GitHub did not answer the question about the tag ${DEPLOYED_TAG} (answer ${r.status}). ${NOTHING}`);
      const obj = r.json.object || {};
      return { exists: true, sha: obj.type === "commit" ? fullSha(obj.sha) : "" };
    },
    /** GitHub's runs of the CI workflow for one commit. Stops when GitHub does not answer. */
    async ciRuns(sha) {
      const r = await call("GET", `/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${fullSha(sha)}&branch=${DEPLOY_BRANCH}&per_page=50`);
      if (r.status !== 200 || !r.json || !Array.isArray(r.json.workflow_runs)) throw new Stop("ci_read", `Stopped: GitHub did not answer the question about the CI result (answer ${r.status}). ${NOTHING}`);
      return r.json.workflow_runs;
    },
    /** Point the tag at a commit (make it when it is not there). → true | false ; never throws */
    async moveTag(sha, existed) {
      const full = fullSha(sha);
      if (!full) return false;
      const update = () => call("PATCH", `/git/refs/tags/${DEPLOYED_TAG}`, { sha: full, force: true });
      const create = () => call("POST", "/git/refs", { ref: tagRef, sha: full });
      const first = await (existed ? update() : create());
      if (first.status === 200 || first.status === 201) return true;
      if (first.status !== 404 && first.status !== 422) return false;
      const second = await (existed ? create() : update());     // it appeared / went away in between
      return second.status === 200 || second.status === 201;
    },
  };
}

// ── The Render Deploy Hook ───────────────────────────────────────────────────────────────────────
/**
 * ONE request to the hook, asking Render to deploy exactly `sha` (Render's "ref" parameter).
 * → { status }  (0 = no answer; then `word` is "timeout" or "network"). Never throws, reads no body.
 */
export async function callRenderHook(rawUrl, sha, { fetchImpl = fetch, timeoutMs = HOOK_TIMEOUT_MS } = {}) {
  if (hookState(rawUrl) !== "set" || !fullSha(sha)) return { status: 0, word: "refused" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const url = new URL(String(rawUrl).trim());
    url.searchParams.set("ref", fullSha(sha));
    const res = await fetchImpl(url.toString(), { method: "POST", redirect: "manual", signal: ctl.signal });
    const status = Number(res && res.status) || 0;
    try { await res.body?.cancel?.(); } catch { /* the body is never read */ }
    return { status, word: status ? "" : "network" };
  } catch {
    return { status: 0, word: ctl.signal.aborted ? "timeout" : "network" };
  } finally { clearTimeout(timer); }
}

// ── The run ──────────────────────────────────────────────────────────────────────────────────────
const yes = (v) => ["1", "true", "yes"].includes(String(v ?? "").trim().toLowerCase());

/**
 * deps: env, git (createGit), github (createGithub), hook(rawUrl, sha) → { status, word }, say(line), now()
 * → { exitCode: 0 | 1, action, code }
 */
export async function runNightlyDeploy({ env = process.env, git, github, hook = callRenderHook, say = console.log, now = Date.now } = {}) {
  const dryRun = yes(env.NIGHTLY_DEPLOY_DRY_RUN);
  const event = String(env.GITHUB_EVENT_NAME || "");
  const rawHook = env[HOOK_SECRET];
  const pauseRaw = String(env[PAUSE_VARIABLE] ?? "").trim();
  const setup = {
    // "What would happen" may be asked from any branch; a real run only from the deploy branch.
    onMain: dryRun || env.GITHUB_REF === `refs/heads/${DEPLOY_BRANCH}`,
    // "What would happen" answers for the nightly run, so the pause is looked at too.
    event: dryRun ? "schedule" : event,
    hook: hookState(rawHook),
    pause: pauseState(pauseRaw, taipeiDay(now())),
    pauseUntil: pauseRaw,
  };
  const end = (r) => {
    say(r.line);
    return { exitCode: r.action === "stop" ? 1 : 0, action: r.action, code: r.code };
  };
  let hookCalled = false;
  try {
    if (dryRun) return await tellOnly({ setup, git, github, say });

    const early = checkSetup(setup);
    if (early) return end(early);

    const headSha = await git.headOfMain();
    const tag = await github.readTag();
    const known = tag.sha && (await git.hasCommit(tag.sha));
    const facts = { ...setup, headSha, deployedSha: tag.sha, changed: known ? await git.changedFiles(tag.sha, headSha) : null };
    const same = checkChange(facts);
    if (same) return end(same);

    facts.ci = ciState(await github.ciRuns(headSha), headSha);
    const wait = checkCi(facts);
    if (wait) return end(wait);

    say(deployLine(facts));
    const answer = await hook(rawHook, headSha);
    const status = Number(answer && answer.status) || 0;
    if (status < 200 || status >= 300) {
      const what = status ? `Render answered ${status} to the Deploy Hook` : `Render did not answer the Deploy Hook (${answer && answer.word === "timeout" ? "no answer in 30 seconds" : "no connection"})`;
      const hint = status === 401 || status === 404 ? ` The hook may have been changed in Render: copy it again into the secret ${HOOK_SECRET}.` : "";
      return end({ action: "stop", code: status ? `hook_${status}` : "hook_no_answer", line: `Stopped: ${what}.${hint} The commit was not noted, so the next run tries again.` });
    }
    hookCalled = true;
    say(`Render accepted the deploy of ${sha7(headSha)} (answer ${status}). Render now builds it and restarts the server by itself; this run does not wait for it.`);
    const noted = await github.moveTag(headSha, tag.exists);
    if (!noted) {
      return end({ action: "stop", code: "tag_write", line: `Stopped: Render accepted the deploy, but the tag ${DEPLOYED_TAG} could not be moved. The next run will deploy this commit once more.` });
    }
    say(`Noted ${sha7(headSha)} as the last deployed commit (tag ${DEPLOYED_TAG}).`);
    return { exitCode: 0, action: "deploy", code: "deploy" };
  } catch (e) {
    if (e instanceof Stop) return end({ action: "stop", code: e.code, line: e.line });
    // Never print the error itself: it can hold an address.
    return end({ action: "stop", code: "unexpected", line: hookCalled
      ? `Stopped: something unexpected happened after Render accepted the deploy. The commit was not noted, so the next run deploys it once more.`
      : `Stopped: something unexpected happened. ${NOTHING}` });
  }
}

/** "Only tell me what would happen": reads everything, calls nothing, notes nothing. */
async function tellOnly({ setup, git, github, say }) {
  say("Only telling what would happen: the Deploy Hook is not called and nothing is noted.");
  const facts = { ...setup, headSha: "", deployedSha: "", changed: null, ci: { state: "unknown", word: "" } };
  const read = { tag: "not read", ci: "not read" };
  try { facts.headSha = await git.headOfMain(); } catch { facts.headSha = ""; }
  let tag = { exists: false, sha: "" };
  try { tag = await github.readTag(); read.tag = tag.exists ? (tag.sha ? sha7(tag.sha) : "not a commit") : "none yet"; } catch { read.tag = "GitHub did not answer"; }
  facts.deployedSha = tag.sha;
  try {
    if (tag.sha && (await git.hasCommit(tag.sha))) facts.changed = await git.changedFiles(tag.sha, facts.headSha);
  } catch { facts.changed = null; }
  try {
    if (facts.headSha) { facts.ci = ciState(await github.ciRuns(facts.headSha), facts.headSha); read.ci = facts.ci.state; }
  } catch { read.ci = "GitHub did not answer"; }
  const changed = Array.isArray(facts.changed) ? `${facts.changed.length} changed, ${serverFilesIn(facts.changed).length} of the server` : "not known";
  say(`Facts: ${DEPLOY_BRANCH} is at ${sha7(facts.headSha) || "?"} · last deployed: ${read.tag} · files: ${changed} · CI: ${read.ci} · hook: ${setup.hook} · pause: ${setup.pause}.`);
  const r = decide(facts);
  say(r.action === "deploy" ? `It would deploy. ${r.line}` : `It would not deploy. ${r.line}`);
  return { exitCode: 0, action: "tell", code: r.code };
}

// ── Started by the workflow ──────────────────────────────────────────────────────────────────────
/** One line to the log and to the run's summary page. */
export function createSay({ env = process.env, log = console.log, append = appendFileSync } = {}) {
  return (line) => {
    const text = String(line);
    try { log(text); } catch { /* a log never stops the run */ }
    const file = env.GITHUB_STEP_SUMMARY;
    if (file) { try { append(file, `${text}\n\n`); } catch { /* the summary is extra */ } }
  };
}

async function main() {
  const env = process.env;
  const say = createSay({ env });
  let result;
  try {
    result = await runNightlyDeploy({
      env,
      git: createGit(),
      github: createGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, apiUrl: env.GITHUB_API_URL || "https://api.github.com" }),
      say,
    });
  } catch {
    say(`Stopped: something unexpected happened. ${NOTHING}`);
    result = { exitCode: 1 };
  }
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
