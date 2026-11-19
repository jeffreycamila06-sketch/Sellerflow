// @vitest-environment node
// Nightly Render deploy — the DECISION (scripts/nightly-deploy/decide.mjs, Jeff 2026-11-18).
// The hook is called ONLY when: server code changed since the last deployed commit, the CI run of
// that exact main commit finished and passed, and the hook secret is set. Everything else = one line.
// The time rule (Jeff 2026-11-19, D8–D10): a run not started by hand may deploy ONLY 03:30–05:30 Asia/Taipei.
import { describe, it, expect } from "vitest";
import {
  decide, decideApartFromTime, checkWindow, windowLine, checkSetup, checkChange, checkCi, deployLine, ciState, hookState, pauseState, taipeiDay,
  taipeiClock, taipeiMinuteOfDay, inDeployWindow, plannedClock, isServerPath, serverFilesIn,
  nameList, fullSha, sha7, SERVER_FILES, SERVER_DIRS, CI_WORDS, DEPLOY_BRANCH, DEPLOYED_TAG, CI_WORKFLOW, HOOK_SECRET, PAUSE_VARIABLE, HOOK_HOST,
  WINDOW_FROM_MIN, WINDOW_TO_MIN, WINDOW_FROM, WINDOW_TO, BY_HAND_EVENT,
} from "../../../../scripts/nightly-deploy/decide.mjs";

const HEAD = "16b4bb93aaaabbbbccccddddeeeeffff00001111";
const OLD = "0cc49da3aaaabbbbccccddddeeeeffff00002222";
const HOOK = "https://api.render.com/deploy/srv-abc123DEF?key=MARKKEYzzzz9999";
type Facts = Parameters<typeof decide>[0];
/** A moment on 20 November 2026 in Taipei, written as a Taipei wall-clock time ("04:05" or "05:30:59"). */
const taipei = (clock: string, day = "2026-11-20") => Date.parse(`${day}T${clock.length === 5 ? `${clock}:00` : clock}+08:00`);
// A night on which everything says "deploy" (a scheduled run that started at 04:05): each test changes ONE thing.
const deployNight = (over: Record<string, unknown> = {}): Facts => ({
  onMain: true, event: "schedule", hook: "set", pause: "off", pauseUntil: "",
  headSha: HEAD, deployedSha: OLD, changed: ["server/pc711Duty.js", "src/redesign/screens/Admin.tsx"],
  ci: { state: "passed", word: "" }, nowMs: taipei("04:05"), planned: "", ...over,
});

describe("D1 the five cases Jeff listed", () => {
  it("nothing new → skip", () => {
    const r = decide(deployNight({ deployedSha: HEAD, changed: [] }));
    expect(r).toMatchObject({ action: "skip", code: "nothing_new" });
    expect(r.line).toBe("Skipped: nothing new on main since the last deploy (16b4bb9).");
  });
  it("web-only change → skip", () => {
    const r = decide(deployNight({ changed: ["src/redesign/screens/Admin.tsx", "docs/support/sfl-guide.md", "sql/116b_guide_seed.sql"] }));
    expect(r).toMatchObject({ action: "skip", code: "web_only" });
    expect(r.line).toBe("Skipped: 3 files changed since the last deploy (0cc49da), none of them is server code.");
  });
  it("server change with CI green → deploy", () => {
    const r = decide(deployNight());
    expect(r).toMatchObject({ action: "deploy", code: "deploy" });
    expect(r.line).toBe("Deploying 16b4bb9: 1 file of the server changed since 0cc49da (server/pc711Duty.js), and CI passed.");
  });
  it("CI red → skip", () => {
    const r = decide(deployNight({ ci: { state: "failed", word: "failure" } }));
    expect(r).toMatchObject({ action: "skip", code: "ci_failed" });
    expect(r.line).toBe("Skipped: CI did not pass for 16b4bb9 (failure). The server code was not deployed.");
  });
  it("CI still running → skip", () => {
    const r = decide(deployNight({ ci: { state: "running", word: "" } }));
    expect(r).toMatchObject({ action: "skip", code: "ci_running" });
    expect(r.line).toBe("Skipped: CI is still running for 16b4bb9. The next run tries again.");
  });
  it("secret missing → skip", () => {
    const r = decide(deployNight({ hook: "missing" }));
    expect(r).toMatchObject({ action: "skip", code: "no_hook" });
    expect(r.line).toBe("Skipped: the Render Deploy Hook is not saved yet (repository secret RENDER_DEPLOY_HOOK_URL).");
  });
});

