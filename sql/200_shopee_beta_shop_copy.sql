-- 200 — ONE-TIME COPY: each Shopee beta seller's current Shopee shop (shopee_beta.shopee_uid) becomes
-- their registered shop in shopee_link_shops. NOT APPLIED by the repo — run by hand AFTER sql/199 and
-- WHILE app_settings.shopee_account_enforce is still 'false' (the file refuses otherwise, nothing changed).
--
-- Dated NOW (Jeff, 2026-11-22): the shop is the youngest account of its seller, so an account the seller
-- had before keeps going live. Example (live 2026-11-22): beta seller A, Basic (1 account), already has a
-- TikTok name → after the switch: 2 of 1, TikTok stays covered, the Shopee shop shows "Not covered by your
-- plan" (no upgrade / exempt). Beta seller B, Pro (3) → 2 of 3, both covered.
--
-- No plan check here (sfl.account_copy = '199' tells the insert trigger to skip it) and no 4-hour wait:
-- each copied shop gets an ACTIVE place dated now. A seller with no shop on the beta row, a region other
-- than tw / ph, or a deleted user is skipped. Running it twice adds nothing.
-- Undo: sql/199_account_limits_v2_rollback.sql (removes the table and these places with it).
begin;
set local lock_timeout = '3s';

do $$
begin
  if public.account_switch_on('shopee_account_enforce') then
    raise exception 'sql/200: shopee_account_enforce is already on — run this copy while it is off (nothing was changed)';
  end if;
end
$$;

set local sfl.account_copy = '199';

insert into public.shopee_link_shops (user_id, region, shopee_uid, created_at, last_connect_at)
select b.user_id, b.shopee_region, btrim(b.shopee_uid), now(), b.last_connect_at
  from public.shopee_beta b
 where b.shopee_uid is not null
   and btrim(b.shopee_uid) ~ '^[A-Za-z0-9_-]{1,64}$'
   and b.shopee_region in ('tw', 'ph')
   and exists (select 1 from auth.users u where u.id = b.user_id)
on conflict (user_id, region, shopee_uid) do nothing;

insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
select l.user_id, 'shopee', l.region || ':' || l.shopee_uid, now(), null, null, null
  from public.shopee_link_shops l
 where exists (select 1 from public.shopee_beta b where b.user_id = l.user_id)
on conflict (user_id, platform, account_key) do nothing;

commit;

-- Check (counts only):
--   select count(*) from public.shopee_link_shops;                                       -- = beta rows with a shop (2 on 2026-11-22)
--   select count(*) from public.account_seats where platform = 'shopee' and position(':' in account_key) > 0;
