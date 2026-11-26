// @vitest-environment node
// Nightly Render deploy — two things that must stay true in the REPOSITORY:
//   P. the list of "server code" (scripts/nightly-deploy/decide.mjs) covers every file the Render
//      server really loads — found by walking the imports from server.js, not by a list kept by hand;
//   W. the workflow file: when it runs, what it may do, and that the hook secret never meets a print.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import ts from "typescript";
import { isServerPath, SERVER_FILES, CI_WORKFLOW, DEPLOYED_TAG, HOOK_SECRET, PAUSE_VARIABLE, plannedClock, inDeployWindow, WINDOW_FROM_MIN, WINDOW_TO_MIN } from "../../../../scripts/nightly-deploy/decide.mjs";

const ROOT = process.cwd();

/** Every repository file reached from `entry` through import / export-from / import("…"). */
function loadedFrom(entry: string) {
  const seen = new Set<string>();
  const missing: string[] = [];
  const packages = new Set<string>();
  const walk = (abs: string) => {
    const rel = relative(ROOT, abs).split("\\").join("/");
    if (seen.has(rel)) return;
    seen.add(rel);
    for (const f of ts.preProcessFile(readFileSync(abs, "utf8"), true, true).importedFiles) {
      const spec = f.fileName;
      if (!spec.startsWith(".")) { packages.add(spec); continue; }
      const next = resolve(dirname(abs), spec);
      if (!existsSync(next)) { missing.push(`${rel} → ${spec}`); continue; }
      walk(next);
    }
  };
  walk(resolve(ROOT, entry));
  return { files: [...seen].sort(), missing, packages: [...packages].sort() };
}

describe("P the server-code list covers what the Render server really loads", () => {
  const server = loadedFrom("server.js");
  it("Render starts the server with: node server.js (exec: no shell left between npm and node, so a stop signal reaches the server)", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.start).toBe("exec node server.js");
  });
  it("the walk works: it finds the server's own files and no import that leads nowhere", () => {
    expect(server.files.length).toBeGreaterThan(50);
    expect(server.files).toContain("server.js");
    expect(server.files).toContain("server/telegramAlert.js");
    expect(server.files).toContain("server/versionAlert.js");
    expect(server.missing).toEqual([]);
  });
  it("EVERY file the server loads is on the list — add a new one to SERVER_FILES in decide.mjs", () => {
    const notCovered = server.files.filter((f) => !isServerPath(f));
    expect(notCovered, `the server loads these, but a change in them would not be deployed: ${notCovered.join(", ")}`).toEqual([]);
  });
  it("the files outside server/ are exactly the three on the list (no stale name, none missing)", () => {
    const outside = server.files.filter((f) => f !== "server.js" && !f.startsWith("server/"));
    expect(outside).toEqual(["src/lib/errCodes.js", "src/lib/helpBotGuard.js", "src/lib/receiptLayout.js"]);
    for (const f of outside) expect(SERVER_FILES).toContain(f);
    const listedShared = SERVER_FILES.filter((f) => f.startsWith("src/"));
    expect(listedShared.sort()).toEqual(outside);
  });
  it("every listed file exists, except the four Render / npm setting files that are there for the day one is added", () => {
    const optional = ["render.yaml", ".node-version", ".nvmrc", ".npmrc"];
    for (const f of SERVER_FILES) expect(existsSync(f), f).toBe(!optional.includes(f));
  });
  it("files the server reads from disk by a path of its own: inside server/, or the help guide's fallback copy", () => {
    // new URL("./x", import.meta.url) — the way server.js names a file next to itself
    const reads: string[] = [];
    for (const f of server.files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/new URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
        reads.push(relative(ROOT, resolve(dirname(resolve(ROOT, f)), m[1])).split("\\").join("/"));
      }
    }
    // The guide is NOT a deploy trigger on purpose: the bot reads it from the database (support_guide);
    // this file is only the fallback, and it changes with almost every app change.
    const knownNotServer = ["docs/support/sfl-guide.md"];
    expect(reads.filter((r) => !isServerPath(r))).toEqual(knownNotServer);
    expect(isServerPath("docs/support/sfl-guide.md")).toBe(false);
  });
  it("the packages the server imports are in package.json (so a change of them is a package.json / lock change)", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
    const builtIn = (p: string) => p.startsWith("node:") || ["fs", "fs/promises", "http", "https", "path", "url", "crypto", "os", "zlib", "stream", "events", "util", "child_process", "perf_hooks"].includes(p);
    const outside = server.packages.filter((p) => !builtIn(p)).map((p) => (p.startsWith("@") ? p.split("/").slice(0, 2).join("/") : p.split("/")[0]));
    expect(outside.length).toBeGreaterThan(3);
    for (const p of outside) expect(deps, p).toContain(p);
  });
  it("the nightly deploy's own files are NOT server code (changing them restarts nothing)", () => {
    for (const f of ["scripts/nightly-deploy/decide.mjs", "scripts/nightly-deploy/run.mjs", ".github/workflows/nightly-render-deploy.yml", "docs/ops/nightly-render-deploy.md"]) expect(isServerPath(f), f).toBe(false);
    expect(server.files.some((f) => f.startsWith("scripts/"))).toBe(false);
  });
});

