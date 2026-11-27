# Cancel order (sql/234) — what was built and the proof

Orders tab only. Jeff's six decisions (2026-11-28): the free order is NOT given back · stock goes back ·
allowed while the order is shown in the Orders tab · allowed after a receipt / invoice was sent (warning
line) · the same Live comment can be ordered again · a new column on the orders ledger is OK.

## What the seller sees
- **⋯** on every order made after the release (orders from before have no tag → no ⋯).
- ⋯ → sheet: buyer, item, amount, 4 short lines, the amber warning when an invoice / Messenger receipt was
  already sent to that buyer, **Keep order** / **Cancel order**.
- Cancelled: item + amount struck through, red **Cancelled** chip, **↶ Undo**; no Reprint / Paid on it.
- Left out of: Orders totals + badge + export, Sales (all ranges), Sales by platform, peak hours, the
  Sessions list counts, Miners report, the buyer card, Send to TikTok, Invoicing (both tabs), Send all +
  the after-live Messenger receipt (server), the Live board totals, Print all, 7-11 shipping groups.
- Kept: the buyer's number (numbering still counts the order, so no number is ever reused).

## Pictures
`shots/` — iPhone 390, Android 412, phone 360, laptop 1280, iPhone dark: 1 list · 2 the sheet (with the
warning) · 3 after Cancel (toast) · 2b the sheet with nothing sent. Real app in preview mode
(`?ivc=6,0&cx=1[&cxsent=1]`). `measured.txt`: no sideways scroll at any width, sheet buttons 46 px, the ⋯
tap area 44×44 (drawn 38×28 + `.sfl-tap44`).

## Proof
- `proof/sql234-behaviour.txt` — PGlite, 67 checks: the 7 live function texts (md5) before / after, cancel /
  undo / check, own rows only, Customers counts (exact handle; the table is unique on lower(handle)), stock
  back for Auto-mode orders, the comment free to order again, Undo when the comment was ordered again, the
  six readers leave cancelled rows out, the rollback (refuses while any order is cancelled).
- `proof/sql235-behaviour.txt` — the guide row phrase swap (twice = once, rollback = before).
- `proof/breaks.txt` — 14 on-purpose breaks, 14 caught.
- Tests: `Orders.cancel.test.tsx`, `orderCancel.test.ts`, `orderCancelSql.test.ts`,
  `orderCancelFilter.server.test.ts`, `useLiveSession.cancel.test.tsx`, `useOrders.orderRef.test.tsx`.
