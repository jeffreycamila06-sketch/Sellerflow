# Invoicing rows — item count, "✎ View", "I sent it by hand" (2026-11-26)

Branch `claude/invoicing-view`. Web only (Vercel). No SQL to apply, no server.

## What changed
- **Row (TikTok tab):** after the tag, `· N items` (`· 1 item` singular). N = the order lines the row's
  sheet shows: one line per order. An order with qty x2 is ONE line in the sheet ("x2" after it), so it
  counts as **1**. A multi-day buyer's lines from every day are counted (same rows, same lines).
  When the tag is long (Bulgarian, Vietnamese…) the count moves under the tag instead of pushing the row wider.
- **✎ View** under the total: a real button, accent outline, drawn 30 px tall with a 44 px tap area
  (`.sfl-tap44`). It opens the same sheet a row tap opens; the whole row still opens it too.
  The row itself is now a plain container (not a `<button>`) so View is not a button inside a button.
- **I sent it by hand:** a text link at the bottom of the row sheet, only while that buyer is
  **Copy failed** or **Sending…** (`byHandAllowed`). Tap → saved as Sent (the same saved row a normal Sent
  writes), "Copy failed" / "Sending…" cleared, sheet closed. Analytics: `invoice_send` `via: "hand"`.
  Never in the Orders tab's sheet (it passes no `invoice`).

## Proof
- `src/redesign/screens/__tests__/Invoicing.view.test.tsx` — 17 tests (count = sheet lines, multi-day, past
  session, qty x2, View opens that buyer, row tap, by-hand states, saves Sent, Orders sheet).
- `proof/breaks.py` → `proof/breaks.txt`: 18 of 18 on-purpose breaks caught.
- `shoot.cjs` → `measured.txt`: real app (preview), 360 / 390 / 430 / 1280 × 8 languages: no sideways
  scroll, total and View never wrap or leave the row, View under the total, tap area 44 px, the long
  username cut with "…" on phones (whole on a laptop), the count = the sheet's lines for the first 6 rows.
- `shots/`: `list_<device>_<theme>` (iPhone 390, Android 360, laptop 1280, light + dark; buyer #2 = a long
  username), `sheet_sending_<device>_<theme>`, `list_copyfailed_iphone390_*`, `sheet_copyfailed_iphone390_*`,
  `lang_360_<lang>`.

Preview: `?ivc=40,12&ivclong=1` (src/dev/fakeSupabase.ts, preview only).
