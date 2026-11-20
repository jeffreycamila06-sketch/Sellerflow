# Pickup Status — FamilyMart (全家) parcels FamilyMart has not received

Branch `claude/fm-pickup-accuracy-2`, 2026-11-19. Server (Render) + database (sql/186) + web (Vercel).
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

## Fix round 1 — the right-hand line never leaves one character alone

Before: on a phone the Traditional Chinese line wrapped as "請在 11月26日 前寄 ⏎ 件" (and "11月27日 移出清 ⏎ 單"),
and in English, Thai, Indonesian and Vietnamese the date itself was cut in two ("Nov ⏎ 26", "26 ⏎ Nov").
Now each line may wrap only between whole pieces (`src/redesign/adapters/keepTogether.ts`): the date is one
piece, every word group between spaces of up to 6 characters is one piece, and a longer run without spaces
is split into words of 2+ characters. Chinese, Traditional Chinese and Thai also get evened-out lines
("下次檢查時 ⏎ 移出清單"). The words themselves are unchanged. This covers the "Drop off before" line on every
全家 in-transit row, not only the new group.

- `wrap/sheet_before_<device>.png`, `wrap/sheet_after_<device>.png` — the group rows, iPhone 390 and Android
  360, the 8 languages; `wrap/<before|after>_<device>_<lang>.png` one by one.
- `proof/wrap-before.txt`, `proof/wrap-after.txt` — every right-hand line, read character by character on a
  real browser, iPhone 390 / Android 360 / laptop 1280, 8 languages (96 lines): before 12 one-character
  lines and dates cut in English / Thai / Indonesian / Vietnamese; after 0 one-character lines, 0 dates
  cut, 0 lines wider than their cell. Made with `harness/wrap-check.cjs` (and `harness/wrap-shoot.cjs`).

## Proof

- `proof/without-the-code.txt` — the new tests run against main's source files: 55 fail, 9 pass
  (each of the 9 checks that something stays as before), and the SQL pins + wrapping tests cannot load
  (sql/186 is not on main).
- `proof/on-purpose-breaks.txt` — 60 one-line breaks of this branch (incl. 8 for fix round 1): 60 of 60 make a test fail.
  The list: `proof/on-purpose-breaks.py`.
- `proof/seven-scopes-vs-main.txt` — main's worker and this branch's worker side by side over
  4,000 generated jobs: the 7-11 part, the shared scope and the automatic check are the same in
  every case. Script: `proof/seven-scopes-vs-main.mjs`.
- `proof/sql186-behaviour.txt` — sql/186 and its rollback on a throw-away database
  (`scripts/sql186-behaviour.mjs`, PGlite).
