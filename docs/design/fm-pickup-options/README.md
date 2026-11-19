# Pickup Status — FamilyMart parcels FamilyMart has not received (STEP 0 study, nothing built)

2026-11-19, branch `claude/fm-pickup-accuracy`. **These are mock-ups.** No app file, server file or
database object was changed for them. The pictures are the real Pickup Status screen on made-up
parcels, with each option drawn on top by `harness/harness.tsx`.

## The case (live table, counts only)

27 FamilyMart parcels are "in transit". For 25 of them FamilyMart's own site has never given a
real answer: it either does not know the parcel number, or knows the order and shows it as not
handed in yet. The row keeps what the 好賣+ file said (出貨中) and looks like a parcel on its way.

Only 1 of the 25 carries the existing "Not dropped off yet" label: that label needs a date the
newer 好賣+ file does not have.

## The three options

| | Option 1 — one label | Option 2 — own group (recommended) | Option 3 — own tab / card |
|---|---|---|---|
| Where the fact is kept | Nothing new is saved. The app works it out from two things already saved: the time of the last check and the time of the last real answer. | One new field on the parcel: what FamilyMart's site said at the last check ("not found" or "not dropped off"). The check writes it; any real answer empties it. | Same as option 2. |
| What the seller reads | One label on the row: **Not at FamilyMart yet**. The row stays in the In transit list and in its number. | Two labels: **Not dropped off yet** (FamilyMart knows the order) or **No record yet** (FamilyMart does not know the number). The rows sit in their own group at the end of the In transit list; the In transit number counts moving parcels only. | The same two labels, in a tab of their own on the laptop and a fifth card on the phone. |
| Right-hand column | "Drop off before {date}" when the file gives it, else "Leaves this list {date}". | Same. | Same. |
| Leaves the list | 10 days after it was saved. A nightly database job decides, from what is saved. | 10 days after it was saved. The check decides, on the answer it has just received — the 7-11 way. | Same as option 2. |
| What an upload does | As today for a parcel still in the list. A parcel that left stays out unless the file says something new about it. | Same; and the file showing real progress (at the store, picked up, returned) moves the parcel there and empties the saved fact. | Same as option 2. |
| Needs | Web + one database file. No server change. | Database file, then server, then web. | Same as option 2, plus a layout change. |
| Shows on the 25 parcels | At once. | At each parcel's next check. | At each parcel's next check. |

## Pictures

`sheet_<view>_<device>.png` — one sheet per view and device, the 8 app languages side by side
(en, fil, zh, zh-TW, vi, th, id, bg). Views: `today`, `opt1`, `opt2`, `opt3`. Devices: iPhone 390,
Android 360, laptop 1280. `shots/` has the English pictures one by one.

Every picture: 0 px sideways scrolling, no label cut off (96 pictures measured).

The three made-up parcels of the case, in every picture:

| Buyer | What FamilyMart's site said | Date from the file |
|---|---|---|
| ella.tw | knows the order, not handed in | "drop off before" in 6 days |
| faye_ukay | knows the order, not handed in | none |
| ivy_live | does not know the number | none |

## New words (drafts)

English is the source. The other seven languages are drafts and have not been checked by a
speaker — Traditional Chinese needs a check before any build.

| | en |
|---|---|
| Label, option 1 | Not at FamilyMart yet |
| Label "site does not know the number" | No record yet |
| Right-hand column | Leaves this list {date} |
| Line above the group | FamilyMart has not received these yet. They leave this list after 10 days. |

"Not dropped off yet" and "Drop off before {date}" are already in the app in 8 languages.

## To make the pictures again

```bash
npx vite --config docs/design/fm-pickup-options/harness/vite.config.mjs --port 5330
```

```bash
node docs/design/fm-pickup-options/harness/shoot.cjs
```
