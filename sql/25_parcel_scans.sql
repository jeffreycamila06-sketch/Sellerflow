-- 25_parcel_scans.sql
-- Parcel Scan (Phase A1, ADMIN-ONLY dogfood) — scanned handwritten parcel slips.
-- Applied to prod via Supabase MCP 2026-09-08 (this file is the repo mirror —
-- raffle_config / seller_shipping_settings pattern).
--
-- One row per scanned parcel: the owner photographs a handwritten slip, Claude
-- vision extracts the fields server-side (POST /admin/parcel-scan on Render),
-- the owner confirms/edits, and the row lands here with status 'confirmed'.
-- Phase A2 adds the per-parcel 7-11 encode queue that moves rows through
-- encoded_ok / store_full / restricted_number / printed.
--
-- DELIBERATE non-links: NO FK to shipping_entries or orders (a scanned physical
-- parcel is frequently not tied to any in-app order), and NO image storage
-- anywhere — the photo goes device → Render → Anthropic → discarded; only the
-- extracted fields persist. raw_extraction keeps the model's field/confidence
-- JSON for later accuracy tuning.
--
-- Egress shape: ONE select per Parcel-Scan screen open (recent rows) + one
-- insert per confirmed parcel. ZERO poll.

create table if not exists public.parcel_scans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  customer_name  text,
  phone          text,
  store_id       text,
  amount         numeric,
  notes          text,
  status         text not null default 'pending'
                 check (status in ('pending','confirmed','encoded_ok','store_full','restricted_number','printed')),
  raw_extraction jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  encoded_at     timestamptz
);

create index if not exists parcel_scans_user_created
  on public.parcel_scans (user_id, created_at desc);

alter table public.parcel_scans enable row level security;

-- A seller may only ever see / write their OWN rows. (The FEATURE gate is
-- admin-only — client tile + server requireAdmin — but the data gate is plain
-- own-scoped RLS like every other per-seller table.)
create policy parcel_scans_select on public.parcel_scans
  for select using (user_id = auth.uid());
create policy parcel_scans_insert on public.parcel_scans
  for insert with check (user_id = auth.uid());
create policy parcel_scans_update on public.parcel_scans
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy parcel_scans_delete on public.parcel_scans
  for delete using (user_id = auth.uid());
