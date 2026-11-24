// Native QR scanner fence (Android versionCode 11 / iOS build 15) — the mobile/ BYTE PIN.
// ONE source of the rules for src/redesign/__tests__/nativeScannerMain.fence.test.ts (vitest) and for
// mobile/android/qr-scanner-gate.sh (the Mac gate before an upload). Both run it ONLY with SCANNER_GATE=1:
// after the scanner is merged, normal work on mobile/ files must not turn CI red.
//
//   node scripts/native-scanner-fence.mjs --write [ref]            rewrite the fixture from <ref> (default origin/main)
//   SCANNER_GATE=1 node scripts/native-scanner-fence.mjs --check [--base <commit>]
//                                                                   check this checkout; exit 0 = PASS, 1 = FAIL
//
// What it pins: every file under mobile/ that the scanner must NOT change (printer code, Niimbot libraries,
// Swift packages, gradle files …) has the base's exact bytes; the five files the scanner DOES edit equal the
// base's once the EXACT expected scanner lines are taken out — each one the expected number of times, never
// "any line that names the scanner" — and the version numbers are blanked; no other file is added.
// The base = the fixture (main 3dfb26b8), or --base <commit> (the gate passes the newest main commit that
// has no scanner). Git LFS files are compared by their LFS id (= sha256 of the real file), so it reads the
// same with the real libraries and with pointer files.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE = "src/redesign/__tests__/fixtures/nativeScannerFence.json";

/** Files the scanner adds (they do not exist on main). */
export const ADDED = [
  "mobile/android/app/src/main/java/com/sellerflow/live/QrCentrePick.java",
  "mobile/android/app/src/main/java/com/sellerflow/live/QrScannerDialog.java",
  "mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowScannerPlugin.java",
  "mobile/android/app/src/main/res/drawable/sfl_qr_close.xml",
  "mobile/android/app/src/main/res/drawable/sfl_qr_light_off.xml",
  "mobile/android/app/src/main/res/drawable/sfl_qr_light_on.xml",
  "mobile/android/app/src/test/java/com/sellerflow/live/QrCentrePickCases.java",
  "mobile/android/app/src/test/java/com/sellerflow/live/QrCentrePickTest.java",
  "mobile/android/qr-scanner-gate.sh",
  "mobile/android/qr-scanner-gate-check.mjs",
  "mobile/ios/App/App/SellerFlowScannerPlugin.swift",
  "mobile/ios/App/AppTests/QrCentrePickCases.swift",
  "mobile/ios/App/AppTests/QrCentrePickTests.swift",
];

const GRADLE_NDK = `        // Ship exactly the chip types the app ships today (the Niimbot printer AARs are ARM-only);
        // CameraX / ML Kit's other chip types are left out. Checked by mobile/android/qr-scanner-gate.sh.
        ndk {
            abiFilters "armeabi-v7a", "arm64-v8a"
        }
`;
const GRADLE_DEPS = `    // Live "Scan sticker QR" (SellerFlowScannerPlugin): CameraX + Google ML Kit barcode scanning with the
    // BUNDLED model (no Google Play services, works offline the first time). Check with
    // mobile/android/qr-scanner-gate.sh before an upload (size, 16 KB pages, permissions).
    implementation "androidx.camera:camera-core:1.5.2"
    implementation "androidx.camera:camera-camera2:1.5.2"
    implementation "androidx.camera:camera-lifecycle:1.5.2"
    implementation "androidx.camera:camera-view:1.5.2"
    implementation "com.google.guava:listenablefuture:1.0"
    implementation "com.google.mlkit:barcode-scanning:17.3.0"
`;
/**
 * Exact scanner text in a file. `lines` = whole lines, each found EXACTLY `n` times on the branch (0 on the base)
 * and removed exactly `n` times; `blocks` = multi-line text, the same. Nothing else is removed: a second
 * registration line, another line naming a scanner file, or one more copy of an expected line stays in the text
 * → "changed beyond the scanner lines" (and the `marker` count names it).
 */
const dropLinesExact = (expected) => (t) => {
  const left = new Map(expected.map(([l, n]) => [l, n]));
  return t.split("\n").filter((l) => {
    const n = left.get(l);
    if (n > 0) { left.set(l, n - 1); return false; }
    return true;
  }).join("\n");
};
const dropBlockExact = (expected) => (t) => {
  let s = t;
  for (const [piece, n] of expected) {
    for (let i = 0; i < n; i++) {
      const k = s.indexOf(piece);
      if (k < 0) break;
      s = s.slice(0, k) + s.slice(k + piece.length);
    }
  }
  return s;
};
const versions = (t) => t
  .replace(/CURRENT_PROJECT_VERSION = \d+;/g, "CURRENT_PROJECT_VERSION = ?;")
  .replace(/MARKETING_VERSION = [\d.]+;/g, "MARKETING_VERSION = ?;")
  .replace(/versionCode \d+/g, "versionCode ?")
  .replace(/versionName "[^"]*"/g, 'versionName "?"');

