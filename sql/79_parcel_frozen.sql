-- 79 — PARCEL SCAN Dry / Frozen (常溫 / 冷凍) per parcel. NOT APPLIED — mirror for review; the
-- reviewer applies it. Additive + idempotent (safe to run twice).
--
-- OpenPoint frozen rule (October promo): shipping NT$129, order + shipping ≥ NT$150, buyer pays
-- order + shipping. The numbers live in app_settings (below) so they can change without a deploy.
--
-- Who sees the Dry / Frozen control: app_settings parcel_frozen_public = 'true' exactly, OR the
-- seller has an enabled parcel_frozen_access row. Everyone else (and any read error) sees today's
-- Parcel Scan; their parcels save as 常溫 (the column default) → byte-identical export.
--
-- Order matters: the column comes first. The app treats "parcel_frozen_access is readable" as
-- "this file is applied" and only then selects parcel_scans.temp_layer.

-- 1. Per-parcel layer. Existing rows get the default 常溫.
alter table public.parcel_scans
  add column if not exists temp_layer text not null default '常溫';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'parcel_scans_temp_layer_check') then
    alter table public.parcel_scans
      add constraint parcel_scans_temp_layer_check check (temp_layer in ('常溫', '冷凍'));
  end if;
end $$;

-- 2. The seller's current mode (account-level, follows them across devices). Owner-only rows.
create table if not exists public.parcel_scan_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  temp_layer text not null default '常溫' check (temp_layer in ('常溫', '冷凍')),
  updated_at timestamptz not null default now()
);
alter table public.parcel_scan_prefs enable row level security;
revoke all on table public.parcel_scan_prefs from anon;
grant select, insert, update on table public.parcel_scan_prefs to authenticated;
drop policy if exists parcel_scan_prefs_select_own on public.parcel_scan_prefs;
create policy parcel_scan_prefs_select_own on public.parcel_scan_prefs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists parcel_scan_prefs_insert_own on public.parcel_scan_prefs;
create policy parcel_scan_prefs_insert_own on public.parcel_scan_prefs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists parcel_scan_prefs_update_own on public.parcel_scan_prefs;
create policy parcel_scan_prefs_update_own on public.parcel_scan_prefs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 3. Early access (owner adds rows by SQL). Sellers may only read their own row; no client writes.
create table if not exists public.parcel_frozen_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
alter table public.parcel_frozen_access enable row level security;
revoke all on table public.parcel_frozen_access from anon;
revoke all on table public.parcel_frozen_access from authenticated;
grant select on table public.parcel_frozen_access to authenticated;
drop policy if exists parcel_frozen_access_select_own on public.parcel_frozen_access;
create policy parcel_frozen_access_select_own on public.parcel_frozen_access
  for select to authenticated using (user_id = (select auth.uid()));

-- 4. Settings (insert only if missing — never overwrites a value already changed).
--    parcel_frozen_fee_column_max '' = no cap (G = the whole fee).
insert into public.app_settings (key, value) values
  ('parcel_frozen_public', 'false'),
  ('parcel_frozen_fee', '129'),
  ('parcel_frozen_min_total', '150'),
  ('parcel_frozen_fee_column_max', '')
on conflict (key) do nothing;