describe("D2 only ALL THREE together deploy", () => {
  const hooks = ["set", "missing", "bad"];
  const cis = [{ state: "passed" }, { state: "running" }, { state: "failed", word: "failure" }, { state: "none" }, { state: "unknown" }, null, undefined];
  const changes: Array<{ name: string; deployedSha: string | null; changed: string[] | null; server: boolean }> = [
    { name: "same commit", deployedSha: HEAD, changed: [], server: false },
    { name: "web only", deployedSha: OLD, changed: ["src/App.tsx"], server: false },
    { name: "no file differs", deployedSha: OLD, changed: [], server: false },
    { name: "server file", deployedSha: OLD, changed: ["src/App.tsx", "server.js"], server: true },
    { name: "package-lock", deployedSha: OLD, changed: ["package-lock.json"], server: true },
    { name: "nothing noted yet", deployedSha: "", changed: null, server: true },
    { name: "difference unknown", deployedSha: OLD, changed: null, server: true },
  ];
  it("the whole table: deploy ⇔ hook set AND the server may differ AND CI passed", () => {
    let deploys = 0;
    let rows = 0;
    for (const hook of hooks) for (const ci of cis) for (const c of changes) {
      rows += 1;
      const r = decide(deployNight({ hook, ci, deployedSha: c.deployedSha, changed: c.changed }));
      const want = hook === "set" && c.server && ci?.state === "passed";
      expect(r.action === "deploy", `${hook} / ${JSON.stringify(ci)} / ${c.name}`).toBe(want);
      if (want) deploys += 1;
      expect(typeof r.line === "string" && r.line.length > 10).toBe(true);
    }
    expect(rows).toBe(3 * 7 * 7);
    expect(deploys).toBe(4);   // hook set × CI passed × the 4 rows where the server may differ — and no other row
  });
});

describe("D3 the setup step: branch, hook, pause", () => {
  it("not on main → skip, whatever else is true", () => {
    expect(decide(deployNight({ onMain: false }))).toMatchObject({ action: "skip", code: "not_main" });
    expect(decide(deployNight({ onMain: undefined }))).toMatchObject({ action: "skip", code: "not_main" });
    expect(decide(deployNight({ onMain: "true" }))).toMatchObject({ action: "skip", code: "not_main" });
  });
  it("a secret that is not a Render Deploy Hook → STOP (red), nothing deployed, and the line holds no part of it", () => {
    const r = decide(deployNight({ hook: "bad" }));
    expect(r).toMatchObject({ action: "stop", code: "bad_hook" });
    expect(r.line).toBe("Stopped: the saved secret RENDER_DEPLOY_HOOK_URL is not a Render Deploy Hook address. Copy it again from Render. Nothing was deployed.");
  });
  it("hookState: empty = missing; only https://api.render.com/deploy/srv-…?key=… is set; anything else is bad", () => {
    for (const v of [undefined, null, "", "   ", "\n"]) expect(hookState(v)).toBe("missing");
    expect(hookState(HOOK)).toBe("set");
    expect(hookState(`  ${HOOK}\n`)).toBe("set");
    for (const v of [
      "not a url", "http://api.render.com/deploy/srv-abc?key=k", "https://render.com/deploy/srv-abc?key=k",
      "https://api.render.com.evil.example/deploy/srv-abc?key=k", "https://evil.example/?x=https://api.render.com/deploy/srv-abc?key=k",
      "https://api.render.com/deploy/srv-abc", "https://api.render.com/deploy/srv-abc?key=", "https://api.render.com/other/srv-abc?key=k",
      "https://api.render.com/deploy/srv-abc/extra?key=k", "https://user:pw@api.render.com/deploy/srv-abc?key=k", "https://api.render.com:8443/deploy/srv-abc?key=k",
    ]) expect(hookState(v), v).toBe("bad");
    expect(HOOK_HOST).toBe("api.render.com");
  });
  it("the pause: on = skip the NIGHTLY run; a run started by hand ignores it", () => {
    const night = decide(deployNight({ pause: "on", pauseUntil: "2026-11-20" }));
    expect(night).toMatchObject({ action: "skip", code: "paused" });
    expect(night.line).toBe("Skipped: the nightly deploy is paused until 2026-11-20 (variable NIGHTLY_DEPLOY_PAUSE_UNTIL).");
    expect(decide(deployNight({ event: "workflow_dispatch", pause: "on", pauseUntil: "2026-11-20" })).action).toBe("deploy");
    expect(decide(deployNight({ pause: "over", pauseUntil: "2026-11-01" })).action).toBe("deploy");
  });
  it("a pause value that is not a date → STOP on the nightly run (never a deploy against Jeff's wish), and it is not printed", () => {
    const r = decide(deployNight({ pause: "bad", pauseUntil: "Nov 20 <script>" }));
    expect(r).toMatchObject({ action: "stop", code: "bad_pause" });
    expect(r.line).not.toContain("Nov 20");
    expect(decide(deployNight({ event: "workflow_dispatch", pause: "bad", pauseUntil: "x" })).action).toBe("deploy");
  });
  it("pauseState: the day itself is still paused; the day after works again by itself", () => {
    expect(pauseState("", "2026-11-19")).toBe("off");
    expect(pauseState("  ", "2026-11-19")).toBe("off");
    expect(pauseState("2026-11-20", "2026-11-19")).toBe("on");
    expect(pauseState("2026-11-20", "2026-11-20")).toBe("on");
    expect(pauseState(" 2026-11-20 ", "2026-11-20")).toBe("on");
    expect(pauseState("2026-11-20", "2026-11-21")).toBe("over");
    for (const bad of ["tomorrow", "20-11-2026", "2026-13-01", "2026-02-30", "2026-11-20T04:00", "2026/11/20"]) expect(pauseState(bad, "2026-11-19"), bad).toBe("bad");
    expect(pauseState("2026-11-20", "")).toBe("bad");
  });
  it("taipeiDay: 04:00 in Taipei is 20:00 UTC of the day before", () => {
    expect(taipeiDay(Date.parse("2026-11-19T20:00:00Z"))).toBe("2026-11-20");
    expect(taipeiDay(Date.parse("2026-11-19T15:59:59Z"))).toBe("2026-11-19");
    expect(taipeiDay(Date.parse("2026-11-19T16:00:00Z"))).toBe("2026-11-20");
  });
  it("the order: the time, then the branch, then the secret, then the pause, then the change, then CI", () => {
    expect(decide(deployNight({ nowMs: taipei("09:50"), onMain: false, hook: "missing" })).code).toBe("outside_window");
    expect(decide(deployNight({ onMain: false, hook: "missing" })).code).toBe("not_main");
    expect(decide(deployNight({ hook: "missing", pause: "on", deployedSha: HEAD })).code).toBe("no_hook");
    expect(decide(deployNight({ pause: "on", deployedSha: HEAD })).code).toBe("paused");
    expect(decide(deployNight({ deployedSha: HEAD, ci: { state: "failed", word: "failure" } })).code).toBe("nothing_new");
    expect(decide(deployNight({ changed: ["README.md"], ci: { state: "running" } })).code).toBe("web_only");
  });
});

