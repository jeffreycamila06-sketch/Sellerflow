# "Free" button — Choose price before print (2026-11-19)

Branch `claude/choose-price-free`. Settings → Live setup → Choose price before print → **Show Free button**
(default OFF). ON = the price pop-up shows a green **Free** button after the prices; one tap makes the order at
price 0 and the sticker prints **FREE** where a price prints.

## Screens (the real components, real browser) — iPhone 390 · Android 360 · laptop 1280, light + dark

| Picture | What it shows |
|---|---|
| `pop-3-prices-free_*` | the pop-up with 3 prices + Free (Free = 4th cell, start of the second row) |
| `pop-6-prices-free_*` | 6 prices + Free (Free alone on the third row), "1 more waiting after this" |
| `settings-free-off_*` / `settings-free-on_*` | the switch under the price list, OFF and ON |
| `orders-free-row_*` | Orders: the Free order shows **Free**; the comment order beside it still shows NT$0 |

Each name ends with `_iphone-390`, `_android-360` or `_laptop-1280`; dark pictures have `_dark` before it
(30 pictures). Made by `harness/shoot.cjs` (dev server: `npx vite --port 5199`). It also checks every picture:
no sideways scroll, no cut label, Free is the last cell and the same size as a price button (58 px high),
the switch row is 53 px high.

## Stickers — TODAY ("150", left) next to NEW ("FREE", right)

No print code was changed: a Free order is an ordinary order whose item text is "FREE", and every path
prints the item text where it prints a price. The pictures are what each printer RECEIVES, decoded back
to dots (`stickers/`, made by `SFL_FREE_PICTURES=docs/design/choose-price-free/stickers npx vitest run freeSticker.proof`).
Today's sticker is drawn the way the app prints it today (word spacing on, as for every seller).

Sizes: 50×30 · 60×40 · 70×50 · 80×50 · 80×60 · 100×60 (Niimbot: 50×30 only; the text sticker has no 50×30).

| Files | What |
|---|---|
| `today_d520_*` `today_tspl_*` `today_escpos_*` `today_cpcl_*` `today_niimbot_50x30` | today's sticker, usual layout — AIMO D520, Xprinter / Flash (TSPL), generic ESC-POS, generic CPCL, Niimbot |
| `today-newer_*` (same printers) | today's sticker in the newer small-label layout (admins and listed accounts) |
| `today_d520_*_comment-x3` | AIMO, Comment size 3× (the biggest) |
| `new_d520_*` `new_tspl_*` `new_escpos_*` `new_cpcl_*` `new_niimbot_50x30` | the new sticker, same printers |
| `new_laptop_*_qr-off` / `_qr-on` | the new sticker's laptop page picture |
| `today_laptop_*_qr-off` / `_qr-on` | today's laptop page in a real browser (`stickers/shoot-laptop.cjs`), 6 paper sizes |
| `text_*` | the text sticker (old Bluetooth sticker / iPhone WiFi sticker) — its layout drawn with the app's own letters; the printer's built-in letters look a little different |
| `two-orders_today_*` / `two-orders_new_*` | Print screen, a buyer with TWO orders. `FREE-then-150`: left = "200" then "150", right = FREE then "150". `150-then-FREE`: left = "150" then "200", right = "150" then FREE. AIMO, 6 sizes |
| `facebook_*` | a Facebook buyer with a long name (2 lines), 50×30 · 60×40 · 100×60, AIMO and Xprinter, today's and the new sticker |
| `chinese-name_*` | a buyer named 陳小美, same sizes and printers |
| `reprint-past-session_today_d520_60x40` | a Reprint of an order from 3 days earlier (the sticker carries that day's date) |

**Two orders on one sticker (Print screen)** — which orders show is today's rule, FREE does not change it
(a price in FREE's place gives the same sticker except that word):

| Sticker | Shows |
|---|---|
| today's, AIMO 60×40 · 80×60 · 100×60 and Xprinter 80×60 · 100×60 | both orders |
| today's, 50×30 · 70×50 · 80×50 (and Xprinter 60×40), and today's laptop page | the FIRST order only |
| the new sticker, every size | both ("FREE · 150") |

So on a first-order-only size, a buyer whose first order is Free and second is 150 gets a sticker that says
FREE only — the same way a buyer with "200" then "150" gets "200" only today.

`stickers/measurements.txt` — every case: the FREE letters' own size and place, the "150" beside it, the
free room to the right and bottom edges; today's sticker in both layouts at Comment size 1× / 2× / 3×, the
new sticker at 1× / 2×, QR off and on. `stickers/measurements-laptop.txt` — today's laptop page per paper
size, QR off and on.

Not pictured: the receipt-printer slip (its text is built inside the phone app; the order sent to it carries
the item "FREE" — tested) and paper from a real printer.
