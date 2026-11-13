# Admin: connected accounts + downgrade dialog (Nov 13 2026)

Branch `account-total-connected`. Screens: Admin → Manage sellers.

| File | What it shows |
|---|---|
| `today_card_kevin_*` | TODAY (main): 1 TikTok + 1 connected Page shows "Accounts 1", no Page |
| `new_card_kevin_*` | NEW: the Page with its date, "Accounts 2" |
| `new_card_multi_*` | NEW: Facebook + Instagram + Shopee listed, "Accounts 5" |
| `new_edit_kevin_*` | NEW: Edit accounts — old typed box relabelled, connected list read-only |
| `new_dialog_kevin_*` | NEW: Plus → Basic, 2 accounts, 1 allowed: the newest is pre-checked |
| `new_dialog_multi_*` | NEW: Pro → Basic, 5 accounts: the 4 newest pre-checked |
| `new_dialog_multi_notexact_*` | NEW: one un-checked → OK is off, the count line turns red |

Widths: iPhone 390, Android 412, laptop 1280 (+ 360 for the dialog). Measured in the same run:
no sideways scroll at any width, the dialog fits the screen, rows 48 px, buttons 46 px.
Sample data only (demo emails, made-up Page names) — no real seller data in these pictures.
