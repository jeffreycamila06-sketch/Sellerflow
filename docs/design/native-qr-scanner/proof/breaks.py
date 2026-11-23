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
 ("sql/207 changes the Blacklist step to other words than the guide", "sql/207_guide_native_qr_scanner.sql", "or use a photo of it (on a laptop: **Upload sticker photo**).'),\n", "or use a photo (on a laptop: **Upload sticker photo**).'),\n", "src/redesign/adapters/__tests__/blacklistSql.test.ts"),
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