const MAIN_LINES = [["        registerPlugin(SellerFlowScannerPlugin.class); // live \"Scan sticker QR\" (CameraX + ML Kit)", 1]];
const BRIDGE_LINES = [["        bridge?.registerPluginInstance(SellerFlowScannerPlugin()) // live \"Scan sticker QR\" (SellerFlowScannerPlugin.swift)", 1]];
const PBX_LINES = [
  ["\t\t9F00001000000000000000A4 /* SellerFlowScannerPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = 9F00002000000000000000A4 /* SellerFlowScannerPlugin.swift */; };", 1],
  ["\t\t9FA000000000000000000016 /* QrCentrePickTests.swift in Sources */ = {isa = PBXBuildFile; fileRef = 9FA000000000000000000007 /* QrCentrePickTests.swift */; };", 1],
  ["\t\t9FA000000000000000000017 /* QrCentrePickCases.swift in Sources */ = {isa = PBXBuildFile; fileRef = 9FA000000000000000000008 /* QrCentrePickCases.swift */; };", 1],
  ["\t\t9F00002000000000000000A4 /* SellerFlowScannerPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SellerFlowScannerPlugin.swift; sourceTree = \"<group>\"; };", 1],
  ["\t\t9FA000000000000000000007 /* QrCentrePickTests.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = QrCentrePickTests.swift; sourceTree = \"<group>\"; };", 1],
  ["\t\t9FA000000000000000000008 /* QrCentrePickCases.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = QrCentrePickCases.swift; sourceTree = \"<group>\"; };", 1],
  ["\t\t\t\t9FA000000000000000000007 /* QrCentrePickTests.swift */,", 1],
  ["\t\t\t\t9FA000000000000000000008 /* QrCentrePickCases.swift */,", 1],
  ["\t\t\t\t9F00002000000000000000A4 /* SellerFlowScannerPlugin.swift */,", 1],
  ["\t\t\t\t9F00001000000000000000A4 /* SellerFlowScannerPlugin.swift in Sources */,", 1],
  ["\t\t\t\t9FA000000000000000000016 /* QrCentrePickTests.swift in Sources */,", 1],
  ["\t\t\t\t9FA000000000000000000017 /* QrCentrePickCases.swift in Sources */,", 1],
];
const GRADLE_BLOCKS = [[GRADLE_NDK, 1], [GRADLE_DEPS, 1]];
const PLIST_BLOCKS = [["<string>SellerFlowLive uses the camera to scan the QR code on your order stickers and to scan your parcel slips.</string>", 1]];

/**
 * The five files the scanner edits: the exact scanner lines / blocks, how often each must be there on the
 * branch, the marker that names any scanner line (its line count must equal the expected lines), and `norm`
 * = the file with exactly those lines taken out (+ the version numbers blanked).
 */
export const EDITED = {
  "mobile/android/app/build.gradle": { lines: [], blocks: GRADLE_BLOCKS, marker: null, norm: (t) => versions(dropBlockExact(GRADLE_BLOCKS)(t)) },
  "mobile/android/app/src/main/java/com/sellerflow/live/MainActivity.java": {
    lines: MAIN_LINES, blocks: [], marker: /SellerFlowScanner|QrScanner|QrCentrePick/, norm: dropLinesExact(MAIN_LINES),
  },
  "mobile/ios/App/App/SellerFlowBridgeViewController.swift": {
    lines: BRIDGE_LINES, blocks: [], marker: /SellerFlowScanner|QrScanner|QrCentrePick/, norm: dropLinesExact(BRIDGE_LINES),
  },
  "mobile/ios/App/App/Info.plist": {
    lines: [], blocks: PLIST_BLOCKS, marker: null,
    norm: (t) => t.replace(/(<key>NSCameraUsageDescription<\/key>\s*)<string>[^<]*<\/string>/, "$1<string>?</string>"),
  },
  "mobile/ios/App/App.xcodeproj/project.pbxproj": {
    lines: PBX_LINES, blocks: [], marker: /SellerFlowScanner|QrCentrePick/, norm: (t) => versions(dropLinesExact(PBX_LINES)(t)),
  },
};
/** Every check of one edited file's scanner text (empty = as expected). */
export function scannerLineProblems(p, t) {
  const e = EDITED[p], out = [];
  const all = t.split("\n");
  for (const [line, n] of e.lines) {
    const got = all.filter((l) => l === line).length;
    if (got !== n) out.push(`scanner lines in ${p}: "${line.trim().slice(0, 60)}" ${got}× (expected ${n}×)`);
  }
  for (const [block, n] of e.blocks) {
    const got = t.split(block).length - 1;
    if (got !== n) out.push(`scanner lines in ${p}: "${block.trim().slice(0, 60)}" ${got}× (expected ${n}×)`);
  }
  if (e.marker) {
    const want = e.lines.reduce((s, [, n]) => s + n, 0);
    const got = all.filter((l) => e.marker.test(l)).length;
    if (got !== want) out.push(`scanner lines in ${p}: ${got} line(s) name the scanner (expected ${want})`);
  }
  return out;
}

