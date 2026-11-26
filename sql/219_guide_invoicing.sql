-- ============================================================================
-- sql/219 — help guide, ONE row of support_guide: "The Settings screen" (settings-tiles) (2026-11-26).
--   One line is added to its list of tiles:
--     - **Invoicing** — sending invoices to buyers is coming soon.
--   Same words as docs/support/sfl-guide.md / sql/116b. A LINE ADDITION, not the whole row: it runs only where
--   the "Invite friends" line is found and the Invoicing line is not, so running it twice changes nothing the
--   second time. The "Invite friends" line was checked on the live row on 2026-11-26 (read only).
--   "checked" becomes 2026-11-26.
--   No guide row (file or live table, checked 2026-11-26) tells sellers to open "Receipt format" from
--   Settings, so there is no path to change.
-- No Render deploy (the help bot re-reads the guide every 5 minutes).
-- NOT APPLIED. Apply after the web merge (the Invoicing card is on the Settings tab only after it).
-- Rollback: sql/219_guide_invoicing_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, '- **Invite friends** — your invite code, the friends you invited, and a place to add a friend''s code.
', '- **Invite friends** — your invite code, the friends you invited, and a place to add a friend''s code.
- **Invoicing** — sending invoices to buyers is coming soon.
'),
       checked = greatest(checked, '2026-11-26'::date)
 where id = 'settings-tiles'
   and position('- **Invite friends** — your invite code, the friends you invited, and a place to add a friend''s code.
' in body) > 0
   and position('- **Invoicing** — sending invoices to buyers is coming soon.' in body) = 0;

commit;
