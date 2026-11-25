#!/usr/bin/env python3
"""On-purpose breaks: each one changes ONE thing in the code and the named test must go red.
Run from the repository root:  python3 previews/web-qr-scanner/proof/breaks.py
Every file is put back after its break. Writes breaks.txt next to this file."""
import os, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
S = "src/redesign/adapters/webQrScanner.ts"
T_UNIT = "src/redesign/adapters/__tests__/webQrScanner.test.ts"
T_SCREENS = "src/redesign/screens/__tests__/webScan.screens.test.tsx"
T_FENCE = "src/redesign/__tests__/webQrScanner.fence.test.ts"
T_ZX = "src/redesign/adapters/__tests__/qrLiveHits.zxing.test.ts"
PS = "src/redesign/screens/ParcelScan.tsx"
APP = "src/redesign/RedesignApp.tsx"
T_APP = "src/redesign/__tests__/webQrScanner.app.test.tsx"
T_SQL = "src/redesign/adapters/__tests__/webQrScannerFeatureSql.test.ts"
T_KEYS = "src/redesign/adapters/__tests__/parcelBatchCap.test.ts"
T_WARM = "src/redesign/adapters/__tests__/qrLiveWarm.test.ts"
SQL219 = "sql/219_web_qr_scanner_feature.sql"
ALLOW = "a?.switchOn === true || a?.isAdmin === true || a?.previewKey === true"
WIRE = "webQrScannerAllowed({ isAdmin, previewKey: hasFeature(\"web_qr_scanner\"), switchOn: featureSw.webQrScanner })"
LIMIT = "startTimer = setTimeout(() => { if (!gotFrame && !cameraHasPicture()) fail(null); }, deps.startMs ?? START_MS);"
MAKE_AT_OPEN = "    try { grabber = (deps.grabber ?? cameraGrabber)(ui.video, view); } catch { fail(null); return handle; }\n"

