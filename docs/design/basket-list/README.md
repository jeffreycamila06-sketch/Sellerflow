# Basket list (🛒N on the Live screen) — option C, paid plans

Jeff's decisions (2026-11-28): tap the 🛒N badge on a Live comment → that buyer's orders of this session.
Each line: item, price (or **Free**), time, **↻ Reprint**, **Cancel** (a rectangle button, the Orders tab's
question "Cancel this order?" → Keep order / Cancel order, then **Cancelled** + **↺ Undo**). No "See all" —
the list scrolls inside the sheet (up to 85 % of a phone screen, 80 % on a laptop). Who: Basic / Plus / Pro /
Master with an active plan, and admins. Free plan / ended plan: the badge is the same plain number as before.

- Code: `components/BasketSheet.tsx`, `adapters/basketCounts.ts` (`basketOrdersFor`, `basketListAllowed`),
  Dashboard `onBasketTap` (absent = main's `<span>`), RedesignApp (state + gate + the sheet).
- Reprint = the Orders tab's `onReprintOrder` (zero-write). Cancel / Undo = the Orders tab's `orderCancelUi`
  (no Cancel button when Cancel order is off or the order has no tag).
- Printer guardian: PASS (no print file changed; same arguments as Orders ↻ — test-pinned).
- Pictures: `shots/` (real app, preview `?bk=1`, `&bkmany=1` for the scroll, `&bkfree=1` free plan).
  `shoot.cjs` makes them; `measured.txt` = widths, button heights, tap areas, sheet above the bottom bar.
- Breaks: `breaks.txt`.
- Guide: one-click-orders + reprint sections, 116b regenerated (do NOT apply 116b);
  `sql/236_guide_basket_list.sql` = those two rows only (NOT applied; checked: live rows + sql/236 = 116b rows).

Known, small: close and reopen the sheet within 2 s → its 2 s Reprint rest starts again (an extra copy at most,
never a wrong sticker). The basket list shows the current session only (as the 🛒 count does).