describe("D4 what counts as server code", () => {
  it("Jeff's list + what the server really loads", () => {
    for (const p of ["server.js", "server/pc711Duty.js", "server/fonts/NotoSans.ttf", "server/a/b/c.js", "package.json", "package-lock.json",
      "src/lib/errCodes.js", "src/lib/helpBotGuard.js", "src/lib/receiptLayout.js", "render.yaml", ".node-version", ".nvmrc", ".npmrc"]) expect(isServerPath(p), p).toBe(true);
  });
  it("everything else never deploys", () => {
    for (const p of ["", "server", "server/", "serverless.js", "src/server.js", "docs/server.js", "x/server/a.js", "src/redesign/screens/Admin.tsx", "src/lib/planWindow.ts",
      "src/lib/errCodes.ts", "src/lib/__tests__/errCodes.test.ts", "docs/support/sfl-guide.md", "sql/179_pc711_backup.sql", "chrome-extension/background.js",
      "mobile/package.json", "e2e/smoke/package.json", "e2e/smoke/package-lock.json", "api/geo.ts", "supabase/functions/admin-delete-user/index.ts",
      ".github/workflows/nightly-render-deploy.yml", ".github/workflows/ci.yml", "scripts/nightly-deploy/decide.mjs", "scripts/nightly-deploy/run.mjs", "CLAUDE.md",
      "Server.js", "SERVER/x.js", "package.json.bak", "public/native-version.json", "vercel.json"]) expect(isServerPath(p), p).toBe(false);
    expect(isServerPath(null)).toBe(false);
    expect(isServerPath(undefined)).toBe(false);
  });
  it("the lists themselves (a change here is a change of what deploys)", () => {
    expect(SERVER_DIRS).toEqual(["server/"]);
    expect(SERVER_FILES).toEqual(["server.js", "package.json", "package-lock.json", "src/lib/errCodes.js", "src/lib/helpBotGuard.js", "src/lib/receiptLayout.js",
      "render.yaml", ".node-version", ".nvmrc", ".npmrc"]);
  });
  it("serverFilesIn keeps the order, drops doubles and everything that is not a list", () => {
    expect(serverFilesIn(["a.md", "server.js", "server/x.js", "server.js"])).toEqual(["server.js", "server/x.js"]);
    expect(serverFilesIn(null)).toEqual([]);
    expect(serverFilesIn("server.js")).toEqual([]);
  });
  it("ONE server file among 500 app files is enough; a deleted or renamed server file counts", () => {
    const many = Array.from({ length: 500 }, (_, i) => `src/redesign/f${i}.tsx`);
    expect(decide(deployNight({ changed: [...many, "server/sanitize.js"] })).action).toBe("deploy");
    expect(decide(deployNight({ changed: many })).code).toBe("web_only");
    expect(decide(deployNight({ changed: ["server/old.js", "tools/old.js"] })).action).toBe("deploy");   // moved out of server/: old + new name
  });
});

