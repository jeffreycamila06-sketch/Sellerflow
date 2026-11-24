// Native QR scanner (Android versionCode 11 / iOS build 15) — the mobile/ BYTE PIN.
// Runs ONLY with SCANNER_GATE=1 (mobile/android/qr-scanner-gate.sh sets it and runs the same check before
// an upload). In normal CI it is skipped, so work on mobile/ files after the merge never turns CI red.
// The rules live in scripts/native-scanner-fence.mjs (one source for this file and the gate):
//   • every file the scanner must not touch — printer code, Niimbot libraries (Git LFS ids), Swift packages
//     (Package.swift / Package.resolved), gradle files, Info.plist keys … — is the base's exact file;
//   • the five files the scanner edits are the base's once the scanner lines are taken out (and the version
//     numbers blanked): one registration line in SellerFlowBridgeViewController.swift / MainActivity.java,
//     the camera sentence in Info.plist, the scanner files in project.pbxproj, the ndk filter + CameraX /
//     ML Kit lines in build.gradle;
//   • no other file is added under mobile/.
// Base = the fixture (main 3dfb26b8), or SCANNER_GATE_BASE=<commit> (the gate's base).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkTree, fixtureFrom, trackedMobile, EDITED } from "../../../scripts/native-scanner-fence.mjs";
import fixture from "./fixtures/nativeScannerFence.json";

const root = resolve(__dirname, "../../..");
const ON = process.env.SCANNER_GATE === "1";
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
type Fx = { from: string; unchanged: Record<string, string>; edited: Record<string, string> };
const EDIT = EDITED as unknown as Record<string, { norm: (t: string) => string }>;

if (!ON) {
  describe("native QR scanner — mobile/ byte pin", () => {
    it.skip("skipped: runs only with SCANNER_GATE=1 (mobile/android/qr-scanner-gate.sh runs it before an upload)", () => {});
  });
} else {
  const base = process.env.SCANNER_GATE_BASE;
  const fx: Fx = base ? (fixtureFrom(base, root) as Fx) : (fixture as Fx);

  describe(`native QR scanner — mobile/ byte pin vs ${fx.from.slice(0, 8)} (SCANNER_GATE=1)`, () => {
    it("printer code, printer libraries, Swift packages, gradle and every other file: the base's exact bytes; the 5 edited files: only the scanner lines; nothing added", () => {
      expect(checkTree(root, fx, trackedMobile(root))).toEqual([]);
    });

    it("the files that matter most are in the list", () => {
      for (const p of [
        "mobile/ios/App/CapApp-SPM/Package.swift",
        "mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
        "mobile/ios/App/App/SellerFlowPrinterPlugin.swift",
        "mobile/ios/App/App/NiimbotTransport.swift",
        "mobile/ios/App/App/App-Bridging-Header.h",
        "mobile/ios/App/NiimbotKit/libJCAPI.a",
        "mobile/ios/App/NiimbotKit/NiimbotKitDriver.swift",
        "mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowPrinterPlugin.java",
        "mobile/android/app/src/main/java/com/sellerflow/live/TsplBuilder.java",
        "mobile/android/app/src/main/java/com/sellerflow/live/BleStickerTransport.java",
        "mobile/android/app/src/main/java/com/sellerflow/live/GenericBleTransport.java",
        "mobile/android/app/src/main/java/com/sellerflow/live/NiimbotTransport.java",
        "mobile/android/app/libs/4.1.1-release.aar",
        "mobile/android/app/libs/image-1.9.5.aar",
        "mobile/android/app/libs/LPAPI-2019-11-20-R.jar",
        "mobile/android/app/src/main/AndroidManifest.xml",
        "mobile/android/variables.gradle",
        "mobile/android/build.gradle",
        "mobile/package.json",
        "mobile/capacitor.config.ts",
      ]) expect(fx.unchanged[p], p).toMatch(/^[0-9a-f]{64}$/);
      // no Podfile and no CocoaPods anywhere (Swift packages only, as on main)
      expect(Object.keys(fx.unchanged).filter((p) => /Podfile|\.podspec$/.test(p))).toEqual([]);
    });

    it("iPhone: no framework, Swift package or library added to the Xcode project", () => {
      const pbx = read("mobile/ios/App/App.xcodeproj/project.pbxproj");
      for (const re of [/\.framework\b/g, /\.xcframework\b/g, /XCRemoteSwiftPackageReference/g, /XCSwiftPackageProductDependency/g, /XCLocalSwiftPackageReference/g, /\.a \*\//g]) {
        expect((pbx.match(re) || []).length, String(re)).toBe((EDIT["mobile/ios/App/App.xcodeproj/project.pbxproj"].norm(pbx).match(re) || []).length);
      }
    });
  });
}