export const sha = (b) => createHash("sha256").update(b).digest("hex");
/** sha256 of a file's real content; a Git LFS pointer gives its LFS id (the same number). */
export function contentId(buf) {
  const s = buf.subarray(0, 200).toString("utf8");
  if (s.startsWith("version https://git-lfs")) {
    const m = /oid sha256:([0-9a-f]{64})/.exec(buf.toString("utf8"));
    if (m) return m[1];
  }
  return sha(buf);
}
export const normId = (path, text) => sha(Buffer.from(EDITED[path].norm(text)));

const gitIn = (root, ...a) => execFileSync("git", ["-C", root, ...a], { maxBuffer: 256 * 1024 * 1024 });

/** The fixture, read from <ref> (the base = main without the scanner). */
export function fixtureFrom(ref, root = ROOT) {
  const files = gitIn(root, "ls-tree", "-r", "--name-only", ref, "--", "mobile").toString().split("\n").filter(Boolean).sort();
  const unchanged = {}, edited = {};
  for (const f of files) {
    const buf = gitIn(root, "show", `${ref}:${f}`);
    if (EDITED[f]) edited[f] = normId(f, buf.toString("utf8"));
    else if (!ADDED.includes(f)) unchanged[f] = contentId(buf);
  }
  return { from: gitIn(root, "rev-parse", ref).toString().trim(), unchanged, edited };
}

/** One edited file's text against the base's id: the exact scanner lines, each the expected number of times, and nothing else changed. */
export function editedFileProblems(p, t, id) {
  const out = scannerLineProblems(p, t);
  if (normId(p, t) !== id) out.push(`changed beyond the scanner lines: ${p}`);
  return out;
}

/**
 * Check a checkout against a fixture. Returns the problems (empty = PASS). `tracked` = the files git tracks
 * under mobile/ (null = not a git checkout: the "no other file" check is skipped, said in a problem-free note).
 */
export function checkTree(root, fx, tracked) {
  const problems = [];
  const read = (p) => readFileSync(resolve(root, p));
  for (const [p, id] of Object.entries(fx.unchanged)) {
    if (!existsSync(resolve(root, p))) problems.push(`missing: ${p}`);
    else if (contentId(read(p)) !== id) problems.push(`changed: ${p}`);
  }
  for (const [p, id] of Object.entries(fx.edited)) {
    if (!EDITED[p]) { problems.push(`no rule for edited file: ${p}`); continue; }
    if (!existsSync(resolve(root, p))) { problems.push(`missing: ${p}`); continue; }
    problems.push(...editedFileProblems(p, read(p).toString("utf8"), id));
  }
  for (const p of Object.keys(EDITED)) if (!fx.edited[p]) problems.push(`edited file missing from the base: ${p}`);
  if (tracked) {
    const known = new Set([...Object.keys(fx.unchanged), ...Object.keys(fx.edited), ...ADDED]);
    for (const f of tracked) if (!known.has(f)) problems.push(`added: ${f}`);
  }
  return problems;
}

/** The files git tracks under mobile/ in <root>, or null when it is not a git checkout. */
export function trackedMobile(root = ROOT) {
  try { return gitIn(root, "ls-files", "mobile").toString().split("\n").filter(Boolean); } catch { return null; }
}

export const loadFixture = (root = ROOT) => JSON.parse(readFileSync(resolve(root, FIXTURE), "utf8"));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--write") {
    const ref = args[1] || "origin/main";
    const fx = fixtureFrom(ref);
    writeFileSync(resolve(ROOT, FIXTURE), JSON.stringify(fx, null, 1) + "\n");
    console.log(`${FIXTURE}: ${Object.keys(fx.unchanged).length} unchanged + ${Object.keys(fx.edited).length} edited files from ${ref} (${fx.from.slice(0, 8)})`);
  } else if (args[0] === "--check") {
    if (process.env.SCANNER_GATE !== "1") { console.log("mobile/ byte pin: skipped (set SCANNER_GATE=1 — qr-scanner-gate.sh does)"); process.exit(0); }
    const bi = args.indexOf("--base");
    const fx = bi >= 0 ? fixtureFrom(args[bi + 1]) : loadFixture();
    const problems = checkTree(ROOT, fx, trackedMobile());
    const n = Object.keys(fx.unchanged).length + Object.keys(fx.edited).length;
    if (!problems.length) { console.log(`PASS mobile/ byte pin: ${n} files = base ${fx.from.slice(0, 8)} (scanner lines and files only)`); process.exit(0); }
    console.log(`FAIL mobile/ byte pin vs base ${fx.from.slice(0, 8)}: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
    if (problems.length > 60) console.log(`  … and ${problems.length - 60} more`);
    process.exit(1);
  } else {
    console.log("usage: node scripts/native-scanner-fence.mjs --write [ref] | SCANNER_GATE=1 node scripts/native-scanner-fence.mjs --check [--base <commit>]");
    process.exit(2);
  }
}
