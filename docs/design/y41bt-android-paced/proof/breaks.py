#!/usr/bin/env python3
"""On-purpose breaks of the Y41BT paced send — is each one caught by a test?

Each break changes ONE thing in the real source, runs the three checks, and puts the file back:
  J = the Java unit tests on the plain JVM (PacedBleSendTest + BleStickerLogicTest)
  S = the simulation (the real GenericBleTransport on a pretend phone + printer: other printers main == branch,
      and the Y41BT checks)
  C = the source pins in CI (pacedBleSend.contract.test.ts)
Run from the repo root:  python3 docs/design/y41bt-android-paced/proof/breaks.py <folder with junit-4.13.2.jar + hamcrest-core-1.3.jar>
"""
import os, shutil, subprocess, sys, tempfile

LIB = sys.argv[1] if len(sys.argv) > 1 else ""
J = "mobile/android/app/src/main/java/com/sellerflow/live/"
T = "mobile/android/app/src/test/java/com/sellerflow/live/"
PACED, GENERIC, PLUGIN = J + "PacedBleSend.java", J + "GenericBleTransport.java", J + "SellerFlowPrinterPlugin.java"
ENV = {k: v for k, v in os.environ.items() if k != "JAVA_TOOL_OPTIONS"}
CP = f"{LIB}/junit-4.13.2.jar:{LIB}/hamcrest-core-1.3.jar"

def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, env=ENV)
    return r.returncode == 0

def junit():
    out = tempfile.mkdtemp()
    try:
        if not sh(f"javac -encoding UTF-8 -nowarn -cp {CP} -d {out} {PACED} {J}BleStickerLogic.java {T}PacedBleSendTest.java {T}BleStickerLogicTest.java"):
            return False
        return sh(f"java -cp {out}:{CP} org.junit.runner.JUnitCore com.sellerflow.live.PacedBleSendTest com.sellerflow.live.BleStickerLogicTest")
    finally:
        shutil.rmtree(out, ignore_errors=True)

def sim():
    keep = tempfile.mkdtemp()
    d = "docs/design/y41bt-android-paced/proof/sim/"
    names = ["others-main.txt", "others-branch.txt", "y41-main.txt", "y41-branch.txt"]
    for n in names: shutil.copy(d + n, keep)
    try:
        return sh(f"bash {d}run.sh")
    finally:
        for n in names: shutil.copy(os.path.join(keep, n), d + n)  # the committed outputs stay those of the real code
        shutil.rmtree(keep, ignore_errors=True)

def contract():
    return sh("npx vitest run src/redesign/adapters/__tests__/pacedBleSend.contract.test.ts")

