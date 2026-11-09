# Label overflow — the extra blank label (XP-420B, 60×40, Vietnamese)

**Paper bug (Jeff, 2026-11-09):** admin language test, Vietnamese sample #77 at 60×40 on the Xprinter
XP-420B → the printer fed one extra BLANK label; the last comment line sat at the bottom edge; the
preview said everything fits.

**What the printer got (before):** `SIZE 60 mm, 40 mm` / `GAP 2 mm, 0`, picture exactly 320 dots tall
(never taller than the label) — but the lowest ink row was **311 of 320: 8 dots = 1 mm from the edge**
(the "p" of "shop"). Every other admin sample at every size was ≥ 21 dots (2.6 mm). See `capture.md`.

**Why:** with the QR on, the comment wraps to 3 lines. The comment's line count let the LAST line use its
leading space (`+ 0.12 × size`), which only works when the last line has nothing below the baseline. A
descender ("p", "g", "y") or a mark under a letter (ị, ụ) does — so it ran into the 1.5 mm bottom margin,
to 1 mm from the edge, and the printer fed a blank label. English "size M" has no descender, so it fit.
The fit check measured line boxes, not ink, so the preview said "Everything fits".

**Fix (all picture paths share it: D520, generic TSPL / ESC-POS / CPCL, Niimbot, laptop):** no ink in the
bottom 1.5 mm (`BOTTOM_SAFE_DOTS` = 12, the layout's own margin), measured on the real glyphs (marks,
descenders, device-font runs). The comment drops a line and shrinks (then "…") until its last line's ink
fits; a fixed line (name, @username, Buyer #) whose ink would cross is not drawn and the screen shows the
red "Too big" note — same picture on the screen and on paper. Vietnamese 60×40 now prints the comment at
92 % with ink 19 dots from the edge; the screen says "Comment made smaller (92%) to fit". Every other
case is byte-for-byte the same as before.

**Today's sticker with the all-scripts fix:** the admin samples were fine (worst 13 dots), but the
printer-guardian's stress comments were not: a short Thai comment at 70×50 / 80×50 put a mark under a
letter **5 dots** from the edge (D520, XP-420B, ESC/POS, CPCL). Fixed for the all-scripts letters only
(`stickerRaster.ts` `liftForBottomSafety`, active only while those letters are drawn): the picture moves
up into the free top space until the bottom 1.5 mm is clear; if there is no room, only the leftover
mark tips are cleared. English / Chinese orders and everything with the switch OFF never enter it →
byte-identical (864 × 2 capture). Picture: `th_70x50_today_before_after.png`.

**Still open (today's sticker for every seller, switch OFF — must stay byte-identical, not changed):**
a mixed Chinese + Vietnamese comment at 80×50 ends 7 dots from the edge, a long Facebook name with
descenders at 60×40 on the D520 8 dots. Same blank-label risk on an XP-420B; fix it in today's layouts in
its own branch if sellers see it.

**Top (new sticker):** a comment that is the FIRST line (every part above it off) put the tall marks of
Ễ / Ỗ above the label top. It now starts lower by the marks' real height (only in that case).

Pictures: `vi_60x40_before.png` / `vi_60x40_after.png` (decoded from the exact TSPL sent to the XP-420B),
`vi_60x40_before_after.png` (red box = the bottom 1.5 mm), `en_60x40_*` (unchanged), `th_70x50_today_*` (today's sticker, all-scripts).
Test: `src/redesign/adapters/__tests__/oneSticker.labelFit.test.ts` (fails on main: "vi 60x40: ink 8 dots
from the bottom" on D520, XP-420B, Y41BT, ESC/POS, CPCL and laptop).
