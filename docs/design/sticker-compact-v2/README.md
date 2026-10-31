# Compact layout v2 — PREVIEW pictures (2026-10-31, branch claude/sticker-compact-v2, NOT merged)

True pixels from the production sticker functions (8 dots = 1 mm, white paper, black ink).
`<size>_today_<row>.png` = today's compact layout (Flash / Xprinter / Niimbot on 50×30 and 60×40);
`<size>_new_<row>.png` = the same order on the v2 preview (`settings.printCompactV2`, printing.ts
`STICKER_COMPACT_V2_PREVIEW = false` → nothing changes for sellers). `niimbot_*` = the 384×224 B1
frame (the Niimbot always prints 50×30). Rows: `qr-on`, `qr-off`, `long-comment` (QR on),
`fb-long-name` (Facebook buyer, no QR).

Order: buyer #88, @amy.ukay2026, 陳美玲 Amy, comment "黑色洋裝 M NT$350", 10/31 20:15.

What v2 changes (same fonts, same sizes, same shrink ladder as today):
1. "Buyer" (line size) + the big number (today's size) on one line, baselines aligned.
2. Date + time top-right; the QR moves down under it when needed; QR off = full-width text.
3. Comment: shrink first, then wrap at the smallest size to ≤ 3 lines, the last cut with "…".
4. With the flag ON the AIMO D520BT prints this same layout on 50×30 / 60×40.
