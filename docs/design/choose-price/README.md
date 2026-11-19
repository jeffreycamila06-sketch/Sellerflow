# Choose price before print — pictures

Real `GeneralSettings`, real `Dashboard` and real `ChoosePriceSheet` (harness in `harness/`; not part of the app build).
Re-take: `npx vite --port 5199`, then `node docs/design/choose-price/harness/shoot.cjs`.
Every picture exists at three widths: `_iphone-390`, `_android-360` (bottom sheet) and `_laptop-1280` (centered dialog).

| Picture | What |
|---|---|
| `settings-off` | Live setup with the new switch OFF (Same price ON, ₱39) |
| `settings-on` | Switch ON: the price list under it (₱39 default, ₱59, ₱79, ₱99), ☆ make default, × remove, Add |
| `settings-6-prices` | The full list (6): the Add field is gone, "You can save up to 6 prices." |
| `settings-long-prices` | NT$12,000 · NT$8,500 · NT$150,000 · NT$990 in the list |
| `settings-on_dark` | Dark theme |
| `pop-single` | The pop-up after a 1-Click tap |
| `pop-queued` | Same, with "2 more waiting after this" |
| `pop-6-prices` | Six price buttons (two rows of three) |
| `pop-long-prices-nt` | NT$12,000 · NT$8,500 · NT$150,000 · NT$990 · NT$1,200 · NT$350 |
| `pop-long-prices-eur` | €1,234.50 · €999.99 · €12.50 · €10,000 · €49.90 |
| `pop-type-price` | After "Type price": the price field + Back + Print |
| `pop-sold-out` | The code went sold out while the comment waited: "A1 is sold out. Print anyway?" |
| `pop-orders-paused` | A tap while orders are paused: the sheet stays, with the message |
| `pop-single_dark`, `pop-type-price_dark` | Dark theme |

Measured by the script on every picture (it exits with an error otherwise):
no sideways page scroll · no price label wider than its button or chip · price buttons 58 px tall ·
☆ and × 44×44 px with a 6 px gap · the page behind the pop-up cannot scroll · the focus is inside the pop-up.

Not shown in a picture (needs a real phone): the keyboard in the Type price state. The sheet is lifted by the
part of the page the keyboard covers so "Print" stays visible on iPhone — check this on a device.
