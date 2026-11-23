// Native QR scanner (Android versionCode 11 / iOS build 15): under mobile/ the ONLY change is the scanner.
// Fixture = main's bytes (scripts/native-scanner-fence.mjs, from origin/main at the last merge):
//   • every file the scanner must not touch — printer code, Niimbot libraries (Git LFS ids), Swift packages
//     (Package.swift / Package.resolved), gradle files, Info.plist keys … — is main's exact file;
//   • the five files the scanner edits are main's once the scanner lines are taken out (and the version
//     numbers blanked): one registration line in SellerFlowBridgeViewController.swift / MainActivity.java,
//     the camera sentence in Info.plist, the scanner files in project.pbxproj, the ndk filter + CameraX /
//     ML Kit lines in build.gradle;
//   • no other file is added under mobile/.
// A later branch that changes one of these files ON PURPOSE regenerates the fixture:
//   node scripts/native-scanner-fence.mjs
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { ADDED, EDITED, contentId, normId } from "../../../scripts/native-scanner-fence.mjs";
import fixture from "./fixtures/nativeScannerFence.json";

const root = resolve(__dirname, "../../..");
const readBuf = (p: string) => readFileSync(resolve(root, p));
const read = (p: string) => readBuf(p).toString("utf8");
const fx = fixture as { from: string; unchanged: Record<string, string>; edited: Record<string, string> };
const EDIT = EDITED as unknown as Record<string, { pieces: [string, number][]; norm: (t: string) => string }>;

describe("native QR scanner — nothing but the scanner changed under mobile/", () => {
  it("printer code, printer libraries, Swift packages, gradle and every other file: main's exact bytes", () => {
    const changed = Object.entries(fx.unchanged).filter(([p, id]) => !existsSync(resolve(root, p)) || contentId(readBuf(p)) !== id).map(([p]) => p);
    expect(changed).toEqual([]);
    // the files that matter most are really in the list
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

  it("the five edited files = main's once the scanner lines are taken out", () => {
    for (const [p, id] of Object.entries(fx.edited)) {
      const t = read(p);
      for (const [piece, n] of EDIT[p].pieces) expect(t.split(piece).length - 1, `${p}: "${piece.slice(0, 60)}…"`).toBe(n);
      expect(normId(p, t), p).toBe(id);
    }
    expect(Object.keys(fx.edited).sort()).toEqual(Object.keys(EDIT).sort());
  });

  it("iPhone: exactly ONE added line in SellerFlowBridgeViewController.swift, none in the printer plugin", () => {
    const vc = read("mobile/ios/App/App/SellerFlowBridgeViewController.swift");
    expect(vc.split("\n").filter((l) => /SellerFlowScanner/.test(l))).toHaveLength(1);
    const pbx = read("mobile/ios/App/App.xcodeproj/project.pbxproj");
    // no framework, Swift package or library was added to the Xcode project
    for (const re of [/\.framework\b/g, /\.xcframework\b/g, /XCRemoteSwiftPackageReference/g, /XCSwiftPackageProductDependency/g, /XCLocalSwiftPackageReference/g, /\.a \*\//g]) {
      expect((pbx.match(re) || []).length, String(re)).toBe((EDIT["mobile/ios/App/App.xcodeproj/project.pbxproj"].norm(pbx).match(re) || []).length);
    }
  });

  it("Android build.gradle: only the chip-type filter (today's two ARM types) and the camera / ML Kit libraries", () => {
    const g = read("mobile/android/app/build.gradle");
    expect(g).toMatch(/ndk \{\n\s+abiFilters "armeabi-v7a", "arm64-v8a"\n\s+\}/);
    expect(g.match(/abiFilters/g)).toHaveLength(1);
  });

  it("no other file was added under mobile/", () => {
    let files: string[];
    try { files = execFileSync("git", ["-C", root, "ls-files", "mobile"], { encoding: "utf8" }).split("\n").filter(Boolean); }
    catch { return; } // not a git checkout — the two checks above still ran
    const known = new Set([...Object.keys(fx.unchanged), ...Object.keys(fx.edited), ...(ADDED as string[])]);
    expect(files.filter((f) => !known.has(f))).toEqual([]);
  });
});