describe("D5 the change step", () => {
  it("nothing noted yet (first run) → go on to CI; the deploy line says so", () => {
    expect(checkChange({ headSha: HEAD, deployedSha: "", changed: null })).toBeNull();
    expect(checkChange({ headSha: HEAD, deployedSha: null, changed: null })).toBeNull();
    expect(decide(deployNight({ deployedSha: "", changed: null })).line).toBe("Deploying 16b4bb9: no nightly deploy is noted yet, and CI passed.");
    expect(decide(deployNight({ deployedSha: "", changed: null, ci: { state: "running" } })).code).toBe("ci_running");
  });
  it("the last deployed commit is gone from the repository → treated as changed (CI still decides)", () => {
    expect(checkChange({ headSha: HEAD, deployedSha: OLD, changed: null })).toBeNull();
    expect(decide(deployNight({ changed: null })).line).toBe("Deploying 16b4bb9: the last deployed commit (0cc49da) is not in the repository any more, and CI passed.");
  });
  it("a newest commit that cannot be read → STOP, never a deploy", () => {
    for (const bad of ["", null, undefined, "16b4bb9", "zzzz", `${HEAD}0`]) expect(decide(deployNight({ headSha: bad })), String(bad)).toMatchObject({ action: "stop", code: "no_head" });
  });
  it("a noted commit that is not a full commit id counts as 'nothing noted'", () => {
    expect(checkChange({ headSha: HEAD, deployedSha: "0cc49da", changed: ["README.md"] })).toBeNull();
  });
  it("1 file is said as '1 file'", () => {
    expect(decide(deployNight({ changed: ["README.md"] })).line).toBe("Skipped: 1 file changed since the last deploy (0cc49da), none of them is server code.");
  });
  it("the deploy line shows at most 3 server files, and no name that is not plain", () => {
    const five = ["server.js", "server/a.js", "server/b.js", "server/c.js", "package.json"];
    expect(deployLine(deployNight({ changed: five }))).toBe("Deploying 16b4bb9: 5 files of the server changed since 0cc49da (server.js, server/a.js, server/b.js (+2 more)), and CI passed.");
    expect(nameList(["server/ok.js", "server/has space.js", "server/<b>.js"])).toBe("server/ok.js (+2 more)");
    expect(nameList(["server/has space.js"])).toBe("(+1 more)");
    expect(nameList([])).toBe("");
  });
});

describe("D6 the CI step: only 'finished and passed' deploys", () => {
  const run = (over: Record<string, unknown>) => ({ head_sha: HEAD, head_branch: "main", status: "completed", conclusion: "success", run_number: 1845, run_attempt: 1, ...over });
  it("passed", () => {
    expect(ciState([run({})], HEAD)).toEqual({ state: "passed", word: "" });
  });
  it("still running: queued / in_progress / waiting / requested / pending", () => {
    for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) expect(ciState([run({ status, conclusion: null })], HEAD).state, status).toBe("running");
  });
  it("finished but not success: every other conclusion is 'failed'", () => {
    for (const conclusion of [...CI_WORDS, null, "weird", ""]) {
      const r = ciState([run({ conclusion })], HEAD);
      expect(r.state, String(conclusion)).toBe("failed");
      expect(r.word).toBe(CI_WORDS.includes(conclusion as string) ? conclusion : "");
    }
  });
  it("no run of THAT commit on main → none (a run of another commit, or of the same commit on another branch, does not count)", () => {
    expect(ciState([], HEAD).state).toBe("none");
    expect(ciState(null, HEAD).state).toBe("none");
    expect(ciState([run({ head_sha: OLD })], HEAD).state).toBe("none");
    expect(ciState([run({ head_branch: "claude/some-branch" })], HEAD).state).toBe("none");
    expect(ciState([run({})], "").state).toBe("none");
    expect(ciState([run({})], "16b4bb9").state).toBe("none");
  });
  it("several runs of the commit: the newest decides (a green older run does not hide a red newer one)", () => {
    expect(ciState([run({ run_number: 10, conclusion: "success" }), run({ run_number: 11, conclusion: "failure" })], HEAD).state).toBe("failed");
    expect(ciState([run({ run_number: 11, conclusion: "failure" }), run({ run_number: 10, conclusion: "success" })], HEAD).state).toBe("failed");
    expect(ciState([run({ run_number: 10, conclusion: "failure" }), run({ run_number: 11, conclusion: "success" })], HEAD).state).toBe("passed");
    expect(ciState([run({ run_number: 10 }), run({ run_number: 11, status: "in_progress", conclusion: null })], HEAD).state).toBe("running");
    expect(ciState([run({ run_number: 10, run_attempt: 1, conclusion: "failure" }), run({ run_number: 10, run_attempt: 2 })], HEAD).state).toBe("passed");
  });
  it("the lines; a conclusion that is not a known word is never printed", () => {
    expect(checkCi({ headSha: HEAD, ci: { state: "passed" } })).toBeNull();
    expect(checkCi({ headSha: HEAD, ci: { state: "none" } })?.line).toBe("Skipped: CI has no finished run for 16b4bb9 yet. The next run tries again.");
    expect(checkCi({ headSha: HEAD, ci: { state: "failed", word: "timed_out" } })?.line).toBe("Skipped: CI did not pass for 16b4bb9 (timed_out). The server code was not deployed.");
    expect(checkCi({ headSha: HEAD, ci: { state: "failed", word: "<img src=x>" } })?.line).toBe("Skipped: CI did not pass for 16b4bb9. The server code was not deployed.");
    for (const ci of [undefined, null, {}, { state: "PASSED" }, { state: "success" }, { state: true }, "passed"]) {
      expect(checkCi({ headSha: HEAD, ci }), JSON.stringify(ci)).toMatchObject({ action: "skip", code: "ci_unknown" });
    }
  });
});

