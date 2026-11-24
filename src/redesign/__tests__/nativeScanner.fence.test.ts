// Native QR scanner fence (2026-11-22): the scanner is its OWN plugin — printing is never touched.
//   • MainActivity / SellerFlowBridgeViewController gain exactly ONE registration line each;
//   • the scanner's native files never reach into the printer code;
//   • no npm Capacitor plugin was added and the Android includePlugins lock is still empty;
//   • the web side reaches the scanner only through adapters/nativeQrScanner (method presence).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { checkTree, trackedMobile, editedFileProblems } from "../../../scripts/native-scanner-fence.mjs";
import fenceFixture from "./fixtures/nativeScannerFence.json";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("native QR scanner — fence", () => {
  it("Android: one registration line, nothing else in MainActivity knows the scanner", () => {
    const main = read("mobile/android/app/src/main/java/com/sellerflow/live/MainActivity.java");
    expect(count(main, "registerPlugin(SellerFlowScannerPlugin.class);")).toBe(1);
    expect(count(main, "SellerFlowScanner")).toBe(1);
    expect(count(main, "QrScanner")).toBe(0);
  });
  it("iOS: one registration line in the bridge view controller", () => {
    const vc = read("mobile/ios/App/App/SellerFlowBridgeViewController.swift");
    expect(count(vc, "bridge?.registerPluginInstance(SellerFlowScannerPlugin())")).toBe(1);
    expect(vc.split("\n").filter((l) => l.includes("SellerFlowScanner")).length).toBe(1); // the one line (its comment names the file)
  });
  it("the scanner files never use the printer code", () => {
    for (const f of [
      "mobile/ios/App/App/SellerFlowScannerPlugin.swift",
      "mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowScannerPlugin.java",
      "mobile/android/app/src/main/java/com/sellerflow/live/QrScannerDialog.java",
      "mobile/android/app/src/main/java/com/sellerflow/live/QrCentrePick.java",
    ]) {
      const s = read(f);
      for (const bad of ["SellerFlowPrinterPlugin.", "TsplBuilder", "BleStickerTransport", "BleStickerLogic", "GenericBleTransport", "NiimbotTransport", "CoreBluetooth", "BluetoothAdapter"]) {
        expect(s.includes(bad), `${f} uses ${bad}`).toBe(false);
      }
    }
  });
  it("no npm scanner plugin; the Android includePlugins lock is still empty", () => {
    const pkg = JSON.parse(read("mobile/package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /barcode|scanner|mlkit|ml-kit|qr|zxing|camera/i.test(d))).toEqual([]);
    expect(read("mobile/capacitor.config.ts")).toMatch(/includePlugins: \[\]/);
  });
  it("Android adds no permission: CAMERA was already there, no VIBRATE", () => {
    const m = read("mobile/android/app/src/main/AndroidManifest.xml");
    expect(m).toContain('<uses-permission android:name="android.permission.CAMERA" />');
    expect(m).toContain('<uses-feature android:name="android.hardware.camera" android:required="false" />');
    expect(m).not.toContain("VIBRATE");
  });
  it("Android reader = ML Kit with the BUNDLED model (no Google Play services library)", () => {
    const g = read("mobile/android/app/build.gradle");
    expect(g).toContain('implementation "com.google.mlkit:barcode-scanning:17.3.0"');
    expect(g).not.toMatch(/play-services-mlkit-barcode-scanning|play-services-code-scanner/);
  });
  it("versions: iOS build at least 15, Android versionCode at least 11 (later releases only raise them)", () => {
    const pbx = read("mobile/ios/App/App.xcodeproj/project.pbxproj");
    // the app target's build settings (Debug + Release) = the blocks with the app's own bundle id
    const blocks = pbx.split("buildSettings = {").slice(1).map((b) => b.slice(0, b.indexOf("};")));
    const app = blocks.filter((b) => /PRODUCT_BUNDLE_IDENTIFIER = com\.sellerflow\.live;/.test(b));
    const builds = app.map((b) => Number(/CURRENT_PROJECT_VERSION = (\d+);/.exec(b)?.[1]));
    expect(builds).toHaveLength(2);
    for (const b of builds) expect(b).toBeGreaterThanOrEqual(15);
    const code = /versionCode (\d+)/.exec(read("mobile/android/app/build.gradle"));
    expect(code).not.toBeNull();
    expect(Number(code![1])).toBeGreaterThanOrEqual(11);
  });
  it("the mobile/ byte pin is skipped in normal CI (only SCANNER_GATE=1 runs it — the Mac gate)", () => {
    const env = { ...process.env };
    delete env.SCANNER_GATE;
    const r = spawnSync(process.execPath, [resolve(root, "scripts/native-scanner-fence.mjs"), "--check"], { cwd: root, env, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("mobile/ byte pin: skipped (set SCANNER_GATE=1");
    const pin = read("src/redesign/__tests__/nativeScannerMain.fence.test.ts");
    expect(pin).toContain('const ON = process.env.SCANNER_GATE === "1";');
    expect(pin).toMatch(/if \(!ON\) \{\s*describe\([^)]*\) => \{\s*it\.skip\(/);
  });
  it("…and when it runs it still catches a changed printer file and an added mobile/ file", () => {
    type Fx = { from: string; unchanged: Record<string, string>; edited: Record<string, string> };
    const fx = JSON.parse(JSON.stringify(fenceFixture)) as Fx;
    const tspl = "mobile/android/app/src/main/java/com/sellerflow/live/TsplBuilder.java";
    const extra = "mobile/android/variables.gradle";
    fx.unchanged[tspl] = "0".repeat(64); // as if the base had other bytes
    delete fx.unchanged[extra]; // as if the base did not have this file
    expect(checkTree(root, fx, trackedMobile(root))).toEqual(expect.arrayContaining([`changed: ${tspl}`, `added: ${extra}`]));
  });
  it("byte pin, the 5 edited files: only the EXACT scanner lines are taken out, each the expected number of times (Fix Round 4)", () => {
    const fx = fenceFixture as { edited: Record<string, string> };
    const MAIN = "mobile/android/app/src/main/java/com/sellerflow/live/MainActivity.java";
    const PBX = "mobile/ios/App/App.xcodeproj/project.pbxproj";
    const VC = "mobile/ios/App/App/SellerFlowBridgeViewController.swift";
    const main = read(MAIN), pbx = read(PBX), vc = read(VC);
    // as they are in this branch: nothing to say
    for (const [p, t] of [[MAIN, main], [PBX, pbx], [VC, vc]] as const) expect(editedFileProblems(p, t, fx.edited[p]), p).toEqual([]);
    const after = (t: string, line: string, extra: string) => { expect(t.split(line).length - 1, line).toBe(1); return t.replace(line, line + extra); };
    const reg = '        registerPlugin(SellerFlowScannerPlugin.class); // live "Scan sticker QR" (CameraX + ML Kit)\n';

    // MainActivity: a second registration (other words), a second copy of the expected line, any other line naming the scanner
    const mainCases: [string, string][] = [
      ["a second registration line", after(main, reg, "        registerPlugin(SellerFlowScannerPlugin.class);\n")],
      ["the expected line twice", after(main, reg, reg)],
      ["a line that only mentions the scanner", after(main, reg, "        // SellerFlowScannerPlugin also starts the printer\n")],
      ["scanner code in MainActivity", after(main, reg, "        new QrScannerDialog(this).show();\n")],
      ["the expected line with other code on it", main.replace(reg, reg.replace("); //", "); registerPlugin(Other.class); //"))],
    ];
    for (const [name, text] of mainCases) {
      const got = editedFileProblems(MAIN, text, fx.edited[MAIN]);
      expect(got.length, name).toBeGreaterThan(0);
      expect(got.join("\n"), name).toMatch(/scanner lines in |changed beyond the scanner lines/);
    }
    expect(editedFileProblems(MAIN, after(main, reg, "        registerPlugin(SellerFlowScannerPlugin.class);\n"), fx.edited[MAIN])).toContain(`changed beyond the scanner lines: ${MAIN}`);

    // project.pbxproj: one more build-file line for a scanner file, an expected line twice, another line naming a scanner file
    const src = "\t\t\t\t9F00001000000000000000A4 /* SellerFlowScannerPlugin.swift in Sources */,\n";
    const pbxCases: [string, string][] = [
      ["the scanner file compiled twice", after(pbx, src, src)],
      ["the scanner file in another build phase", after(pbx, src, "\t\t\t\t9F0000100000000000000FFF /* SellerFlowScannerPlugin.swift in Resources */,\n")],
      ["another file reference that names a scanner test", after(pbx, src, "\t\t\t\t9FA0000000000000000000FF /* QrCentrePickTests.swift */,\n")],
      ["a framework on a scanner line", pbx.replace(src, src.replace(" */,", " */, 9F00 /* Extra.framework */,"))],
    ];
    for (const [name, text] of pbxCases) {
      const got = editedFileProblems(PBX, text, fx.edited[PBX]);
      expect(got.length, name).toBeGreaterThan(0);
      expect(got, name).toContain(`changed beyond the scanner lines: ${PBX}`);
    }
    // the iPhone bridge file: the same rule
    const vcReg = '        bridge?.registerPluginInstance(SellerFlowScannerPlugin()) // live "Scan sticker QR" (SellerFlowScannerPlugin.swift)\n';
    expect(editedFileProblems(VC, after(vc, vcReg, "        bridge?.registerPluginInstance(SellerFlowScannerPlugin())\n"), fx.edited[VC])).toContain(`changed beyond the scanner lines: ${VC}`);
  });
  it("the iPhone camera text names the sticker QR and parcel slips", () => {
    const plist = read("mobile/ios/App/App/Info.plist");
    expect(plist).toContain("<string>SellerFlowLive uses the camera to scan the QR code on your order stickers and to scan your parcel slips.</string>");
  });
  it("Orders gets its Scan button — and Blacklist its wide-screen wording — only from nativeScannerAvailable(the switch) — RedesignApp", () => {
    const app = read("src/redesign/RedesignApp.tsx");
    expect(count(app, "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)}")).toBe(2); // Orders + Blacklist
    expect(count(app, "liveScan=")).toBe(2);
    expect(app).toContain("initialQuery={ordersInitialQuery} liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)}");
    expect(app).toContain("onRemove={blacklist.remove} liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)} />");
  });
  it("Android: the scanner screen is portrait while open; the app's orientation comes back on every close path", () => {
    const d = read("mobile/android/app/src/main/java/com/sellerflow/live/QrScannerDialog.java");
    expect(d).toContain("activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);");
    expect(d).toMatch(/int prev = activity\.getRequestedOrientation\(\);/); // what the app had, kept to put back
    expect(d).toMatch(/protected void onStart\(\) \{\s*super\.onStart\(\);\s*lockPortrait\(\);/);
    expect(d).toMatch(/protected void onStop\(\) \{\s*restoreOrientation\(\);/); // dismiss + Back (cancel → dismiss)
    expect(d).toContain("setOnDismissListener(d -> restoreOrientation());");
    expect(d).toMatch(/void close\(\) \{[\s\S]*?restoreOrientation\(\);[\s\S]*?\n {4}\}/);
    expect(d).toContain("try { activity.setRequestedOrientation(prev); }");
    // the app itself is not locked: the manifest still lets MainActivity follow the phone and handle rotation
    const m = read("mobile/android/app/src/main/AndroidManifest.xml");
    expect(m).not.toContain("screenOrientation");
    expect(m).toMatch(/android:configChanges="orientation\|/);
  });
  it("a picked photo that can't be opened is reported as photo_unreadable, never as cancelled", () => {
    const sw = read("mobile/ios/App/App/SellerFlowScannerPlugin.swift");
    expect(sw).toContain('case .unreadable: // picked, but the picture can\'t be opened');
    expect(sw).toContain('self?.finish(["status": "error", "code": "photo_unreadable"])');
    expect(sw).toContain("(object as? UIImage).map { Picked.image($0) } ?? Picked.unreadable"); // iCloud-only photo offline
    expect(sw).toContain("self.onDone?(b64.map { Outcome.photo($0) } ?? Outcome.unreadable)");
    const a = read("mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowScannerPlugin.java");
    expect(a.match(/finish\(error\("photo_unreadable"\)\);/g)).toHaveLength(3); // no picture back + a file that can't be opened + the screen gone meanwhile
  });
  it("iPhone: something already on top of the app → answered at once as an error, never left pending (Fix Round 4)", () => {
    const sw = read("mobile/ios/App/App/SellerFlowScannerPlugin.swift");
    const fn = /@objc func scanStickerQr\(_ call: CAPPluginCall\) \{([\s\S]*?)\n {4}\}\n/.exec(sw)?.[1] ?? "";
    const guard = fn.indexOf("if host.presentedViewController != nil {");
    expect(guard).toBeGreaterThan(0);
    expect(fn.slice(guard)).toMatch(/^if host\.presentedViewController != nil \{\n\s*call\.resolve\(\["status": "error", "code": "view_busy"\]\)\n\s*return\n\s*\}/);
    // the check comes BEFORE the call is kept and before anything is presented
    expect(guard).toBeLessThan(fn.indexOf("self.pending = call"));
    expect(guard).toBeLessThan(fn.indexOf("host.present(vc, animated: true)"));
    expect(guard).toBeLessThan(fn.indexOf("self.startPhoto(texts: texts, from: host, allowCamera: false)"));
    expect(fn.split("self.pending = call").length - 1).toBe(1);
  });
  it("iPhone: a closed scanner never starts the camera again (Fix Round 4)", () => {
    const sw = read("mobile/ios/App/App/SellerFlowScannerPlugin.swift");
    // ONE place starts the camera, and it refuses once the scanner is finished
    expect(sw.match(/startRunning\(\)/g)).toHaveLength(1);
    expect(sw).toMatch(/private func startSessionIfOpen\(\) \{\n\s*if finished \{ return \}\n\s*sessionQueue\.async \{ \[session\] in if !session\.isRunning \{ session\.startRunning\(\) \} \}\n {4}\}/);
    // the camera's own error / restart notice: back on the main thread, nothing after a close
    const rt = /@objc private func runtimeError\(_ n: Notification\) \{([\s\S]*?)\n {4}\}\n/.exec(sw)?.[1] ?? "";
    expect(rt).toMatch(/DispatchQueue\.main\.async \{ \[weak self\] in\n\s*guard let self = self, !self\.finished else \{ return \}/);
    expect(rt.indexOf("!self.finished")).toBeLessThan(rt.indexOf("self.startSessionIfOpen()"));
    expect(rt.indexOf("!self.finished")).toBeLessThan(rt.indexOf("self.showPanel("));
    expect(rt).not.toMatch(/sessionQueue|startRunning/);
    // coming back to the app and the permission answer use the same guarded start
    expect(sw).toMatch(/@objc private func becameActive\(\) \{\n\s*if finished \{ return \}/);
    expect(sw).toMatch(/private func checkPermissionAndStart\(\) \{\n\s*if finished \{ return \}/);
  });
  it("Android: the picture is read on its own thread — no screen left = answered once, there (Fix Round 4)", () => {
    const a = read("mobile/android/app/src/main/java/com/sellerflow/live/SellerFlowScannerPlugin.java");
    const fn = /private void photoResult\(PluginCall call, ActivityResult result\) \{([\s\S]*?)\n {4}\}\n/.exec(a)?.[1] ?? "";
    expect(fn).toMatch(/String b64 = jpegBase64\(src\);\n\s*Activity activity = getActivity\(\);\n\s*if \(activity == null\) \{[^\n]*\n\s*finish\(error\("photo_unreadable"\)\);\n\s*return;\n\s*\}\n\s*activity\.runOnUiThread\(/);
    expect(fn).not.toContain("getActivity().runOnUiThread");
    // one answer per call, also when two threads reach it
    expect(a).toMatch(/private synchronized void finish\(JSObject r\) \{\n\s*PluginCall c = pending;\n\s*pending = null;\n\s*if \(c != null\) c\.resolve\(r\);/);
  });
  it("iPhone photo library: no swipe-down dismiss (the scan always finishes); Cancel still finishes it", () => {
    const sw = read("mobile/ios/App/App/SellerFlowScannerPlugin.swift");
    const lib = /private func openLibrary\(from host: UIViewController\) \{([\s\S]*?)\n {4}\}/.exec(sw)?.[1] ?? "";
    expect(lib).toMatch(/picker\.delegate = self\n[\s\S]*picker\.isModalInPresentation = true\n\s*host\.present\(picker, animated: true\)/);
    expect(sw.match(/isModalInPresentation = true/g)).toHaveLength(1); // the library picker only
    // Cancel in the photo library = no result → the scan ends as cancelled
    expect(sw).toMatch(/didFinishPicking results: \[PHPickerResult\]\) \{\n\s*picker\.dismiss\(animated: true\)\n\s*guard let provider = results\.first\?\.itemProvider else \{ \/\/ Cancel in the photo library\n\s*complete\(\.cancelled\)/);
  });
  it("Android ships today's two chip types only (ARM — the Niimbot libraries have nothing else)", () => {
    const g = read("mobile/android/app/build.gradle");
    expect(g).toMatch(/defaultConfig \{[\s\S]*?ndk \{\n\s+abiFilters "armeabi-v7a", "arm64-v8a"\n\s+\}[\s\S]*?\n {4}\}/);
  });
  it("the web reaches the scanner only through adapters/nativeQrScanner", () => {
    for (const f of ["src/redesign/screens/ParcelScan.tsx", "src/redesign/screens/FmParcelScan.tsx", "src/redesign/screens/Blacklist.tsx", "src/redesign/screens/Orders.tsx"]) {
      const s = read(f);
      expect(s, f).toContain('from "../adapters/nativeQrScanner"');
      expect(s, f).not.toContain("SellerFlowScanner");
    }
  });
});
