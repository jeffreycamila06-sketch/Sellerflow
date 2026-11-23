# On-purpose breaks: each must make its test go red; the file is restored after each.
import subprocess, sys
import os
R=os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../../")
BREAKS=[
 ("ParcelScan always uses the photo picker", "src/redesign/screens/ParcelScan.tsx", "    const native = nativeQrScanner();\n    if (!native) { warmQrReader(); qrRef.current?.click(); return; }", "    const native = null as ReturnType<typeof nativeQrScanner>;\n    if (!native) { warmQrReader(); qrRef.current?.click(); return; }", "src/redesign/screens/__tests__/nativeScan.screens.test.tsx"),
 ("Blacklist native read skips the strict parser", "src/redesign/screens/Blacklist.tsx", "    const handle = blacklistHandleFromQr(read.text);\n    if (!handle) { setNote({ kind: \"noqr\" }); return; }\n    await save(\"tiktok\", handle);\n  };\n  // The Scan tap", "    const handle = read.text;\n    if (!handle) { setNote({ kind: \"noqr\" }); return; }\n    await save(\"tiktok\", handle);\n  };\n  // The Scan tap", "src/redesign/screens/__tests__/nativeScan.screens.test.tsx"),
 ("Orders scan triggers the 7-day load", "src/redesign/screens/Orders.tsx", "    setQuery(q);\n    setScanned({ handle, query: q });", "    onQuery(q);\n    setScanned({ handle, query: q });", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("Orders matches case-sensitively", "src/redesign/adapters/useReadData.ts", "String(b.handle || \"\").trim().replace(/^@/, \"\").toLowerCase() === key", "String(b.handle || \"\").trim().replace(/^@/, \"\") === key", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("Orders matches Facebook buyers too", "src/redesign/adapters/useReadData.ts", "String(b.platform || \"\").toLowerCase() === \"tiktok\" && ", "", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("Orders shows 'no orders' while the past session loads", "src/redesign/screens/Orders.tsx", "pastSel && past.buyersState !== \"ready\"", "false", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("Web rule margin 0.1", "src/lib/qrCentrePick.ts", "export const PICK_MARGIN = 0.15;", "export const PICK_MARGIN = 0.1;", "src/lib/__tests__/qrCentrePick.test.ts"),
 ("Web rule reads after 1 frame", "src/lib/qrCentrePick.ts", "export const PICK_FRAMES = 2;", "export const PICK_FRAMES = 1;", "src/lib/__tests__/qrCentrePick.test.ts"),
 ("Java margin drifts", "mobile/android/app/src/main/java/com/sellerflow/live/QrCentrePick.java", "static final double MARGIN = 0.15;", "static final double MARGIN = 0.2;", "src/lib/__tests__/qrCentrePick.test.ts"),
 ("Swift frames drift", "mobile/ios/App/App/SellerFlowScannerPlugin.swift", "static let frames: Int = 2", "static let frames: Int = 3", "src/lib/__tests__/qrCentrePick.test.ts"),
 ("switch accepts any truthy value", "src/redesign/adapters/nativeQrScanner.ts", "switchOn = on === true;", "switchOn = !!on;", "src/redesign/adapters/__tests__/nativeQrScanner.test.ts"),
 ("photo answer skips readQrFromFile", "src/redesign/adapters/nativeQrScanner.ts", "      const read = await readQrFromFile(file);", "      const read = { kind: \"none\" as const, reason: \"no_code\" as const, diag: {} as never };", "src/redesign/adapters/__tests__/nativeQrScanner.test.ts"),
 ("a second scanner registration line", "mobile/android/app/src/main/java/com/sellerflow/live/MainActivity.java", "        registerPlugin(SellerFlowScannerPlugin.class); // live", "        registerPlugin(SellerFlowScannerPlugin.class);\n        registerPlugin(SellerFlowScannerPlugin.class); // live", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("VIBRATE permission added", "mobile/android/app/src/main/AndroidManifest.xml", "    <uses-permission android:name=\"android.permission.CAMERA\" />", "    <uses-permission android:name=\"android.permission.CAMERA\" />\n    <uses-permission android:name=\"android.permission.VIBRATE\" />", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("sql/209 changes the Blacklist step to other words than the guide", "sql/209_guide_native_qr_scanner.sql", "or use a photo of it (on a laptop: **Upload sticker photo**).'),\n", "or use a photo (on a laptop: **Upload sticker photo**).'),\n", "src/redesign/adapters/__tests__/blacklistSql.test.ts"),
 ("Orders scan toast timer is a bare setTimeout", "src/redesign/screens/Orders.tsx", "setScanMsg(m); later(() => setScanMsg(\"\"), 2800);", "setScanMsg(m); setTimeout(() => setScanMsg(\"\"), 2800);", "src/redesign/adapters/__tests__/useScreenTimers.test.tsx"),
 # ── Fix Round 1 ──
 ("Orders shows Scan without the live scanner", "src/redesign/screens/Orders.tsx", "          {liveScan && (\n", "          {(liveScan || true) && (\n", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("RedesignApp always passes liveScan", "src/redesign/RedesignApp.tsx", "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)}", "liveScan", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("availability ignores the switch", "src/redesign/adapters/nativeQrScanner.ts", "return switchOnNow === true && pluginScan() !== null;", "return pluginScan() !== null;", "src/redesign/adapters/__tests__/nativeQrScanner.test.ts"),
 ("unreadable photo treated as a scanner failure", "src/redesign/adapters/nativeQrScanner.ts", "  if (a.status === \"error\" && a.code === \"photo_unreadable\") return unreadable();\n", "", "src/redesign/screens/__tests__/nativeScan.screens.test.tsx"),
 ("broken photo data = failed again", "src/redesign/adapters/nativeQrScanner.ts", "    if (!file) return unreadable();", "    if (!file) return done(\"failed\", { kind: \"failed\" });", "src/redesign/adapters/__tests__/nativeQrScanner.test.ts"),
 ("chooser count back to 0", "src/redesign/screens/Orders.tsx", "scanActive ? matches.reduce((n, m) => n + m.count, 0)", "scanActive ? 0", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("Blacklist clears the note before the scanner opens", "src/redesign/screens/Blacklist.tsx", "    setReading(true); // the \"Added", "    setReading(true); setNote(null); // the \"Added", "src/redesign/screens/__tests__/nativeScan.screens.test.tsx"),
 ("Android: no portrait lock", "mobile/android/app/src/main/java/com/sellerflow/live/QrScannerDialog.java", "        super.onStart();\n        lockPortrait();\n", "        super.onStart();\n", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("Android: close() does not restore", "mobile/android/app/src/main/java/com/sellerflow/live/QrScannerDialog.java", "        restoreOrientation(); // also when the dialog was never shown / already gone\n", "", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("iPhone: unreadable photo reported as cancelled", "mobile/ios/App/App/SellerFlowScannerPlugin.swift", "self?.finish([\"status\": \"error\", \"code\": \"photo_unreadable\"])", "self?.finish([\"status\": \"cancelled\"])", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("version name back to 2.0", "mobile/android/app/build.gradle", "versionName \"1.10\"", "versionName \"2.0\"", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("batchLimit: shutter checked before the rows are in", "src/redesign/screens/__tests__/ParcelScan.batchLimit.test.tsx", "    await waitFor(() => expect(norm(getByTestId(\"ps-batch-n\").textContent)).toBe(\"40/40\"));\n", "", "src/redesign/screens/__tests__/ParcelScan.batchLimit.test.tsx"),
 # ── Fix Round 2 ──
 ("Android: chip-type filter removed", "mobile/android/app/build.gradle", "        ndk {\n            abiFilters \"armeabi-v7a\", \"arm64-v8a\"\n        }\n", "", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("Android: x86_64 chip type added", "mobile/android/app/build.gradle", "abiFilters \"armeabi-v7a\", \"arm64-v8a\"", "abiFilters \"armeabi-v7a\", \"arm64-v8a\", \"x86_64\"", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("Android: one more library in build.gradle", "mobile/android/app/build.gradle", "    implementation \"com.google.mlkit:barcode-scanning:17.3.0\"\n", "    implementation \"com.google.mlkit:barcode-scanning:17.3.0\"\n    implementation \"androidx.core:core:1.16.0\"\n", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("iPhone: photo library can be swiped away", "mobile/ios/App/App/SellerFlowScannerPlugin.swift", "        picker.isModalInPresentation = true\n", "", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("iPhone: Cancel in the photo library does not finish the scan", "mobile/ios/App/App/SellerFlowScannerPlugin.swift", "            complete(.cancelled)\n            return\n        }\n        guard provider.canLoadObject", "            return\n        }\n        guard provider.canLoadObject", "src/redesign/__tests__/nativeScanner.fence.test.ts"),
 ("Android printer code changed (TsplBuilder)", "mobile/android/app/src/main/java/com/sellerflow/live/TsplBuilder.java", "class TsplBuilder {", "class TsplBuilder { ", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("iPhone printer code changed (NiimbotKitDriver)", "mobile/ios/App/NiimbotKit/NiimbotKitDriver.swift", "// iOS SDK, inside the SEPARATE embedded NiimbotKit.framework (min iOS 17.2).", "// iOS SDK, inside the SEPARATE embedded NiimbotKit.framework (min iOS 17.3).", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("iPhone Swift package version changed (Package.swift)", "mobile/ios/App/CapApp-SPM/Package.swift", "exact: \"8.3.4\")", "exact: \"8.3.5\")", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("iPhone Package.resolved changed", "mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved", "\"version\" : \"8.3.4\"", "\"version\" : \"8.3.5\"", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("iPhone: a second line in SellerFlowBridgeViewController", "mobile/ios/App/App/SellerFlowBridgeViewController.swift", "        bridge?.registerPluginInstance(authPlugin)", "        bridge?.registerPluginInstance(printerPlugin)\n        bridge?.registerPluginInstance(authPlugin)", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("iPhone: a framework added to the Xcode project", "mobile/ios/App/App.xcodeproj/project.pbxproj", "\t\t9F0000300000000000000C20 /* NiimbotKit.framework */ = {isa = PBXFileReference;", "\t\t9F0000300000000000000C99 /* Extra.framework */ = {isa = PBXFileReference; path = Extra.framework; sourceTree = BUILT_PRODUCTS_DIR; };\n\t\t9F0000300000000000000C20 /* NiimbotKit.framework */ = {isa = PBXFileReference;", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("iPhone: the Bluetooth sentence in Info.plist changed", "mobile/ios/App/App/Info.plist", "connects to your Bluetooth label printer to print order stickers.", "connects to your Bluetooth printer to print order stickers.", "src/redesign/__tests__/nativeScannerMain.fence.test.ts"),
 ("Orders: Scan button back to minHeight (row taller)", "src/redesign/screens/Orders.tsx", "height: 26, boxSizing: \"border-box\", lineHeight: 1, padding: \"0 10px\", margin: \"-5px -6px -5px 0\",", "minHeight: 26, padding: \"4px 10px\", margin: \"-5px -6px -5px 0\",", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("Orders: Scan button not pulled into the row padding", "src/redesign/screens/Orders.tsx", "padding: \"0 10px\", margin: \"-5px -6px -5px 0\",", "padding: \"0 10px\",", "src/redesign/screens/__tests__/Orders.scan.test.tsx"),
 ("gate a: a new chip type passes", "mobile/android/qr-scanner-gate-check.mjs", "const same = mainAbis.length === newAbis.length && mainAbis.every((a, i) => a === newAbis[i]);", "const same = mainAbis.every((a) => newAbis.includes(a));", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate b: a changed .so passes", "mobile/android/qr-scanner-gate-check.mjs", "    const same = n.hash === m.hash;\n", "    const same = true;\n", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate c: changed printer class passes", "mobile/android/qr-scanner-gate-check.mjs", "if (m.text === n.text) { same++; continue; }", "if (true) { same++; continue; }", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate c: only the roots, not what they use", "mobile/android/qr-scanner-gate-check.mjs", "for (const r of mainClasses.get(d).refs)", "for (const r of [])", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate c: MainActivity may have more than the one line", "mobile/android/qr-scanner-gate-check.mjs", "return extra.length === 2 &&", "return extra.length >= 2 &&", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate c: line-number tables not removed", "mobile/android/qr-scanner-gate-check.mjs", "    if (/^\\s*(positions|locals)\\s*:/.test(line)) { skipDebug = true; continue; }\n", "", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate c: an LFS pointer in the new build is not noticed", "mobile/android/qr-scanner-gate-check.mjs", "for (const [side, b] of [[\"main\", bm], [\"new\", bn]]) {", "for (const [side, b] of [[\"main\", bm]]) {", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate d: a bumped version passes", "mobile/android/qr-scanner-gate-check.mjs", "else if (n !== v) bumped.push(", "else if (false) bumped.push(", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate e: a new permission passes", "mobile/android/qr-scanner-gate-check.mjs", "for (const k of b.perms.keys()) if (!a.perms.has(k)) fails.push(", "for (const k of b.perms.keys()) if (false) fails.push(", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate f: too big passes", "mobile/android/qr-scanner-gate-check.mjs", "    const ok = worst <= maxMb;\n", "    const ok = true;\n", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate f: unaligned .so passes", "mobile/android/qr-scanner-gate-check.mjs", "const ok = !e.is64 || e.align >= 16384;", "const ok = true;", "src/redesign/__tests__/qrScannerGate.test.ts"),
 ("gate script: builds the branch in this checkout", "mobile/android/qr-scanner-gate.sh", "git -C \"$ROOT\" worktree add -q --detach \"$WORK/new\" \"$NEW_SHA\"", "ln -s \"$ROOT\" \"$WORK/new\"", "src/redesign/__tests__/qrScannerGate.test.ts"),
]
red=0
for name,f,a,b,test in BREAKS:
    p=R+f; s=open(p).read()
    assert s.count(a)==1,(name,s.count(a))
    open(p,'w').write(s.replace(a,b))
    try:
        r=subprocess.run(["npx","vitest","run",test],cwd=R,capture_output=True,text=True,timeout=600)
        ok = r.returncode!=0
    finally:
        open(p,'w').write(s)
    red+=ok
    print(("RED  " if ok else "GREEN (missed) ")+name, flush=True)
print(f"{red}/{len(BREAKS)} breaks caught")
