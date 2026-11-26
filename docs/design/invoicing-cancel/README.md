# Invoicing — "Buyer cancelled" + cancel one item (2026-11-26)

Branch `claude/invoicing-cancel` (on top of `claude/invoicing-view`). Web (Vercel) + **sql/222 (NOT applied)**. No Render.
Orders, buyer numbers, Sales, printing, comment delivery, server, chrome-extension/, app_settings: 0 lines.

## Buyer cancelled
- Row sheet → **Buyer cancelled** → the buyer is saved as `cancelled` (invoice_sends). Row: tag **Cancelled** (gray),
  dimmed, total struck through. Send next skips them; "X of N sent" and the summary leave them out (N − 1);
  listed under **All** only.
- Right after: **"Add @handle to Blacklist?"** Yes / No — only when the app passes the Blacklist add, i.e. the seller
  has Blacklist today (`blacklistOn` = the gate of the Settings tile: switch `blacklist_enabled`, admin or the tester
  key, never Taiwan). Yes = `blacklist.add("tiktok", handle, "not_checked_out")`, the SAME function the Blacklist
  screen's Add uses; the answer (added / already today / couldn't save) uses the Blacklist screen's own texts.
- **Undo cancel** (in the cancelled buyer's sheet): **Sent** again when the buyer was Sent before the cancel — with
  the FIRST send time (sql/222 keeps it through the cancel); otherwise **Not sent** (the saved row is removed).
  A buyer who was "Can't message" before the cancel comes back as Not sent.

## Cancel one item
- The **×** of a line now saves that ORDER as cancelled for the invoice: the line shows struck through with **Undo**,
  and is left out of the message and the total. Saved in `invoice_line_cancels` by the order's own database id
  (`live_session_orders.id`) — never by text — so it holds after a reload and on another phone.
- Which order a line is: one small read of the session's order rows (id, buyer number, username, item, price,
  qty, time — the read the Orders "Paid" flag already makes), paired with the SAME rule (`matchPaidRows`). Read once
  when the screen / session opens, then only new rows when the order count grows. No timer. Nothing is written there.
- A line not paired yet (its order is still being saved, or the read failed) keeps today's × (this message only).
- The last remaining line asks **"Cancel the whole buyer?"** (No = nothing; Yes = Buyer cancelled).
- **"New item · send again" ignores cancelled lines:** a line cancelled after the invoice went out does not make the
  buyer "New item" (the lines it was sent with are still recognised); a real new order still does.

## sql/222 (+ rollback, NOT applied)
- `invoice_sends.status` also allows `'cancelled'`; `invoice_sends_stamp()` = sql/220's text + one rule (a cancel keeps
  the send time, Undo back to sent gives it back).
- NEW `invoice_line_cancels` (seller, session, platform, order id, time). **A table, not a column:** an id array on
  invoice_sends would need read-change-write, so two phones cancelling two lines at once would overwrite each other;
  one row per line = one insert / one delete. No foreign key to live_session_orders (it is cleaned after its session;
  this file must not lock or depend on it). RLS = invoice_sends' 4 own-row policies; nothing for visitors.
- `privacy_retention_purge()` = sql/220's text + one loop (cancelled lines 3 months after they were made).
- md5-pinned to the live texts (read from production 2026-11-26); the rollback puts both back word for word.

## Proof
- `src/redesign/screens/__tests__/Invoicing.cancel.test.tsx` (24) · `adapters/__tests__/invoicingCancelSql.test.ts` (6, CI)
  · `scripts/sql222-behaviour.mjs` (PGlite, 54: guard, apply twice, Undo time, RLS between two sellers, visitor,
  shape checks, clean-up, rollback, live_session_orders byte-identical) · `proof/breaks.txt` (20 of 20 caught).
- `shoot.cjs` → `measured.txt`: real app (preview), 360 / 390 / 430 / 1280 × 8 languages: no sideways scroll, the
  cancelled row's total + View on one line each, the struck line's Undo 44 px, the question's buttons 48 px.
- `shots/`: `sheet_item_*`, `blacklist_ask_*`, `list_cancelled_*` (iPhone 390, Android 360, laptop 1280, light + dark),
  `lang_360_<lang>_*`. Preview: `?ivc=40,12&ivclong=1&admin=1&bl=1`.
