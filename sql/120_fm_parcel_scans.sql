-- 120 — Parcel Scan FamilyMart (全家). NOT APPLIED — chat-Claude applies.
-- Rollback: sql/120_fm_parcel_scans_rollback.sql.
--
-- The seller types each 全家 parcel (name, phone, store, amount, fee, order date, @username) and
-- exports a 好賣+ 大量匯單 .xlsx built in the app. Separate from the 7-11 parcel_scans table —
-- nothing here touches it.
--
-- Switch: app_settings fm_scan_enabled (default 'false'). The feature_access_emails 'fm_pickup'
-- preview list also opens it. On top of that the 7-11 Parcel Scan manual-entry rule applies
-- unchanged: admin, or parcel_manual_enabled = 'true' AND an active Plus/Pro/Master plan AND the
-- Taiwan market (country null or TW). Reading own rows is always allowed; writing needs the gate.
--
-- Retention like parcel_scans: 90 days after export, never-exported rows 180 days after creation.
begin;
set local lock_timeout = '5s';

insert into public.app_settings (key, value) values ('fm_scan_enabled', 'false') on conflict (key) do nothing;

-- Who may write 全家 Parcel Scan rows (the app shows the screen on the same rule).
create function public.fm_scan_allowed()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null
    and (
      coalesce((select lower(btrim(value)) from public.app_settings where key = 'fm_scan_enabled'), '') = 'true'
      or coalesce((public.my_feature_access() ->> 'fm_pickup')::boolean, false)
    )
    and (
      public.is_admin()
      or (
        coalesce((select lower(btrim(value)) from public.app_settings where key = 'parcel_manual_enabled'), '') = 'true'
        and exists (
          select 1 from public.seller_profiles p
           where p.auth_user_id = auth.uid()
             and lower(btrim(coalesce(p.plan, ''))) in ('plus', 'pro', 'master')
             and p.plan_status = 'active'
             and (p.plan_expiry is null or p.plan_expiry > now())
             and upper(coalesce(nullif(btrim(p.country), ''), 'TW')) = 'TW')
      )
    );
$function$;
revoke all on function public.fm_scan_allowed() from public, anon;
grant execute on function public.fm_scan_allowed() to authenticated;

-- ── Parcels ───────────────────────────────────────────────────────────────────
-- The checks are 好賣+ 大量匯單's own rules (the order-date 60-day window is checked in the app).
create table public.fm_parcel_scans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  recipient_name  text not null check (length(btrim(recipient_name)) between 1 and 50),
  phone           text not null check (phone ~ '^09[0-9]{8}$'),
  store_id        text not null check (store_id ~ '^[0-9]{6}$'),
  amount          numeric not null check (amount >= 10 and amount <= 20000),
  shipping_fee    numeric not null check (shipping_fee >= 0 and shipping_fee <= 200),
  order_date      date not null,
  buyer_username  text check (buyer_username is null or length(buyer_username) <= 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  exported_at     timestamptz,
  export_batch_id uuid,
  constraint fm_parcel_scans_total check (amount + shipping_fee >= 60 and amount + shipping_fee <= 20000)
);
create index fm_parcel_scans_user_created on public.fm_parcel_scans (user_id, created_at desc);

create function public.fm_parcel_scans_touch()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
create trigger trg_fm_parcel_scans_touch before update on public.fm_parcel_scans
  for each row execute function public.fm_parcel_scans_touch();

alter table public.fm_parcel_scans enable row level security;
revoke all on table public.fm_parcel_scans from anon;
create policy fm_parcel_scans_select on public.fm_parcel_scans
  for select to authenticated using (user_id = (select auth.uid()));
create policy fm_parcel_scans_insert on public.fm_parcel_scans
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));
create policy fm_parcel_scans_update on public.fm_parcel_scans
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));
create policy fm_parcel_scans_delete on public.fm_parcel_scans
  for delete to authenticated using (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));

-- ── Per-seller default shipping fee ──────────────────────────────────────────
create table public.fm_scan_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  shipping_fee numeric not null default 39 check (shipping_fee >= 0 and shipping_fee <= 200),
  updated_at   timestamptz not null default now()
);
alter table public.fm_scan_settings enable row level security;
revoke all on table public.fm_scan_settings from anon;
create policy fm_scan_settings_select on public.fm_scan_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy fm_scan_settings_insert on public.fm_scan_settings
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));
create policy fm_scan_settings_update on public.fm_scan_settings
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.fm_scan_allowed()));

-- ── Retention (daily 17:15 UTC = 01:15 Taipei, after the other purge jobs) ────
select cron.schedule('purge-old-fm-parcel-scans', '15 17 * * *', $cron$
  delete from public.fm_parcel_scans
   where (exported_at is not null and exported_at < now() - interval '90 days')
      or (exported_at is null and created_at < now() - interval '180 days');
$cron$);

commit;
