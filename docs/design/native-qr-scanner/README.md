# Native "Scan sticker QR" — evidence (branch `claude/native-qr-scanner`)

What it is: in the phone app (iOS build 15, Android versionCode 11) every Scan button opens a live
camera scanner. On a laptop, in an older app build, or with `native_qr_scanner_enabled` off, the
same button opens today's photo picker, unchanged.

## Files here
- `shoot.cjs` — opens the real app (preview mode, made-up data) → Orders, at 360 / 390 / 430 / 1280 px
  and in 4 languages (en, fil, bg, th), and measures the search row with the new Scan button.
  Run: `npx vite --config vite.preview.config.ts --port 5199`, then `node docs/design/native-qr-scanner/shoot.cjs 5199`.
- `header-check.txt` — its output (16 lines).
- `shots/orders-header_<width>.png` — the Orders header in English at each width.

## What the check found
- The search row stays ONE line, 38 px tall, at every width and language; nothing scrolls sideways.
- The Scan button sits inside the row; the longest label (Bulgarian "Сканирай", 95 px) still leaves
  a 183 px search box at 360 px.
- Tap area: 45 px tall. The first run measured less, because the Sessions button right under it
  also has a 44 px area and the two overlapped by a few pixels. The Scan button's area now starts
  4 px higher (`.sfl-tap44-up` in redesign.css; there is free room above), and both buttons get
  45 px with no overlap.

## Not checked here
The native scanner screens (iPhone + Android) cannot run in this cloud session (no Xcode, no
Android SDK). They are checked on Jeff's Mac and phones — see the branch report.
