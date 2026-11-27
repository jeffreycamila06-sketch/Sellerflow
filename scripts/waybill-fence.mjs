// Waybill username — the byte fence. Proves the branch did not change ONE byte of:
//   • every printing file (scripts/printing-paths.mjs) and every other file whose path names printing,
//     stickers, receipts, printers or Bluetooth (this feature makes a PDF; it never talks to a printer);
//   • anything under mobile/ (no app build), server/ and server.js (no server change, no Render deploy),
//     chrome-extension/ — and no file was added or removed there.
// It compares git's own content ids (the id IS the content) of the commit being checked with the ids taken
// from main when the branch was cut (the fixture). Run:
//   node scripts/waybill-fence.mjs --check             (HEAD vs the fixture, + nothing uncommitted there)
//   node scripts/waybill-fence.mjs --write origin/main (make the fixture again — only after merging a newer main)
// The vitest copy (src/redesign/__tests__/waybillUsername.fence.test.ts) runs it on the branch
// claude/waybill-username (also in CI) or with WAYBILL_GATE=1; elsewhere it is skipped.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPrintingFile } from "./printing-paths.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE = "src/redesign/__tests__/fixtures/waybillFence.json";
const BY_NAME = /(print|sticker|receipt|bluetooth|niimbot|tspl|escpos|cpcl|glyph|atlas|btstate|btoff|blesticker|genericble)/i;
const WHOLE_FOLDERS = ["mobile/", "server/", "chrome-extension/"];
export function fenced(path) {
  const p = String(path || "");
  if (p === FIXTURE) return false;
  return WHOLE_FOLDERS.some((f) => p.startsWith(f)) || p === "server.js" || isPrintingFile(p) || (/^(src|scripts|public)\//.test(p) && BY_NAME.test(p));
}
const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
export function treeOf(ref, cwd = ROOT) {
  const out = {};
  for (const line of git(["ls-tree", "-r", "-z", ref], cwd).split("\0")) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);
    if (!m || m[2] !== "blob") continue;
    if (fenced(m[4])) out[m[4]] = `${m[1]}:${m[3]}`;
  }
  return out;
}
export function fenceProblems(fixtureFiles, nowFiles) {
  const out = [];
  for (const [p, id] of Object.entries(fixtureFiles)) {
    if (!(p in nowFiles)) out.push(`removed: ${p}`);
    else if (nowFiles[p] !== id) out.push(`changed: ${p}`);
  }
  for (const p of Object.keys(nowFiles)) if (!(p in fixtureFiles)) out.push(`added: ${p}`);
  return out.sort();
}
export function loadFixture(cwd = ROOT) { return JSON.parse(readFileSync(resolve(cwd, FIXTURE), "utf8")); }
export function uncommitted(cwd = ROOT) {
  const out = [];
  for (const rec of git(["status", "--porcelain", "-z", "--untracked-files=all"], cwd).split("\0")) {
    const p = rec.slice(3);
    if (p && fenced(p)) out.push(`not committed: ${p}`);
  }
  return out.sort();
}
export function checkHead(cwd = ROOT) {
  const fx = loadFixture(cwd);
  return { base: fx.base, files: Object.keys(fx.files).length, problems: [...fenceProblems(fx.files, treeOf("HEAD", cwd)), ...uncommitted(cwd)] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ref] = process.argv.slice(2);
  if (mode === "--write") {
    const base = git(["rev-parse", ref || "origin/main"]).trim();
    const files = treeOf(base);
    writeFileSync(resolve(ROOT, FIXTURE), JSON.stringify({ base, files }, null, 1) + "\n");
    console.log(`fixture written from ${base.slice(0, 8)}: ${Object.keys(files).length} files`);
  } else if (mode === "--check") {
    const r = checkHead();
    if (r.problems.length) { console.error(r.problems.join("\n")); console.error(`FAIL — ${r.problems.length} difference(s) from ${r.base.slice(0, 8)}`); process.exit(1); }
    console.log(`PASS — ${r.files} files (every printing / sticker / receipt / Bluetooth file, mobile/, server/, server.js, chrome-extension/) are byte-identical to ${r.base.slice(0, 8)}`);
  } else {
    console.error("usage: node scripts/waybill-fence.mjs --check | --write [commit]");
    process.exit(2);
  }
}
