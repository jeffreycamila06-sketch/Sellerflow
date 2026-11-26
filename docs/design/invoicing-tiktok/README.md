# Invoicing, step 2a — TikTok "Send next" (text)

Jeff, 2026-11-26. Settings → Invoicing. Behind a switch: `app_settings.invoicing_enabled` (sql/220 creates it
`'false'`), a preview login (`feature_access_emails`, feature `invoicing`), or an admin. Switch off and not
listed → the Settings card is exactly the "Soon" card of today.

## What the seller does

1. Settings → **Invoicing**. The TikTok tab lists the session's TikTok buyers, one row per buyer number.
2. **Send next · #N handle · total** → the buyer's message is copied and TikTok opens on that buyer.
3. In TikTok: Message → Paste → Send. Back in the app, **Send next** again: the buyer before becomes
   **✓ Sent** and the next one opens. After the last buyer the button reads **Done**.
4. A row opens the Send-to-TikTok sheet for that buyer: edit lines / price, Send, Can't message, Send again.
5. **Format** (top right): payment note, shipping fee, and "Message type: Text (Picture soon)".
6. **This session · date ▾** (top of the TikTok tab): pick a past session to send its invoices. A past
   session is shown in amber ("Past session · 11/24 → 11/25"). Each session keeps its own Sent marks.
7. If the phone refuses the copy: the buyer shows **Copy failed**, is not marked Sent, and the big button
   reads **Copy again · #N handle** until a copy works.

## Pictures (`shots/`, the real app in preview mode, made-up seller and buyers, `?ivc=40,12`)

Each one on iPhone 390, Android 360 and laptop 1280, light and dark (`_<device>_<theme>.png`):

| What | Files |
|---|---|
| The TikTok tab mid-way (12 of 40 sent) | `tiktok_*` |
| The same list further down: Sent · Next · Not sent · Can't message · New item together | `tiktok_tags_*` |
| A row's sheet (the buyer who is Next) | `sheet_*` |
| The Format sheet | `format_*` |
| The Instagram tab ("Soon") | `instagram_*` |
| The TikTok tab at 360 px in the other 7 languages | `lang_360_<language>.png` |
| The session picker open (this session first, then past ones, newest first) | `picker_*` |
| A past session picked (amber button + amber line, its own Sent marks) | `past_*` |
| "Copy failed": the button reads Copy again, the message is shown selected | `copyfailed_*` |
| The same, scrolled to the buyer's row with the amber "Copy failed" tag | `copyfailed_row_*` |

## Measured (`measured.txt`, all ok)

`node docs/design/invoicing-tiktok/shoot.cjs` against `npx vite --config vite.preview.config.ts --port 5199`.
On 360 / 390 / 430 / 1280 px in all 8 languages, and on the pictures above: nothing runs sideways, the header
is one 44 px line with Back, the title and Format, the four tabs are whole, every button is at least 44 px
tall, the big button and all 40 rows are inside the screen (rows 58 px), no tag is cut. In Filipino at 360 px
the big button wraps to two lines (67 px tall) — it is never cut.
The three new states (picker open, a past session, Copy failed) are measured on the three picture sizes in
light and dark and at 360 px and 430 px in all 8 languages: the picker button and every line of the list are
at least 44 px and inside the screen, nothing is cut, nothing runs sideways, a past session's button is amber,
after a refused copy nobody is "Sending…", the count of Sent is the same as before the tap, and the message
is shown selected.

## Proof

- `src/redesign/adapters/__tests__/invoicing.test.ts` — the rows ARE the Orders buyer cards (same code, also
  for a 3-day session), the message IS the Send to TikTok message, the order of Send next, the tags, New item.
- `src/redesign/screens/__tests__/Invoicing.test.tsx` — the screen against an in-memory database: Send next +
  marking, Done, numeric id = copy only, copy refused, the row sheet, another device, another seller, a new
  session, failed read / failed save, Format, the other tabs, nothing with a buyer in analytics.
- `src/redesign/screens/__tests__/Invoicing.sessions.test.tsx` — the two follow-ups: the session list is the
  Orders tab's list (same database function, same words, compared with the Orders tab itself); a past
  multi-day session's rows equal the Orders past buyer cards; tags of two sessions kept apart (also while
  the new one loads); no "old session" question in Invoicing, the question still there in Orders; copy
  refused → not Sent, the button stays, the next copy that works → the normal flow.
- `src/redesign/__tests__/invoicingOpen.app.test.tsx` — the real app: switch off = closed; switch on = every
  plan, a Free seller sends and it is saved; admin; preview login; Messenger-receipt seller; iPhone wording.
- `src/redesign/__tests__/invoicing.app.test.tsx` (from the "Soon" card, not edited) — switch off = today's card.
- `scripts/sql220-behaviour.mjs` — sql/220 and its rollback on a real Postgres (PGlite), 71 checks.
- `src/redesign/adapters/__tests__/invoicingSql.test.ts`, `invoicingGuideSql.test.ts` — the SQL texts (CI).
- `proof/breaks.txt` — changes made on purpose and the test that caught each.

## Decisions made while building (for Jeff)

- **Two buyers can have the same number** (two phones). The saved status is per seller + session + platform +
  buyer number **+ a short mark of the buyer** (a one-way code of the username; the username itself is not saved).
- **"Sending…"** — a sixth tag, on this phone only, for the buyer whose TikTok was just opened and who is not
  marked Sent yet (the next tap marks them).
- **"New item" looks at the buyer's order lines and their total**, not at the shipping fee: changing the
  default fee does not turn every sent buyer into "New item".
- **A double tap on Send next does nothing the second time** (0.9 s) — otherwise it would mark the buyer just
  opened as Sent and jump to the next one.
- **"Not sent" filter** = everything that is not Sent (New item and Can't message too).
- **Past sessions = the Orders tab's list**, so it goes back as far as Orders does: the past sessions whose
  orders are still stored (up to 7 finished sessions, 40 days at most — sql/127). NOT 3 months: the 3-month
  history is the Sales table, which has no buyer numbers and no sessions, so no invoice list can be made
  from it. The saved Sent marks themselves are kept 3 months.
- **The picker shows for the sellers who have the Sessions picker in Orders** (same rule; today the switch
  `past_sessions_public` is on for everyone).
- **A past session's message carries that session's dates** (as Send to TikTok does from Orders).
- **Copy failed and the link:** the big button is a real link (the only way TikTok opens inside the iPhone
  app), so a press opens TikTok whether or not the copy worked. Only the marking waits for a copy that worked.
- **A phone that never allows copying** cannot get a buyer marked Sent from this screen (only "Can't
  message"). The seller can still copy the selected message by hand and send it; the buyer then stays
  "Copy failed" / Not sent. If that happens to real sellers, a small "I sent it by hand" link would fix it —
  not built (the rule given was: not Sent until a copy works).
- **"Copy failed" is forgotten** when the seller leaves the screen or picks another session (the buyer is
  then simply Not sent again — never Sent).
- **The payment note is shared** with the Messenger receipt (same saved note). The invoice shipping fee is new
  and the Messenger receipt does not read it.
- The row sheet starts from the Format's note and fee; what is typed there is for that one message.

## Seen while taking the pictures — old, not changed here

The screenshot tool's own "click" scrolls its target into view first; in the dark theme that moved the app's
frame 14 px sideways (a hidden container a finger cannot move — a real tap does not do it, checked). The
script taps the way a phone does and checks that the frame is not moved.