BREAKS = [
    # (what, file, old, new)
    ("a second printer gets the paced send (XP-420B added to the list)", PACED,
     'NAME_PREFIXES = { "Y41BT" };', 'NAME_PREFIXES = { "Y41BT", "XP-420B" };'),
    ("the name may match anywhere, not only at the start", PACED,
     "if (n.startsWith(p.toUpperCase(Locale.US))) return true;", "if (n.contains(p.toUpperCase(Locale.US))) return true;"),
    ("pieces of 509 bytes again", PACED, "static final int MAX_CHUNK = 180;", "static final int MAX_CHUNK = 509;"),
    ("the piece ignores the size the phone and printer agreed on", PACED,
     "return Math.max(BleStickerLogic.MIN_CHUNK, Math.min(negotiated, MAX_CHUNK));", "return MAX_CHUNK;"),
    ("no pause between pieces", PACED, "static final long GAP_MS = 8;", "static final long GAP_MS = 0;"),
    ("the next piece is offered while one is still in flight", PACED,
     "if (failed || inFlight || allTaken()) return null;", "if (failed || allTaken()) return null;"),
    ("a piece the phone reports as NOT written counts as written", PACED,
     "if (!ok) { failed = true; return Next.FAIL_WRITE; }", "if (!ok) { /* ignored */ }"),
    ("the next piece goes at once (no wait after the answer)", PACED,
     """            if (next == Next.WRITE_AFTER_GAP) {
                phone.progress(s.taken());
                schedule(GAP_MS, this::pump);""",
     """            if (next == Next.WRITE_AFTER_GAP) {
                phone.progress(s.taken());
                pump();"""),
    ("a busy phone: the piece is counted as handed over", PACED,
     "else if (w == WRITE_BUSY) schedule(GAP_MS, this::pump);", "else if (w == WRITE_BUSY) s.onWriteStarted();"),
    ("the question is never asked", PACED,
     "boolean can = phone.canAsk();", "boolean can = false;"),
    ("no answer to the question still ends as SENT", PACED,
     "if (s.onConfirmTimeout() == Next.FAIL_NOT_CONFIRMED) fail(MSG_NOT_CONFIRMED);", "if (s.onConfirmTimeout() == Next.FAIL_NOT_CONFIRMED) { over = false; phone.settle(); }"),
    ("the phone's own error (133) counts as the printer's answer", PACED,
     "return status >= 0x01 && status <= 0x13 && status != 0x08;", "return true;"),
    ("status 0x08 (also a lost link) counts as the printer's answer", PACED,
     "return status >= 0x01 && status <= 0x13 && status != 0x08;", "return status >= 0x01 && status <= 0x13;"),
    ("the link closing before the answer ends as SENT", PACED,
     "failed = true; // the question was not asked yet, or not answered yet\n            return Next.FAIL_NOT_CONFIRMED;",
     "return Next.DONE_OK;"),
    ("the link closing while sending ends as SENT", PACED,
     "if (!allTaken()) { failed = true; return Next.FAIL_DISCONNECTED; }", "if (!allTaken()) { return Next.DONE_OK; }"),
    ("the question may read a value of the print service", PACED,
     '{"1800", "2A00"}, {"1800", "2A01"},', '{"FF00", "FF02"}, {"1800", "2A00"}, {"1800", "2A01"},'),
    ("the wait for the answer no longer grows with the job", PACED,
     "return Math.min(CONFIRM_TIMEOUT_MAX_MS, CONFIRM_TIMEOUT_MS + Math.max(0, jobBytes) / 4);", "return CONFIRM_TIMEOUT_MS;"),
    ("a stopped job can still send", PACED,
     """        void stop() {
            over = true;""", """        void stop() {
            over = false;"""),
    ("the 1.5 s wait starts before the printer answered (settle at the question)", PACED,
     "if (next == Next.WAIT_CONFIRM) schedule(confirmTimeoutMs(s.totalBytes()), this::onConfirmTimeout);",
     "if (next == Next.WAIT_CONFIRM) phone.settle();"),
    # the Bluetooth plumbing
    ("GenericBleTransport: the Y41BT is not sent the paced way", GENERIC,
     "        if (pacedWanted) { beginPaced(chunkSize); return; } // Y41BT\n", ""),
    ("GenericBleTransport: the saved name is ignored (only the device's own name)", GENERIC,
     "pacedWanted = PacedBleSend.appliesTo(nameHint, deviceName); // Y41BT", "pacedWanted = PacedBleSend.appliesTo(deviceName); // Y41BT"),
    ("GenericBleTransport: EVERY printer is sent the paced way", GENERIC,
     "pacedWanted = PacedBleSend.appliesTo(nameHint, deviceName); // Y41BT", "pacedWanted = true; // Y41BT"),
    ("GenericBleTransport: a closing link uses the old rule (sent once everything was handed over)", GENERIC,
     "                    if (paced != null) { paced.onDisconnected(); return; } // Y41BT\n", ""),
    ("GenericBleTransport: the printer's answer never reaches the driver", GENERIC,
     "                paced.onConfirmAnswer(status);\n", ""),
    ("GenericBleTransport: the paced pieces use the generic size", GENERIC,
     "new PacedBleSend.Session(payload, PacedBleSend.chunkSize(negotiatedChunk));", "new PacedBleSend.Session(payload, negotiatedChunk);"),
    ("GenericBleTransport: the phone's answers for the pieces never reach the driver", GENERIC,
     "if (paced != null) { if (jobActive && g == gatt) paced.onWriteAnswer(status == BluetoothGatt.GATT_SUCCESS); return; } // Y41BT",
     "if (paced != null) { return; } // Y41BT"),
    ("GenericBleTransport: a failed write is reported to the driver as written", GENERIC,
     "paced.onWriteAnswer(status == BluetoothGatt.GATT_SUCCESS); return; } // Y41BT", "paced.onWriteAnswer(true); return; } // Y41BT"),
    ("GenericBleTransport: the paced state survives the job (the next printer inherits it)", GENERIC,
     "        if (paced != null) { paced.stop(); paced = null; } // Y41BT\n        pacedWanted = false; confirmChar = null; // Y41BT\n", ""),
    ("GenericBleTransport: the paced write always asks for a response", GENERIC,
     "            int type = writeNoResponse ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;\n            boolean started;\n            try {\n                if (Build.VERSION.SDK_INT >= SDK_TIRAMISU) {\n                    started = gatt.writeCharacteristic(writeChar, piece, type)",
     "            int type = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;\n            boolean started;\n            try {\n                if (Build.VERSION.SDK_INT >= SDK_TIRAMISU) {\n                    started = gatt.writeCharacteristic(writeChar, piece, type)"),
    ("GenericBleTransport: \"sent\" right after the answer (no 1.5 s)", GENERIC,
     "            handler.postDelayed(settleTimer, SETTLE_MS);\n        }\n\n        @Override\n        public void done()",
     "            handler.postDelayed(settleTimer, 0);\n        }\n\n        @Override\n        public void done()"),
    ("GenericBleTransport: the generic send's own piece size is changed", GENERIC,
     "        chunks = BleStickerLogic.chunks(payload, chunkSize);\n        nextChunk = 0;\n        lastWriteProgressAt = SystemClock.uptimeMillis();\n        armWriteStall();\n        pump();",
     "        chunks = BleStickerLogic.chunks(payload, Math.min(chunkSize, 180));\n        nextChunk = 0;\n        lastWriteProgressAt = SystemClock.uptimeMillis();\n        armWriteStall();\n        pump();"),
    # the plugin
    ("Plugin: the saved Y41BT name is used for ANOTHER printer under test", PLUGIN,
     'return isSaved ? prefs().getString(PREF_BT_NAME, "") : "";', 'return prefs().getString(PREF_BT_NAME, "");'),
    ("Plugin: no name is passed (the Y41BT is only known by the device's own name)", PLUGIN,
     "generic().printJob(tspl, address, genericNameHint(call, address), r -> {", 'generic().printJob(tspl, address, "", r -> {'),
]

