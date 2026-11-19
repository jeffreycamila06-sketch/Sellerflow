// @vitest-environment node
// Nightly Render deploy — the RUN (scripts/nightly-deploy/run.mjs) with a FAKE GitHub and a FAKE Render.
// No real request is ever made by these tests. The one real thing is git, in a throw-away folder.
import { describe, it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { runNightlyDeploy, callRenderHook, createGithub, createGit, createSay, Stop, HOOK_TIMEOUT_MS, GITHUB_TIMEOUT_MS } from "../../../../scripts/nightly-deploy/run.mjs";
import { decide, ciState, hookState, pauseState, taipeiDay, inDeployWindow, taipeiClock, plannedClock } from "../../../../scripts/nightly-deploy/decide.mjs";

const HEAD = "16b4bb93aaaabbbbccccddddeeeeffff00001111";
const OLD = "0cc49da3aaaabbbbccccddddeeeeffff00002222";
const KEY = "MARKKEYzzzz9999";
const HOOK = `https://api.render.com/deploy/srv-abc123DEF?key=${KEY}`;
const NOW = Date.parse("2026-11-19T20:05:00Z");                // 04:05 on 20 November in Taipei
const ciRun = (over: Record<string, unknown> = {}) => ({ head_sha: HEAD, head_branch: "main", status: "completed", conclusion: "success", run_number: 1845, run_attempt: 1, ...over });

/** A moment on 20 November 2026 in Taipei, written as a Taipei wall-clock time ("04:05" or "05:30:59"). */
const taipei = (clock: string, day = "2026-11-20") => Date.parse(`${day}T${clock.length === 5 ? `${clock}:00` : clock}+08:00`);

type World = {
  env?: Record<string, string | undefined>;
  /** the clock: ONE time for the whole run, or a list — the first reading, the second reading, … (the last one stays) */
  clock?: number | number[];
  head?: string | (() => never);
  tag?: { exists: boolean; sha: string } | (() => never);
  inClone?: boolean;
  changed?: string[] | null;
  runs?: unknown[] | (() => never);
  hookAnswer?: { status: number; word?: string } | (() => never);
  tagMoves?: boolean | (() => never);
};
function world(w: World = {}) {
  const lines: string[] = [];
  const order: string[] = [];
  const hookCalls: Array<{ url: unknown; sha: unknown }> = [];
  const tagMoves: Array<{ sha: string; existed: boolean }> = [];
  const pick = <T,>(v: T | (() => never) | undefined, def: T): T => (typeof v === "function" ? (v as () => never)() : v === undefined ? def : v);
  const git = {
    headOfMain: vi.fn(async () => { order.push("git:head"); return pick(w.head, HEAD); }),
    hasCommit: vi.fn(async () => { order.push("git:has"); return w.inClone ?? true; }),
    changedFiles: vi.fn(async () => { order.push("git:diff"); return w.changed === undefined ? ["server/pc711Duty.js", "src/redesign/screens/Admin.tsx"] : w.changed; }),
  };
  const github = {
    readTag: vi.fn(async () => { order.push("gh:tag"); return pick(w.tag, { exists: true, sha: OLD }); }),
    ciRuns: vi.fn(async () => { order.push("gh:ci"); return pick(w.runs, [ciRun()]); }),
    moveTag: vi.fn(async (sha: string, existed: boolean) => { order.push("gh:move"); tagMoves.push({ sha, existed }); return pick(w.tagMoves, true); }),
  };
  const hook = vi.fn(async (url: unknown, sha: unknown) => { order.push("hook"); hookCalls.push({ url, sha }); return pick(w.hookAnswer, { status: 200, word: "" }); });
  const env = { GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "schedule", RENDER_DEPLOY_HOOK_URL: HOOK, ...(w.env ?? {}) };
  // how many questions had been asked (git / GitHub / the hook) when the clock was read: one entry per reading
  const clockAt: number[] = [];
  const times = w.clock === undefined ? [NOW] : Array.isArray(w.clock) ? w.clock : [w.clock];
  const now = vi.fn(() => { clockAt.push(order.length); return times[Math.min(clockAt.length - 1, times.length - 1)]; });
  const run = () => runNightlyDeploy({ env, git, github, hook, say: (l: string) => lines.push(l), now } as never);
  return { run, lines, order, hookCalls, tagMoves, git, github, hook, now, clockAt };
}
const noSecret = (lines: string[]) => { for (const l of lines) { expect(l).not.toContain(KEY); expect(l).not.toContain("srv-abc123DEF"); expect(l).not.toContain("api.render.com"); } };

describe("R1 a night with a server change, CI green and the secret set", () => {
  it("ONE call to the hook for exactly that commit, then the tag is moved; three lines; green", async () => {
    const h = world();
    expect(await h.run()).toEqual({ exitCode: 0, action: "deploy", code: "deploy" });
    expect(h.hookCalls).toEqual([{ url: HOOK, sha: HEAD }]);
    expect(h.tagMoves).toEqual([{ sha: HEAD, existed: true }]);
    expect(h.order).toEqual(["git:head", "gh:tag", "git:has", "git:diff", "gh:ci", "hook", "gh:move"]);   // the hook BEFORE the tag
    expect(h.lines).toEqual([
      "Deploying 16b4bb9: 1 file of the server changed since 0cc49da (server/pc711Duty.js), and CI passed.",
      "Render accepted the deploy of 16b4bb9 (answer 200). Render now builds it and restarts the server by itself; this run does not wait for it.",
      "Noted 16b4bb9 as the last deployed commit (tag render-deployed).",
    ]);
    noSecret(h.lines);
  });
  it("the first night (no tag yet): the difference is not asked, the tag is MADE", async () => {
    const h = world({ tag: { exists: false, sha: "" } });
    expect((await h.run()).action).toBe("deploy");
    expect(h.git.changedFiles).not.toHaveBeenCalled();
    expect(h.tagMoves).toEqual([{ sha: HEAD, existed: false }]);
    expect(h.lines[0]).toBe("Deploying 16b4bb9: no nightly deploy is noted yet, and CI passed.");
  });
  it("the noted commit is not in the clone any more: treated as changed, CI still decides", async () => {
    const h = world({ inClone: false });
    expect((await h.run()).action).toBe("deploy");
    expect(h.git.changedFiles).not.toHaveBeenCalled();
    const red = world({ inClone: false, runs: [ciRun({ conclusion: "failure" })] });
    expect(await red.run()).toMatchObject({ action: "skip", code: "ci_failed" });
    expect(red.hook).not.toHaveBeenCalled();
  });
  it("a tag that does not point straight at a commit counts as 'nothing noted' and is overwritten", async () => {
    const h = world({ tag: { exists: true, sha: "" } });
    expect((await h.run()).action).toBe("deploy");
    expect(h.tagMoves).toEqual([{ sha: HEAD, existed: true }]);
  });
  it("any 2xx answer of Render is 'accepted'", async () => {
    for (const status of [200, 201, 202, 204]) {
      const h = world({ hookAnswer: { status } });
      expect((await h.run()).action, String(status)).toBe("deploy");
      expect(h.lines[1]).toContain(`(answer ${status})`);
    }
  });
  it("it does not wait for Render: after the hook the only thing left is the tag", async () => {
    const h = world();
    await h.run();
    expect(h.hook).toHaveBeenCalledTimes(1);
    expect(h.order.slice(h.order.indexOf("hook") + 1)).toEqual(["gh:move"]);
  });
});

describe("R2 every skip: ONE line, green, the hook is not called, the tag is not moved", () => {
  const skips: Array<[string, World, string]> = [
    ["nothing new", { tag: { exists: true, sha: HEAD } }, "nothing_new"],
    ["web-only change", { changed: ["src/redesign/screens/Admin.tsx", "docs/x.md"] }, "web_only"],
    ["no file differs", { changed: [] }, "web_only"],
    ["CI red", { runs: [ciRun({ conclusion: "failure" })] }, "ci_failed"],
    ["CI cancelled", { runs: [ciRun({ conclusion: "cancelled" })] }, "ci_failed"],
    ["CI still running", { runs: [ciRun({ status: "in_progress", conclusion: null })] }, "ci_running"],
    ["CI queued", { runs: [ciRun({ status: "queued", conclusion: null })] }, "ci_running"],
    ["CI has no run for this commit", { runs: [] }, "ci_none"],
    ["CI ran only for another commit", { runs: [ciRun({ head_sha: OLD })] }, "ci_none"],
    ["CI ran for this commit on another branch only", { runs: [ciRun({ head_branch: "claude/x" })] }, "ci_none"],
    ["secret missing", { env: { RENDER_DEPLOY_HOOK_URL: "" } }, "no_hook"],
    ["secret not there at all", { env: { RENDER_DEPLOY_HOOK_URL: undefined } }, "no_hook"],
    ["not on main", { env: { GITHUB_REF: "refs/heads/claude/x" } }, "not_main"],
    ["a tag run", { env: { GITHUB_REF: "refs/tags/render-deployed" } }, "not_main"],
    ["paused", { env: { NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-20" } }, "paused"],
  ];
  for (const [name, w, code] of skips) {
    it(`${name} → ${code}`, async () => {
      const h = world(w);
      expect(await h.run()).toEqual({ exitCode: 0, action: "skip", code });
      expect(h.hook).not.toHaveBeenCalled();
      expect(h.github.moveTag).not.toHaveBeenCalled();
      expect(h.lines.length).toBe(1);
      expect(h.lines[0].startsWith("Skipped: ")).toBe(true);
      noSecret(h.lines);
    });
  }
  it("a skip that is decided early asks nothing more", async () => {
    for (const w of [{ env: { RENDER_DEPLOY_HOOK_URL: "" } }, { env: { GITHUB_REF: "refs/heads/x" } }, { env: { NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-20" } }] as World[]) {
      const h = world(w);
      await h.run();
      expect(h.order).toEqual([]);
    }
    const same = world({ tag: { exists: true, sha: HEAD } });
    await same.run();
    expect(same.github.ciRuns).not.toHaveBeenCalled();
    const web = world({ changed: ["README.md"] });
    await web.run();
    expect(web.github.ciRuns).not.toHaveBeenCalled();
  });
  it("the pause ends by itself the day after, and a run started by hand ignores it", async () => {
    expect((await world({ env: { NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-19" } }).run()).action).toBe("deploy");   // it is the 20th in Taipei
    expect((await world({ env: { NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-20", GITHUB_EVENT_NAME: "workflow_dispatch" } }).run()).action).toBe("deploy");
  });
});

describe("R3 the run gives the same answer as decide() on the same facts", () => {
  it("across the time × hook × pause × branch × event × change × CI", async () => {
    const clocks = ["04:05", "03:29", "05:31", "09:50"].map((c) => taipei(c));
    const hooks = [HOOK, "", "https://example.com/x"];
    const pauses = ["", "2026-11-20", "2026-11-01", "soon"];
    const refs = ["refs/heads/main", "refs/heads/other"];
    const events = ["schedule", "workflow_dispatch", "push", ""];
    const changes: Array<Pick<World, "tag" | "changed" | "inClone">> = [
      { tag: { exists: true, sha: HEAD } }, { changed: ["README.md"] }, { changed: ["server.js"] }, { tag: { exists: false, sha: "" } }, { inClone: false },
    ];
    const runsList = [[ciRun()], [ciRun({ conclusion: "failure" })], [ciRun({ status: "queued", conclusion: null })], []];
    let n = 0;
    let deploys = 0;
    for (const clock of clocks) for (const hookUrl of hooks) for (const pause of pauses) for (const ref of refs) for (const event of events) for (const c of changes) for (const runs of runsList) {
      n += 1;
      const h = world({ ...c, runs, clock, env: { RENDER_DEPLOY_HOOK_URL: hookUrl, NIGHTLY_DEPLOY_PAUSE_UNTIL: pause, GITHUB_REF: ref, GITHUB_EVENT_NAME: event } });
      const got = await h.run();
      const tagSha = c.tag ? (c.tag as { sha: string }).sha : OLD;
      const want = decide({
        onMain: ref === "refs/heads/main", event, hook: hookState(hookUrl), pause: pauseState(pause, taipeiDay(clock)), pauseUntil: pause,
        headSha: HEAD, deployedSha: tagSha,
        changed: tagSha && c.inClone !== false ? (c.changed ?? ["server/pc711Duty.js", "src/redesign/screens/Admin.tsx"]) : null,
        ci: ciState(runs, HEAD), nowMs: clock, planned: "",
      });
      expect(got.code, `${n}`).toBe(want.code);
      expect(h.hook.mock.calls.length, `${n}`).toBe(want.action === "deploy" ? 1 : 0);
      // the hook is NEVER called by a run that was not started by hand outside the window
      if (event !== "workflow_dispatch" && !inDeployWindow(clock)) expect(h.hook.mock.calls.length, `${n}`).toBe(0);
      deploys += h.hook.mock.calls.length;
    }
    expect(n).toBe(4 * 3 * 4 * 2 * 4 * 5 * 4);
    expect(deploys).toBeGreaterThan(20);
  });
});

describe("R4 a broken setting or a failed step ends RED, and never deploys by mistake", () => {
  it("a secret that is not a Render Deploy Hook: red, no request at all, no part of it printed", async () => {
    for (const bad of ["https://example.com/hook?key=" + KEY, "api.render.com/deploy/srv-abc?key=" + KEY, `http://api.render.com/deploy/srv-abc?key=${KEY}`]) {
      const h = world({ env: { RENDER_DEPLOY_HOOK_URL: bad } });
      expect(await h.run()).toEqual({ exitCode: 1, action: "stop", code: "bad_hook" });
      expect(h.order).toEqual([]);
      noSecret(h.lines);
      expect(h.lines.join(" ")).not.toContain("example.com");
    }
  });
  it("a pause value that is not a date: red on the nightly run, nothing deployed", async () => {
    const h = world({ env: { NIGHTLY_DEPLOY_PAUSE_UNTIL: "next friday" } });
    expect(await h.run()).toEqual({ exitCode: 1, action: "stop", code: "bad_pause" });
    expect(h.order).toEqual([]);
    expect(h.lines.join(" ")).not.toContain("next friday");
  });
  it("Render refuses the hook: red, the tag is NOT moved (so the next run tries again)", async () => {
    for (const [status, extra] of [[500, false], [503, false], [302, false], [400, false], [401, true], [404, true]] as Array<[number, boolean]>) {
      const h = world({ hookAnswer: { status } });
      expect(await h.run()).toEqual({ exitCode: 1, action: "stop", code: `hook_${status}` });
      expect(h.github.moveTag).not.toHaveBeenCalled();
      expect(h.lines[1]).toContain(`Render answered ${status} to the Deploy Hook.`);
      expect(h.lines[1]).toContain("The commit was not noted, so the next run tries again.");
      expect(h.lines[1].includes("copy it again into the secret RENDER_DEPLOY_HOOK_URL")).toBe(extra);
      noSecret(h.lines);
    }
  });
  it("Render does not answer (timeout / no connection): red, the tag is NOT moved", async () => {
    const t = world({ hookAnswer: { status: 0, word: "timeout" } });
    expect(await t.run()).toEqual({ exitCode: 1, action: "stop", code: "hook_no_answer" });
    expect(t.lines[1]).toBe("Stopped: Render did not answer the Deploy Hook (no answer in 30 seconds). The commit was not noted, so the next run tries again.");
    const n = world({ hookAnswer: { status: 0, word: "network" } });
    await n.run();
    expect(n.lines[1]).toContain("(no connection)");
    for (const h of [t, n]) expect(h.github.moveTag).not.toHaveBeenCalled();
  });
  it("the hook worked but the tag could not be moved: red, and the line says the commit is deployed once more next time", async () => {
    const h = world({ tagMoves: false });
    expect(await h.run()).toEqual({ exitCode: 1, action: "stop", code: "tag_write" });
    expect(h.hook).toHaveBeenCalledTimes(1);
    expect(h.lines.at(-1)).toBe("Stopped: Render accepted the deploy, but the tag render-deployed could not be moved. The next run will deploy this commit once more.");
  });
  it("GitHub does not answer about the tag or about CI: red, the hook is not called", async () => {
    const tag = world({ tag: () => { throw new Stop("tag_read", "Stopped: GitHub did not answer the question about the tag render-deployed (answer 403). Nothing was deployed."); } });
    expect(await tag.run()).toEqual({ exitCode: 1, action: "stop", code: "tag_read" });
    const ci = world({ runs: () => { throw new Stop("ci_read", "Stopped: GitHub did not answer the question about the CI result (answer 500). Nothing was deployed."); } });
    expect(await ci.run()).toEqual({ exitCode: 1, action: "stop", code: "ci_read" });
    for (const h of [tag, ci]) { expect(h.hook).not.toHaveBeenCalled(); expect(h.github.moveTag).not.toHaveBeenCalled(); expect(h.lines.length).toBe(1); }
  });
  it("the newest commit of main cannot be read: red, nothing asked of Render", async () => {
    const h = world({ head: "" });
    expect(await h.run()).toEqual({ exitCode: 1, action: "stop", code: "no_head" });
    expect(h.hook).not.toHaveBeenCalled();
  });
  it("anything unexpected: ONE fixed sentence — the error itself is never printed (it can hold an address)", async () => {
    const boom = () => { throw new Error(`request to ${HOOK} failed`); };
    const before = world({ head: boom });
    expect(await before.run()).toEqual({ exitCode: 1, action: "stop", code: "unexpected" });
    expect(before.lines).toEqual(["Stopped: something unexpected happened. Nothing was deployed."]);
    const hook = world({ hookAnswer: boom });
    expect((await hook.run()).code).toBe("unexpected");
    expect(hook.lines.at(-1)).toBe("Stopped: something unexpected happened. Nothing was deployed.");
    expect(hook.github.moveTag).not.toHaveBeenCalled();
    const after = world({ tagMoves: boom });
    expect((await after.run()).code).toBe("unexpected");
    expect(after.lines.at(-1)).toBe("Stopped: something unexpected happened after Render accepted the deploy. The commit was not noted, so the next run deploys it once more.");
    for (const h of [before, hook, after]) noSecret(h.lines);
  });
});

describe("R12 the time window in the run: a scheduled run reaches Render ONLY 03:30–05:30 Asia/Taipei", () => {
  const RULE = "A scheduled run deploys only between 03:30 and 05:30 Taiwan time.";
  const outside = (at: string, plan = "") => `Skipped: this run started at ${at} Taiwan time${plan ? ` (GitHub had it planned for ${plan})` : ""}. ${RULE} Nothing was deployed; the next scheduled run inside that window tries again.`;
  const closedLine = (at: string) => `Skipped: the deploy window closed before Render was called: it is now ${at} Taiwan time. ${RULE} The Deploy Hook was not called; the next scheduled run inside that window tries again.`;

  it("03:29 skip · 03:30 deploy · 05:30 deploy · 05:31 skip · 09:50 skip (server change, CI green, secret set — only the time differs)", async () => {
    for (const [clock, deploys] of [["03:29", false], ["03:30", true], ["05:30", true], ["05:31", false], ["09:50", false]] as Array<[string, boolean]>) {
      const h = world({ clock: taipei(clock) });
      const r = await h.run();
      if (deploys) {
        expect(r, clock).toEqual({ exitCode: 0, action: "deploy", code: "deploy" });
        expect(h.hookCalls, clock).toEqual([{ url: HOOK, sha: HEAD }]);
        expect(h.tagMoves, clock).toEqual([{ sha: HEAD, existed: true }]);
      } else {
        expect(r, clock).toEqual({ exitCode: 0, action: "skip", code: "outside_window" });
        expect(h.lines, clock).toEqual([outside(clock)]);
        expect(h.hook, clock).not.toHaveBeenCalled();
        expect(h.github.moveTag, clock).not.toHaveBeenCalled();
      }
      noSecret(h.lines);
    }
  });
  it("the run that was found (planned 04:00, started 01:50:14 UTC = 09:50 Taipei): green, ONE line, and NOTHING is asked of git, GitHub or Render", async () => {
    const h = world({ clock: Date.parse("2026-11-19T01:50:14Z"), env: { NIGHTLY_DEPLOY_PLANNED: "0 20 * * *" } });
    expect(await h.run()).toEqual({ exitCode: 0, action: "skip", code: "outside_window" });
    expect(h.lines).toEqual([outside("09:50", "04:00")]);
    expect(h.order).toEqual([]);
    expect(h.now).toHaveBeenCalledTimes(1);
  });
  it("outside the window nothing else matters: no secret, a bad secret, a pause, a bad pause, another branch — the same one line", async () => {
    for (const env of [{ RENDER_DEPLOY_HOOK_URL: "" }, { RENDER_DEPLOY_HOOK_URL: "https://example.com/x" }, { NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-20" },
      { NIGHTLY_DEPLOY_PAUSE_UNTIL: "soon" }, { GITHUB_REF: "refs/heads/other" }] as Array<Record<string, string>>) {
      const h = world({ clock: taipei("09:50"), env });
      expect(await h.run(), JSON.stringify(env)).toEqual({ exitCode: 0, action: "skip", code: "outside_window" });
      expect(h.lines).toEqual([outside("09:50")]);
      expect(h.order).toEqual([]);
    }
  });
  it("to the minute, on both readings: 03:29:59 out · 05:30:59 in · 05:31:00 out", async () => {
    expect((await world({ clock: taipei("03:29:59") }).run()).code).toBe("outside_window");
    expect((await world({ clock: taipei("03:30:00") }).run()).code).toBe("deploy");
    expect((await world({ clock: taipei("05:30:59") }).run()).code).toBe("deploy");
    expect((await world({ clock: taipei("05:31:00") }).run()).code).toBe("outside_window");
    const lastSecond = world({ clock: [taipei("05:29"), taipei("05:30:59")] });
    expect((await lastSecond.run()).code).toBe("deploy");
    expect(lastSecond.hook).toHaveBeenCalledTimes(1);
    const firstSecondAfter = world({ clock: [taipei("05:29"), taipei("05:31:00")] });
    expect((await firstSecondAfter.run()).code).toBe("window_closed");
    expect(firstSecondAfter.hook).not.toHaveBeenCalled();
  });

  it("a run started by hand at 14:00 deploys: Jeff chose the moment", async () => {
    const h = world({ clock: taipei("14:00"), env: { GITHUB_EVENT_NAME: "workflow_dispatch" } });
    expect(await h.run()).toEqual({ exitCode: 0, action: "deploy", code: "deploy" });
    expect(h.hookCalls).toEqual([{ url: HOOK, sha: HEAD }]);
    expect(h.tagMoves).toEqual([{ sha: HEAD, existed: true }]);
    expect(h.lines).toEqual([
      "Deploying 16b4bb9: 1 file of the server changed since 0cc49da (server/pc711Duty.js), and CI passed.",
      "Render accepted the deploy of 16b4bb9 (answer 200). Render now builds it and restarts the server by itself; this run does not wait for it.",
      "Noted 16b4bb9 as the last deployed commit (tag render-deployed).",
    ]);
  });
  it("by hand: no hour stops it, a clock that moves does not stop it, and the other three rules still do", async () => {
    for (const clock of ["00:00", "03:29", "05:31", "09:50", "14:00", "23:59"]) {
      const h = world({ clock: taipei(clock), env: { GITHUB_EVENT_NAME: "workflow_dispatch" } });
      expect((await h.run()).action, clock).toBe("deploy");
      expect(h.hook).toHaveBeenCalledTimes(1);
    }
    const moving = world({ clock: [taipei("05:29"), taipei("05:31")], env: { GITHUB_EVENT_NAME: "workflow_dispatch" } });
    expect((await moving.run()).action).toBe("deploy");
    const red = world({ clock: taipei("14:00"), env: { GITHUB_EVENT_NAME: "workflow_dispatch" }, runs: [ciRun({ conclusion: "failure" })] });
    expect((await red.run()).code).toBe("ci_failed");
    expect(red.hook).not.toHaveBeenCalled();
  });
  it("only the exact event of the Run workflow button is 'by hand': a re-run of a scheduled run, an unknown or empty event are bound by the window", async () => {
    for (const event of ["schedule", "", "push", "workflow_run", "WORKFLOW_DISPATCH", "workflow_dispatch "]) {
      const h = world({ clock: taipei("14:00"), env: { GITHUB_EVENT_NAME: event } });
      expect(await h.run(), event).toEqual({ exitCode: 0, action: "skip", code: "outside_window" });
      expect(h.hook).not.toHaveBeenCalled();
    }
    const none = world({ clock: taipei("14:00"), env: { GITHUB_EVENT_NAME: undefined } });
    expect((await none.run()).code).toBe("outside_window");
  });

  it("the clock moves past 05:30 between the decision and the hook → NO call, the tag is not moved, green, ONE line", async () => {
    const h = world({ clock: [taipei("05:29"), taipei("05:31")] });
    expect(await h.run()).toEqual({ exitCode: 0, action: "skip", code: "window_closed" });
    expect(h.hook).not.toHaveBeenCalled();
    expect(h.github.moveTag).not.toHaveBeenCalled();
    expect(h.lines).toEqual([closedLine("05:31")]);                                  // and no "Deploying …" line before it
    expect(h.order).toEqual(["git:head", "gh:tag", "git:has", "git:diff", "gh:ci"]);  // everything had said "deploy"
    noSecret(h.lines);
  });
  it("the same when GitHub was slow by hours, and when the first night's deploy would have been the one", async () => {
    const hours = world({ clock: [taipei("04:07"), taipei("09:50")] });
    expect((await hours.run()).code).toBe("window_closed");
    expect(hours.lines).toEqual([closedLine("09:50")]);
    const first = world({ clock: [taipei("05:30"), taipei("05:31")], tag: { exists: false, sha: "" } });
    expect((await first.run()).code).toBe("window_closed");
    expect(first.hook).not.toHaveBeenCalled();
    expect(first.github.moveTag).not.toHaveBeenCalled();
  });
  it("the two readings: the first before ANY question, the second after the last one and right before the hook — and no third", async () => {
    const h = world({ clock: [taipei("04:07"), taipei("04:08")] });
    await h.run();
    expect(h.order).toEqual(["git:head", "gh:tag", "git:has", "git:diff", "gh:ci", "hook", "gh:move"]);
    expect(h.clockAt).toEqual([0, 5]);                 // 0 questions asked · 5 asked, the hook is question number 6
    expect(h.now).toHaveBeenCalledTimes(2);
    const skipped = world({ changed: ["README.md"] });
    await skipped.run();
    expect(skipped.now).toHaveBeenCalledTimes(1);      // a run that never gets as far as the hook reads the clock once
  });
  it("the clock passing 05:30 AFTER the call changes nothing: Render was asked inside the window, so the commit is noted", async () => {
    const h = world({ clock: [taipei("05:29"), taipei("05:30:59"), taipei("05:45"), taipei("05:45")] });
    expect(await h.run()).toEqual({ exitCode: 0, action: "deploy", code: "deploy" });
    expect(h.tagMoves).toEqual([{ sha: HEAD, existed: true }]);
  });
  it("a clock that cannot be read: a scheduled run stops RED before asking anything; at the second reading it stops RED without calling Render", async () => {
    for (const bad of [NaN, Infinity, undefined as unknown as number, "04:05" as unknown as number]) {
      const h = world({ clock: [bad] });
      expect(await h.run(), String(bad)).toEqual({ exitCode: 1, action: "stop", code: "no_clock" });
      expect(h.lines).toEqual(["Stopped: the time could not be read, so the deploy window could not be checked. Nothing was deployed."]);
      expect(h.order).toEqual([]);
    }
    const second = world({ clock: [taipei("04:07"), NaN] });
    expect(await second.run()).toEqual({ exitCode: 1, action: "stop", code: "no_clock" });
    expect(second.hook).not.toHaveBeenCalled();
    expect(second.github.moveTag).not.toHaveBeenCalled();
  });
  it("the pause still goes by the Taipei day of the start, and is only looked at inside the window", async () => {
    const paused = world({ clock: taipei("04:07"), env: { NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-20" } });
    expect((await paused.run()).code).toBe("paused");
    const dayAfter = world({ clock: taipei("04:07", "2026-11-21"), env: { NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-20" } });
    expect((await dayAfter.run()).code).toBe("deploy");
  });
});

describe("R13 six starts a night: the first one that lands in the window deploys, the others end 'nothing new'", () => {
  const PLANNED = ["37 19 * * *", "52 19 * * *", "7 20 * * *", "22 20 * * *", "41 20 * * *", "56 20 * * *"];
  type Start = { at: string; hookAnswer?: { status: number; word?: string }; runs?: unknown[]; tagMoves?: boolean };
  /** One night: the runs happen one after the other (the workflow never runs two at once) and share ONE tag. */
  async function night(starts: Array<Start | string>, opts: { head?: string } = {}) {
    let tag = { exists: true, sha: OLD };
    let hookCalls = 0;
    const out: Array<{ at: string; code: string; line: string; lines: string[] }> = [];
    for (let i = 0; i < starts.length; i++) {
      const st = typeof starts[i] === "string" ? { at: starts[i] as string } : (starts[i] as Start);
      const lines: string[] = [];
      const git = { headOfMain: async () => opts.head ?? HEAD, hasCommit: async () => true, changedFiles: async (from: string, to: string) => (from === to ? [] : ["server/pc711Duty.js"]) };
      const github = {
        readTag: async () => ({ ...tag }),
        ciRuns: async () => st.runs ?? [ciRun({ head_sha: opts.head ?? HEAD })],
        moveTag: async (sha: string) => { if (st.tagMoves === false) return false; tag = { exists: true, sha }; return true; },
      };
      const hook = async () => { hookCalls += 1; return st.hookAnswer ?? { status: 200, word: "" }; };
      const env = { GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "schedule", RENDER_DEPLOY_HOOK_URL: HOOK, NIGHTLY_DEPLOY_PLANNED: PLANNED[i] ?? "" };
      const r = await runNightlyDeploy({ env, git, github, hook, say: (l: string) => lines.push(l), now: () => taipei(st.at) } as never);
      out.push({ at: st.at, code: r.code, line: lines.at(-1) ?? "", lines });
    }
    return { out, hookCalls: () => hookCalls, tag: () => tag };
  }
  it("the planned times are the six in the workflow file, all inside the window", () => {
    const yml = readFileSync(".github/workflows/nightly-render-deploy.yml", "utf8");
    expect([...yml.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual(PLANNED);
    expect(PLANNED.map(plannedClock)).toEqual(["03:37", "03:52", "04:07", "04:22", "04:41", "04:56"]);
  });
  it("GitHub on time: ONE call to Render (the 03:37 start); the five later starts end 'nothing new'", async () => {
    const n = await night(["03:38", "03:53", "04:08", "04:23", "04:42", "04:57"]);
    expect(n.out.map((o) => o.code)).toEqual(["deploy", "nothing_new", "nothing_new", "nothing_new", "nothing_new", "nothing_new"]);
    expect(n.hookCalls()).toBe(1);
    expect(n.tag().sha).toBe(HEAD);
    for (const o of n.out.slice(1)) expect(o.lines).toEqual(["Skipped: nothing new on main since the last deploy (16b4bb9)."]);
  });
  it("the first two start late the next morning, the third is on time: the third deploys, the late ones deploy nothing", async () => {
    // the order they really run in: 04:08 (on time), then the rest of the night, then the two late ones at 09:50
    const n = await night([{ at: "09:50" }, { at: "09:51" }, { at: "04:08" }, { at: "04:23" }, { at: "04:42" }, { at: "04:57" }]);
    expect(n.out.map((o) => o.code)).toEqual(["outside_window", "outside_window", "deploy", "nothing_new", "nothing_new", "nothing_new"]);
    expect(n.hookCalls()).toBe(1);
    expect(n.out[0].line).toBe("Skipped: this run started at 09:50 Taiwan time (GitHub had it planned for 03:37). A scheduled run deploys only between 03:30 and 05:30 Taiwan time. Nothing was deployed; the next scheduled run inside that window tries again.");
  });
  it("GitHub late for ALL six (they start between 05:31 and 09:55): ZERO calls to Render; each line says its own time and its planned time", async () => {
    const n = await night(["05:31", "06:10", "07:45", "09:50", "09:52", "09:55"]);
    expect(n.out.map((o) => o.code)).toEqual(Array(6).fill("outside_window"));
    expect(n.hookCalls()).toBe(0);
    expect(n.tag().sha).toBe(OLD);                                   // nothing noted: the next night still has the work
    expect(n.out.map((o) => o.line.slice(0, 80))).toEqual([
      "Skipped: this run started at 05:31 Taiwan time (GitHub had it planned for 03:37)",
      "Skipped: this run started at 06:10 Taiwan time (GitHub had it planned for 03:52)",
      "Skipped: this run started at 07:45 Taiwan time (GitHub had it planned for 04:07)",
      "Skipped: this run started at 09:50 Taiwan time (GitHub had it planned for 04:22)",
      "Skipped: this run started at 09:52 Taiwan time (GitHub had it planned for 04:41)",
      "Skipped: this run started at 09:55 Taiwan time (GitHub had it planned for 04:56)",
    ]);
  });
  it("a late start that still lands inside the window deploys (planned 03:37, started 05:20), and the ones after 05:30 do nothing", async () => {
    const n = await night(["05:20", "05:29", "05:31", "05:40", "06:00", "06:30"]);
    expect(n.out.map((o) => o.code)).toEqual(["deploy", "nothing_new", "outside_window", "outside_window", "outside_window", "outside_window"]);
    expect(n.hookCalls()).toBe(1);
  });
  it("Render does not answer the first start: the NEXT start, 15 minutes later, tries again the same night — still one deploy", async () => {
    const n = await night([{ at: "03:38", hookAnswer: { status: 503 } }, "03:53", "04:08", "04:23", "04:42", "04:57"]);
    expect(n.out.map((o) => o.code)).toEqual(["hook_503", "deploy", "nothing_new", "nothing_new", "nothing_new", "nothing_new"]);
    expect(n.hookCalls()).toBe(2);                                   // one refused, one accepted
  });
  it("CI still running at 03:38 and finished by 03:53: the second start deploys", async () => {
    const n = await night([{ at: "03:38", runs: [ciRun({ status: "in_progress", conclusion: null })] }, "03:53", "04:08", "04:23", "04:42", "04:57"]);
    expect(n.out.map((o) => o.code)).toEqual(["ci_running", "deploy", "nothing_new", "nothing_new", "nothing_new", "nothing_new"]);
    expect(n.hookCalls()).toBe(1);
  });
  it("CI red all night: six skips, ZERO calls", async () => {
    const red = [ciRun({ conclusion: "failure" })];
    const n = await night(["03:38", "03:53", "04:08", "04:23", "04:42", "04:57"].map((at) => ({ at, runs: red })));
    expect(n.out.map((o) => o.code)).toEqual(Array(6).fill("ci_failed"));
    expect(n.hookCalls()).toBe(0);
  });
  it("the one way to two restarts in a night is the known one: Render accepted but the tag could not be moved — and both are inside the window", async () => {
    const n = await night([{ at: "03:38", tagMoves: false }, "03:53", "04:08", "04:23", "04:42", "04:57"]);
    expect(n.out.map((o) => o.code)).toEqual(["tag_write", "deploy", "nothing_new", "nothing_new", "nothing_new", "nothing_new"]);
    expect(n.hookCalls()).toBe(2);
    expect(n.out[0].line).toBe("Stopped: Render accepted the deploy, but the tag render-deployed could not be moved. The next run will deploy this commit once more.");
  });
});

describe("R5 'only tell me what would happen'", () => {
  it("everything says deploy → it SAYS so, and calls nothing, notes nothing", async () => {
    const h = world({ env: { NIGHTLY_DEPLOY_DRY_RUN: "1" } });
    expect(await h.run()).toEqual({ exitCode: 0, action: "tell", code: "deploy" });
    expect(h.hook).not.toHaveBeenCalled();
    expect(h.github.moveTag).not.toHaveBeenCalled();
    expect(h.lines).toEqual([
      "Only telling what would happen: the Deploy Hook is not called and nothing is noted.",
      "Facts: main is at 16b4bb9 · last deployed: 0cc49da · files: 2 changed, 1 of the server · CI: passed · hook: set · pause: off.",
      "It would deploy. Deploying 16b4bb9: 1 file of the server changed since 0cc49da (server/pc711Duty.js), and CI passed.",
      "Time now: 04:05 Taiwan time. A scheduled run starting now would be allowed to deploy (window: 03:30 to 05:30 Taiwan time).",
    ]);
    noSecret(h.lines);
  });
  it("asked at 14:00: the facts are judged as at any hour, and the LAST line says a scheduled run would not be allowed now", async () => {
    const h = world({ clock: taipei("14:00"), env: { NIGHTLY_DEPLOY_DRY_RUN: "1", GITHUB_EVENT_NAME: "workflow_dispatch" } });
    expect(await h.run()).toEqual({ exitCode: 0, action: "tell", code: "deploy" });
    expect(h.lines.length).toBe(4);
    expect(h.lines[2]).toBe("It would deploy. Deploying 16b4bb9: 1 file of the server changed since 0cc49da (server/pc711Duty.js), and CI passed.");
    expect(h.lines[3]).toBe("Time now: 14:00 Taiwan time. A scheduled run starting now would NOT be allowed to deploy (window: 03:30 to 05:30 Taiwan time). A run started by hand is not bound by the window.");
    expect(h.hook).not.toHaveBeenCalled();
    expect(h.github.moveTag).not.toHaveBeenCalled();
  });
  it("the time line at Jeff's five times, and it never changes what the other lines say", async () => {
    const ref = world({ env: { NIGHTLY_DEPLOY_DRY_RUN: "1", GITHUB_EVENT_NAME: "workflow_dispatch" } });
    await ref.run();
    for (const [clock, allowed] of [["03:29", false], ["03:30", true], ["05:30", true], ["05:31", false], ["09:50", false]] as Array<[string, boolean]>) {
      const h = world({ clock: taipei(clock), env: { NIGHTLY_DEPLOY_DRY_RUN: "1", GITHUB_EVENT_NAME: "workflow_dispatch" } });
      expect((await h.run()).code, clock).toBe("deploy");
      expect(h.lines[3].startsWith(`Time now: ${clock} Taiwan time. A scheduled run starting now would ${allowed ? "be allowed" : "NOT be allowed"} to deploy`), clock).toBe(true);
      expect(h.lines.slice(0, 3), clock).toEqual(ref.lines.slice(0, 3));
      expect(h.hook).not.toHaveBeenCalled();
    }
  });
  it("it answers for main from any branch, and for the NIGHTLY run (the pause counts)", async () => {
    const branch = world({ env: { NIGHTLY_DEPLOY_DRY_RUN: "true", GITHUB_REF: "refs/heads/claude/nightly-render-deploy", GITHUB_EVENT_NAME: "push" } });
    expect((await branch.run()).code).toBe("deploy");
    const paused = world({ env: { NIGHTLY_DEPLOY_DRY_RUN: "1", GITHUB_EVENT_NAME: "workflow_dispatch", NIGHTLY_DEPLOY_PAUSE_UNTIL: "2026-11-20" } });
    expect((await paused.run()).code).toBe("paused");
    expect(paused.lines[2].startsWith("It would not deploy. Skipped: the nightly deploy is paused until 2026-11-20")).toBe(true);
    expect(paused.lines[3].startsWith("Time now: 04:05 Taiwan time.")).toBe(true);
  });
  it("GitHub not answering is said in the facts and never deploys; still green (it is only telling)", async () => {
    const h = world({ env: { NIGHTLY_DEPLOY_DRY_RUN: "1" }, tag: () => { throw new Stop("tag_read", "x"); }, runs: () => { throw new Stop("ci_read", "x"); } });
    expect(await h.run()).toEqual({ exitCode: 0, action: "tell", code: "ci_unknown" });
    expect(h.lines[1]).toBe("Facts: main is at 16b4bb9 · last deployed: GitHub did not answer · files: not known · CI: GitHub did not answer · hook: set · pause: off.");
    expect(h.hook).not.toHaveBeenCalled();
  });
  it("0 / empty / false do not switch it on", async () => {
    for (const v of ["0", "", "false", "no", undefined]) {
      const h = world({ env: { NIGHTLY_DEPLOY_DRY_RUN: v } });
      expect((await h.run()).action, String(v)).toBe("deploy");
    }
  });
});

describe("R6 callRenderHook: one POST, the commit pinned, nothing read, nothing leaked", () => {
  const fakeFetch = (reply: () => unknown) => {
    const sent: Array<{ url: string; init: Record<string, unknown> }> = [];
    return { sent, f: vi.fn(async (url: string, init: Record<string, unknown>) => { sent.push({ url, init }); return reply(); }) };
  };
  it("POST to the saved address + ref=<the exact commit>; the key is kept; redirects are not followed", async () => {
    let cancelled = 0;
    const t = fakeFetch(() => ({ status: 200, body: { cancel: async () => { cancelled += 1; } }, text: () => { throw new Error("the body must not be read"); }, json: () => { throw new Error("the body must not be read"); } }));
    expect(await callRenderHook(HOOK, HEAD, { fetchImpl: t.f as never })).toEqual({ status: 200, word: "" });
    expect(t.sent.length).toBe(1);
    const u = new URL(t.sent[0].url);
    expect([u.protocol, u.hostname, u.pathname]).toEqual(["https:", "api.render.com", "/deploy/srv-abc123DEF"]);
    expect(u.searchParams.get("key")).toBe(KEY);
    expect(u.searchParams.get("ref")).toBe(HEAD);
    expect([...u.searchParams.keys()].sort()).toEqual(["key", "ref"]);
    expect(t.sent[0].init.method).toBe("POST");
    expect(t.sent[0].init.redirect).toBe("manual");
    expect(t.sent[0].init.body).toBeUndefined();
    expect(cancelled).toBe(1);
  });
  it("a ref already in the saved address is replaced by the commit of this run", async () => {
    const t = fakeFetch(() => ({ status: 200 }));
    await callRenderHook(`${HOOK}&ref=${OLD}`, HEAD, { fetchImpl: t.f as never });
    expect(new URL(t.sent[0].url).searchParams.getAll("ref")).toEqual([HEAD]);
  });
  it("the status number is all that comes back", async () => {
    for (const status of [201, 404, 500]) {
      const t = fakeFetch(() => ({ status, statusText: `see ${HOOK}`, headers: { location: HOOK } }));
      expect(await callRenderHook(HOOK, HEAD, { fetchImpl: t.f as never })).toEqual({ status, word: "" });
    }
  });
  it("a fetch that throws (its message holds the address) → { status: 0, word: 'network' }, nothing thrown", async () => {
    const t = fakeFetch(() => { throw new TypeError(`fetch failed for ${HOOK}`); });
    const r = await callRenderHook(HOOK, HEAD, { fetchImpl: t.f as never });
    expect(r).toEqual({ status: 0, word: "network" });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it("no answer in 30 seconds → cut, word 'timeout'", async () => {
    vi.useFakeTimers();
    try {
      expect(HOOK_TIMEOUT_MS).toBe(30000);
      const f = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => { init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); }));
      const p = callRenderHook(HOOK, HEAD, { fetchImpl: f as never });
      await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT_MS - 1);
      let done = false;
      void p.then(() => { done = true; });
      await Promise.resolve();
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await p).toEqual({ status: 0, word: "timeout" });
    } finally { vi.useRealTimers(); }
  });
  it("an address that is not a Render Deploy Hook, or a commit that is not a full commit: ZERO requests", async () => {
    const t = fakeFetch(() => ({ status: 200 }));
    for (const [url, sha] of [["https://example.com/x?key=k", HEAD], ["", HEAD], [HOOK, "16b4bb9"], [HOOK, ""], [`http://api.render.com/deploy/srv-a?key=k`, HEAD]]) {
      expect(await callRenderHook(url, sha, { fetchImpl: t.f as never })).toEqual({ status: 0, word: "refused" });
    }
    expect(t.sent.length).toBe(0);
  });
});

describe("R7 createGithub: the tag and the CI result", () => {
  const TOKEN = "ghs_MARKTOKEN1234567890";
  type Rep = { status: number; json?: unknown } | "network";
  const gh = (replies: Rep[] | ((url: string, init: { method: string }) => Rep), over: Record<string, unknown> = {}) => {
    const sent: Array<{ url: string; method: string; headers: Record<string, string>; body?: string; redirect?: string }> = [];
    let i = 0;
    const f = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect?: string }) => {
      sent.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect });
      const r = typeof replies === "function" ? replies(url, init) : replies[i++];
      if (r === "network" || r === undefined) throw new TypeError(`fetch failed (token ${TOKEN})`);
      return { status: r.status, json: async () => { if (r.json === undefined) throw new Error("no json"); return r.json; } };
    });
    return { sent, api: createGithub({ token: TOKEN, repo: "jeff/sellerflow", fetchImpl: f as never, ...over }) };
  };
  const tagJson = (type = "commit", sha = OLD, ref = "refs/tags/render-deployed") => ({ ref, object: { type, sha } });

  it("readTag: no tag yet (404) → { exists: false }", async () => {
    const h = gh([{ status: 404, json: { message: "Not Found" } }]);
    expect(await h.api.readTag()).toEqual({ exists: false, sha: "" });
    expect(h.sent[0].url).toBe("https://api.github.com/repos/jeff/sellerflow/git/ref/tags/render-deployed");
    expect(h.sent[0].method).toBe("GET");
    expect(h.sent[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.sent[0].redirect).toBe("error");
  });
  it("readTag: the tag's commit; a tag that is not a plain commit tag → exists, no commit", async () => {
    expect(await gh([{ status: 200, json: tagJson() }]).api.readTag()).toEqual({ exists: true, sha: OLD });
    expect(await gh([{ status: 200, json: tagJson("tag") }]).api.readTag()).toEqual({ exists: true, sha: "" });
    expect(await gh([{ status: 200, json: tagJson("commit", "nothex") }]).api.readTag()).toEqual({ exists: true, sha: "" });
  });
  it("readTag: any other answer STOPS with the status number only (another tag's answer too)", async () => {
    for (const rep of [{ status: 403, json: { message: `bad credentials ${TOKEN}` } }, { status: 500 }, { status: 200, json: tagJson("commit", OLD, "refs/tags/render-deployed-old") }, { status: 200, json: [tagJson()] }, { status: 200 }, "network"] as Rep[]) {
      const h = gh([rep]);
      const err = await h.api.readTag().then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(Stop);
      expect((err as Stop).code).toBe("tag_read");
      expect((err as Stop).line).toMatch(/^Stopped: GitHub did not answer the question about the tag render-deployed \(answer \d+\)\. Nothing was deployed\.$/);
      expect((err as Stop).line).not.toContain(TOKEN);
    }
  });
  it("ciRuns: asks for the runs of ci.yml for that commit on main", async () => {
    const h = gh([{ status: 200, json: { total_count: 1, workflow_runs: [ciRun()] } }]);
    expect(await h.api.ciRuns(HEAD)).toEqual([ciRun()]);
    const u = new URL(h.sent[0].url);
    expect(u.pathname).toBe("/repos/jeff/sellerflow/actions/workflows/ci.yml/runs");
    expect([u.searchParams.get("head_sha"), u.searchParams.get("branch")]).toEqual([HEAD, "main"]);
  });
  it("ciRuns: no usable answer STOPS (never 'no run', never 'passed')", async () => {
    for (const rep of [{ status: 403, json: {} }, { status: 200, json: {} }, { status: 200, json: { workflow_runs: "x" } }, { status: 200 }, "network"] as Rep[]) {
      const err = await gh([rep]).api.ciRuns(HEAD).then(() => null, (e: unknown) => e);
      expect((err as Stop)?.code).toBe("ci_read");
    }
  });
  it("moveTag: an existing tag is moved (PATCH, forced); a missing one is made (POST)", async () => {
    const moved = gh([{ status: 200, json: {} }]);
    expect(await moved.api.moveTag(HEAD, true)).toBe(true);
    expect([moved.sent[0].method, moved.sent[0].url]).toEqual(["PATCH", "https://api.github.com/repos/jeff/sellerflow/git/refs/tags/render-deployed"]);
    expect(JSON.parse(moved.sent[0].body!)).toEqual({ sha: HEAD, force: true });
    const made = gh([{ status: 201, json: {} }]);
    expect(await made.api.moveTag(HEAD, false)).toBe(true);
    expect([made.sent[0].method, made.sent[0].url]).toEqual(["POST", "https://api.github.com/repos/jeff/sellerflow/git/refs"]);
    expect(JSON.parse(made.sent[0].body!)).toEqual({ ref: "refs/tags/render-deployed", sha: HEAD });
  });
  it("moveTag: it went away / appeared in between → the other way is tried once", async () => {
    const gone = gh([{ status: 422, json: {} }, { status: 201, json: {} }]);
    expect(await gone.api.moveTag(HEAD, true)).toBe(true);
    expect(gone.sent.map((s) => s.method)).toEqual(["PATCH", "POST"]);
    const there = gh([{ status: 422, json: {} }, { status: 200, json: {} }]);
    expect(await there.api.moveTag(HEAD, false)).toBe(true);
    expect(there.sent.map((s) => s.method)).toEqual(["POST", "PATCH"]);
  });
  it("moveTag: refused (403 / 500 / no answer) → false, no second try; a commit that is not full → no request", async () => {
    for (const rep of [{ status: 403, json: {} }, { status: 500, json: {} }, "network"] as Rep[]) {
      const h = gh([rep]);
      expect(await h.api.moveTag(HEAD, true)).toBe(false);
      expect(h.sent.length).toBe(1);
    }
    const twice = gh([{ status: 404, json: {} }, { status: 403, json: {} }]);
    expect(await twice.api.moveTag(HEAD, true)).toBe(false);
    const none = gh([]);
    expect(await none.api.moveTag("16b4bb9", true)).toBe(false);
    expect(none.sent.length).toBe(0);
  });
  it("no token, a repository name that is not owner/name, or an API address that is not https: ZERO requests", async () => {
    for (const over of [{ token: "" }, { token: "   " }, { repo: "sellerflow" }, { repo: "a/b/c" }, { repo: "a/b?x=1" }, { apiUrl: "http://api.github.com" }, { apiUrl: "" }]) {
      const h = gh([], over);
      expect(h.api.usable()).toBe(false);
      expect((await h.api.readTag().then(() => null, (e: unknown) => e) as Stop).line).toContain("(answer 0)");
      expect(await h.api.moveTag(HEAD, true)).toBe(false);
      expect(h.sent.length).toBe(0);
    }
  });
  it("a GitHub that never answers is cut at 20 seconds (the read stops, the tag move says false)", async () => {
    vi.useFakeTimers();
    try {
      expect(GITHUB_TIMEOUT_MS).toBe(20000);
      const hang = vi.fn((_url: string, init: { signal?: AbortSignal }) => new Promise((_res, rej) => {
        if (!init.signal) return;                                  // no time limit = it would hang for ever
        init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }));
      const api = createGithub({ token: TOKEN, repo: "jeff/sellerflow", fetchImpl: hang as never });
      let read: unknown = "waiting";
      void api.readTag().then(() => { read = "answered"; }, (e: unknown) => { read = e; });
      let moved: unknown = "waiting";
      void api.moveTag(HEAD, true).then((v: boolean) => { moved = v; });
      await vi.advanceTimersByTimeAsync(GITHUB_TIMEOUT_MS - 1);
      expect([read, moved]).toEqual(["waiting", "waiting"]);
      await vi.advanceTimersByTimeAsync(2);
      expect(read).toBeInstanceOf(Stop);
      expect((read as Stop).line).toContain("(answer 0)");
      expect(moved).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("the token goes to the GitHub API address only", async () => {
    const h = gh(() => ({ status: 200, json: tagJson() }), { apiUrl: "https://api.github.com/" });
    await h.api.readTag();
    await h.api.ciRuns(HEAD).catch(() => {});
    await h.api.moveTag(HEAD, true);
    for (const s of h.sent) expect(s.url.startsWith("https://api.github.com/repos/jeff/sellerflow/")).toBe(true);
  });
});

describe("R8 createGit: three read-only questions", () => {
  it("the commands (nothing that writes) and how their answers are read", async () => {
    const asked: string[][] = [];
    const exec = async (args: string[]) => { asked.push(args); return args[0] === "diff" ? { ok: true, out: "server.js\0src/a b.ts\0" } : { ok: true, out: `${HEAD}\n` }; };
    const git = createGit({ cwd: "/x", exec: exec as never });
    expect(await git.headOfMain()).toBe(HEAD);
    expect(await git.hasCommit(OLD)).toBe(true);
    expect(await git.changedFiles(OLD, HEAD)).toEqual(["server.js", "src/a b.ts"]);
    expect(asked).toEqual([
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"],
      ["cat-file", "-e", `${OLD}^{commit}`],
      ["diff", "--name-only", "--no-renames", "-z", OLD, HEAD],
    ]);
    for (const a of asked) expect(["rev-parse", "cat-file", "diff"]).toContain(a[0]);
  });
  it("git failing, or an id that is not a full commit: '' / false / null — and no command for a bad id", async () => {
    const asked: string[][] = [];
    const git = createGit({ exec: (async (args: string[]) => { asked.push(args); return { ok: false, out: "" }; }) as never });
    expect(await git.headOfMain()).toBe("");
    expect(await git.hasCommit(OLD)).toBe(false);
    expect(await git.changedFiles(OLD, HEAD)).toBeNull();
    const n = asked.length;
    expect(await git.hasCommit("--upload-pack=x")).toBe(false);
    expect(await git.changedFiles("-x", HEAD)).toBeNull();
    expect(asked.length).toBe(n);
  });

  // REAL git, in a throw-away folder: what the nightly run really asks.
  let dir = "";
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = ""; } });
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } }).trim();
  it("real git: a web-only range, a server range, a renamed server file, a commit that is not there", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightly-deploy-"));
    g("init", "-q", "-b", "work");
    mkdirSync(join(dir, "server")); mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "server.js"), "one\n"); writeFileSync(join(dir, "server", "a.js"), "a\n".repeat(50)); writeFileSync(join(dir, "src", "app.ts"), "x\n");
    g("add", "-A"); g("commit", "-q", "-m", "first");
    const first = g("rev-parse", "HEAD");
    writeFileSync(join(dir, "src", "app.ts"), "y\n"); writeFileSync(join(dir, "src", "new file.ts"), "n\n");
    g("add", "-A"); g("commit", "-q", "-m", "web only");
    const web = g("rev-parse", "HEAD");
    renameSync(join(dir, "server", "a.js"), join(dir, "server", "b.js"));
    g("add", "-A"); g("commit", "-q", "-m", "rename a server file");
    const renamed = g("rev-parse", "HEAD");
    g("update-ref", "refs/remotes/origin/main", renamed);

    const git = createGit({ cwd: dir });
    expect(await git.headOfMain()).toBe(renamed);
    expect(await git.hasCommit(first)).toBe(true);
    expect(await git.hasCommit("0".repeat(40))).toBe(false);
    expect((await git.changedFiles(first, web))!.sort()).toEqual(["src/app.ts", "src/new file.ts"]);
    expect((await git.changedFiles(web, renamed))!.sort()).toEqual(["server/a.js", "server/b.js"]);     // a rename = the old and the new name
    expect(await git.changedFiles(first, first)).toEqual([]);
    expect(await git.changedFiles("0".repeat(40), renamed)).toBeNull();
    expect(g("status", "--porcelain")).toBe("");                                                          // nothing was written
  });
});

describe("R9 createSay: one line to the log and to the run's summary", () => {
  it("both; a summary that cannot be written, or a log that throws, never stops the run", () => {
    const logs: string[] = [];
    const files: Array<[string, string]> = [];
    const say = createSay({ env: { GITHUB_STEP_SUMMARY: "/tmp/summary.md" }, log: (l: string) => logs.push(l), append: ((f: string, t: string) => files.push([f, t])) as never });
    say("Skipped: nothing new.");
    expect(logs).toEqual(["Skipped: nothing new."]);
    expect(files).toEqual([["/tmp/summary.md", "Skipped: nothing new.\n\n"]]);
    const quiet = createSay({ env: {}, log: () => { throw new Error("x"); }, append: (() => { throw new Error("must not be called"); }) as never });
    expect(() => quiet("line")).not.toThrow();
    const broken = createSay({ env: { GITHUB_STEP_SUMMARY: "/nope" }, log: (l: string) => logs.push(l), append: (() => { throw new Error("disk"); }) as never });
    expect(() => broken("still printed")).not.toThrow();
    expect(logs.at(-1)).toBe("still printed");
  });
});

describe("R11 the script as the workflow starts it (a real process on the REAL clock; none of these cases reaches the network)", () => {
  /**
   * Starts the real script. `at` = the hour the machine's clock shows to that process: the TEST puts a
   * clock in front of the process (a file loaded before the script). The script itself has no way to
   * be told the time — the last test of this block proves that.
   */
  const start = (env: Record<string, string>, at?: number) => {
    const dirTmp = mkdtempSync(join(tmpdir(), "nightly-run-"));
    const summary = join(dirTmp, "summary.md");
    writeFileSync(summary, "");
    const args = ["scripts/nightly-deploy/run.mjs"];
    if (at !== undefined) {
      const clockFile = join(dirTmp, "machine-clock.cjs");
      writeFileSync(clockFile, `Date.now = () => ${JSON.stringify(at)};\n`);
      args.unshift("--require", clockFile);
    }
    let code = 0;
    let out: string;
    try {
      out = execFileSync(process.execPath, args, {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "", GITHUB_STEP_SUMMARY: summary, GITHUB_REPOSITORY: "jeff/sellerflow", ...env },
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      code = err.status ?? -1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    const sum = readFileSync(summary, "utf8");
    rmSync(dirTmp, { recursive: true, force: true });
    return { code, out: out.trim(), sum: sum.trim() };
  };
  // These four are started "by hand" (the Run workflow button), so the hour the tests run at does not matter.
  const HAND = { GITHUB_EVENT_NAME: "workflow_dispatch" };
  it("not on main → one line, exit 0, the same line in the run's summary", () => {
    const r = start({ GITHUB_REF: "refs/heads/claude/x", ...HAND, RENDER_DEPLOY_HOOK_URL: HOOK });
    expect(r).toEqual({ code: 0, out: "Skipped: this run is not on main. The nightly deploy only works from main.", sum: "Skipped: this run is not on main. The nightly deploy only works from main." });
  });
  it("secret missing → one line, exit 0", () => {
    const r = start({ GITHUB_REF: "refs/heads/main", ...HAND });
    expect([r.code, r.out]).toEqual([0, "Skipped: the Render Deploy Hook is not saved yet (repository secret RENDER_DEPLOY_HOOK_URL)."]);
  });
  it("a secret that is not a Render Deploy Hook → exit 1, and no part of it in the output", () => {
    const r = start({ GITHUB_REF: "refs/heads/main", ...HAND, RENDER_DEPLOY_HOOK_URL: `https://example.com/deploy?key=${KEY}` });
    expect(r.code).toBe(1);
    expect(r.out).toBe("Stopped: the saved secret RENDER_DEPLOY_HOOK_URL is not a Render Deploy Hook address. Copy it again from Render. Nothing was deployed.");
    expect(`${r.out}${r.sum}`).not.toContain(KEY);
  });
  it("no GitHub token → exit 1 before anything is asked of Render, and the hook is not in the output", () => {
    const r = start({ GITHUB_REF: "refs/heads/main", ...HAND, RENDER_DEPLOY_HOOK_URL: HOOK });
    expect(r.code).toBe(1);
    expect(r.out).toBe("Stopped: GitHub did not answer the question about the tag render-deployed (answer 0). Nothing was deployed.");
    expect(`${r.out}${r.sum}`).not.toContain(KEY);
  });

  // A SCHEDULED run reads the machine's clock.
  const NO_TAG = "Stopped: GitHub did not answer the question about the tag render-deployed (answer 0). Nothing was deployed.";
  const SCHED = { GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "schedule", RENDER_DEPLOY_HOOK_URL: HOOK };
  const timeLine = (at: string, plan = "") => `Skipped: this run started at ${at} Taiwan time${plan ? ` (GitHub had it planned for ${plan})` : ""}. A scheduled run deploys only between 03:30 and 05:30 Taiwan time. Nothing was deployed; the next scheduled run inside that window tries again.`;
  it("scheduled, the machine's clock at 09:50 Taipei (the run that was found): one line, exit 0, nobody is asked — it needs no GitHub token", () => {
    const r = start({ ...SCHED, NIGHTLY_DEPLOY_PLANNED: "0 20 * * *" }, Date.parse("2026-11-19T01:50:14Z"));
    expect(r).toEqual({ code: 0, out: timeLine("09:50", "04:00"), sum: timeLine("09:50", "04:00") });
    expect(`${r.out}${r.sum}`).not.toContain(KEY);
  });
  it("scheduled at 03:29 / 05:31 → the time line; at 03:30 / 05:30 → it goes on to the next question (GitHub, which this test does not have)", () => {
    expect(start(SCHED, taipei("03:29")).out).toBe(timeLine("03:29"));
    expect(start(SCHED, taipei("05:31")).out).toBe(timeLine("05:31"));
    for (const clock of ["03:30", "05:30"]) {
      const r = start(SCHED, taipei(clock));
      expect([r.code, r.out], clock).toEqual([1, NO_TAG]);
    }
  });
  it("scheduled and paused: the pause line inside the window (04:07), the time line outside it (09:50) — exit 0 both ways", () => {
    const env = { ...SCHED, NIGHTLY_DEPLOY_PAUSE_UNTIL: "2999-01-01" };
    expect(start(env, taipei("04:07"))).toMatchObject({ code: 0, out: "Skipped: the nightly deploy is paused until 2999-01-01 (variable NIGHTLY_DEPLOY_PAUSE_UNTIL)." });
    expect(start(env, taipei("09:50"))).toMatchObject({ code: 0, out: timeLine("09:50") });
  });
  it("started by hand at 14:00: the window does not stop it (it goes on to GitHub)", () => {
    const r = start({ ...SCHED, ...HAND }, taipei("14:00"));
    expect([r.code, r.out]).toEqual([1, NO_TAG]);
  });
  it("'only tell me' at 14:00, from the real script: four lines, the last one about the time", () => {
    const r = start({ ...SCHED, ...HAND, NIGHTLY_DEPLOY_DRY_RUN: "1" }, taipei("14:00"));
    const lines = r.out.split("\n");
    expect(r.code).toBe(0);
    expect(lines.length).toBe(4);
    expect(lines[3]).toBe("Time now: 14:00 Taiwan time. A scheduled run starting now would NOT be allowed to deploy (window: 03:30 to 05:30 Taiwan time). A run started by hand is not bound by the window.");
    expect(r.out).not.toContain(KEY);
  });
  it("the machine's own clock, untouched: the line is the one the pure rule gives for this very moment", () => {
    const before = Date.now();
    const r = start({ ...SCHED, NIGHTLY_DEPLOY_PLANNED: "7 20 * * *" });
    const after = Date.now();
    const ok = new Set<string>();
    for (const ms of [before, after]) ok.add(inDeployWindow(ms) ? NO_TAG : timeLine(taipeiClock(ms), "04:07"));
    for (let ms = before; ms <= after; ms += 1000) ok.add(inDeployWindow(ms) ? NO_TAG : timeLine(taipeiClock(ms), "04:07"));
    expect([...ok]).toContain(r.out);
    expect(r.code).toBe(r.out === NO_TAG ? 1 : 0);
    expect(r.sum).toBe(r.out);
    expect(plannedClock("7 20 * * *")).toBe("04:07");
  });
  it("no setting can move the clock or switch the window off for a scheduled run", () => {
    // every name a "test clock" or an "off switch" could plausibly have — none of them is read
    const tries = { NIGHTLY_DEPLOY_NOW: "2026-11-19T20:05:00Z", NIGHTLY_DEPLOY_TIME: "04:05", NIGHTLY_DEPLOY_WINDOW: "off", NIGHTLY_DEPLOY_IGNORE_WINDOW: "1",
      NIGHTLY_DEPLOY_FORCE: "1", NIGHTLY_DEPLOY_BY_HAND: "1", NIGHTLY_DEPLOY_DRY_RUN: "0", TZ: "Pacific/Honolulu", NOW: "1795000000000", FAKE_NOW: "1795000000000", INPUT_DRY_RUN: "false" };
    expect(start({ ...SCHED, ...tries }, taipei("09:50"))).toMatchObject({ code: 0, out: timeLine("09:50") });
    expect(start({ ...SCHED, ...tries, TZ: "Asia/Tokyo" }, taipei("05:31")).out).toBe(timeLine("05:31"));
    // the planned time is only ever printed; it cannot move the window either
    expect(start({ ...SCHED, NIGHTLY_DEPLOY_PLANNED: "50 1 * * *" }, taipei("09:50")).out).toBe(timeLine("09:50", "09:50"));
    const srcRun = readFileSync("scripts/nightly-deploy/run.mjs", "utf8");
    const envNames = [...srcRun.matchAll(/\benv\.([A-Z_]+)|\benv\[([A-Z_]+)\]/g)].map((m) => m[1] || m[2]).filter((v, k, a) => a.indexOf(v) === k).sort();
    expect(envNames).toEqual(["GITHUB_API_URL", "GITHUB_EVENT_NAME", "GITHUB_REF", "GITHUB_REPOSITORY", "GITHUB_STEP_SUMMARY", "GITHUB_TOKEN", "HOOK_SECRET", "NIGHTLY_DEPLOY_DRY_RUN", "NIGHTLY_DEPLOY_PLANNED", "PAUSE_VARIABLE"]);
    expect(srcRun).not.toMatch(/process\.argv\.slice|process\.argv\[2\]/);     // and no command-line switch
  });
});

describe("R10 the script's own text: the hook is never near a print", () => {
  const src = readFileSync("scripts/nightly-deploy/run.mjs", "utf8");
  const code = src.split("\n").filter((l) => !/^(\/\/|\/\*|\*)/.test(l.trim())).join("\n");   // comments are not code
  it("the secret is read in ONE place and used in exactly two: the shape check and the hook call", () => {
    expect(code.split("env[HOOK_SECRET]").length - 1).toBe(1);
    expect(code.split("RENDER_DEPLOY_HOOK_URL").length - 1).toBe(0);     // only through the name in decide.mjs
    const uses = code.split("\n").filter((l) => /\brawHook\b/.test(l)).map((l) => l.trim());
    expect(uses).toEqual([
      "const rawHook = env[HOOK_SECRET];",
      "hook: hookState(rawHook),",
      "const answer = await hook(rawHook, headSha);",
    ]);
  });
  it("no printed line is built from an address, an answer body or an error", () => {
    const printed = code.split("\n").filter((l) => /\bsay\(|console\.|\blog\(/.test(l));
    expect(printed.length).toBeGreaterThan(5);
    for (const l of printed) expect(l, l).not.toMatch(/rawHook|rawUrl|\burl\b|\.json\b|\.text\(|\be\b\.message|\.stack|String\(e\)|\$\{e\}|answer\.body|token/i);
    expect(code).not.toMatch(/catch\s*\(\s*\w+\s*\)\s*\{[^}]*say\([^)]*\b(e|err|error)\b[^)]*\)/);
    expect(code).not.toContain("console.error");
  });
  it("the clock: the real one by default, read as the run begins and AGAIN right before the hook — with nothing awaited in between", () => {
    expect(code.split("now = Date.now").length - 1).toBe(1);                       // the default of runNightlyDeploy
    expect(code.split("Date.now").length - 1).toBe(1);
    expect(code).not.toMatch(/\bnow:\s|now,\s*\n\s*\}\);/);                        // the workflow's start passes no clock of its own
    const mainAt = code.indexOf("async function main()");
    expect(code.slice(mainAt)).not.toMatch(/\bnow\b/);
    expect(code.split("now()").length - 1).toBe(2);                                 // the two readings, and no third
    const first = code.indexOf("const outside = checkWindow(setup);");
    const setupAt = code.indexOf("const early = checkSetup(setup);");
    const second = code.indexOf('const closed = checkWindow({ ...setup, nowMs: now() }, "hook");');
    const call = code.indexOf("const answer = await hook(rawHook, headSha);");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(setupAt);                                            // the time is the FIRST question
    const dryLine = "if (dryRun) return await tellOnly({ setup, git, github, say });";
    expect(code.indexOf(dryLine)).toBeGreaterThan(0);
    expect(code.slice(code.indexOf(dryLine) + dryLine.length, first)).not.toMatch(/\bawait\b|git\.|github\./);   // nothing is asked before the time
    expect(second).toBeGreaterThan(code.indexOf("const wait = checkCi(facts);"));  // after everything else said "deploy"
    expect(call).toBeGreaterThan(second);
    const between = code.slice(second, call);
    expect(between).not.toMatch(/\bawait\b/);
    expect(between.split("\n").map((l) => l.trim()).filter(Boolean)).toEqual([
      'const closed = checkWindow({ ...setup, nowMs: now() }, "hook");',
      "if (closed) return end(closed);",
      "say(deployLine(facts));",
    ]);
    expect(code.split("await hook(").length - 1).toBe(1);                           // ONE place calls Render
    expect(code.split("checkWindow(").length - 1).toBe(2);
  });
  it("the real decision never uses the rules-without-the-time; only 'only tell me' does", () => {
    const tellAt = code.indexOf("async function tellOnly(");
    const tellEnd = code.indexOf("\n}\n", tellAt);
    expect(code.split("decideApartFromTime(").length - 1).toBe(1);
    const useAt = code.indexOf("decideApartFromTime(");
    expect(useAt).toBeGreaterThan(tellAt);
    expect(useAt).toBeLessThan(tellEnd);
    expect(code.slice(tellAt, tellEnd)).not.toMatch(/\bhook\(|moveTag/);
    expect(code.slice(tellAt, tellEnd)).toContain("say(windowLine(setup.nowMs));");
  });
  it("no packages: only Node's own modules and decide.mjs", () => {
    // every kind of import (with or without "from", and import("…")), read by TypeScript's own reader
    const imported = ts.preProcessFile(src, true, true).importedFiles.map((f) => f.fileName).sort();
    expect(imported).toEqual(["./decide.mjs", "node:child_process", "node:fs", "node:url"]);
    expect(ts.preProcessFile(readFileSync("scripts/nightly-deploy/decide.mjs", "utf8"), true, true).importedFiles).toEqual([]);
    const decideSrc = readFileSync("scripts/nightly-deploy/decide.mjs", "utf8");
    expect(decideSrc).not.toMatch(/\bimport\b|\brequire\(|process\.|fetch\(|Date\.now|console\./);   // pure
  });
});