describe("W the workflow file", () => {
  const yml = readFileSync(".github/workflows/nightly-render-deploy.yml", "utf8");
  const code = yml.split("\n").filter((l) => !l.trim().startsWith("#")).map((l) => l.replace(/\s+#.*$/, "")).join("\n");
  /** the lines of a top-level block ("on:", "permissions:" …), without the head line */
  const block = (name: string) => {
    const lines = code.split("\n");
    const at = lines.findIndex((l) => l === `${name}:`);
    expect(at, name).toBeGreaterThanOrEqual(0);
    const out: string[] = [];
    for (let i = at + 1; i < lines.length && (lines[i].startsWith(" ") || lines[i] === ""); i++) if (lines[i].trim()) out.push(lines[i]);
    return out;
  };

  const crons = [...code.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  /** minutes after midnight in Taipei of a "minute hour * * *" line (UTC) */
  const taipeiMin = (cron: string) => { const [m, h] = cron.split(" ").map(Number); return (h * 60 + m + 8 * 60) % 1440; };
  it("six starts a night, every night, and nothing else on a clock", () => {
    expect(crons).toEqual(["37 19 * * *", "52 19 * * *", "7 20 * * *", "22 20 * * *", "41 20 * * *", "56 20 * * *"]);
    for (const c of crons) expect(c, c).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);          // a minute, an hour, every day
    expect(crons.map(plannedClock)).toEqual(["03:37", "03:52", "04:07", "04:22", "04:41", "04:56"]);
    // the same times by the machine's own time-zone table (not by this file's arithmetic)
    for (const c of crons) {
      const [m, h] = c.split(" ").map(Number);
      expect(new Date(Date.UTC(2026, 10, 19, h, m)).toLocaleString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }), c).toBe(plannedClock(c));
    }
  });
  it("every start is planned INSIDE the deploy window 03:30–05:30 Asia/Taipei, with room on both sides", () => {
    for (const c of crons) {
      const [m, h] = c.split(" ").map(Number);
      expect(inDeployWindow(Date.UTC(2026, 10, 19, h, m)), c).toBe(true);
      expect(inDeployWindow(Date.UTC(2026, 5, 30, h, m)), c).toBe(true);            // the same in summer: Taiwan has no summer time
    }
    const mins = crons.map(taipeiMin);
    expect(mins[0] - WINDOW_FROM_MIN).toBeGreaterThanOrEqual(5);                    // never planned for the very first minute
    expect(WINDOW_TO_MIN - mins.at(-1)!).toBeGreaterThanOrEqual(30);               // the last one may start 30 minutes late and still deploy
  });
  it("in order, at least 15 minutes apart (a run is cut after 10, so two planned starts never overlap), none at the start of an hour or on :30", () => {
    const mins = crons.map(taipeiMin);
    for (let i = 1; i < mins.length; i++) expect(mins[i] - mins[i - 1], `${crons[i - 1]} → ${crons[i]}`).toBeGreaterThanOrEqual(15);
    for (const c of crons) expect([0, 30]).not.toContain(Number(c.split(" ")[0]));
    expect(code).toMatch(/timeout-minutes: 10/);
  });
  it("the comment next to each line says its Taipei time, and it is the right one", () => {
    const withNotes = [...yml.matchAll(/cron:\s*"([^"]+)"\s*#\s*(\d{2}:\d{2}) Asia\/Taipei/g)].map((m) => [m[1], m[2]]);
    expect(withNotes.length).toBe(crons.length);
    for (const [cron, note] of withNotes) expect(note, cron).toBe(plannedClock(cron));
  });
  it("the run is told which schedule line started it — from GitHub's own event, as the script's environment", () => {
    expect(code).toContain("NIGHTLY_DEPLOY_PLANNED: ${{ github.event.schedule }}");
    expect(code.split("github.event").length - 1).toBe(1);
    const envAt = code.indexOf("        env:");
    expect(code.indexOf("github.event.schedule")).toBeGreaterThan(envAt);
    expect(code.indexOf("github.event.schedule")).toBeLessThan(code.indexOf("        run: node"));
  });
  it("nothing in the workflow file can move the clock or switch the window off", () => {
    const names = [...code.matchAll(/^\s{10}([A-Z_]+):/gm)].map((m) => m[1]);
    expect(names).toEqual(["GITHUB_TOKEN", "RENDER_DEPLOY_HOOK_URL", "NIGHTLY_DEPLOY_PAUSE_UNTIL", "NIGHTLY_DEPLOY_DRY_RUN", "NIGHTLY_DEPLOY_PLANNED"]);
    expect(code).not.toMatch(/\bTZ:|faketime|\bif:\s/);                              // no step is switched on or off by a condition
    expect(code.split("inputs.").length - 1).toBe(1);                                // the one tick box, and no other choice
  });
  it("it starts ONLY on the clock or by the Run workflow button — never on a push or a pull request", () => {
    const on = block("on");
    const triggers = on.filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim());
    expect(triggers).toEqual(["schedule:", "workflow_dispatch:"]);
    expect(code).not.toMatch(/\bpull_request|\bpush:|workflow_run|repository_dispatch/);
  });
  it("the button has ONE choice, off unless ticked: only tell me what would happen", () => {
    expect(block("on").join("\n")).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}dry_run:\n {8}description: "Only tell me what would happen \(deploys nothing\)"\n {8}type: boolean\n {8}default: false/);
    expect(code).toContain("NIGHTLY_DEPLOY_DRY_RUN: ${{ inputs.dry_run && '1' || '0' }}");
  });
  it("permissions: move a tag + read the CI result — nothing more, and none per job", () => {
    expect(block("permissions").map((l) => l.trim()).sort()).toEqual(["actions: read", "contents: write"]);
    expect(code.split("permissions:").length - 1).toBe(1);
    expect(code).not.toMatch(/write-all|id-token|pull-requests|deployments:|packages:|issues:/);
  });
  it("one run at a time; a second one waits and is not cancelled", () => {
    expect(block("concurrency").map((l) => l.trim())).toEqual(["group: nightly-render-deploy", "cancel-in-progress: false"]);
  });
  it("ONE action (GitHub's own checkout), whole history, and it keeps no login", () => {
    expect([...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])).toEqual(["actions/checkout@v4"]);
    expect(code).toMatch(/uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 0\n\s+persist-credentials: false/);
  });
  it("ONE command, and it is the script — no shell line ever sees the secret", () => {
    expect([...code.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1].trim())).toEqual(["node scripts/nightly-deploy/run.mjs"]);
    expect(code).not.toMatch(/run:\s*\|/);
    expect(code).not.toMatch(/\becho\b|\bcurl\b|\bwget\b|\bprintenv\b|set -x|ACTIONS_STEP_DEBUG/);
    expect(existsSync("scripts/nightly-deploy/run.mjs")).toBe(true);
  });
  it("the hook secret appears ONCE, as the script's environment; the token once; no install step", () => {
    expect(code.split("secrets.").length - 1).toBe(1);
    expect(code).toContain(`${HOOK_SECRET}: \${{ secrets.${HOOK_SECRET} }}`);
    expect(code.split("github.token").length - 1).toBe(1);
    expect(code).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(code).toContain(`${PAUSE_VARIABLE}: \${{ vars.${PAUSE_VARIABLE} }}`);
    expect(code).not.toMatch(/npm (ci|install)|setup-node|npx /);
    const envAt = code.indexOf("        env:");
    const runAt = code.indexOf("        run: node");
    expect(envAt).toBeGreaterThan(0);
    expect(code.indexOf("secrets.")).toBeGreaterThan(envAt);
    expect(code.indexOf("secrets.")).toBeLessThan(runAt);
  });
  it("a hung run is cut (10 minutes), on GitHub's own machine", () => {
    expect(code).toMatch(/runs-on: ubuntu-latest\n\s+timeout-minutes: 10/);
  });
  it("the names in the comments are the real ones", () => {
    expect(yml).toContain(`"${DEPLOYED_TAG}"`);
    expect(yml).toContain(HOOK_SECRET);
    expect(yml).toContain("docs/ops/nightly-render-deploy.md");
  });
});

describe("C the CI workflow the nightly deploy waits for", () => {
  const ci = readFileSync(`.github/workflows/${CI_WORKFLOW}`, "utf8");
  it("it is ci.yml, and it runs on EVERY push (so every commit of main gets a result)", () => {
    expect(CI_WORKFLOW).toBe("ci.yml");
    expect(ci).toMatch(/^on:\n {2}push:\n {2}pull_request:\n/m);     // "push:" with nothing under it = every branch
    expect(ci).toMatch(/^name: CI$/m);
  });
  it("it runs the type check, the tests and the build", () => {
    for (const step of ["npm run typecheck", "npm test", "npm run build"]) expect(ci).toContain(`- run: ${step}`);
  });
});
