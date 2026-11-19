# Pickup Status — FamilyMart (全家) rows in their status tab

Branch `claude/fm-pickup-accuracy`, 2026-11-19. Web only (Vercel). No server change, no phone build.

## What was wrong

A 全家 row was put in a status tab only when its saved delivery type was the word `C2C`.
The reader of the 好賣+ file wrote `C2C` only when the file's text contained `店到店`.
The newer 好賣+ file ("Good-selling version") says `全家店寄店取` instead, so those rows were saved
with the file's own words — and Pickup Status treated them as "not a store pickup":

- phone: in no card and in no list;
- laptop: only under **All**, with "—" and no Chase;
- the FamilyMart filter showed 0;
- the exact numbers on the Waiting / In transit cards left them out.

Live table on 2026-11-19 (counts only): 76 全家 rows, 70 saved as `全家店寄店取`, 6 as `C2C`.

## What changed

1. **The reader** (`adapters/fmPickup.ts`, `fmShipType`): a 全家 order is a store pickup and is saved
   as `C2C`, whatever the 配送方式 / 運送方式 text says — unless that text itself says `宅配` (home
   delivery) or `社區` (community pickup). An empty or unknown text is a store pickup.
2. **The screen** (`adapters/parcelTracking.ts`, `inStatusTabs`): a 全家 row already saved with the
   words `全家店寄店取` counts as a store pickup too. So the 70 saved rows show correctly with the code
   alone.
3. **The exact card numbers** (`loadParcelTracking`): with 全家 on, the count asks for both saved
   words. With 全家 off the question is exactly the old one.
4. `sql/182_fm_ship_type_fix.sql` (+ rollback), **not applied**: rewrites the 70 saved rows to `C2C`.
   Optional — the screen is right without it.

7-11 rows: the rule that decides them (`isChaseable`) is not edited.

## Which delivery types are NOT a store pickup

| Text in the file | Seen in real data | Treated as |
|---|---|---|
| `常溫店到店` (older file) | yes | store pickup |
| `全家店寄店取` (newer file) | yes — 70 of 76 live rows | store pickup |
| frozen (冷凍 …) | no | store pickup — frozen is a temperature, the parcel still goes to a store |
| home delivery (a text with `宅配`) | no — 0 rows | not a store pickup: saved with its own words, shown under All only, no Chase (as today) |
| community pickup (a text with `社區`) | no — 0 rows | same as home delivery |
| empty / any other text | no | store pickup |

The newer file has columns for a home address and a community pickup point, which is how we know
those two types exist. No row of either has ever been in a file we have, so their exact words are
not known; the rule looks for `宅配` / `社區` in the delivery-type text only. A filled address cell
never decides.

## Pictures

Made-up parcels, the real screen. `before` = main, `after` = this branch. Same 13 rows in both:
4 × 7-11, 8 × 全家 saved as `全家店寄店取`, 1 × 全家 saved as `C2C`.

| Picture | iPhone 390 | Android 360 | Laptop 1280 |
|---|---|---|---|
| Waiting | `1-waiting_iphone390_*` | `1-waiting_android360_*` | `1-waiting_laptop1280_*` |
| In transit | `2-transit_…` | `2-transit_…` | `2-transit_…` |
| Picked up | `3-picked_…` | `3-picked_…` | `3-picked_…` |
| FamilyMart filter | `4-familymart-filter_…` | `4-familymart-filter_…` | `4-familymart-filter_…` |
| All (laptop only) | | | `5-all_laptop1280_*` |

Numbers on the pictures:

| | Before | After |
|---|---|---|
| Phone cards: In transit · Waiting · Picked up | 2 · 2 · 3 (Picked up lists 1 row) | 5 · 5 · 3 (lists 3) |
| FamilyMart filter: In transit · Waiting · Picked up | 1 · 0 · 0, no row listed | 4 · 3 · 2, 3 rows listed |
| Laptop "All" | 13 | 13 |

No sideways scrolling on any picture (0 px).

To make them again: `harness/` (the real screen on a made-up data source) — start it with
`npx vite --config docs/design/fm-pickup-tabs/harness/vite.config.mjs`, then
`node docs/design/fm-pickup-tabs/harness/shoot.cjs`.

## Proof

- `proof/without-the-code.txt` — the new tests run against main's two source files: 36 fail.
- `proof/on-purpose-breaks.txt` — 40 one-line breaks of the fix, each makes at least one test fail
  (40 of 40). The list is `proof/on-purpose-breaks.py`.
- `proof/sql182-behaviour.txt` — sql/182 and its rollback on a throw-away database shaped like the
  live table: 358 checks pass. Run it with
  `PGLITE_DIR=<folder with @electric-sql/pglite> node scripts/sql182-behaviour.mjs`.
