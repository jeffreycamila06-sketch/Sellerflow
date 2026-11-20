# Blacklist — "Remove … from your blacklist?" sheet under the bottom nav (fixed 2026-11-20)

## What was wrong
The sheet was drawn inside the Blacklist screen, so it stayed inside the screen's scroll box. On a phone the
bottom nav was drawn on top of it: the seller saw the question and "Their counts are deleted…", but a tap on
Cancel or Remove landed on the nav (Sales / Orders) instead.

## The fix (`src/redesign/screens/Blacklist.tsx`, web only)
- The sheet is drawn with `createPortal` into the `[data-redesign]` root (else `document.body`) — the same way
  `components/BlacklistSheet.tsx` and the Parcel Scan confirm do it. Same `zIndex` 1300; the theme colours still apply.
- Bottom padding still clears the home indicator: `calc(18px + env(safe-area-inset-bottom))`.
- The sheet is at most 80% of the screen tall; the question + note scroll inside it, the two buttons always stay
  below them, on screen.
- Nothing else changed: same texts, same `confirmRemove()`, same busy and error states, a tap on the dark area
  still closes it (not while busy), and on a laptop it is still a centered dialog.

## Proof
`shoot.cjs` opens the REAL app (preview mode, made-up rows: `src/dev/fakeSupabase.ts` with `?admin=1&bl=1`) →
Settings → Blacklist → Remove, and checks at the centre of each button which element a tap would hit.

| screen | main (`before.txt`) | this fix (`after.txt`) |
|---|---|---|
| iPhone 390×844 | Cancel + Remove under the nav (tap hits `nav-sales` / a nav button) | both tappable, on screen |
| Android 412×915 | Cancel + Remove under the nav | both tappable, on screen |
| Laptop 1280×800 | tappable (centered dialog) | tappable, still centered |
| 390×240 (stress, long name) | under the nav | both tappable, on screen |

Pictures: `shots/before_*.png` / `shots/after_*.png` (one short name, one very long Facebook name per size).
No sideways scroll anywhere. Tests: `src/redesign/screens/__tests__/Blacklist.test.tsx` — "the Remove sheet is
drawn outside the screen" (3 of its tests fail on main's screen, all pass on the fix).

Re-run: start `npx vite --config vite.preview.config.ts --port 5199`, then
`node docs/design/blacklist-remove-sheet/shoot.cjs after 5199`.
