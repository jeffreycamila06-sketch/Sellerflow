# Free plan: no 4-hour lock on changing or removing the live account (sql/216)

Jeff, 2026-11-25. Branch `claude/free-no-account-lock`. sql/216 and sql/217 are NOT applied.

## The rule
- A seller whose plan is `free` can change the TikTok username, or remove the account and add a different one
  (TikTok, Facebook Page, Instagram, Shopee shop), at any time, as many times as they want.
- Paid plans: nothing changes (the same 4 hours).
- The plan at the moment of the action decides. A free seller who upgrades gets the lock from the next change on.
- Still 1 account on Free. An account that is live right now still can't be changed or removed.
- The 150 free orders rules are not touched.

## Where it is decided
In the database, from the seller's own stored plan (a seller cannot write their plan). `sql/216` = one new
function `account_no_lock(plan)` + six live functions with a few lines changed each (md5 pinned, guard like sql/205).
The app only stops showing lock words when the database says so (`no_lock` in `my_account_list`, no rows from
`tiktok_slot_cooldowns`), plus one display rule: a Free seller's saved name never shows "LOCKED" while that
answer is loading or could not be read.

## Proof
- `proof/sql216-behaviour.txt` — the six stories on a real Postgres (PGlite), 82 checks. Run:
  `PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> node scripts/sql216-behaviour.mjs`
- `proof/on-purpose-breaks.txt` — 19 on-purpose breaks, each caught (`on-purpose-breaks.py`).
- `shots/` — the real screens for a free seller at iPhone 390, Android 360 / 412 / 430 and laptop 1280
  (+ dark at 390, + a paid seller for comparison); `shots/checks.txt` = what was checked on each picture.
  Made with `harness/` (`npx vite --config vite.preview.config.ts --port 5199`, then `node harness/shoot.cjs`).

## Order
sql/216 → merge (Vercel) → sql/217. Either order of the first two is safe:
- database first: the TikTok screen is already right (it follows the database); the "Plan full" popup still
  shows the 4-hour sentence to a free seller until the web is live (but never blocks them);
- web first: nothing changes until sql/216 (the app follows the database's answers).
No Render deploy.
