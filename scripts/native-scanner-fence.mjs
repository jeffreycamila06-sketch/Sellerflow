// Native QR scanner fence (Android versionCode 11 / iOS build 15). ONE source of the rules for
// src/redesign/__tests__/nativeScannerMain.fence.test.ts and of its fixture.
//
//   node scripts/native-scanner-fence.mjs [ref]   → rewrites the fixture from <ref> (default origin/main)
//
// What it pins: every file under mobile/ that the scanner branch must NOT change (printer code, Niimbot
// libraries, Swift packages, gradle files …) has main's exact bytes, and the five files the scanner DOES
// edit equal main's once the scanner lines are taken out and the version numbers are blanked.
// Git LFS files are compared by their LFS id (= sha256 of the real file), so the test reads the same in
// a checkout with the real libraries and in CI, where they are only pointer files.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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
/** Exact scanner text in a file: each piece must be found exactly `n` times on the branch (0 on main). */
const dropText = (piece) => (t) => t.split(piece).join("");
const dropLines = (re) => (t) => t.split("\n").filter((l) => !re.test(l)).join("\n");
const versions = (t) => t
  .replace(/CURRENT_PROJECT_VERSION = \d+;/g, "CURRENT_PROJECT_VERSION = ?;")
  .replace(/MARKETING_VERSION = [\d.]+;/g, "MARKETING_VERSION = ?;")
  .replace(/versionCode \d+/g, "versionCode ?")
  .replace(/versionName "[^"]*"/g, 'versionName "?"');

/** The five files the scanner edits: what is taken out, and how often it must be there on the branch. */
export const EDITED = {
  "mobile/android/app/build.gradle": { pieces: [[GRADLE_NDK, 1], [GRADLE_DEPS, 1]], norm: (t) => versions(dropText(GRADLE_DEPS)(dropText(GRADLE_NDK)(t))) },
  "mobile/android/app/src/main/java/com/sellerflow/live/MainActivity.java": {
    pieces: [["        registerPlugin(SellerFlowScannerPlugin.class); // live \"Scan sticker QR\" (CameraX + ML Kit)\n", 1]],
    norm: dropLines(/registerPlugin\(SellerFlowScannerPlugin\.class\)/),
  },
  "mobile/ios/App/App/SellerFlowBridgeViewController.swift": {
    pieces: [["        bridge?.registerPluginInstance(SellerFlowScannerPlugin()) // live \"Scan sticker QR\" (SellerFlowScannerPlugin.swift)\n", 1]],
    norm: dropLines(/SellerFlowScannerPlugin\(\)/),
  },
  "mobile/ios/App/App/Info.plist": {
    pieces: [["<string>SellerFlowLive uses the camera to scan the QR code on your order stickers and to scan your parcel slips.</string>", 1]],
    norm: (t) => t.replace(/(<key>NSCameraUsageDescription<\/key>\s*)<string>[^<]*<\/string>/, "$1<string>?</string>"),
  },
  "mobile/ios/App/App.xcodeproj/project.pbxproj": {
    pieces: [["SellerFlowScannerPlugin.swift", 6], ["QrCentrePickTests.swift", 6], ["QrCentrePickCases.swift", 6]],
    norm: (t) => versions(dropLines(/SellerFlowScannerPlugin\.swift|QrCentrePick(Tests|Cases)\.swift/)(t)),
  },
};

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

const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { maxBuffer: 256 * 1024 * 1024 });

/** The fixture, read from <ref> (main). */
export function fixtureFrom(ref) {
  const files = git("ls-tree", "-r", "--name-only", ref, "--", "mobile").toString().split("\n").filter(Boolean).sort();
  const unchanged = {}, edited = {};
  for (const f of files) {
    const buf = git("show", `${ref}:${f}`);
    if (EDITED[f]) edited[f] = normId(f, buf.toString("utf8"));
    else if (!ADDED.includes(f)) unchanged[f] = contentId(buf);
  }
  return { from: git("rev-parse", ref).toString().trim(), unchanged, edited };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ref = process.argv[2] || "origin/main";
  const fx = fixtureFrom(ref);
  writeFileSync(resolve(ROOT, FIXTURE), JSON.stringify(fx, null, 1) + "\n");
  console.log(`${FIXTURE}: ${Object.keys(fx.unchanged).length} unchanged + ${Object.keys(fx.edited).length} edited files from ${ref} (${fx.from.slice(0, 8)})`);
}
