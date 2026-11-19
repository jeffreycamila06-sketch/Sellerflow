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

| Files | Path | Sizes |
|---|---|---|
| `today_d520_*` | today's sticker, AIMO D520 (picture) | 50×30 · 60×40 · 70×50 · 80×50 · 80×60 · 100×60 |
| `today_tspl_*` / `today_escpos_*` / `today_cpcl_*` | today's sticker, Xprinter / Flash and other generic printers | same 6 (50×30 and 60×40 = the small-label layout) |
| `today_niimbot_50x30` | today's sticker, Niimbot | 50×30 |
| `new_d520_*` `new_tspl_*` `new_escpos_*` `new_cpcl_*` `new_niimbot_50x30` | the new sticker, same printers | same |
| `new_laptop_*` | the new sticker's laptop page picture | 6 sizes |
| `today_laptop_*` | today's laptop page in a real browser (`stickers/shoot-laptop.cjs`) | 6 paper sizes |
| `text_*` | the text sticker (old Bluetooth sticker / iPhone WiFi sticker) — its layout drawn with the app's own letters; the printer's built-in letters look a little different | 60×40 · 70×50 · 80×50 · 80×60 · 100×60 (it has no 50×30) |

`stickers/measurements.txt` — for every path × size × QR off/on: the FREE letters' own size and place, the
"150" beside it, and the free room to the right and bottom edges (111 lines).
`stickers/measurements-laptop.txt` — today's laptop page per paper size.

Not pictured: the receipt-printer slip (its text is built inside the phone app; the order sent to it carries
the item "FREE" — tested) and paper from a real printer.