def main():
    if not (LIB and os.path.exists(f"{LIB}/junit-4.13.2.jar")):
        sys.exit("give the folder that holds junit-4.13.2.jar and hamcrest-core-1.3.jar")
    print("the real code first:")
    base = {"J": junit(), "S": sim(), "C": contract()}
    print("  J (Java unit tests) =", "pass" if base["J"] else "FAIL", "| S (simulation) =", "pass" if base["S"] else "FAIL", "| C (source pins) =", "pass" if base["C"] else "FAIL")
    if not all(base.values()):
        sys.exit("the real code does not pass — fix that first")
    print()
    caught = 0
    for i, (what, path, old, new) in enumerate(BREAKS, 1):
        src = open(path, encoding="utf-8").read()
        if src.count(old) != 1:
            print(f"{i:2}. {what}\n      CANNOT APPLY (the text to change was found {src.count(old)} times)")
            continue
        try:
            open(path, "w", encoding="utf-8").write(src.replace(old, new))
            red = [k for k, f in (("J", junit), ("S", sim), ("C", contract)) if not f()]
        finally:
            open(path, "w", encoding="utf-8").write(src)
        ok = bool(red)
        caught += ok
        print(f"{i:2}. {what}\n      {'caught by ' + ' + '.join(red) if ok else 'NOT CAUGHT'}")
    print()
    print(f"{caught} of {len(BREAKS)} breaks caught")
    sys.exit(0 if caught == len(BREAKS) else 1)

main()
