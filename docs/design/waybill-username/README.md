# Waybill username (TikTok Shop, Philippines)

Branch `claude/waybill-username` — NOT merged. sql/231 + sql/232 NOT applied. Web only (no Render, no app build).
Approved design: https://claude.ai/artifact/JFCUgRNggFrpmVUa1rQeuz

## What it does
Settings → **SHIPPING** → **Shipping** → **Waybill username**. The seller uploads two TikTok Shop files:
the order list (CSV) and the waybills (PDF). The app writes each buyer's `@username` on their waybill and gives
back one new PDF (phone: Download / Share; laptop: Print + Download). The files never leave the phone / computer.

## Pictures (the real app, preview mode, fictional buyers)
`shots/` — made by `shoot.cjs` (the real app with `src/dev/fakeSupabase.ts ?wb=ph|tw|off`):

| Width | Settings | Shipping | Upload | Results | Pick the buyer |
|---|---|---|---|---|---|
| iPhone 390 | `iphone390_1_settings` | `iphone390_2_shipping_ph` | `iphone390_3_upload_empty`, `_4_upload_ready` | `iphone390_5_results` | `iphone390_6_pick_sheet`, `_7_pick_selected`, `_8_after_pick` |
| Android 412 | `android412_*` (same steps) |||||
| 360 / 430 | `phone360_*`, `phone430_*` |||||
| Laptop 1280 | `laptop1280_*` |||||
| Dark mode | `iphone390_dark_settings`, `_dark_shipping`, `_dark_results`, `_dark_pick_sheet` |||||
| Taiwan "Soon" | `iphone390_tw_settings`, `iphone390_tw_shipping` |||||
| Switch off | `iphone390_off_settings` (= Settings as before) |||||

`shots-all.txt` lists every picture with its sideways-scroll measure (0 px = no sideways scroll).

The stamped waybill: `stamped/` — the fake J&T waybill (same layout as the approved picture, fictional data) after the app
added the usernames, drawn by pdf.js: `stamped/demo-*.png` (the demo file: 7 usernames, one left blank, one not in the
order list) and `stamped/long-*.png` (a short and a 24-character username — the long one is made smaller to stay on one line).

## Proof
- `proof/breaks-run1.txt` + `proof/breaks-run2.txt` — every rule broken on purpose once; the tests must go red
  (`proof/breaks.py`, `python3 docs/design/waybill-username/proof/breaks.py [words]` runs only matching breaks).
  32 of 33 caught; the 33rd cannot fail (JavaScript's trim() also removes the byte-order mark — see run 2).
- Fence: `node scripts/waybill-fence.mjs --check` — every printing / sticker / receipt / Bluetooth file, mobile/, server/,
  server.js, chrome-extension/ are byte-identical to main (f8b90114).
- SQL: `PGLITE_DIR=… node scripts/sql231-behaviour.mjs` (23 checks), `scripts/sql232-behaviour.mjs` (8 checks).

## Make the pictures again
```bash
WB_DUMP=/tmp/wbdemo npx vitest run src/redesign/adapters/__tests__/waybillDemo.dump.test.ts
npx vite --config vite.preview.config.ts --port 5199
node docs/design/waybill-username/shoot.cjs 5199 /tmp/wbdemo
```
The stamped-waybill PNGs were drawn with pdf.js in a scratch folder (pdfjs-dist is NOT a dependency of the app).

## Not proven (no real TikTok files in the repo)
- The real CSV's header names (Order ID / Tracking ID / Buyer Username) and the real masks are taken from the spec.
- The real waybill PDF: its fonts, the exact words "Weight" / "Payment" / "TT Order ID", the line spacing and where the
  barcode column starts are taken from the spec + the approved picture. If a real label differs, the app shows
  "Couldn't place the username on this waybill" for that page and prints it as it is (it never covers anything).
- The laptop print window and the phone share sheet were not run on a real browser / phone.
- Printer guardian (2026-11-27): no print path changed. Known on a laptop: with the auto-print (kiosk) Chrome,
  Print goes silently to the default printer (usually the sticker printer) — the laptop screen says to use
  Download PDF there and to print waybills after the live. Inside the phone / tablet app there is no Print
  button (Download only).
