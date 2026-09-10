-- 32_app_settings.sql
-- Global app-wide settings (key/value). Applied to prod via Supabase MCP
-- 2026-09-10 — THIS FILE IS THE REPO MIRROR (do NOT re-apply).
--
-- First use: key='shipping_default_fee' — the 7-11 / OPEN POINT 賣貨便 shipping
-- fee. It is the SAME for every seller in Taiwan (a carrier charge, not a
-- per-seller promo), so it lives here as a GLOBAL admin-owned value: one admin
-- change affects every seller (old rows + new). Sellers can READ it (they must,
-- to fill the export's 運費金額 column) but can NEVER write it — RLS below.
--
-- Fail-safe: the client read floors a missing/invalid/<=0 value to the compiled
-- SHIP_DEFAULT_FEE (38); a 0 fee would be a 賣貨便 rejection, never desired.
-- (seller_shipping_settings.free_threshold stays per-seller — a real promo.)
--
-- key='parcel_manual_enabled' — kill switch for Parcel Scan MANUAL encode by
-- paying sellers. Admin toggles it (RLS is_admin() write) to open/close seller
-- access with NO deploy; admin access is independent of it. ⚠️ FAIL-CLOSED (the
-- OPPOSITE of the fee): the client read treats missing/invalid/error as OFF —
-- only the literal "true" opens the feature. Default 'false'. The row is created
-- on the first admin toggle if absent (fail-closed until then), so seeding is
-- optional; the mirror seeds 'false' for documentation.

create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz default now(),
  updated_by  uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

-- Any signed-in user may READ (sellers need the fee to build their export).
create policy app_settings_select on public.app_settings
  for select to authenticated using (true);

-- Admin-only writes — public.is_admin() (the existing SECURITY DEFINER helper,
-- same gate as announcements / admin RPCs). A seller has NO write path.
create policy app_settings_insert on public.app_settings
  for insert to authenticated with check (public.is_admin());
create policy app_settings_update on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- DELETE: no policy → denied for authenticated/anon (RLS default-deny).

-- Seed the shipping fee (matches the current 賣貨便 standard).
insert into public.app_settings (key, value) values ('shipping_default_fee', '38')
  on conflict (key) do nothing;

-- Seed the Parcel Scan manual-encode kill switch OFF (fail-closed default).
insert into public.app_settings (key, value) values ('parcel_manual_enabled', 'false')
  on conflict (key) do nothing;
