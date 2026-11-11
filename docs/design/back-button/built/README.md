# Back button — built (Step 2)

Real components (not a mock) with the shared `BackButton`.

- `<screen>_<lang>_<width>.png` — all 23 sub-screens in English at android-360 / iphone-390 / android-430 /
  laptop-1280, plus vi / th / bg at android-360 (the longest words, the narrowest phone).
- `printing-today-vs-new/` — the printing screens' headers, TODAY (main) vs NEW: Print stickers (with 12
  buyers and empty), Printer settings, old Print pattern, Live print pattern, Receipt format; en at 4 widths,
  fil + bg at 360. The header grows from ~57–60 px to 72 px (the 44 px button — same as the Live print
  pattern already had); nothing wraps.

Automatic check (every screen × all 8 languages × all 4 widths = 736): no horizontal scroll caused by the
header, and Back, the title text and ⇄ never overlap. The only flag: Manage accounts in fil / bg at 360 scrolls
8–14 px sideways because of the "NAKA-LOCK" / "ЗАКЛЮЧЕНО" badge in the account list below the header — the
header is not involved and that list is unchanged from main.

The "Couldn't load…" lines on some screens only mean this preview has no database.
