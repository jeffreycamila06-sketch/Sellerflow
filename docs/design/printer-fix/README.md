# Printer fix — rendered evidence (2026-11-03, branch claude/sticker-v2-shopname)

Real renders from the production sticker function `printing.stickerBitmapFor` (the one bitmap behind
the AIMO stream, the generic TSPL printers Flash Y41BT / Xprinter XP-420B, the Niimbot frame AND the LIVE
print pattern preview). 1 px = 1 printer dot. Regenerate any time with
`PRINTER_FIX_OUT=/abs/out NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/redesign/adapters/__tests__/printControls.evidence.test.ts`.

- `sheet_<path>_<size>_v2-<off|on>.png` — one sheet per printer path × size × layout v2: BASE (all on, 1×,
  QR on, shop on), every size control at 2× and 3×, every switch OFF (shop name, date & time, buyer #,
  TikTok name, @username, comment, QR). A control that changes nothing on a sheet is an explicit
  allow-list entry in `printControls.matrix.test.ts` (today: the shop name on 50×30 / Niimbot, the QR on
  the AIMO 60×40 with v2 OFF).
- `cells/<path>_<size>_v2-<off|on>_<control>.png` — every single sticker.
- `pair_*.png` — preview (left) next to the PRINT bytes recomposed (generic bands) / the Niimbot image (right).
- `browser/*.html` — the laptop print page at every size level and switch (open in Chrome → Print).
- `report.txt` — the cell count per sheet.
A 3× that does not fit prints clipped (the LIVE print pattern shows the red "doesn't fit" warning) — the
control is never ignored.
