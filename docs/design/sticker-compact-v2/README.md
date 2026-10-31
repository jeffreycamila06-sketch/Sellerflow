# Sticker layout v2 — PREVIEW pictures (2026-10-31, branch claude/sticker-compact-v2, NOT merged)

True pixels from the production sticker functions (8 dots = 1 mm, white paper, black ink).
`<size>_today_<row>.png` = today's sticker; `<size>_new_<row>.png` = the same order on the v2
preview (`settings.printCompactV2`, printing.ts `STICKER_COMPACT_V2_PREVIEW = false` → nothing
changes for sellers). Sizes: 50x30, 60x40 (the compact font-C layout — Flash / Xprinter / Niimbot
today, the AIMO too when the flag is ON), niimbot (the 384×224 B1 frame; the Niimbot always prints
50×30), 70x50, 80x50, 80x60, 100x60 (the fixed-cell layout every printer shares). Rows: `qr-on`,
`qr-off`, `long-comment` (QR on), `fb-long-name` (Facebook buyer, no QR).

Order: buyer #88, @amy.ukay2026, name "Amy Santos", comment "Black dress M 350", shop "BudgetUkay",
10/31 20:15. Long comment "Black dress M size 350, pa-reserve po 2 pcs, isama na rin yung blue
shirt 250". Facebook name "Maria Cristina Dela Cruz".

What v2 changes (same fonts, same sizes, same shrink ladder as today):
- 50×30 / 60×40 / Niimbot: "Buyer" (line size) + the big number (today's size) on one line; line
  order Buyer → NAME → @username → comment (today prints @username before the name); date + time
  top-right, the QR moves down under it when needed; QR off = full-width text; the comment shrinks
  first, then wraps at the smallest size to ≤ 3 lines, the last cut with "…".
- 70×50 and up: the header shows the seller's own shop name (never "SellerFlowLive") with the date
  AND time on the right; the separate shop-name line under the bar goes, so everything moves up
  ~4 mm and a long comment gets one more line on 70×50. No shop name → date + time only. Line
  order already was Buyer → name → @username → comment.
