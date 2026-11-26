# Admin → Free tier: active on top + look-alike warning (2026-11-26)

Branch `claude/free-tier-active`. Admin only. Web (Vercel) + one SQL file (sql/228, NOT applied).

## What the panel shows
- Chips: **All · N** / **Active 7 days · N** (last order within 7 days) / **⚠ Look-alike · N**.
- Three groups with counts:
  1. **Using now** — used > 0 and < 150, newest last order first.
  2. **Finished 150** — used ≥ 150, newest last order first.
  3. **No orders yet** — used 0, newest joined first.
- Each row: shop, @username · email, country + "Joined …", `x / 150`, and
  "Last order 3h ago" (green within 24 h) / "No orders yet" / "Last order over 3 months ago"
  (used > 0 but no stored order — `public.orders` keeps about 3 months).
- Look-alike: FREE accounts only. Key = lower-case TikTok username(s) and shop name with digits,
  `.` `_` `-` spaces (and a leading `@`) removed; keys shorter than 4 ignored. Two or more free
  accounts sharing a key (also through a chain) → amber row + "⚠ N look-alike" (N = accounts in the
  group). Tap → sheet with the group side by side + "Free orders used together". Nothing is blocked or written.

## Data
- `sql/228_admin_free_tier_activity.sql` — `admin_free_tier_activity()`: SECURITY DEFINER,
  `is_admin()` first (anyone else gets no rows), free sellers only, email + newest
  `orders.created_at`; execute for `authenticated` only. Read ONCE when the panel opens, no timer.
- Before sql/228: the list still shows (server order: most orders used first), with the line
  "Last order times couldn't be read." The look-alike warning needs no database read.
- Production read (2026-11-26, read only): 499 free accounts, 45 would be flagged (24 shared keys).

## Proof
- `src/redesign/screens/__tests__/Admin.freeTier.test.tsx` (22) — keys (budgetukay1 / budget_ukay2 /
  budgetukay4 = one group, short keys ignored, paid never included), group order, chips, sheet,
  function missing, not admin. 6 on-purpose breaks of the logic all caught.
- `src/redesign/adapters/__tests__/freeTierActivitySql.test.ts` (5, CI) — the file's rules.
- `scripts/sql228-behaviour.mjs` (PGlite, 16) — admin gets free sellers only with the newest order;
  a non-admin gets nothing; anon cannot call it; no row changed; rollback.
- `shoot.cjs` + `shots/` + `measured.txt` — iPhone 390, Android 360, laptop 1280, light + dark;
  360 / 390 / 430 / 1280: no page wider than the screen, chips and Close 44 px. Preview: `?admin=1&ft=1`.
