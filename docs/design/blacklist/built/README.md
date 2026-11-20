# Blacklist — BUILT (branch `claude/blacklist`, nothing merged, applied or deployed)

Pictures of the REAL screens (SettingsHub with the tile, the Blacklist screen, the Live rows with the chip,
the dates sheet), clicked through like a seller would, on made-up data with no database.

- `sheet_{iphone390,android360,laptop1280}_{en,fil}.png` — overview.
  Row 1: Settings (NEW) · Settings after opening once · no reason yet · reason + typed name · reading the QR · scanned.
  Row 2: added + Undo · after Undo · Already added today · Facebook name · a TikTok name with a space · QR with no buyer.
  Row 3: search · Remove question · empty list · live rows with the chip · the dates sheet.
- `shots/` — all 102 pictures, full page. `measured.txt` — every picture: 0 px sideways scroll, no cut text,
  every phone button ≥ 44 px, no page error, the live-row name's tap area covers no other button, the Add colour.
- `proof/breaks.txt` — 25 on-purpose breaks (22 in the code, 3 in the SQL run on a throw-away database): all caught.
- How they were made: `npx vite --config docs/design/blacklist/built/harness/vite.config.mjs --port 5334`, then
  `node docs/design/blacklist/built/harness/shoot.cjs` and `python3 -I docs/design/blacklist/built/harness/sheet.py`.
  Breaks: `PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> python3 -I docs/design/blacklist/built/proof/breaks.py`.

Two changes against the STEP 0 pictures:
- The **NEW** badge sits on the tile's top-right corner. In STEP 0 it was inside the tile and ran past the tile's
  edge on a 360 px phone (visible in `../shots/settings_android360_en.png`).
- The buyer's name on a live row has a 44 px tap area (it was 15 px tall, the same as Taiwan's Buyer Alert name).
  Nothing on screen moves; the extra area goes down over the comment text, never over a button.
