# Choose price before print — up to 12 prices (2026-11-28)

Branch `claude/choose-price-twelve` (from main `83aae240`). Jeff said go on the plan (2026-11-28): a third
"box" of 3 prices, 3 per row in the price window, Free on its own row at 12.
For every seller, every plan, every country — it is only a maximum. On 2026-11-28, 23 sellers had all 9 saved.
**NOT APPLIED:** `sql/238` (database) and `sql/239` (help guide). No Render deploy, no phone app build
(the phone apps load the web from Vercel). No change to orders, printing or the sticker.

## What changes for a seller
- Settings → Live setup → Choose price before print: up to **12** prices. The list looks as today (one price per
  row on a phone, several per row on a laptop). Below 12 the Price + Add row shows (at 9 too now); with 12 it is gone
  and one short note says **"12 of 12 prices saved. Remove one to add a new price."** (8 languages). The hint and the
  "max" error say 12.
- The price window: 3 prices per row as before → 4 rows with 12. Show Free on: with **9 or 12** prices (full rows)
  Free takes its own full-width row; with 1–8, 10 or 11 it is the next cell. 1–9 look exactly as today.
- Nothing else: default, Type price, Skip, Free (prints FREE), the sold-out question, the tap guard, the waiting line,
  orders and printing are unchanged — the 10th–12th price makes the same order call main makes for that price.

## Why a third database column (old devices can never delete prices 10–12)
Same reason as sql/196. An app opened before this change can stay open on a second phone or laptop tab. It knows 9
(`prices` + `prices_more`) and sends its whole list with every Settings change. So prices 10–12 live in a NEW column
`prices_extra`; a save writes only the columns it sends → an old device's save never touches `prices_extra`.
The new app sends `prices_extra` only when the list has, or had, more than 9 — a seller with 9 or fewer sends
exactly today's request (test-pinned: same request as the frozen 9-price app).
- An old device sees only the first 9 until it is fully closed and opened again.
- If an old device adds a price that is already 10th–12th, the database refuses it ("Couldn't save" on that device) —
  nothing is lost.

## Fits on a small phone
Measured (`harness/measure.cjs`, `harness/shoot.cjs`): the price window with 12 prices + Free is 565 px tall; on a
360×640 Android it fits without scrolling and Skip is on screen. Long prices (NT$12,000) don't cut.

## Order (Jeff)
Either order is safe for sql/238 and the web merge:
- web first → up to 9 works as today; adding a 10th says "Couldn't save" and the list goes back to 9;
- sql/238 first → nothing reads the new column until the web is updated.
Then `sql/239` (the one guide sentence) after both. Rollback: `sql/238_choose_price_twelve_rollback.sql` is refused
while any seller has a 10th–12th price (nothing is changed); run it before sql/196's rollback.
`sql/239_…_rollback.sql` swaps the sentence back.

## Pictures (the real Settings and price window, real browser, deviceScaleFactor 2)
| File | What |
|---|---|
| `settings-12-prices_*` | 12 prices, the 12-of-12 note, no Add row |
| `settings-11-prices_*` | 11 prices, the Add row as today |
| `pop-12-prices-free_*` | the price window, 12 prices + Free on its own full-width row, "2 more waiting" |
| `pop-12-prices_*` | 12 prices, Show Free off |
| `pop-11-prices-free_*` | 11 prices, Free the next cell |
| `pop-12-prices-free-NT-big_*` | 12 long NT$ prices + Free |

Devices: `android-360x640`, `iphone-390x844`, `android-412x915`, `laptop-1280x800`, `iphone-390x844-dark`.

## Proof
- `proof/sql238-behaviour.txt` — `scripts/sql238-behaviour.mjs` on PGlite (58 checks): the app's exact PostgREST
  upserts; every old 9-price and 6-price app Settings action keeps prices 10–12; a 13th / a price twice across the
  three columns refused; own row only; the rollback refused with 10th–12th prices, then clean.
- `proof/guide-239-check.txt` — the live guide row after the sql/239 swap = the regenerated sql/116b row, word for word.
- `proof/breaks.txt` — on-purpose breaks, every one caught.
- Tests: `choosePriceTwelve.oldDevice.test.tsx` (main's frozen 9-price hook and the 6-price hook as old devices
  against a fake database with the real checks), `ChoosePriceSheet.twelve.test.tsx`,
  `GeneralSettings.chooseTwelve.test.tsx`, `choosePriceTwelve.app.test.tsx`, `choosePriceTwelveSql.test.ts`.
  The sticker of a picked price is unchanged (`choosePriceNine.sticker.test.ts`, 20 printer fingerprints, still green).