describe("D7 the names everything hangs on", () => {
  it("branch, tag, CI file, secret, variable", () => {
    expect([DEPLOY_BRANCH, DEPLOYED_TAG, CI_WORKFLOW, HOOK_SECRET, PAUSE_VARIABLE]).toEqual(["main", "render-deployed", "ci.yml", "RENDER_DEPLOY_HOOK_URL", "NIGHTLY_DEPLOY_PAUSE_UNTIL"]);
  });
  it("fullSha / sha7", () => {
    expect(fullSha(` ${HEAD.toUpperCase()}\n`)).toBe(HEAD);
    expect(sha7(HEAD)).toBe("16b4bb9");
    for (const bad of ["", "16b4bb9", null, undefined, 12345, `${HEAD}a`, HEAD.replace("1", "g")]) expect(fullSha(bad)).toBe("");
  });
  it("checkSetup lets a good setup through", () => {
    expect(checkSetup({ onMain: true, event: "schedule", hook: "set", pause: "off" })).toBeNull();
    expect(checkSetup({ onMain: true, event: "workflow_dispatch", hook: "set", pause: "off" })).toBeNull();
  });
  it("no line ever holds the hook, whatever is passed in", () => {
    const hooks = [HOOK, "MARKKEYzzzz9999"];
    for (const hook of ["set", "missing", "bad", HOOK]) for (const pauseUntil of ["", HOOK]) {
      const r = decide(deployNight({ hook, pauseUntil, pause: "on" }));
      for (const h of hooks) expect(r.line).not.toContain(h);
    }
  });
});

// ── The time rule (Jeff, 2026-11-19) ─────────────────────────────────────────────────────────────
// The finding: the scheduled run for 04:00 Taipei on 19 November started at 09:50 Taipei (01:50:14 UTC).
// With the secret saved it would have restarted the server in the morning, with sellers live.
const FOUND = Date.parse("2026-11-19T01:50:14Z");
const RULE = "A scheduled run deploys only between 03:30 and 05:30 Taiwan time.";
const outsideLine = (at: string, plan = "") =>
  `Skipped: this run started at ${at} Taiwan time${plan ? ` (GitHub had it planned for ${plan})` : ""}. ${RULE} Nothing was deployed; the next scheduled run inside that window tries again.`;

