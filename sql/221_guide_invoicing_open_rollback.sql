-- ============================================================================
-- sql/221 ROLLBACK — help guide for Invoicing. Removes the "invoicing" row and puts the "coming soon" line
-- back on "The Settings screen" row (= the live row of 2026-11-26, after sql/219). Runs only where the new
-- line is found; twice = no change. "checked" is left as it is. NOT APPLIED.
-- ============================================================================
begin;

delete from public.support_guide where id = 'invoicing';

update public.support_guide
   set body = replace(body, '- **Invoicing** — send each buyer their invoice on TikTok after your live. If it shows **Soon**, it is not open for your account yet.
', '- **Invoicing** — sending invoices to buyers is coming soon.
')
 where id = 'settings-tiles'
   and position('- **Invoicing** — send each buyer their invoice on TikTok after your live. If it shows **Soon**, it is not open for your account yet.
' in body) > 0;

commit;