# (what is broken, file, old text, new text, the test file that must fail)
BREAKS = [
  ("gate: any phone, not only the Android app", S, "return isCapacitorAndroid() && !nativeScannerAvailable(true) && cameraSupported();", "return !nativeScannerAvailable(true) && cameraSupported();", T_UNIT),
  ("gate: also when the app build HAS the built-in scanner", S, "return isCapacitorAndroid() && !nativeScannerAvailable(true) && cameraSupported();", "return isCapacitorAndroid() && cameraSupported();", T_UNIT),
  ("gate: also without a camera API", S, "return isCapacitorAndroid() && !nativeScannerAvailable(true) && cameraSupported();", "return isCapacitorAndroid() && !nativeScannerAvailable(true);", T_UNIT),
  ("switch: anything truthy turns it on", S, "switchOn = on === true;", "switchOn = !!on;", T_UNIT),
  ("switch ignored at tap time", S, "export function webQrScanner(): boolean { return switchOn && canWebScan(); }", "export function webQrScanner(): boolean { return canWebScan(); }", T_UNIT),
  ("switch ignored for a render (Orders button)", S, "return allowedNow === true && canWebScan();", "return canWebScan();", T_UNIT),
  ("the camera is NOT stopped when the scan ends", S, "    finished = true;\n    stopCamera();", "    finished = true;", T_UNIT),
  ("a camera that arrives after the close is left running", S, "if (finished || panel) { stopStream(s); return; }", "if (finished || panel) return;", T_UNIT),
  ("going to the background does not close the scanner", S, "try { if (document.hidden && (stream || panel)) finish({ kind: \"cancelled\" }); } catch { /* ignore */ }", "/* nothing */", T_UNIT),
  ("a camera arriving while in the background is kept on", S, "if ((() => { try { return document.hidden; } catch { return false; } })()) { stopStream(s); finish({ kind: \"cancelled\" }); return; }", "", T_UNIT),
  ("the phone's Back does not close the scanner", S, "    popped = true;\n    finish({ kind: \"cancelled\" });", "    popped = true;", T_UNIT),
  ("a late pop of an earlier scanner closes the new one", S, "try { if ((e?.state as Record<string, unknown> | null)?.[HISTORY_MARK]) return; } catch { /* treat as Back */ }", "", T_UNIT),
  ("its history entry is left behind after Close", S, "if ((window.history.state as Record<string, unknown> | null)?.[HISTORY_MARK]) window.history.back();", "", T_UNIT),
  ("leaving the screen still calls the screen back", S, "if (!silent) { try { onDone(r); }", "if (true) { try { onDone(r); }", T_UNIT),
  ("one frame is enough to read", S, "const step = stepPick(streak, pickCentreQr(got.hits, got.frame));", "const step = stepPick(streak ?? { text: got.hits[0]?.text ?? \"\", count: 1 }, pickCentreQr(got.hits, got.frame));", T_UNIT),
  ("no 'Point at one QR' hint on a tie", S, "ui?.setHint(step.tie ? texts.one : texts.hint)", "ui?.setHint(texts.hint)", T_UNIT),
  ("a refused camera is called 'not available'", S, "const DENIED = new Set([\"NotAllowedError\", \"PermissionDeniedError\", \"SecurityError\"]);", "const DENIED = new Set([\"PermissionDeniedError\", \"SecurityError\"]);", T_UNIT),
  ("closes even when the photo picker could not be opened (the tap no longer counts)", S, "if (tapStillCounts() || !ui) { finish({ kind: \"fallback\", reason }); return; }", "finish({ kind: \"fallback\", reason }); return;", T_UNIT),
  ("the light button is always shown", S, "export function torchSupported(t: MediaStreamTrack | null): boolean { return capsOf(t).torch === true; }", "export function torchSupported(_t: MediaStreamTrack | null): boolean { return true; }", T_UNIT),
  ("the light shows 'on' even when the camera refused", S, "if (ok) torchOn = want;", "torchOn = want;", T_UNIT),
  ("no vibration on a read", S, "        triggerHaptic(60);\n", "", T_UNIT),
  ("no beep on a read", S, "        playScanBeep();\n", "", T_UNIT),
  ("the beep is not 2.6 kHz", S, "osc.frequency.value = 2600;", "osc.frequency.value = 1000;", T_UNIT),
  ("the FRONT camera is asked", S, "facingMode: { ideal: \"environment\" }", "facingMode: { ideal: \"user\" }", T_UNIT),
  ("the event sent carries the QR text", S, "reader: readerName, ms: Date.now() - t0 });", "reader: readerName, ms: Date.now() - t0, text: r.kind === \"read\" ? r.text : null });", T_UNIT),
  ("a phone reader that cannot read QR codes is still used", S, "if (Array.isArray(formats) && formats.includes(\"qr_code\")) { detector", "if (Array.isArray(formats)) { detector", T_UNIT),
  ("the phone's failing reader is never given up on", S, "const NATIVE_FAIL_LIMIT = 3;", "const NATIVE_FAIL_LIMIT = 300;", T_UNIT),
  ("a camera that never shows a picture keeps the scanner open for ever", S, "startTimer = setTimeout(() => { if (!gotFrame && !cameraHasPicture()) fail(null); }, deps.startMs ?? START_MS);", "", T_UNIT),
  ("a second scanner can be opened on top of the first", S, "    if (active) active.close(); // one scanner at a time\n", "", T_UNIT),
  ("the frame is not the phone app's size", S, "export const FRAME_SHARE = 0.68;", "export const FRAME_SHARE = 0.5;", T_UNIT),
  ("Parcel Scan: the page's scanner also when the built-in one is there", PS, "if (!native && webQrScanner()) { onWebScanQr(); return; }", "if (webQrScanner()) { onWebScanQr(); return; }", T_FENCE),
  ("Parcel Scan: the read text is changed before today's parser", PS, "if (out.kind === \"read\") { try { applyQrRead({ kind: \"one\", text: out.text }); }", "if (out.kind === \"read\") { try { applyQrRead({ kind: \"one\", text: out.text.toLowerCase() }); }", T_SCREENS),
  ("Parcel Scan: 'Take a photo instead' / a refused camera opens no photo picker", PS, "      if (out.kind === \"fallback\") { setToast(webScanFallbackText(out.reason, texts)); later(() => setToast(\"\"), 2500); }\n      warmQrReader(); qrRef.current?.click();", "      if (out.kind === \"fallback\") { setToast(webScanFallbackText(out.reason, texts)); later(() => setToast(\"\"), 2500); }", T_SCREENS),
  ("Parcel Scan: no line when the camera is refused", PS, "if (out.kind === \"fallback\") { setToast(webScanFallbackText(out.reason, texts)); later(() => setToast(\"\"), 2500); }", "", T_SCREENS),
  ("FamilyMart: the read is not applied", "src/redesign/screens/FmParcelScan.tsx", "if (out.kind === \"read\") { try { applyQrRead({ kind: \"one\", text: out.text }); } catch { flash(t.rd_ps2_qr_none); } return; }", "if (out.kind === \"read\") return;", T_SCREENS),
  ("Blacklist: no line when the camera is refused", "src/redesign/screens/Blacklist.tsx", "if (out.kind === \"fallback\") setNote({ kind: \"camera\", text: webScanFallbackText(out.reason, texts) });", "", T_SCREENS),
  ("Blacklist: the read skips today's parser (saved as another platform)", "src/redesign/screens/Blacklist.tsx", "if (out.kind === \"read\") { void applyRead({ kind: \"one\", text: out.text }); return; }", "if (out.kind === \"read\") { void save(\"facebook\", out.text); return; }", T_SCREENS),
  ("Orders: the photo input is always on the page", "src/redesign/screens/Orders.tsx", "{webScan && <input ref={scanFileRef}", "{<input ref={scanFileRef}", T_SCREENS),
  ("Orders: no Scan button with the page's scanner", "src/redesign/screens/Orders.tsx", "{(liveScan || webScan) && (", "{liveScan && (", T_SCREENS),
  ("Orders: the read is not applied", "src/redesign/screens/Orders.tsx", "if (out.kind === \"read\") { applyScan({ kind: \"one\", text: out.text }); return; }", "if (out.kind === \"read\") return;", T_SCREENS),
  ("RedesignApp: Orders always gets webScan", "src/redesign/RedesignApp.tsx", "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)} webScan={webScannerAvailable(webQrOn)} fbReceipt", "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)} webScan fbReceipt", T_FENCE),
  ("RedesignApp: the answer is never handed to the scanner", APP, "  useEffect(() => { setWebQrScannerOn(webQrOn); }, [webQrOn]);\n", "", T_FENCE),
  ("the app reads another switch name", "src/redesign/adapters/featureSwitches.ts", "webQrScanner: \"web_qr_scanner_enabled\"", "webQrScanner: \"web_qr_scanner\"", T_UNIT),
  ("the switch is on by default", "src/redesign/adapters/featureSwitches.ts", "nativeQrScanner: false, webQrScanner: false };", "nativeQrScanner: false, webQrScanner: true };", T_UNIT),
  ("sql/218 creates the switch ON", "sql/218_web_qr_scanner_switch.sql", "values ('web_qr_scanner_enabled', 'false')", "values ('web_qr_scanner_enabled', 'true')", T_FENCE),
  ("sql/218 overwrites a row that is already there", "sql/218_web_qr_scanner_switch.sql", "on conflict (key) do nothing;", "on conflict (key) do update set value = excluded.value;", T_FENCE),
  ("the rollback deletes more than its row", "sql/218_web_qr_scanner_switch_rollback.sql", "where key = 'web_qr_scanner_enabled';", "where key like '%qr_scanner_enabled';", T_FENCE),
  ("the frame reader finds only one QR (two stickers would be guessed)", "src/redesign/adapters/qrDecode.ts", "tryDownscale: false, maxNumberOfSymbols: 4 };", "tryDownscale: false, maxNumberOfSymbols: 1 };", T_ZX),
  ("the frame reader gives a corner, not the centre", "src/redesign/adapters/qrDecode.ts", "out.push({ text: r.text, ...centre([p.topLeft, p.topRight, p.bottomRight, p.bottomLeft]) });", "out.push({ text: r.text, cx: 0, cy: 0 });", T_ZX),
  ("the scanner uses printing code", S, "import { track } from \"../analytics\";", "import { track } from \"../analytics\";\nimport { getSavedPrinter } from \"./savedPrinter\";\nvoid getSavedPrinter;", T_FENCE),
  ("FENCE: a printing file is changed", "src/redesign/adapters/printing.ts", None, None, T_FENCE),
  ("FENCE: an app-build file is changed", "mobile/android/app/src/main/java/com/sellerflow/live/MainActivity.java", None, None, T_FENCE),
  ("FENCE: the native scanner's adapter is changed", "src/redesign/adapters/nativeQrScanner.ts", None, None, T_FENCE),
  ("FENCE: a file is added under mobile/", "mobile/NEW_FILE.txt", "ADD", None, T_FENCE),
  ("FENCE: a server file is changed", "server.js", None, None, T_FENCE),
  # ── follow-up 2026-11-25: testers first ──
  ("testers: an admin is NOT let in", S, ALLOW, "a?.switchOn === true || a?.previewKey === true", T_UNIT),
  ("testers: a login with the feature key is NOT let in", S, ALLOW, "a?.switchOn === true || a?.isAdmin === true", T_UNIT),
  ("testers: the switch no longer turns it on for everyone", S, ALLOW, "a?.isAdmin === true || a?.previewKey === true", T_UNIT),
  ("testers: anything truthy counts as 'admin'", S, ALLOW, "a?.switchOn === true || !!a?.isAdmin || a?.previewKey === true", T_UNIT),
  ("testers: anything truthy counts as the feature key", S, ALLOW, "a?.switchOn === true || a?.isAdmin === true || !!a?.previewKey", T_UNIT),
  ("app: the admin role is not passed (real app)", APP, WIRE, WIRE.replace("{ isAdmin,", "{ isAdmin: false,"), T_APP),
  ("app: the feature key is not read (real app)", APP, WIRE, WIRE.replace("hasFeature(\"web_qr_scanner\")", "false"), T_APP),
  ("app: another feature's key is read instead (real app)", APP, WIRE, WIRE.replace("hasFeature(\"web_qr_scanner\")", "hasFeature(\"blacklist\")"), T_APP),
  ("app: the switch is not read (real app)", APP, WIRE, WIRE.replace("switchOn: featureSw.webQrScanner", "switchOn: false"), T_APP),
  ("app: EVERY login is let in with the switch off (real app)", APP, "const webQrOn = " + WIRE + ";", "const webQrOn = true;", T_APP),
  ("app: the Scan button shows but a tap is not told the answer (real app)", APP, "  useEffect(() => { setWebQrScannerOn(webQrOn); }, [webQrOn]);\n", "", T_APP),
  ("app: Orders shows the button from the switch only (real app)", APP, "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)} webScan={webScannerAvailable(webQrOn)} fbReceipt", "liveScan={nativeScannerAvailable(featureSw.nativeQrScanner)} webScan={webScannerAvailable(featureSw.webQrScanner)} fbReceipt", T_APP),
  ("the app does not read the key web_qr_scanner", "src/redesign/adapters/featureAccess.ts", "  \"web_qr_scanner\", //", "  // \"web_qr_scanner\", //", T_KEYS),
  ("sql/219 puts a login on the list", SQL219, "$function$;\n\ncommit;", "$function$;\ninsert into public.feature_access_emails (feature, email) values ('web_qr_scanner', 'someone@test.example');\n\ncommit;", T_SQL),
  ("sql/219 drops another feature's key", SQL219, "('account_limits_v2'), ('shopee_public'), ('web_qr_scanner')", "('account_limits_v2'), ('web_qr_scanner')", T_SQL),
  ("sql/219 spells the key differently from the app", SQL219, "('shopee_public'), ('web_qr_scanner')", "('shopee_public'), ('web_qr_scan')", T_SQL),
  ("sql/219 has no guard on the live text", SQL219, "md5(p.prosrc) in ('c2839ef78c5cd5c19b75a8d6a6f7f238', 'dcf0e8a5cdf0d22d97f61068b6f5818e')", "true", T_SQL),
  ("sql/219 also creates the switch row", SQL219, "$function$;\n\ncommit;", "$function$;\ninsert into public.app_settings (key, value) values ('web_qr_scanner_enabled', 'true') on conflict (key) do nothing;\n\ncommit;", T_SQL),
  ("sql/219 rollback deletes the testers of EVERY feature", "sql/219_web_qr_scanner_feature_rollback.sql", "delete from public.feature_access_emails where feature = 'web_qr_scanner';", "delete from public.feature_access_emails;", T_SQL),
  ("sql/219 rollback leaves the new key in", "sql/219_web_qr_scanner_feature_rollback.sql", "('account_limits_v2'), ('shopee_public')\n", "('account_limits_v2'), ('shopee_public'), ('web_qr_scanner')\n", T_SQL),
  # ── follow-up 2026-11-25: the camera limit asks the camera only; the reader loads at open ──
  ("limit: it waits for the READER again (a slow reader load = 'camera isn't available')", S, LIMIT, LIMIT.replace("!gotFrame && !cameraHasPicture()", "!gotFrame"), T_UNIT),
  ("limit: a camera that HAS a picture is still called 'not available'", S, "return !!v && v.videoWidth > 0 && v.videoHeight > 0;", "return false;", T_UNIT),
  ("limit: a camera with NO picture is taken as fine", S, "return !!v && v.videoWidth > 0 && v.videoHeight > 0;", "return true;", T_UNIT),
  ("limit: it also runs while the phone is still asking for the camera", S, MAKE_AT_OPEN, MAKE_AT_OPEN + "    " + LIMIT + "\n", T_UNIT),
  ("reader: made only after the camera answered (not when the scanner opens)", S, [(MAKE_AT_OPEN, ""), ("    if (!grabber) { fail(null); return; }\n", "    try { grabber = (deps.grabber ?? cameraGrabber)(ui!.video, view); } catch { fail(null); return; }\n")], "MULTI", T_UNIT),
  ("reader: ours is not loaded at open (only at the first frame)", S, "    if (mode === \"loaded\") { try { warmQrPixelReader(); } catch { /* it loads at the first frame then */ } }\n", "", T_UNIT),
  ("reader: ours is loaded even when the phone has its own", S, "    if (mode === \"loaded\") { try { warmQrPixelReader(); }", "    if (true) { try { warmQrPixelReader(); }", T_UNIT),
  ("reader: a phone reader that never answers is waited for, for ever", S, "await answerWithin(BD.getSupportedFormats(), NATIVE_ASK_MS)", "await BD.getSupportedFormats()", T_UNIT),
  ("reader: a failed making of the reader still opens the camera", S, "catch { fail(null); return handle; }\n    const md", "catch { /* go on */ }\n    const md", T_UNIT),
  ("reader: warmQrPixelReader starts no load", "src/redesign/adapters/qrDecode.ts", "try { if (!zxLiveGaveUp) void loadZxing(); } catch { /* it loads at the first frame then */ }", "/* nothing */", T_WARM),
]