describe("D8 the time window: a scheduled run may deploy ONLY 03:30–05:30 Asia/Taipei", () => {
  it("the five times Jeff listed: 03:29 skip · 03:30 deploy · 05:30 deploy · 05:31 skip · 09:50 skip", () => {
    const at = (clock: string) => decide(deployNight({ nowMs: taipei(clock) }));
    expect(at("03:29")).toEqual({ action: "skip", code: "outside_window", line: outsideLine("03:29") });
    expect(at("03:30")).toMatchObject({ action: "deploy", code: "deploy" });
    expect(at("05:30")).toMatchObject({ action: "deploy", code: "deploy" });
    expect(at("05:31")).toEqual({ action: "skip", code: "outside_window", line: outsideLine("05:31") });
    expect(at("09:50")).toEqual({ action: "skip", code: "outside_window", line: outsideLine("09:50") });
  });
  it("the run that was found: 01:50:14 UTC on 19 November = 09:50 Taipei → skip, and the line says the time and the window", () => {
    const r = decide(deployNight({ nowMs: FOUND, planned: "0 20 * * *" }));
    expect(r.action).toBe("skip");
    expect(r.line).toBe("Skipped: this run started at 09:50 Taiwan time (GitHub had it planned for 04:00). A scheduled run deploys only between 03:30 and 05:30 Taiwan time. Nothing was deployed; the next scheduled run inside that window tries again.");
  });
  it("read to the minute, both ends included: 03:29:59 out · 03:30:00 in · 05:30:59 in · 05:31:00 out", () => {
    for (const [clock, inside] of [["03:29:59", false], ["03:30:00", true], ["03:30:01", true], ["04:00:00", true], ["05:29:59", true], ["05:30:00", true], ["05:30:59", true], ["05:31:00", false]] as Array<[string, boolean]>) {
      expect(inDeployWindow(taipei(clock)), clock).toBe(inside);
      expect(decide(deployNight({ nowMs: taipei(clock) })).action, clock).toBe(inside ? "deploy" : "skip");
    }
    expect(inDeployWindow(taipei("03:30:00") - 1)).toBe(false);      // one millisecond before 03:30
    expect(inDeployWindow(taipei("05:31:00") - 1)).toBe(true);       // the last millisecond of 05:30
  });
  it("EVERY minute of the day: deploy ⇔ 03:30 … 05:30 — 121 minutes, and no other", () => {
    const allowed: number[] = [];
    for (let m = 0; m < 24 * 60; m++) {
      const ms = taipei("00:00") + m * 60000;
      const r = decide(deployNight({ nowMs: ms }));
      expect(taipeiMinuteOfDay(ms)).toBe(m);
      expect(r.action === "deploy", `minute ${m}`).toBe(m >= 210 && m <= 330);
      if (r.action === "deploy") allowed.push(m);
      else expect(r).toMatchObject({ action: "skip", code: "outside_window" });
    }
    expect([allowed[0], allowed.at(-1), allowed.length]).toEqual([210, 330, 121]);
    expect([WINDOW_FROM_MIN, WINDOW_TO_MIN, WINDOW_FROM, WINDOW_TO]).toEqual([210, 330, "03:30", "05:30"]);
  });
  it("the same window every day of the year (Taiwan has no summer time), also when the UTC day differs", () => {
    for (const day of ["2026-01-01", "2026-03-29", "2026-06-30", "2026-10-25", "2026-12-31", "2028-02-29"]) {
      expect(decide(deployNight({ nowMs: taipei("03:29", day) })).code, day).toBe("outside_window");
      expect(decide(deployNight({ nowMs: taipei("03:30", day) })).action, day).toBe("deploy");
      expect(decide(deployNight({ nowMs: taipei("05:30", day) })).action, day).toBe("deploy");
      expect(decide(deployNight({ nowMs: taipei("05:31", day) })).code, day).toBe("outside_window");
    }
    // 04:00 in Taipei is 20:00 UTC of the day BEFORE; 09:50 in Taipei is 01:50 UTC of the same day
    expect(taipeiClock(Date.parse("2026-11-18T20:00:00Z"))).toBe("04:00");
    expect(taipeiClock(Date.parse("2026-11-19T01:50:00Z"))).toBe("09:50");
    expect(taipeiClock(Date.parse("2026-11-18T16:00:00Z"))).toBe("00:00");
    expect(taipeiClock(Date.parse("2026-11-18T15:59:59Z"))).toBe("23:59");
  });
  it("the window is the FIRST question: outside it, no other fact changes the answer or the line", () => {
    const late = taipei("09:50");
    for (const over of [{ onMain: false }, { hook: "missing" }, { hook: "bad" }, { pause: "on", pauseUntil: "2026-11-20" }, { pause: "bad", pauseUntil: "x" },
      { deployedSha: HEAD }, { changed: ["README.md"] }, { ci: { state: "failed", word: "failure" } }, { ci: { state: "running" } }, { headSha: "" }]) {
      expect(decide(deployNight({ ...over, nowMs: late })), JSON.stringify(over)).toEqual({ action: "skip", code: "outside_window", line: outsideLine("09:50") });
    }
  });
  it("inside the window the three rules decide exactly as before (the same answer as without the time rule)", () => {
    for (const over of [{}, { onMain: false }, { hook: "missing" }, { hook: "bad" }, { pause: "on", pauseUntil: "2026-11-20" }, { pause: "bad" },
      { deployedSha: HEAD }, { changed: ["README.md"] }, { ci: { state: "failed", word: "failure" } }, { ci: { state: "running" } }, { ci: { state: "none" } }, { headSha: "" }, { deployedSha: "", changed: null }]) {
      for (const clock of ["03:30", "04:05", "05:30"]) {
        const f = deployNight({ ...over, nowMs: taipei(clock) });
        expect(decide(f), `${clock} ${JSON.stringify(over)}`).toEqual(decideApartFromTime(f));
      }
    }
  });
  it("deploy ⇔ (inside the window OR started by hand) AND hook set AND the server may differ AND CI passed", () => {
    let rows = 0;
    let deploys = 0;
    for (const clock of ["03:29", "03:30", "04:30", "05:30", "05:31", "09:50", "14:00", "23:59"]) for (const event of ["schedule", "workflow_dispatch"])
      for (const hook of ["set", "missing"]) for (const changed of [["server.js"], ["README.md"]]) for (const ci of [{ state: "passed" }, { state: "running" }]) {
        rows += 1;
        const r = decide(deployNight({ nowMs: taipei(clock), event, hook, changed, ci }));
        const timeOk = event === "workflow_dispatch" || ["03:30", "04:30", "05:30"].includes(clock);
        const want = timeOk && hook === "set" && changed[0] === "server.js" && ci.state === "passed";
        expect(r.action === "deploy", `${clock} ${event} ${hook} ${changed[0]} ${ci.state}`).toBe(want);
        if (want) deploys += 1;
      }
    expect(rows).toBe(8 * 2 * 2 * 2 * 2);
    expect(deploys).toBe(3 + 8);       // scheduled: the 3 times inside the window · by hand: all 8 times
  });
});

