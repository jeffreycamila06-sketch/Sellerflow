# Lock the saved Printer list (Printer Tuning, part 1) — 2026-11-27

Admin only. Nothing a seller's phone reads or prints changes.

- `sql/229_approved_printer_lock.sql` (+ rollback) — NOT applied. Column `locked`, the 11 active rows locked
  (refuses unless exactly 11), trigger `trg_approved_printers_lock`, `admin_lock_approved_printer`, overlap rule
  on approve / add back. Proof: `sql229-behaviour.txt` (PGlite, 92 checks), `breaks.txt`.
- Admin → Printer testers → Printer list: Built-in · 5 (read only) · Locked — working (read only, green badge)
  · Testing (Shift / Flip / Save / Remove + "Lock — working na" with a question inside the panel).
- Pictures: `shots/` — `list_*`, `testing_lock_*`, `approve_overlap_*` at iPhone 390, Android 360, 430,
  laptop 1280, light + dark (the real app in preview mode, `?ptl=1&admin=1`, made-up data = today's printer
  names). `measured.txt`: nothing wider than the screen, no controls inside a locked row.
- Matched settings unchanged: `src/redesign/adapters/__tests__/approvedPrinterLock.match.test.ts`.
