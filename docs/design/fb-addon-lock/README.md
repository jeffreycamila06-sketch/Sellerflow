# Facebook tab "locked" card + Admin "Receipt add-on" (2026-11-26)

Branch `claude/fb-addon-lock`. Pictures of the REAL app (preview mode, made-up sellers): `shots/`.
Measured: `measured.txt` (made by `shoot.cjs`).

## 1. Settings → Invoicing → Facebook tab
- **Without the Receipt add-on** (every plan, Free too; web, Android app, iPhone app — the same card):
  lock icon · "Facebook invoicing" · "Send every Facebook buyer their invoice in Messenger — automatically,
  in one tap." · **Ask Admin to turn it on** (a real `<a target="_blank">` to
  `t.me/SellerFlowLive?text=Hi Admin, I'd like Facebook invoicing.` — the Website teaser's
  `telegramDraftUrl`) · "Opens Telegram @SellerFlowLive". No price, no "upgrade", no sample, no counts.
  8 languages; the ready message is in the seller's language.
- **With the add-on** (`fbReceiptUi` → `onReceiptFormat`): the tab is byte-for-byte main's
  (`src/redesign/screens/__tests__/fixtures/invoicingFbAddon.main.json`, recorded on main 58d780b).
- Shots: `fb_locked_{iphone390,android360,laptop1280}_{light,dark}.png`, `lang_360_*.png`.
- Measured at 360 / 390 / 430 / 1280 × 8 languages: nothing wider than the screen, the button 46 px tall,
  no text cut.

## 2. Admin → Controls → Receipt add-on
- The list = every `fb_receipt_access` row with `enabled = true` (sql/223 `admin_receipt_addon_list`):
  shop (or the email when no shop name), email, plan, "+ Receipt", plan end (amber under 7 days or
  ended — the add-on has no date of its own), since (`created_at`), note. Count at the top, search by
  shop / email.
- **+ Add seller** by email · **Remove** with a question inside the page (Remove = `enabled = false`, the
  row and its note stay) · the note is edited inline.
- "+ Receipt" badge next to the plan in Manage sellers and in the Active / Expiring / Expired lists.
- Shots: `admin_list_{iphone390,laptop1280}.png`, `admin_add_remove_*.png`,
  `admin_sellers_badge_iphone390.png`.

## Database (sql/223, NOT applied)
Three functions, SECURITY DEFINER, each asks `is_admin()` first: a seller who is not admin gets `[]` /
`not_admin` and changes nothing; anon cannot call them. The file changes no row and no setting.
Re-adding a removed seller keeps the first "since" date. Proof: `scripts/sql223-behaviour.mjs`
(PGlite, 39 checks) + `receiptAddonSql.test.ts` (CI).

Preview: `?ra=1&admin=1` in `src/dev/fakeSupabase.ts` (preview only; the list there does not change on
Add / Remove).
