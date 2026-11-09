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
fits; a fixed line (name, @username, Buyer #) is never dropped — see Round 4 below. Vietnamese 60×40 now prints the comment at
92 % with ink 19 dots from the edge; the screen says "Comment made smaller (92%) to fit". Every other
case is byte-for-byte the same as before.

**Today's sticker with the all-scripts fix:** the admin samples were fine (worst 13 dots), but the
printer-guardian's stress comments were not: a short Thai comment at 70×50 / 80×50 put a mark under a
letter **5 dots** from the edge (D520, XP-420B, ESC/POS, CPCL). Fixed for the all-scripts letters only
(`stickerRaster.ts` `liftForBottomSafety`, active only while those letters are drawn): the picture moves
up into the free top space until the bottom 1.5 mm is clear (Round 4: never erasing ink). English / Chinese orders and everything with the switch OFF never enter it →
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

## Round 4 — Jeff's decisions (2026-11-09, after the senior audit)

**1. No line is ever missing.** 7273e026 did not draw a fixed line that would cross the bottom limit,
and in practice it was the COMMENT that disappeared (e.g. #8888 Vietnamese at 60×40 with Buyer # /
name / @username at 2×). Now:
- **Print (safety net):** the comment gives up space first (shrink → fewer lines → "…", keeping one line);
  then the lowest fixed line (@username → name → Buyer # → shop) is made smaller just enough — never below
  2.4 mm (19 dots; 2.1 mm / 17 dots on a 50×30-class label). Amber note "<part> made smaller to fit".
  The saved setting does not change; the preview is the same layout. Buyer # always prints.
- **Screen (before Save):** the fit check also lays out worst-case buyers (#8888; Vietnamese with marks
  above and below, Chinese + Latin descenders, Thai, a 2-line Facebook name). A part one of them would
  need made smaller is red, and its "+" stops at the largest size that always fits.

**2. Today's sticker with the all-scripts letters: ink is never erased.** The picture moves up, up to 4
dots from the top; if that is not enough the comment takes one line fewer with "…". Thai 70×50: the
mark tips 7273e026 cleared are back (XP-420B 18,428 → 18,472 ink dots, D520 15,818 → 15,854), still
12 dots clear.

**3.** The two switch-OFF cases (80×50 Chinese+Vietnamese comment; long FB name 60×40 D520) stay as they
are — PRINTING_MAP §6. **Found for Jeff:** name / buyer / @username at 2× (old Print pattern) on 60×40 –
80×50 with a tall name (Chinese, or Japanese/Korean/Thai/Arabic with the all-scripts letters) pushes the
@username to the edge; no rule fits (it is not the comment) → lifted as far as it goes, nothing cut.

**4.** The Buyer # bottom check reads the small word's "y" too; a comment that is the first line moves
down only for the marks on its own first line.

**5. One label on every printer:** one bridge call, SIZE = the label, one PRINT / feed, no FORMFEED,
picture ≤ label, bottom 12 dots clear — D520 (same stream for Android SPP and iPhone BLE), Flash Y41BT and
Xprinter XP-420B (TSPL), generic ESC/POS and CPCL, Niimbot B1/B21, laptop.

Pictures (left = 7273e026, right = now; red box = the bottom 1.5 mm):
`round4_new_vn_60x40_big_{xp420b,y41bt,d520}.png`, `round4_today_th_70x50_{xp420b,y41bt,d520}.png`.
Tests: `oneSticker.noLineMissing.test.ts`, `stickerScripts.bottomSafety.test.ts`,
`oneSticker.labelFit.test.ts` ("one label on every printer"), `OneStickerPattern.test.tsx` (the "+" cap).

## Round 5 — Jeff's decisions after the 2nd senior audit (2026-11-09)

- **Worst-case buyers on the screen** also include a SHORT handle ("ab": small QR → bigger module → less
  width for #8888) and the comment "gjpqy Ụ ợ". 438b4a90 showed no red on a 30 mm-wide label at Buyer # 1–1.5
  while #8888 was cut, and "Everything fits" at 80×30 / 110×30 (every part 2×, Bold/Extra) while a Thai buyer's
  @username was made smaller.
- **A — Buyer # never cut beside the QR:** the print makes the number just small enough (QR kept, amber
  "made smaller"); also for a pattern saved earlier. The screen lowers Buyer # automatically after a size
  change or the QR turned on ("Buyer # lowered to fit this size").
- **B — today's sticker, all-scripts letters, tall name at 2×:** the @username is drawn one size smaller
  (60×40: the bottom is now clear; only the @username changes). At 70×50 / 80×50 even 1× is not enough
  (8–10 dots) — listed for Jeff. A Chinese name (switch OFF byte-identical) is left as is.
- **For Jeff (guardian round 5):** at these 2× sizes today's sticker does NOT print the comment / price at all
  (as on main, switch OFF too) — the 60×40 "after" picture has no order line either. Not changed; needs a rule.
- **C** — the Chinese name + g/p/y comment case is the third switch-OFF case in PRINTING_MAP §6 (paper test pending).
- **Limits:** only the part over its limit gets a grey "+"; the others are worked out with it held at its
  limit. The work runs in idle slices (≈ 8 ms each) and is kept per setting; a fixed part's "+" waits until
  its limit is known.

Pictures (left = 438b4a90, right = now): `round5_new_8888_60x40_qr_buyer2_{xp420b,y41bt,d520}.png`,
`round5_today_ja_60x40_size2_d520.png` (bottom clear; the comment/price is missing as on main — see above).
Now only: `round5_A_new_50x30_qr_buyer2_niimbot.png`, `round5_A_new_60x40_qr_buyer2_laptop.png` (A on Niimbot /
laptop), `round5_case3_today_zh_gpy_70x50_{d520,xp420b}.png` (case 3, unchanged). For Jeff:
`round5_forjeff_B_today_ja_70x50_size2_d520.png`, `round5_forjeff_today_en_60x40_size2_no_comment_d520.png`,
`round5_forjeff_new_30x30_noqr_cut_by_date.png`. Screen screenshots (note + grey "+") not taken this round.
