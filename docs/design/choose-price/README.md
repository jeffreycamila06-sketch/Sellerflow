# Choose price before print — pictures

Real `GeneralSettings`, real `Dashboard` and real `ChoosePriceSheet` (harness in `harness/`; not part of the app build).
Re-take: `npx vite --port 5199`, then `node docs/design/choose-price/harness/shoot.cjs`.

| Picture | What |
|---|---|
| `settings-off_*` | Live setup with the new switch OFF (Same price ON, ₱39) |
| `settings-on_*` | Switch ON: the price list under it (₱39 default, ₱59, ₱79, ₱99), ☆ make default, × remove, Add |
| `pop-single_*` | The pop-up after a 1-Click tap |
| `pop-queued_*` | Same, with "2 more waiting after this" |

Widths: iPhone 390, Android 360 (bottom sheet), laptop 1280 (centered dialog).
Measured by the script at every width: no sideways page scroll; price buttons 58 px tall; price chips 44 px tall.
