-- Rollback of sql/137 (Facebook Post Sales). Drops the three tables (orders + items cascade),
-- the RPCs, the cron job and the waitlist source column; my_feature_access() goes back to the
-- sql/126 key list; the switch row is removed.
select cron.unschedule('purge-old-fb-post-sales');
drop function if exists public.fb_post_order_claim(bigint, bigint, text, text, integer, text, text, timestamptz);
drop function if exists public.fb_post_orders_mark_printed(bigint[]);
drop function if exists public.fb_post_waitlist_give(bigint);
drop function if exists public.fb_post_sale_item_update(bigint, numeric, integer);
drop function if exists public.fb_post_sale_end(bigint);
drop function if exists public.fb_post_sale_create(text, text, text, text, text, timestamptz, jsonb);
drop table if exists public.fb_post_orders;
drop table if exists public.fb_post_sale_items;
drop table if exists public.fb_post_sales;
alter table public.fb_waitlist drop constraint if exists fb_waitlist_source;
alter table public.fb_waitlist drop column if exists source;
delete from public.app_settings where key = 'fb_post_sales_enabled';

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;
