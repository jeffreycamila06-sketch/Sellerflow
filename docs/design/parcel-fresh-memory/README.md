# Parcel checks — no "no" from an old remembered answer (sql/193 + sql/194, Nov 21 2026)

**Jeff's rule:** the system must never tell a seller "no" from an old remembered answer — ask 7-11.
Trigger: a 冷凍 parcel was refused "This store can't receive frozen" from a no_frozen answer of **Nov 9**
(trusted 30 days, copied 5 times on save); the seller encoded it by hand in OpenPoint and 7-11 accepted it.

## What changes (database only — no extension change, no Render deploy)
How long a remembered answer may be copied onto another waiting parcel:

| Answer | Before | After |
|---|---|---|
| store open | 10 min | **5 min** |
| store full | 1 h | **5 min** |
| store company / not_found | 24 h | **5 min** |
| phone ok | 6 h | **5 min** |
| phone restricted | until its restriction date | **unchanged** |
| frozen ok (pending read + on save) | 1 h | **5 min** |
| frozen no_frozen (pending read + on save) | 30 days | **5 min** |

A waiting parcel's **own "full"** is asked again every **15 minutes** (was every hour) — Jeff's decision A.
The shared setting was split: `v_store_full_ttl` (copy, 5 min) and `v_store_recheck_ttl` (re-ask, 15 min).
A waiting parcel's own no_frozen is asked again after 5 minutes — in practice every 10 minutes (the per-store gap).

Five functions change, each = the live text with only those lines changed:
`admin_parcel_checks_pending` + `pc711_backup_pending_rows` (extension / server backup),
`admin_parcel_frozen_pending` + `pc711_backup_frozen_pending_rows` (extension / server backup),
`parcel_scans_frozen_instant` (the trigger on save, shared).

**Not changed:** the 10-minute per-store frozen gap (also in the extension), retries, give-ups, 01:00–05:00 rules,
re-queue, lease, the 24-hour late check of exported frozen parcels, the warm-up store picker
(`admin_frozen_warmup_next` — its switch is turned off separately by chat-Claude), grants, triggers, tables, settings.

## sql/194 — the one-time re-check (run after 193, on Jeff's go)
Empties a "no" older than 5 minutes on waiting (not exported) parcels of sellers with the check, so 7-11 is asked live:
store company / not_found, frozen no_frozen. Selected by rule, never by id. Never phone restricted, never full / open / ok.
**Preview on production (read only, Nov 21): company 2 · not_found 3 · no_frozen 1 = 6.**
Of the 6, three (2 company + 1 no_frozen) were copied from another parcel's memory; the 3 not_found were asked for that
parcel more than a day ago. Under the new rule all six are old remembered answers ("older than 5 minutes"), so the file
uses that test — a "copied from another parcel" test would catch only 3.

## Proof
- `scripts/sql193-behaviour.mjs` (PGlite, **219 checks**) — output: `proof/sql193-behaviour.txt`:
  the starting database = live (md5 of the source AND the full definition of 18 functions, read Nov 21);
  193 changes exactly the five functions and in each only the listed lines; every other function, trigger, grant, table
  and setting byte for byte the same; the old-vs-new table for every rule; backup = extension line for line (except the
  duty check / running as the caller) and the same rows/data on two databases; the guard (runs twice, refuses an
  unexpected function); rollback = live byte for byte; sql/194 touches exactly the six rule rows.
- `src/redesign/adapters/__tests__/parcelFreshMemorySql.test.ts` (CI, 13 tests) — the same rules pinned on the file text.
- `proof/breaks.py` → `proof/breaks.txt` — on-purpose breaks, each caught.

## Known
- A frozen parcel saved **5–10 minutes** after its store's last answer gets no copy and waits for the 10-minute gap
  before the live ask (4 of 385 frozen answers in 30 days had that timing). The export hold then asks
  "Wait / Export anyway" as today.
- A waiting no_frozen parcel is re-asked every ~10 minutes while it waits (≈ 144 requests a day per such parcel).
- If the checker stands still for more than 5 minutes, a newer answer from another parcel of the same store is no
  longer copied onto a parcel that already has an older answer of its own; that parcel keeps its answer until its own
  re-ask (15 min for "full"). While the checker runs, the copy step runs every ~5 s, so this does not happen.
