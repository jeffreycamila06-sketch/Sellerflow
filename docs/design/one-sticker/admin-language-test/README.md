# Admin language test (new Live print pattern) — screenshots

Admins only. Under the Printer Test buttons: "New sticker / Today's sticker" and 11 language chips.
A chip swaps the preview (and its notes) to that sample; Printer Test prints it with the current draft —
new sticker: the same test print as the screen (printOneStickerTest); today's sticker: printSlip with
the one sticker off (today's sticker + the all-scripts language fix).

Files: `admin-lang_<width>_<theme>_<state>.png`
- widths 360 / 390 / 412 / 430 (the preview column), 1280 (whole page, two columns)
- states: `chips` (no chip picked), `ja` (日本語 picked), `today-ko` (Today's sticker + 한국어 — the note under the preview)
- `check.txt`: every chip / toggle ≥ 44 px tall and inside the card, no sideways scroll — 0 problems
- `adminlang.cjs`: the Playwright script (run against the local dev harness)
