# Choose price before print — up to 9 prices (2026-11-21)

Branch `claude/great-wright-3v8plu` (from main `991c24b2`). Jeff approved the preview
(claude.ai/artifact/RFpSZxJbgLwBvuvYkfNc4E). For every seller, every plan, every country — it is only a maximum.
**NOT APPLIED:** `sql/196` (database) and `sql/197` (help guide). No Render deploy, no phone app build
(the phone apps load the web from Vercel).

## What changes for a seller
- Settings → Live setup → Choose price before print: up to **9** prices. The list looks as today (one price per
  row on a phone, several per row on a laptop). With fewer than 9 the Price + Add row shows as today; with 9 it is
  gone and one short note says **"9 of 9 prices saved. Remove one to add a new price."** (8 languages).
- The price window: 3 prices per row as before. With **exactly 9** prices and Show Free on, the Free button takes
  its own full-width row under the prices. With 1–8 prices Free is the next cell, as today.
- Nothing else: the default (first price), Type price, Skip, Free (prints FREE), the sold-out question, the tap
  guard, the waiting line, orders and printing are unchanged.

## Why two database columns (old devices can never delete prices 7–9)
An app opened before this change can stay open on a second phone or laptop tab. It reads the price list, keeps 6,
and sends its whole 6-price list with every Settings change (switch, Show Free, ☆, ×, Same price on). So prices
7–9 live in a NEW column `prices_more`; `prices` keeps 1–6 and its own "at most 6" check. A save writes only the
columns it sends → an old device's save never touches `prices_more`. The new app reads both as one list and splits
it again when saving; it sends `prices_more` only when the list has, or had, more than 6 — a seller with 6 or fewer
sends exactly today's request.
- An old device sees (and its price window shows) only the first 6 until it is fully closed and opened again.
- If an old device adds a price that is already 7th–9th, the database refuses it ("Couldn't save" on that device) —
  nothing is lost.

## Order (Jeff)
Either order is safe for sql/196 and the web merge:
- web first → up to 6 works as today; adding a 7th says "Couldn't save" and the list goes back to 6;
- sql/196 first → nothing reads the new column until the web is updated.
Then `sql/197` (the one guide row) after both. Rollback: `sql/196_choose_price_nine_rollback.sql` is refused while
any seller has a 7th–9th price (nothing is changed); `sql/197_…_rollback.sql` puts the live guide row back.

## Pictures (the real Settings and price window, real browser, deviceScaleFactor 2)
| File | What |
|---|---|
| `settings-9-prices_*` | 9 prices, the 9-of-9 note, no Add row, Show Free button under it |
| `settings-8-prices_*` | 8 prices, the Add row as today |
| `pop-9-prices-free_*` | the price window, 9 prices + Free on its own full-width row, "2 more waiting" |
| `pop-9-prices_*` | 9 prices, Show Free off |

Devices: `iphone-390x844`, `android-412x915`, `laptop-1280x800`. Made by `harness/shoot.cjs` (dev server first:
`npx vite --port 5199`); it also checks each picture: no sideways scroll, no cut label, Free exactly as wide as the
price grid and 58 px high, every ☆ / × at least 44 px, one price per row on the phones, the note on screen only at 9.

## Proof
- `proof/sql196-behaviour.txt` — `scripts/sql196-behaviour.mjs` on PGlite (54 checks): the app's exact PostgREST
  upserts; every old-app Settings action keeps prices 7–9; a 10th / a 7th in `prices` / a price twice across the two
  columns refused; own row only; the rollback refused with 7th–9th prices, then clean once there are none.
- `proof/sticker-vs-main.txt` — the sticker of a NT$300 order and of a Free order, built by the app's own order
  builder, handed to 5 printer paths (AIMO D520, Xprinter/Flash TSPL, ESC-POS, CPCL, Niimbot), today's sticker and
  the new sticker: 20 fingerprints, identical on main and on this branch. The real app test shows the 7th–9th price
  (and Free at 9) make exactly the order call main makes for that price.
- `proof/breaks.txt` — 18 on-purpose breaks, every one caught.
- Tests: `choosePriceNine.oldDevice.test.tsx` (main's frozen hook as the old device against a fake database with the
  real checks), `ChoosePriceSheet.nine.test.tsx` (1–9 prices × Free on/off), `GeneralSettings.chooseNine.test.tsx`,
  `choosePriceNine.app.test.tsx`, `choosePriceNine.sticker.test.ts`, `choosePriceNineSql.test.ts`.