describe("D9 a run started by hand is not bound by the window; every other run is", () => {
  it("a run started by hand at 14:00 deploys", () => {
    const r = decide(deployNight({ event: "workflow_dispatch", nowMs: taipei("14:00") }));
    expect(r).toEqual({ action: "deploy", code: "deploy", line: "Deploying 16b4bb9: 1 file of the server changed since 0cc49da (server/pc711Duty.js), and CI passed." });
  });
  it("by hand: every minute of the day is allowed, and the other three rules still decide", () => {
    for (let m = 0; m < 24 * 60; m += 7) expect(decide(deployNight({ event: "workflow_dispatch", nowMs: taipei("00:00") + m * 60000 })).action, `minute ${m}`).toBe("deploy");
    const hand = { event: "workflow_dispatch", nowMs: taipei("14:00") };
    expect(decide(deployNight({ ...hand, hook: "missing" })).code).toBe("no_hook");
    expect(decide(deployNight({ ...hand, changed: ["README.md"] })).code).toBe("web_only");
    expect(decide(deployNight({ ...hand, ci: { state: "failed", word: "failure" } })).code).toBe("ci_failed");
    expect(decide(deployNight({ ...hand, onMain: false })).code).toBe("not_main");
  });
  it("by hand is ONE exact word: every other event — also one that is not known — is bound by the window", () => {
    expect(BY_HAND_EVENT).toBe("workflow_dispatch");
    for (const event of ["schedule", "", undefined, null, "push", "pull_request", "workflow_run", "repository_dispatch", "WORKFLOW_DISPATCH", "workflow_dispatch ", " workflow_dispatch", "workflow_dispatch\n", "dispatch", true, 1, ["workflow_dispatch"]]) {
      expect(decide(deployNight({ event, nowMs: taipei("14:00") })), String(event)).toMatchObject({ action: "skip", code: "outside_window" });
      expect(checkWindow({ event, nowMs: taipei("14:00") }), String(event)).not.toBeNull();
    }
    expect(checkWindow({ event: "workflow_dispatch", nowMs: taipei("14:00") })).toBeNull();
  });
  it("a clock that cannot be read never deploys a scheduled run: STOP (red); a run started by hand does not need it", () => {
    for (const nowMs of [undefined, null, NaN, Infinity, -Infinity, "1795000000000", "04:05", {}, [], true, 9e15, -9e15]) {
      const r = decide(deployNight({ nowMs }));
      expect(r, String(nowMs)).toEqual({ action: "stop", code: "no_clock", line: "Stopped: the time could not be read, so the deploy window could not be checked. Nothing was deployed." });
      expect(inDeployWindow(nowMs as never), String(nowMs)).toBe(false);
      expect(taipeiClock(nowMs as never)).toBe("");
      expect(taipeiMinuteOfDay(nowMs as never)).toBe(-1);
      expect(decide(deployNight({ nowMs, event: "workflow_dispatch" })).action).toBe("deploy");
    }
    expect(decide({ ...deployNight(), nowMs: undefined } as Facts).code).toBe("no_clock");
    expect(checkWindow(undefined as never)).toMatchObject({ action: "stop", code: "no_clock" });
    expect(checkWindow({} as never)).toMatchObject({ action: "stop", code: "no_clock" });
  });
});

