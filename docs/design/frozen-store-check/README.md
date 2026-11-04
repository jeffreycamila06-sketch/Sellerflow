# Frozen (冷凍) store check — Parcel Scan previews

Real app screens on the fake preview harness (`npx vite --config vite.preview.config.ts --port 5199`,
`src/dev/fakeSupabase.ts` rows s4 / s5 / s6), extension 1.17.0 + sql/142.

Each shot shows the three 冷凍 rows, one per frozen state, in this order:

| Row | Store | Frozen verdict | What the seller sees |
|---|---|---|---|
| 新蓮盈買家 | 968551 | `no_frozen` | red border + "❄ This store can't receive frozen. Ask the buyer for another 7-11." + ⟳; kept out of the export |
| 大智通買家 | 151003 | `null` (not checked yet) | amber "❄ Checking frozen…" instead of the green all-clear |
| 樹林買家 | 133712 | `ok` | the normal green "✅ Buyer OK" |

Files: `frozen-rows_<device>_<theme>_<lang>.jpg` (whole screen) and `frozen-rows-crop_…jpg` (the parcel
list only) for iphone390 / android412 / desktop1280 × light / dark × en / zh-TW / fil = 18 + 18.

`measurements.json` (from the same run): at every width `document.documentElement.scrollWidth` equals the
viewport (no horizontal scroll), every row's right edge sits inside the screen, and the red line wraps
instead of clipping — at 390 px it takes 3 lines in English, 3 in 繁體中文 and 4 in Filipino (10.5 px text;
`overflow-wrap: anywhere`, no ellipsis). Dry (常溫) rows on the same screen are unchanged.
