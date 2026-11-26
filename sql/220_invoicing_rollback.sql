-- Rollback of sql/220 (Invoicing step 2a). Puts back the two live function texts, then removes what the
-- file added. ⚠️ The saved invoice status (invoice_sends) and every seller's invoice shipping fee are
-- DELETED by this file. The payment note is not touched (it is the Receipt format note).
-- Instant "off" without this file:  update public.app_settings set value = 'false' where key = 'invoicing_enabled';
begin;
set local lock_timeout = '3s';

do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access'
                    and md5(p.prosrc) in ('c2839ef78c5cd5c19b75a8d6a6f7f238', '6d7264ef44eefe70c1e836eb20709b82')) then
    raise exception 'sql/220 rollback: public.my_feature_access was changed after sql/220 — roll that file back first; nothing was changed';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'privacy_retention_purge'
                    and md5(p.prosrc) in ('8b40e743b07ade1ace5208f73b23f9e8', 'be07f0fefb29068fe43482ed5babd71b')) then
    raise exception 'sql/220 rollback: public.privacy_retention_purge was changed after sql/220 — roll that file back first; nothing was changed';
  end if;
end $guard$;

-- the clean-up first (it must not name a table that is about to go)
create or replace function public.privacy_retention_purge(p_batch integer default 5000)
returns jsonb language plpgsql set search_path = public as $$
declare
  n integer;
  v_orders integer := 0;
  v_scans integer := 0;
  v_tracking integer := 0;
begin
  loop
    delete from public.orders
     where id in (select id from public.orders
                   where created_at < now() - interval '3 months'
                   limit p_batch);
    get diagnostics n = row_count;
    v_orders := v_orders + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_scans
     where id in (select id from public.parcel_scans
                   where (exported_at is not null and exported_at < now() - interval '90 days')
                      or (exported_at is null and created_at < now() - interval '180 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_scans := v_scans + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_tracking
     where id in (select id from public.parcel_tracking
                   where (status = 'picked_up' and coalesce(picked_up_at, updated_at) < now() - interval '7 days')
                      or (status = 'returned'  and coalesce(returned_at,  updated_at) < now() - interval '365 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_tracking := v_tracking + n;
    exit when n < p_batch;
  end loop;

  return jsonb_build_object('orders', v_orders, 'parcel_scans', v_scans, 'parcel_tracking', v_tracking);
end;
$$;
revoke all on function public.privacy_retention_purge(integer) from public, anon, authenticated;

create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

delete from public.feature_access_emails where feature = 'invoicing';
delete from public.app_settings where key = 'invoicing_enabled';

drop trigger if exists trg_invoice_sends_stamp on public.invoice_sends;
drop table if exists public.invoice_sends;
drop function if exists public.invoice_sends_stamp();

alter table public.seller_receipt_settings drop constraint if exists seller_receipt_settings_invoice_fee;
alter table public.seller_receipt_settings drop column if exists invoice_shipping_fee;

commit;
