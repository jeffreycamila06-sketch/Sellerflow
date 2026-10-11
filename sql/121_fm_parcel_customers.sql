-- 121 — FamilyMart (全家) customers + the global FamilyMart shipping fee. NOT APPLIED — chat-Claude applies.
-- Rollback: sql/121_fm_parcel_customers_rollback.sql. Needs sql/120 (fm_parcel_scans, fm_scan_allowed).
--
-- 1. app_settings 'fm_shipping_fee' = '39': ONE fee for every FamilyMart parcel, set by an admin
--    (Admin → Global shipping fee). Sellers read it, never write it (app_settings RLS, sql/32).
--    fm_scan_settings (sql/120) stays in the database, unused.
-- 2. fm_parcel_customers: the FamilyMart phonebook — same rules as the 7-11 parcel_customers
--    (sql/35 + sql/36), filled ONLY by a trigger on fm_parcel_scans:
--      - one row per (user_id, phone, lower(trim(name))) — same phone + different name = two rows;
--      - a blank store / @username on the parcel never wipes the saved value;
--      - a parcel without a phone adds nothing (cannot happen: fm_parcel_scans requires one).
--    No store / buyer checker exists for FamilyMart, so the sql/36 verdict rules do not apply.
--    Retention like parcel_customers: kept while the account exists (deleted with it).
begin;
set local lock_timeout = '5s';

insert into public.app_settings (key, value) values ('fm_shipping_fee', '39') on conflict (key) do nothing;

create table public.fm_parcel_customers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text,
  phone          text not null check (phone ~ '^09[0-9]{8}$'),
  store_id       text check (store_id is null or store_id ~ '^[0-9]{6}$'),
  buyer_username text check (buyer_username is null or length(buyer_username) <= 100),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index fm_parcel_customers_uniq
  on public.fm_parcel_customers (user_id, phone, lower(trim(coalesce(name, ''))));
create index fm_parcel_customers_search
  on public.fm_parcel_customers
  using gin ((coalesce(name, '') || ' ' || phone || ' ' || coalesce(buyer_username, '')) gin_trgm_ops);
create index fm_parcel_customers_user_updated on public.fm_parcel_customers (user_id, updated_at desc);

alter table public.fm_parcel_customers enable row level security;
revoke all on table public.fm_parcel_customers from anon;
create policy fm_parcel_customers_select on public.fm_parcel_customers
  for select to authenticated using (user_id = (select auth.uid()));
create policy fm_parcel_customers_insert on public.fm_parcel_customers
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));
create policy fm_parcel_customers_update on public.fm_parcel_customers
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));
create policy fm_parcel_customers_delete on public.fm_parcel_customers
  for delete to authenticated using (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));

-- Every FamilyMart parcel add / edit saves or updates its buyer (the parcel write itself is gated
-- by fm_scan_allowed(), so this only runs for allowed writes).
create function public.upsert_fm_parcel_customer()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
begin
  if v_phone = '' then
    return new;
  end if;
  insert into public.fm_parcel_customers (user_id, phone, name, store_id, buyer_username, updated_at)
  values (
    new.user_id,
    v_phone,
    nullif(trim(coalesce(new.recipient_name, '')), ''),
    nullif(trim(coalesce(new.store_id, '')), ''),
    nullif(trim(coalesce(new.buyer_username, '')), ''),
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id       = coalesce(excluded.store_id, fm_parcel_customers.store_id),
        buyer_username = coalesce(excluded.buyer_username, fm_parcel_customers.buyer_username),
        updated_at     = now();
  return new;
end;
$function$;
revoke all on function public.upsert_fm_parcel_customer() from public, anon, authenticated;

create trigger trg_upsert_fm_parcel_customer
  after insert or update of recipient_name, phone, store_id, buyer_username
  on public.fm_parcel_scans
  for each row execute function public.upsert_fm_parcel_customer();

-- Backfill from the FamilyMart parcels already saved (newest parcel wins per buyer).
insert into public.fm_parcel_customers (user_id, phone, name, store_id, buyer_username, created_at, updated_at)
select distinct on (s.user_id, s.phone, lower(trim(s.recipient_name)))
       s.user_id, s.phone, nullif(trim(s.recipient_name), ''), s.store_id,
       nullif(trim(coalesce(s.buyer_username, '')), ''), s.created_at, s.created_at
  from public.fm_parcel_scans s
 order by s.user_id, s.phone, lower(trim(s.recipient_name)), s.created_at desc
on conflict do nothing;

commit;
