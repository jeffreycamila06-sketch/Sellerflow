-- sql/227 rollback — puts the "invoicing" row's old "Another session" line and search words back. Runs only where
-- the new line is found, so running it twice changes nothing the second time. Every other row stays as it is.
begin;

update public.support_guide
   set body = replace(body, '**Another session** — tap the session button at the top and pick a past session to send its invoices. Each tab lists only that platform''s sessions, and **This session** is on the tab of the platform you sell on now. A past session is shown in amber. Tap the button again and pick **This session** to go back.', '**Another session** — tap **This session ▾** at the top and pick a past session to send its invoices. A past session is shown in amber. Tap the button again and pick **This session** to go back.'),
       keywords = replace(keywords, 'new item, past session, facebook sessions, tiktok sessions, copy failed', 'new item, past session, copy failed')
 where id = 'invoicing'
   and position('**Another session** — tap the session button at the top and pick a past session to send its invoices. Each tab lists only that platform''s sessions, and **This session** is on the tab of the platform you sell on now. A past session is shown in amber. Tap the button again and pick **This session** to go back.' in body) > 0;

commit;
