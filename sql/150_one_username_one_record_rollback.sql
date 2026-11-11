-- ============================================================================
-- sql/150 ROLLBACK — Customers "one username = one record".
-- ============================================================================
-- NOT APPLIED. Puts the two trigger functions back EXACTLY as they were on the live database on
-- 2026-11-12 (pg_get_functiondef, character for character) and removes the two helpers.
-- Safe at any time. Records that were already merged / removed by sql/150 are NOT brought back.
-- The app is not affected: Scan QR lookup only reads Customers.
-- ⚠️ If either function was changed again AFTER sql/150, do not run this — rebuild from the live one.
-- ============================================================================
begin;

CREATE OR REPLACE FUNCTION public.upsert_parcel_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_name  text := nullif(trim(coalesce(new.customer_name, '')), '');
  v_notes text := nullif(trim(coalesce(new.notes, '')), '');
begin
  if v_phone = '' then
    return new;
  end if;

  -- Rule 2: restricted verdict arrived → remove this buyer from the phonebook.
  if new.phone_check_status = 'restricted' then
    delete from public.parcel_customers
     where user_id = new.user_id
       and phone = v_phone
       and lower(trim(coalesce(name, ''))) = lower(trim(coalesce(v_name, '')));
    return new;
  end if;

  -- Rule 1: explicit non-valid store check → do not add.
  if new.store_check_status is not null
     and new.store_check_status not in ('valid', 'unchecked', 'unknown') then
    return new;
  end if;

  insert into public.parcel_customers (user_id, phone, name, store_id, notes, contact_platform, updated_at)
  values (
    new.user_id,
    v_phone,
    v_name,
    nullif(trim(coalesce(new.store_id,'')), ''),
    v_notes,
    case when v_notes is null then null else new.contact_platform end,
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id         = coalesce(excluded.store_id, parcel_customers.store_id),
        notes            = coalesce(excluded.notes,    parcel_customers.notes),
        contact_platform = case when excluded.notes is null then parcel_customers.contact_platform else excluded.contact_platform end,
        updated_at       = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_fm_parcel_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_user  text := nullif(trim(coalesce(new.buyer_username, '')), '');
begin
  if v_phone = '' then
    return new;
  end if;
  insert into public.fm_parcel_customers (user_id, phone, name, store_id, buyer_username, contact_platform, updated_at)
  values (
    new.user_id,
    v_phone,
    nullif(trim(coalesce(new.recipient_name, '')), ''),
    nullif(trim(coalesce(new.store_id, '')), ''),
    v_user,
    case when v_user is null then null else new.contact_platform end,
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id         = coalesce(excluded.store_id, fm_parcel_customers.store_id),
        buyer_username   = coalesce(excluded.buyer_username, fm_parcel_customers.buyer_username),
        contact_platform = case when excluded.buyer_username is null then fm_parcel_customers.contact_platform else excluded.contact_platform end,
        updated_at       = now();
  return new;
end;
$function$;

drop function if exists public.scan_qr_lookup_on(uuid);
drop function if exists public.scan_qr_username_key(text);

commit;
