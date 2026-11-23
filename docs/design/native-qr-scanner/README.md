# Native "Scan sticker QR" — evidence (branch `claude/native-qr-scanner`)

What it is: in the phone app (iOS build 15, Android versionCode 11) every Scan button opens a live
camera scanner. On a laptop, in an older app build, or with `native_qr_scanner_enabled` off, the
same button opens today's photo picker, unchanged. Nothing else changes — no printer code, no other function.

## Files here
- `header-check.cjs` — opens the real app (preview mode, made-up data) on main and on this branch →
  Orders in 8 languages (en, fil, zh, zh-TW, vi, th, id, bg) × 360 / 390 / 430 / 1280 px × empty box and
  typed text ("dress"). For each case: the search row height on main; on the branch WITHOUT the scanner
  (laptop / older app build) the row height and a pixel compare with main; WITH the scanner (a fake
  plugin + the switch on) the row height, the Scan button inside the row, its tap area, sideways scroll.
  Then the same at a FORCED 33 px row (Jeff's phone) on main and on the branch: the Scan tap area (the
  smallest of 3 points across the button) and the tap area of every neighbour — Orders/Miners tabs, ✕,
  the chips, Sessions — at 3 points each, which must equal main's.
  A 3-pixel spot on the "Session" pill differs between two loads of the SAME page now and then (main
  against main shows it too), so a case with a difference loads both pages again (up to 3 times) and the
  file ends with a main-against-main control.
  Run: `npx vite --config vite.preview.config.ts --port 5198` in a main checkout and `--port 5199` here,
  then `node docs/design/native-qr-scanner/header-check.cjs 5198 5199`.
- `header-check.txt` — its output (64 cases).
- `shots/orders-header_<width>[ _typed][_row33].png` — the Orders header in the phone app with the Scan
  button (natural row, and forced to 33 px).

## What the check found (Fix Round 2)
- Main's search row is 34 px here (fonts of this machine; Jeff measured 33 px on his phone — the point is
  "the same as main"). With the Scan button the row is the SAME height at every width, in every
  language, empty or typed (the button is 26 px tall, pulled into the row's padding with
  margin -5 / -6 / -5 / 0; the 44 px tap area comes from `.sfl-tap44`). Nothing scrolls sideways.
- Without the scanner (laptop / older app build) Orders is pixel-identical to main: 64 of 64 cases.

## Fix Round 3
- The Scan button's 44 px tap area starts 6 px higher (was 4 px): at a 33 px row it is ≥ 44 px in every
  language and width, and ✕ / tabs / chips / Sessions keep exactly main's tap area (`header-check.txt`).
- The mobile/ byte pin runs only with `SCANNER_GATE=1` (the Mac gate). `proof/fence-scope.txt`: a scratch
  copy with 1 byte changed in TsplBuilder.java, a new file under mobile/, native-version.json at 15/11 and
  versionCode 12 → the normal tests stay green; with `SCANNER_GATE=1` the byte pin fails on exactly the
  changed printer file and the added file.

## Printer safety — proven by files
- Android build: `mobile/android/qr-scanner-gate.sh` (run once on the Mac) picks BASE = the newest
  origin/main commit without the scanner and NEW = HEAD (both printed), runs the mobile/ byte pin, builds
  both release .aab files and checks chip types, every .so (sha256), the printer code in the dex (code and
  annotations), library versions (an unreadable line = CANNOT MEASURE), the WHOLE merged manifest, every
  other .aab file (resources compared by name), size and 16 KB pages — see the script header. Its checks
  are tested on made-up inputs in `src/redesign/__tests__/qrScannerGate.test.ts` (a changed .so, a new chip
  type, a bumped library, a changed printer class or annotation, LAUNCHER removed, a new uses-library, an
  empty manifest, an unreadable dependency line, a changed asset … each one turns FAIL or CANNOT MEASURE).
  ⚠️ resources.pb / compiled XML are decoded following aapt2's Resources.proto; that decoding was never
  run on a real .aab here (no Android SDK in the cloud) — a FAIL or CANNOT MEASURE on the Mac → ask Claude.
- Source: `src/redesign/__tests__/nativeScannerMain.fence.test.ts` (only with `SCANNER_GATE=1`) — every
  file under `mobile/` that the scanner does not need (printer code, Niimbot libraries, Package.swift /
  Package.resolved, gradle files …) is the base's exact file; the five files it edits are the base's once
  the scanner lines are taken out.

## Not checked here
The native scanner screens (iPhone + Android) cannot run in this cloud session (no Xcode, no
Android SDK). They are checked on Jeff's Mac and phones.

## On-purpose breaks
`proof/breaks.py` makes 86 small wrong changes one at a time and runs the test that should catch each;
every file is put back after. First build (16), Fix Round 1 (12), Fix Round 2 (26), Fix Round 3 (32): the chip-type filter
removed / x86_64 added / a library added; the iPhone photo library swipe-away or a Cancel that does not
finish; a printer file, Package.swift, Package.resolved, the Bluetooth sentence, a second registration
line or a framework changed; the Orders button back to a taller row (and its tap area back to 4 px);
the byte pin running without SCANNER_GATE or losing its teeth; the gate's base picked wrongly, a prune
put back, annotations / LAUNCHER / uses-library / an empty manifest / an unreadable dependency line / a
changed asset or resource let through; and each gate check made to let its problem through. `proof/breaks.txt` = the result. Run from the repo folder:
`python3 docs/design/native-qr-scanner/proof/breaks.py`.