describe("D10 the lines of the time rule", () => {
  it("the planned time comes from GitHub's schedule line (UTC → Taipei); only that exact shape is read", () => {
    expect(["37 19 * * *", "52 19 * * *", "7 20 * * *", "22 20 * * *", "41 20 * * *", "56 20 * * *"].map(plannedClock)).toEqual(["03:37", "03:52", "04:07", "04:22", "04:41", "04:56"]);
    expect(plannedClock("0 20 * * *")).toBe("04:00");
    expect(plannedClock("0 0 * * *")).toBe("08:00");
    expect(plannedClock("59 15 * * *")).toBe("23:59");
    expect(plannedClock("0 16 * * *")).toBe("00:00");
    expect(plannedClock(" 07 20 * * * \n")).toBe("04:07");
    for (const bad of ["", null, undefined, "7 20 * * 1", "7 20 1 * *", "*/5 20 * * *", "7 20-21 * * *", "7,22 20 * * *", "60 20 * * *", "7 24 * * *", "7 20 * *", "7  20 * * *",
      "7 20 * * * extra", "<b>7 20 * * *</b>", "https://api.render.com/deploy/srv-abc?key=k", "@daily", 720, {}]) expect(plannedClock(bad as never), String(bad)).toBe("");
  });
  it("a late start names its own time and the planned one; a schedule line that is not plain is never printed", () => {
    expect(checkWindow({ event: "schedule", nowMs: taipei("09:50"), planned: "7 20 * * *" })?.line).toBe(outsideLine("09:50", "04:07"));
    expect(checkWindow({ event: "schedule", nowMs: taipei("05:31"), planned: "56 20 * * *" })?.line).toBe(outsideLine("05:31", "04:56"));
    for (const planned of ["", undefined, null, "<img src=x>", "7 20 * * * && curl x", "https://api.render.com/deploy/srv-abc123DEF?key=MARKKEYzzzz9999"]) {
      expect(checkWindow({ event: "schedule", nowMs: taipei("09:50"), planned } as never)?.line, String(planned)).toBe(outsideLine("09:50"));
    }
  });
  it("right before the hook: its own line and its own code; the same window, the same clock rule", () => {
    const r = checkWindow({ event: "schedule", nowMs: taipei("05:31"), planned: "56 20 * * *" }, "hook");
    expect(r).toEqual({ action: "skip", code: "window_closed", line: "Skipped: the deploy window closed before Render was called: it is now 05:31 Taiwan time. A scheduled run deploys only between 03:30 and 05:30 Taiwan time. The Deploy Hook was not called; the next scheduled run inside that window tries again." });
    expect(checkWindow({ event: "schedule", nowMs: taipei("05:30:59") }, "hook")).toBeNull();
    expect(checkWindow({ event: "schedule", nowMs: taipei("05:31:00") }, "hook")?.code).toBe("window_closed");
    expect(checkWindow({ event: "schedule", nowMs: taipei("03:29:59") }, "hook")?.code).toBe("window_closed");
    expect(checkWindow({ event: "schedule", nowMs: NaN }, "hook")).toMatchObject({ action: "stop", code: "no_clock" });
    expect(checkWindow({ event: "workflow_dispatch", nowMs: taipei("14:00") }, "hook")).toBeNull();
    expect(checkWindow({ event: "workflow_dispatch", nowMs: NaN }, "hook")).toBeNull();
  });
  it("'only tell me': the line about the time says whether a scheduled run would be allowed now", () => {
    expect(windowLine(taipei("04:10"))).toBe("Time now: 04:10 Taiwan time. A scheduled run starting now would be allowed to deploy (window: 03:30 to 05:30 Taiwan time).");
    expect(windowLine(taipei("14:00"))).toBe("Time now: 14:00 Taiwan time. A scheduled run starting now would NOT be allowed to deploy (window: 03:30 to 05:30 Taiwan time). A run started by hand is not bound by the window.");
    expect(windowLine(NaN)).toBe("Time now: could not be read. A scheduled run would not deploy (window: 03:30 to 05:30 Taiwan time).");
    for (const [clock, ok] of [["03:29", false], ["03:30", true], ["05:30", true], ["05:31", false], ["09:50", false]] as Array<[string, boolean]>) {
      expect(windowLine(taipei(clock)).includes("would be allowed to deploy"), clock).toBe(ok);
      expect(windowLine(taipei(clock)).includes("would NOT be allowed to deploy"), clock).toBe(!ok);
      expect(windowLine(taipei(clock)).startsWith(`Time now: ${clock} Taiwan time.`)).toBe(true);
    }
  });
  it("decideApartFromTime never looks at the clock (it is what 'only tell me' prints next to the time line)", () => {
    for (const nowMs of [taipei("04:05"), taipei("14:00"), NaN, undefined]) expect(decideApartFromTime(deployNight({ nowMs }))).toMatchObject({ action: "deploy", code: "deploy" });
    expect(decideApartFromTime(deployNight({ nowMs: taipei("14:00"), pause: "on", pauseUntil: "2026-11-20" })).code).toBe("paused");
  });
  it("no line of the time rule ever holds the hook, whatever is passed in", () => {
    const HOOK_URL = "https://api.render.com/deploy/srv-abc123DEF?key=MARKKEYzzzz9999";
    for (const nowMs of [taipei("09:50"), NaN]) for (const when of ["start", "hook"]) {
      const r = checkWindow({ event: HOOK_URL, nowMs, planned: HOOK_URL, hook: HOOK_URL } as never, when);
      expect(r?.line).not.toContain("MARKKEY");
      expect(r?.line).not.toContain("api.render.com");
    }
    expect(windowLine(HOOK_URL as never)).not.toContain("MARKKEY");
  });
});
