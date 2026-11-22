# The 4-hour rule: the first swap is free (sql/205)

Jeff's decision, 2026-11-22. Replaces rule (b) of sql/199 ("every removal waits 4 hours"), which made even the
first swap wait — a seller who had to move platform right now (TikTok restricted → Shopee / Facebook) could not
go live.

## The rule

For the sellers of `account_limits_v2` (the preview login, admins, everyone once `shopee_account_enforce` is
`'true'`), on every platform (TikTok name, Facebook Page, Instagram account, Shopee shop):

- Removing an account and adding a **different** one is immediate.
- The account that took the removed one's place is locked for 4 hours. In the app, **Remove** on it shows
  **Wait a little** with the time left (nothing is removed). If it is removed another way, its place stays used
  until the 4 hours end, so a different new account is refused until then.
- The same account coming back is immediate.
- A removal never starts a wait — an admin's neither. Admins and exempt sellers have no limit and no lock.

This is the rule every seller already has since sql/84 (`account_total_guard`, not changed). sql/199 had added
a wait at every removal on top of it for v2 sellers; sql/205 takes that addition away.

## What changed

| | |
|---|---|
| `sql/205_account_swap_rule.sql` (+ `_rollback.sql`) | `account_seat_vacate` = sql/84's text again; `my_account_list` + `lock_until` per account. NOT applied. |
| `src/redesign/adapters/planFull.ts` | `AccountRow.lockUntil`, `lockMs()` (the time left on the server's clock) |
| `src/redesign/components/PlanFullPopup.tsx` | Remove on a locked account → the existing "Wait a little" sheet |
| `src/redesign/screens/ShopeeShops.tsx` | the same on the Shopee shops screen |
| `src/redesign/i18n/index.tsx` | 8 texts reworded + 1 new (`rd_pf_wait_locked`), 8 languages |
| `docs/support/sfl-guide.md`, `sql/116b`, `sql/201` (not applied) | the account-limit and connect-shopee lines |

Server: 0 lines (no Render deploy). Sellers who are not in the preview: nothing changes (see `proof/`).

## Proof

- `proof/sql205-behaviour.txt` — the SQL on a real Postgres (PGlite): `node scripts/sql205-behaviour.mjs`, 74 checks.
- `proof/same-as-main.txt` — what a seller outside the preview can reach, compared with main (`same-as-main.py`).
- `proof/on-purpose-breaks.txt` — deliberate breaks of the app and of the SQL file, each one caught.
- `shots/` — the changed sheets at 360 / 390 / 430 / 1280 px, dark at 390, and in all 8 languages at 360
  (`shots/checks.txt`; taken with `harness/shoot.cjs`). Made-up names.

## Things to know

- A place that is waiting under rule (b) when sql/205 is applied keeps that wait until it ends (at most 4 hours).
- An account that was removed and added back while it was NOT locked takes its own old place and gets the
  4-hour lock like any account that takes a place (sql/84's behaviour, unchanged).
- The database does not refuse the removal of a locked account (as before sql/199); it keeps its place used.
  The app is what says "Wait a little" before removing.
- A TikTok name also keeps its own slot check (`touch_tiktok_slot`, unchanged): the Manage accounts screen
  shows LOCKED / "Unlock in Xh Ym" as it does today.
