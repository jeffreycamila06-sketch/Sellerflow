-- 08_announcements.sql
-- Admin announcements — one active banner for ALL sellers + a 🔔 bell history.
-- Applied to prod via MCP (not from code) — same flow as 06_raffle_config.sql.
--
-- Egress shape: sellers do ONE read of the latest 10 rows on app open (zero
-- poll); dismiss/last-seen live in localStorage (no seller writes). Admin
-- publish = 2 statements (deactivate current active, insert new) so only one
-- announcement is ever active. Production App.tsx never reads this table
-- (additive only).

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Auto-translated multilingual broadcasts (additive, applied via MCP). At SEND
-- time the admin's single message is translated into all 7 supported languages
-- in ONE Anthropic call; the per-language result is stored here keyed by the
-- canonical i18n codes: {"en":"...","fil":"...","zh":"...","zh-TW":"...",
-- "vi":"...","th":"...","id":"..."}. NULL for legacy rows and "English only"
-- sends → sellers fall back to the plain `message` column. No backfill.
alter table public.announcements add column if not exists message_i18n jsonb;

alter table public.announcements enable row level security;

-- ALL authenticated users read ALL rows — the bell history shows past
-- announcements too; the active flag only decides which one banners.
create policy ann_select on public.announcements
  for select using (auth.uid() is not null);

-- Admin-only writes. public.is_admin() is the existing SECURITY DEFINER helper
-- (same gate as admin_password_log RLS / admin_business_pulse).
create policy ann_insert on public.announcements
  for insert with check (public.is_admin());
create policy ann_update on public.announcements
  for update using (public.is_admin());

-- Admin-only HARD DELETE. Sellers can hide-by-unpublish (ann_update sets
-- active=false), but a true delete removes the row entirely so it disappears
-- from EVERY seller surface (banner + 🔔 bell history) on their next app open.
-- Without this policy RLS default-denies DELETE (a seller's direct API delete
-- silently affects 0 rows); with it, only public.is_admin() may delete.
create policy ann_delete on public.announcements
  for delete using (public.is_admin());
