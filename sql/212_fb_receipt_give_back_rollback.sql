-- Rollback of sql/212: the failed tries it took out are put back (same rows, same ids), then the
-- keeping table is dropped. A row whose id is in fb_receipts again is left alone, and so is a row of
-- a seller whose account was deleted meanwhile.
begin;
set local lock_timeout = '2s';

insert into public.fb_receipts overriding system value
select g.* from public.fb_receipts_given_back_212 g
 where not exists (select 1 from public.fb_receipts r where r.id = g.id)
   and exists (select 1 from auth.users u where u.id = g.user_id);

drop table public.fb_receipts_given_back_212;

commit;
