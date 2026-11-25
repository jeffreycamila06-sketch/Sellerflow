// In-page QR scanner — the byte fence. Proves that the branch did not change ONE byte of:
//   • anything under mobile/ (no app build is part of this feature) — and no file was added or removed there;
//   • every printing file (scripts/printing-paths.mjs) and every other file whose path names printing,
//     stickers, receipts, printers or Bluetooth;
//   • the native scanner's adapter and the centre rule (their behaviour must stay exactly as it is);
//   • everything that is not the website: server.js, server/, chrome-extension/, the packages
//     (package.json / package-lock.json — no new dependency), vercel.json, .github/.
// It compares git's own content ids (the id IS the content) of the commit being checked with the ids
// taken from main when the branch was cut (the fixture). Run:
//   node scripts/web-qr-scanner-fence.mjs --check            (HEAD vs the fixture, + nothing uncommitted there)
//   node scripts/web-qr-scanner-fence.mjs --write origin/main (make the fixture again from a commit —
//                                                              only after merging a newer main into the branch)
// The vitest copy (src/redesign/__tests__/webQrScanner.fence.test.ts) runs this check on the scanner's
// own branches (claude/web-qr-scanner, claude/web-qr-scanner-testers — also in CI) or with WEB_QR_GATE=1;
// on any other branch it is skipped, so later work on printing or the app builds is never blocked by it.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPrintingFile, PRINTING_MAP } from "./printing-paths.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE = "src/redesign/__tests__/fixtures/webQrScannerFence.json";

// Files outside the printing list that are still printing / Bluetooth by name, + the two scanner files
// that must stay as they are.
const BY_NAME = /(print|sticker|receipt|bluetooth|niimbot|tspl|escpos|cpcl|glyph|atlas|btstate|btoff|blesticker|genericble)/i;
const ALSO = new Set([
  "src/redesign/adapters/nativeQrScanner.ts",
  "src/lib/qrCentrePick.ts",
  "public/native-version.json",
  "server.js", "package.json", "package-lock.json", "vercel.json",
  PRINTING_MAP,
]);
const WHOLE_FOLDERS = ["mobile/", "server/", "chrome-extension/", ".github/"];
/** Is this path inside the fence? */
export function fenced(path) {
  const p = String(path || "");
  if (p === FIXTURE) return false;
  return WHOLE_FOLDERS.some((f) => p.startsWith(f)) || isPrintingFile(p) || ALSO.has(p) || (/^(src|scripts|public)\//.test(p) && BY_NAME.test(p));
}

const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
/** Every fenced file of a commit: path → git content id. */
export function treeOf(ref, cwd = ROOT) {
  const out = {};
  for (const line of git(["ls-tree", "-r", "-z", ref], cwd).split("\0")) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);
    if (!m || m[2] !== "blob") continue;
    if (fenced(m[4])) out[m[4]] = `${m[1]}:${m[3]}`; // the file mode counts too (an executable bit is a change)
  }
  return out;
}
/** What differs between the fixture and a commit's fenced files. [] = byte-identical. */
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
/** Files of the fence with a change that is not committed yet (the working folder). */
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
    const from = ref || "origin/main";
    const base = git(["rev-parse", from]).trim();
    const files = treeOf(base);
    writeFileSync(resolve(ROOT, FIXTURE), JSON.stringify({ base, files }, null, 1) + "\n");
    console.log(`fixture written from ${base.slice(0, 8)}: ${Object.keys(files).length} files`);
  } else if (mode === "--check") {
    const r = checkHead();
    if (r.problems.length) { console.error(r.problems.join("\n")); console.error(`FAIL — ${r.problems.length} difference(s) from ${r.base.slice(0, 8)}`); process.exit(1); }
    console.log(`PASS — ${r.files} files (all of mobile/, server, chrome-extension, the packages, every printing / Bluetooth file, the native scanner adapter) are byte-identical to ${r.base.slice(0, 8)}`);
  } else {
    console.error("usage: node scripts/web-qr-scanner-fence.mjs --check | --write [commit]");
    process.exit(2);
  }
}
