# Native "Scan sticker QR" — evidence (branch `claude/native-qr-scanner`)

What it is: in the phone app (iOS build 15, Android versionCode 11) every Scan button opens a live
camera scanner. On a laptop, in an older app build, or with `native_qr_scanner_enabled` off, the
same button opens today's photo picker, unchanged.

## Files here
- `shoot.cjs` — opens the real app (preview mode, made-up data) → Orders in 4 languages (en, fil, bg, th).
  At 360 / 390 / 430 px it plays the NEW phone app (a fake scanner plugin + the switch on) and measures
  the search row with the Scan button; at 1280 px it plays a laptop (no scanner) and counts Scan buttons.
  Run: `npx vite --config vite.preview.config.ts --port 5199`, then `node docs/design/native-qr-scanner/shoot.cjs 5199`.
- `header-check.txt` — its output (16 lines).
- `shots/orders-header_<width>.png` — the Orders header in the phone app (English);
  `shots/orders-header_laptop_<lang>_1280.png` — the laptop header (no Scan button = today's Orders).

## What the check found
- The Scan button shows ONLY in the phone app with the live scanner (Fix Round 1): laptop = 0 Scan buttons.
- In the phone app the search row stays ONE line, 38 px tall, at every width and language; nothing
  scrolls sideways. The longest label (Bulgarian "Сканирай", 95 px) still leaves a 183 px search box at 360 px.
- Tap area: 45 px tall. The Sessions button right under it also has a 44 px area; the Scan button's
  area starts 4 px higher (`.sfl-tap44-up` in redesign.css; there is free room above), so both get
  45 px with no overlap.

## Not checked here
The native scanner screens (iPhone + Android) cannot run in this cloud session (no Xcode, no
Android SDK). They are checked on Jeff's Mac and phones — see the branch report.

## On-purpose breaks
`proof/breaks.py` makes 28 small wrong changes one at a time and runs the test that should catch each;
every file is put back after. First build (16): photo picker always, no strict parser, 7-day load on scan,
case-sensitive match, Facebook buyers matched, rule margin / frames drift in web, Java and Swift, switch
accepting any value, a second registration line, a VIBRATE permission, sql/209 words drifting from the guide,
a bare timer. Fix Round 1 (12): Orders Scan without the live scanner, RedesignApp always passing it, the
availability check ignoring the switch, an unreadable photo as a scanner failure (2), the chooser count back
to 0, Blacklist clearing the note early, Android without the portrait lock / without the restore in close(),
iPhone reporting an unreadable photo as cancelled, version name 2.0, the batch-limit test without its wait.
`proof/breaks.txt` = the result: 28/28 red. Run from the repo folder: `python3 docs/design/native-qr-scanner/proof/breaks.py`.
