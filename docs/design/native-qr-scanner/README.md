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
  A 3-pixel spot on the "Session" pill differs between two loads of the SAME page now and then (main
  against main shows it too), so a case with a difference loads both pages again (up to 3 times) and the
  file ends with a main-against-main control.
  Run: `npx vite --config vite.preview.config.ts --port 5198` in a main checkout and `--port 5199` here,
  then `node docs/design/native-qr-scanner/header-check.cjs 5198 5199`.
- `header-check.txt` — its output (64 cases).
- `shots/orders-header_<width>[ _typed].png` — the Orders header in the phone app with the Scan button.

## What the check found (Fix Round 2)
- Main's search row is 34 px here (fonts of this machine; Jeff measured 33 px on his phone — the point is
  "the same as main"). With the Scan button the row is the SAME height at every width, in every
  language, empty or typed (the button is 26 px tall, pulled into the row's padding with
  margin -5 / -6 / -5 / 0; the 44 px tap area comes from `.sfl-tap44`). Nothing scrolls sideways.
- Without the scanner (laptop / older app build) Orders is pixel-identical to main: 64 of 64 cases.

## Printer safety — proven by files
- Android build: `mobile/android/qr-scanner-gate.sh` (run once on the Mac) builds the release .aab of
  main and of this branch and checks chip types, every .so (sha256), the printer code in the dex, library
  versions, the merged manifest, size and 16 KB pages — see the script header. Its checks are tested on
  made-up inputs in `src/redesign/__tests__/qrScannerGate.test.ts` (a changed .so, a new chip type, a
  bumped library, a changed printer class, a new permission … each one turns FAIL).
- Source: `src/redesign/__tests__/nativeScannerMain.fence.test.ts` — every file under `mobile/` that the
  scanner does not need (printer code, Niimbot libraries, Package.swift / Package.resolved, gradle files …)
  is main's exact file; the five files it edits are main's once the scanner lines are taken out.

## Not checked here
The native scanner screens (iPhone + Android) cannot run in this cloud session (no Xcode, no
Android SDK). They are checked on Jeff's Mac and phones.

## On-purpose breaks
`proof/breaks.py` makes 54 small wrong changes one at a time and runs the test that should catch each;
every file is put back after. First build (16), Fix Round 1 (12), Fix Round 2 (26): the chip-type filter
removed / x86_64 added / a library added; the iPhone photo library swipe-away or a Cancel that does not
finish; a printer file, Package.swift, Package.resolved, the Bluetooth sentence, a second registration
line or a framework changed; the Orders button back to a taller row; and each gate check made to let its
problem through. `proof/breaks.txt` = the result. Run from the repo folder:
`python3 docs/design/native-qr-scanner/proof/breaks.py`.
