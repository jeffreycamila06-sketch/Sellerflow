#!/usr/bin/env python3
"""Y41BT paced send (Android) — are the other printers' code lines untouched?

For the two existing Java files this branch edits, take the branch's file, remove
  - everything between the lines "// >>> Y41BT paced send" and "// <<< Y41BT paced send" (the new code),
  - every single line that ends with "// Y41BT" (the guarded lines added inside existing code),
put the ONE changed line of each file back to main's text, and compare with main's file byte for byte.
Also lists every other file under mobile/ and the printing list that differs from main.

Run from the repo root:  python3 docs/design/y41bt-android-paced/proof/same-as-main.py [base, default origin/main]
"""
import hashlib, re, subprocess, sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
DIR = "mobile/android/app/src/main/java/com/sellerflow/live/"
OPEN, CLOSE = "// >>> Y41BT paced send", "// <<< Y41BT paced send"
ONE_CHANGED_LINE = {
    DIR + "GenericBleTransport.java": (
        "    void printJob(final byte[] data, final String address, final String nameHint, final Callback callback) {",
        "    void printJob(final byte[] data, final String address, final Callback callback) {"),
    DIR + "SellerFlowPrinterPlugin.java": (
        "        generic().printJob(tspl, address, genericNameHint(call, address, what), r -> {",
        "        generic().printJob(tspl, address, r -> {"),
}

def git(*a):
    return subprocess.run(["git", *a], check=True, capture_output=True).stdout

def sha(b):
    return hashlib.sha256(b).hexdigest()

def strip(text, changed):
    out, inside, removed_regions, removed_lines, swapped = [], False, 0, 0, 0
    for line in text.split("\n"):
        t = line.strip()
        if t == OPEN:
            assert not inside
            inside = True
            removed_regions += 1
            if out and out[-1] == "":
                out.pop()  # the blank line that separates the region from the code before it
            continue
        if t == CLOSE:
            assert inside
            inside = False
            continue
        if inside:
            continue
        if re.search(r"\s*// Y41BT$", line):
            removed_lines += 1
            continue
        if line == changed[0]:
            line = changed[1]
            swapped += 1
        out.append(line)
    assert not inside
    return "\n".join(out), removed_regions, removed_lines, swapped

ok = True
print(f"base = {BASE} = {git('rev-parse', BASE).decode().strip()}")
print(f"head = {git('rev-parse', 'HEAD').decode().strip()}" + ("  (+ uncommitted changes)" if git('status', '--porcelain').strip() else ""))
print()
for path, changed in ONE_CHANGED_LINE.items():
    main = git("show", f"{BASE}:{path}")
    mine = open(path, "rb").read()
    stripped, regions, lines, swapped = strip(mine.decode("utf-8"), changed)
    same = stripped.encode("utf-8") == main
    ok &= same and swapped == 1
    print(path)
    print(f"  removed: {regions} marked region(s), {lines} line(s) ending '// Y41BT'; changed line put back: {swapped}")
    print(f"  main    sha256 {sha(main)}  ({len(main)} bytes)")
    print(f"  result  sha256 {sha(stripped.encode('utf-8'))}  ({len(stripped.encode('utf-8'))} bytes)")
    print(f"  => {'IDENTICAL to main' if same else 'DIFFERENT from main'}")
    print()

print("every other file under mobile/ that differs from main:")
diff = [l for l in git("diff", "--name-status", BASE, "--", "mobile/").decode().split("\n") if l]
untracked = [l for l in git("ls-files", "--others", "--exclude-standard", "--", "mobile/").decode().split("\n") if l]
expected_new = {DIR + "PacedBleSend.java", "mobile/android/app/src/test/java/com/sellerflow/live/PacedBleSendTest.java"}
for l in diff:
    status, path = l.split("\t", 1)
    if path in ONE_CHANGED_LINE:
        continue
    note = "new file of this feature" if (status == "A" and path in expected_new) else "UNEXPECTED"
    ok &= note != "UNEXPECTED"
    print(f"  {status}  {path}   <- {note}")
for path in untracked:
    note = "new file of this feature (not committed yet)" if path in expected_new else "UNEXPECTED"
    ok &= note != "UNEXPECTED"
    print(f"  ?  {path}   <- {note}")

print()
print("printer files that must be byte-identical to main:")
for path in [DIR + "BleStickerTransport.java", DIR + "BleStickerLogic.java", DIR + "NiimbotTransport.java", DIR + "TsplBuilder.java",
             DIR + "MainActivity.java", "mobile/ios/App/App/SellerFlowPrinterPlugin.swift", "mobile/android/app/build.gradle",
             "mobile/android/app/src/main/AndroidManifest.xml",
             "src/redesign/adapters/printing.ts", "src/redesign/adapters/printerModels.ts", "src/redesign/adapters/printerBridge.ts",
             "src/redesign/adapters/savedPrinter.ts", "src/redesign/adapters/stickerRaster.ts", "src/redesign/screens/PrinterSettings.tsx"]:
    same = git("show", f"{BASE}:{path}") == open(path, "rb").read()
    ok &= same
    print(f"  {'same     ' if same else 'DIFFERENT'}  {path}")

print()
print("RESULT:", "PASS — outside the marked Y41BT lines, nothing changed" if ok else "FAIL")
sys.exit(0 if ok else 1)
