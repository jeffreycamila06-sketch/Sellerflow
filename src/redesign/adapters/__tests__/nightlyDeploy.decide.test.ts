// @vitest-environment node
// Nightly Render deploy — the DECISION (scripts/nightly-deploy/decide.mjs, Jeff 2026-11-18).
// The hook is called ONLY when: server code changed since the last deployed commit, the CI run of
// that exact main commit finished and passed, and the hook secret is set. Everything else = one line.
import { describe, it, expect } from "vitest";
import {
  decide, checkSetup, checkChange, checkCi, deployLine, ciState, hookState, pauseState, taipeiDay, isServerPath, serverFilesIn,
  nameList, fullSha, sha7, SERVER_FILES, SERVER_DIRS, CI_WORDS, DEPLOY_BRANCH, DEPLOYED_TAG, CI_WORKFLOW, HOOK_SECRET, PAUSE_VARIABLE, HOOK_HOST,
} from "../../../../scripts/nightly-deploy/decide.mjs";

const HEAD = "16b4bb93aaaabbbbccccddddeeeeffff00001111";
const OLD = "0cc49da3aaaabbbbccccddddeeeeffff00002222";
const HOOK = "https://api.render.com/deploy/srv-abc123DEF?key=MARKKEYzzzz9999";
type Facts = Parameters<typeof decide>[0];
// A night on which everything says "deploy": each test changes ONE thing.
const deployNight = (over: Record<string, unknown> = {}): Facts => ({
  onMain: true, event: "schedule", hook: "set", pause: "off", pauseUntil: "",
  headSha: HEAD, deployedSha: OLD, changed: ["server/pc711Duty.js", "src/redesign/screens/Admin.tsx"],
  ci: { state: "passed", word: "" }, ...over,
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
  it("the order: branch, then the secret, then the pause, then the change, then CI", () => {
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
