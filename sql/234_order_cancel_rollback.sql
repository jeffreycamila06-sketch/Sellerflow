-- 234 ROLLBACK — takes CANCEL ORDER out again (the database exactly as before sql/234).
-- REFUSES (nothing changed) while any order is still cancelled: taking the marks away would put those
-- orders back into Sales without anyone deciding it. Undo them in the app first (or decide by hand).
-- Run the web rollback first (or turn 'order_ref_enabled' to 'false'): an app that still sends order_ref
-- repeats its write without it once the column is gone (no order is lost), but that costs a second request.
begin;
set local lock_timeout = '3s';

do $guard$
begin
  if exists (select 1 from public.live_session_orders where cancelled_at is not null)
     or exists (select 1 from public.orders where cancelled_at is not null) then
    raise exception 'sql/234 rollback: some orders are still cancelled — nothing was changed';
  end if;
end $guard$;

-- the six readers: take the one condition out again (the text before sql/234, byte for byte)
do $readers$
declare
  r record;
  def text;
begin
  for r in select * from (values
      ('sales_report',             ' and o.cancelled_at is null /* sql/234 */'),
      ('sales_by_platform_orders', ' and o.cancelled_at is null /* sql/234 */'),
      ('miners_report',            ' and o.cancelled_at is null /* sql/234 */'),
      ('sales_by_platform',        ' and l.cancelled_at is null /* sql/234 */'),
      ('peak_hour_orders',         ' and l.cancelled_at is null /* sql/234 */'),
      ('my_session_summaries',     ' and l.cancelled_at is null /* sql/234 */')
    ) as t(fn, ins)
  loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = r.fn;
    if position(r.ins in def) > 0 then execute replace(def, r.ins, ''); end if;
  end loop;
end $readers$;

-- my_feature_access: sql/231's text (the live 30 keys)
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public'), ('invoicing'), ('waybill_username')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

drop function if exists public.uncancel_order(uuid);
drop function if exists public.cancel_order(uuid);
drop function if exists public.order_cancel_check(uuid);
drop function if exists public.order_cancel_allowed();

delete from public.feature_access_emails where feature = 'order_cancel';
delete from public.app_settings where key in ('order_ref_enabled', 'order_cancel_enabled');

drop index if exists public.idx_lso_user_order_ref;
drop index if exists public.idx_orders_user_order_ref;
alter table public.live_session_orders
  drop column if exists cancel_auto_code,
  drop column if exists cancel_msg_id,
  drop column if exists cancelled_at,
  drop column if exists order_ref;
alter table public.orders
  drop column if exists cancelled_at,
  drop column if exists order_ref;

do $after$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'sales_report' and md5(p.prosrc) = '3cc43d28186bd70d7729c6fc282d5d8b')
     or not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access' and md5(p.prosrc) = '86de09c575137dd74fee9252e586a8e2') then
    raise exception 'sql/234 rollback: the functions did not come back as before — nothing was changed';
  end if;
end $after$;

commit;
