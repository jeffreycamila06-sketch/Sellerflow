-- ============================================================================
-- sql/227 — help guide, ONE row of support_guide: "invoicing" (2026-11-27). The session picker is per platform:
-- each Invoicing tab lists only that platform's sessions, and "This session" is on the tab of the platform the
-- seller sells on now. Same words as docs/support/sfl-guide.md / sql/116b. Two search words are added
-- (facebook sessions, tiktok sessions).
--   A PHRASE SWAP of the "Another session" line only. It runs only where the old line is found (sql/221 + sql/224
--   are applied — the live body's md5 is 359055643d01d94a59600f80440f3211, read 2026-11-27), so running it twice
--   changes nothing the second time. Independent of sql/226 (different words): either may be applied first.
-- Every other row stays as it is. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply after the web merge (Vercel).
-- Rollback: sql/227_guide_invoicing_sessions_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, '**Another session** — tap **This session ▾** at the top and pick a past session to send its invoices. A past session is shown in amber. Tap the button again and pick **This session** to go back.', '**Another session** — tap the session button at the top and pick a past session to send its invoices. Each tab lists only that platform''s sessions, and **This session** is on the tab of the platform you sell on now. A past session is shown in amber. Tap the button again and pick **This session** to go back.'),
       keywords = replace(keywords, 'new item, past session, copy failed', 'new item, past session, facebook sessions, tiktok sessions, copy failed'),
       checked = greatest(checked, '2026-11-27'::date)
 where id = 'invoicing'
   and position('**Another session** — tap **This session ▾** at the top and pick a past session to send its invoices. A past session is shown in amber. Tap the button again and pick **This session** to go back.' in body) > 0
   and position('**Another session** — tap the session button at the top and pick a past session to send its invoices. Each tab lists only that platform''s sessions, and **This session** is on the tab of the platform you sell on now. A past session is shown in amber. Tap the button again and pick **This session** to go back.' in body) = 0;

commit;
