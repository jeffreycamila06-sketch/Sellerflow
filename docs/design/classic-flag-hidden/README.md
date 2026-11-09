# Classic text flag while its card is hidden (Jeff 2026-11-09, admin, AIMO D520)

| | TODAY (main) | NEW (this branch) |
|---|---|---|
| Screen | `today_screen_android-412_older-sticker-note.png` — the "older sticker" note (shown only when the screen already knew the phone printed text) | `new_screen_android-412_no-note.png` — the Live print pattern, no note: the phone prints the picture |
| Paper | Jeff's photo: the old TEXT sticker (no shop name at 60×40, thin letters, − / + not applied). The TEXT sticker is built natively and cannot be drawn in TypeScript. | `new_paper_aimo-d520_60x40.png` — the new sticker on the AIMO D520 60×40 (shop name, bold letters, − / + applied) |

Who changes: only an admin / `classic_text` account whose phone has printer setup v2 (the Classic card is hidden there)
and still has `sfl_rd_classic_text=1` stored. Sellers and accounts without that flag: byte-identical (864 × 2 print
hashes vs main). The pictures are copies of the approved one-sticker proofs (docs/design/one-sticker/).