def run(test):
    r = subprocess.run(["npx", "vitest", "run", test], cwd=ROOT, capture_output=True, text=True, env={**os.environ, "WEB_QR_GATE": "1"})
    return r.returncode != 0

out, missed = [], 0
for name, rel, old, new, test in BREAKS:
    path = os.path.join(ROOT, rel)
    if old == "ADD":
        open(path, "w").write("x\n")
        try: caught = run(test)
        finally: os.remove(path)
    else:
        src = open(path, encoding="utf8").read()
        if old is None:
            broken = src + "\n// touched\n"
        elif new == "MULTI":
            broken = src
            for o, n in old:
                if broken.count(o) != 1:
                    print(f"ANCHOR NOT FOUND ONCE ({broken.count(o)}): {name}"); sys.exit(2)
                broken = broken.replace(o, n)
        else:
            if src.count(old) != 1:
                print(f"ANCHOR NOT FOUND ONCE ({src.count(old)}): {name}"); sys.exit(2)
            broken = src.replace(old, new)
        open(path, "w", encoding="utf8").write(broken)
        try: caught = run(test)
        finally: open(path, "w", encoding="utf8").write(src)
    if not caught: missed += 1
    line = f"{'caught' if caught else 'MISSED'}  {name}  →  {os.path.basename(test)}"
    out.append(line); print(line, flush=True)
out.append("")
out.append(f"{len(BREAKS) - missed} of {len(BREAKS)} on-purpose breaks caught" + ("" if not missed else f" — {missed} MISSED"))
open(os.path.join(os.path.dirname(__file__), "breaks.txt"), "w", encoding="utf8").write("\n".join(out) + "\n")
print(out[-1])
sys.exit(1 if missed else 0)
