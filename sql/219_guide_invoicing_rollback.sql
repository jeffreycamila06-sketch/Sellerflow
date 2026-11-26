-- Rollback of sql/219: the Invoicing line is taken out of "The Settings screen" again (only where it is found).
-- "checked" is left as it is.
begin;

update public.support_guide
   set body = replace(body, '- **Invoicing** — sending invoices to buyers is coming soon.
', '')
 where id = 'settings-tiles'
   and position('- **Invoicing** — sending invoices to buyers is coming soon.
' in body) > 0;

commit;
