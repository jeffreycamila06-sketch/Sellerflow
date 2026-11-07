# Admin — country flag + name per user (branch `claude/admin-country-flag`)

Admin-only. Screenshots taken with fake sample users (no real seller data) at 2× scale.
Every shot checked for horizontal page scroll: none.

| File | What it shows |
|---|---|
| `*-manage-sellers.png` | Manage sellers: country pill before Seller / plan. Short email → same row; long email → pills wrap under it. "Hindi alam" = dashed pill with a globe. |
| `*-expiring.png`, `*-active-paid.png`, `*-expired.png` | Flag + name under the "email · plan" line. |
| `*-free-tier.png` | Flag + name next to "Joined …". |
| `*-business-pulse.png` | Flag + name under each seller in "sellers today". |
| `*-picker-open.png` | Picker after typing "Can" → Canada first, selected. Phone = bottom sheet, laptop = small dialog. |
| `*-picker-madalas.png` | Picker with the "Madalas" quick buttons (Taiwan / Philippines / United States). |
| `*-after-save.png` | After saving Canada for the "Hindi alam" user: the pill shows Canada, no reload. |
| `unknown-and-windows-flag-check.png` | Flags are SVG images, not emoji (Windows Chrome shows emoji flags as letters). Tests also check that no flag emoji is used. |

Widths: `iphone-390`, `android-412`, `laptop-1280`.
