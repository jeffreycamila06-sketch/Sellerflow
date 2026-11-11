# Back button — preview (Step 1, mock only)

No app code was changed. Each screen was rendered with the real component, then the proposed "‹ Back" was
**drawn on top in the browser for the picture only** (same style as the Live print pattern Back: 44 px high,
`rgba(255,255,255,.18)`, white 13 px bold, radius 9, text `rd_back`). Plan + inventory:
`docs/plans/back-button-inventory.md`.

Files: `<screen>_<TODAY|PROPOSED>_<width>.png` at android-360, iphone-390, android-430, laptop-1280.

| Screen | Today | Proposed Back goes to |
|---|---|---|
| general-settings | no Back | Settings hub |
| subscription | no Back | where it was opened from |
| support | no Back | General Settings |
| parcel-scan-7-11 | no Back (⇄ 全家 on the right) | Settings hub (⇄ stays on the right) |
| pickup-status | no Back | Settings hub |
| customer-details | no Back | Settings hub |
| REFERENCE-live-print-pattern-back-today | the existing Back (44 px) — the look to copy | — |

Notes: the "Couldn't load…" lines on Pickup Status and Customer Details only mean this preview has no
database. On Pickup Status (two header rows) the real build would put Back next to the title row.
No horizontal scroll at any width.
