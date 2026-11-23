// Native QR scanner fence (2026-11-22): the scanner is its OWN plugin — printing is never touched.
//   • MainActivity / SellerFlowBridgeViewController gain exactly ONE registration line each;
//   • the scanner's native files never reach into the printer code;
//   • no npm Capacitor plugin was added and the Android includePlugins lock is still empty;
//   • the web side reaches the scanner only through adapters/nativeQrScanner (method presence).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  it("the iPhone camera text names the sticker QR and parcel slips", () => {
    const plist = read("mobile/ios/App/App/Info.plist");
    expect(plist).toContain("<string>SellerFlowLive uses the camera to scan the QR code on your order stickers and to scan your parcel slips.</string>");
  });
  it("Orders gets its Scan button only from nativeScannerAvailable(the switch) — RedesignApp", () => {
    const app = read("src/redesign/RedesignApp.tsx");
    expect(count(app, "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)}")).toBe(1);
    expect(count(app, "liveScan=")).toBe(1);
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
    expect(a.match(/finish\(error\("photo_unreadable"\)\);/g)).toHaveLength(2); // no picture back + a file that can't be opened
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
