-- Rollback of sql/232: removes the "waybill-username" guide row and puts the old "shipping" sentence back
-- ("checked" back to 2026-10-11, the live value read 2026-11-27). Runs only where the new sentence is found.
begin;

delete from public.support_guide where id = 'waybill-username';

update public.support_guide
   set body = replace(body, 'For TikTok Shop waybills in the Philippines, see **Waybill username**.', 'Sellers in other countries do not see Shipping.'),
       checked = '2026-10-11'::date
 where id = 'shipping'
   and position('For TikTok Shop waybills in the Philippines, see **Waybill username**.' in body) > 0;

commit;
