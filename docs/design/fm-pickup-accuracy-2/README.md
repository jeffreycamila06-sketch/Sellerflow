# Pickup Status — FamilyMart (全家) parcels FamilyMart has not received

Branch `claude/fm-pickup-accuracy-2`, 2026-11-19. Server (Render) + database (sql/185) + web (Vercel).
Nothing merged, applied or deployed.

## What changes for a seller

**A. Check now asks every unfinished 全家 parcel.** Before, a press skipped a 全家 parcel "in transit"
that was checked in the last 24 hours. Now every unfinished 全家 parcel is asked (up to 60 a press, as
before): first the ones at a store (nearest pickup deadline first), then the rest (least recently
checked first) — the order a 7-11 press uses. The automatic check, the urgent check and the check
after a new upload are unchanged; so are the daily request cap, the breaker and the pace.

**B. Parcels FamilyMart has nothing for get their own group under In transit.**

| What FamilyMart's site said at the last check | Label on the row |
|---|---|
| it knows the order, the parcel was never handed in | **Not dropped off yet** |
| it does not know the delivery number | **No record yet** |

- The group sits at the end of the **In transit** list, under a heading "Not dropped off yet · N"
  and the line "FamilyMart has not received these yet. They leave this list after 10 days."
- The **In transit** number counts the parcels that are really moving. On the phone the card
  shows the group under it: "+N Not dropped off yet".
- The right-hand column: "Drop off before (date)" when the 好賣+ file gives that date; otherwise
  "Leaves this list (date)"; "Leaves this list at the next check" when that day has come.
- A parcel leaves the list at a check (on the answer just received — the 7-11 way) when it was
  saved 10 or more Taipei days ago, or when FamilyMart does not know the number and the file's
  drop-off date has passed.
- A later Order export that shows the parcel at the store, picked up or returned brings it back.
  A parcel that left is deleted 30 days later.
- Any real answer from FamilyMart removes the label.
- Each check run saves its counts: not found · not handed in · left the list.

## Pictures

The real screen on made-up parcels (`harness/`). In transit view, the app's 8 languages:

- `sheet_iphone390.png`, `sheet_android360.png`, `sheet_laptop1280.png` — the 8 languages side by side
- `shots/<device>_<language>.png` — one by one

The four parcels of the group, in every picture:

| Buyer | FamilyMart said | Right-hand column |
|---|---|---|
| ella.tw | knows the order, not handed in | Drop off before (date from the file) |
| faye_ukay | knows the order, not handed in | Leaves this list (saved day + 10) |
| ivy_live | does not know the number | Leaves this list (saved day + 10) |
| hana_q | does not know the number, saved 11 days ago | Leaves this list at the next check |

Measured on all 24 pictures: 0 px sideways scrolling, no label cut off, no row wider than the screen.
In transit shows 2 (the moving parcels), the group 4.

To make them again:

```bash
npx vite --config docs/design/fm-pickup-accuracy-2/harness/vite.config.mjs --port 5331
```

```bash
node docs/design/fm-pickup-accuracy-2/harness/shoot.cjs
```

## Proof

- `proof/without-the-code.txt` — the new tests run against main's source files: 52 fail, 9 pass
  (each of the 9 checks that something stays as before), and the SQL pin file cannot load
  (sql/185 is not on main).
- `proof/on-purpose-breaks.txt` — 52 one-line breaks of this branch: 52 of 52 make a test fail.
  The list: `proof/on-purpose-breaks.py`.
- `proof/seven-scopes-vs-main.txt` — main's worker and this branch's worker side by side over
  4,000 generated jobs: the 7-11 part, the shared scope and the automatic check are the same in
  every case. Script: `proof/seven-scopes-vs-main.mjs`.
- `proof/sql185-behaviour.txt` — sql/185 and its rollback on a throw-away database
  (`scripts/sql185-behaviour.mjs`, PGlite).
