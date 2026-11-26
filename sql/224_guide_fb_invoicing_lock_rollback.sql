-- sql/224 rollback — puts the "invoicing" row's old line and search words back. Runs only where the new line
-- is found, so running it twice changes nothing the second time. Every other row stays as it is.
begin;

update public.support_guide
   set body = replace(body, '**Facebook tab** — sending invoices to Facebook buyers in Messenger is turned on by Admin. If it isn''t on for you, tap **Ask Admin to turn it on**: Telegram opens with a ready message.

Instagram and Shopee invoices are coming soon.', 'Facebook, Instagram and Shopee invoices are coming soon.'),
       keywords = replace(keywords, 'remove item, facebook invoicing, messenger invoice, ask admin, ipadala', 'remove item, ipadala')
 where id = 'invoicing'
   and position('**Ask Admin to turn it on**' in body) > 0;

commit;
