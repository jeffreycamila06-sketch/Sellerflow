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
