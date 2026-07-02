-- 06_raffle_config.sql
-- Raffle Roleta (Games) — Phase 1 per-seller state. Mirrors the
-- seller_session_config pattern: user_id PK, RLS scoped to the signed-in user.
--
-- The ENTRIES are COMPUTED client-side from the existing live session orders
-- (order.orderNum epoch-ms >= enabled_at, group by buyer, cap 3) — there is NO
-- separate entries table, so this stays egress-safe: 1 read on app open + 1
-- write per toggle. Production App.tsx never reads this table (additive only).
--
-- Cleanup (Phase 2, pg_cron jobid 2, mirrors the jobid-1 purge; run as postgres
-- so RLS is bypassed):
--   UPDATE public.raffle_config SET enabled = false, enabled_at = null
--   WHERE enabled AND enabled_at < now() - interval '3 days';

create table if not exists public.raffle_config (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default false,
  enabled_at timestamptz null,           -- when collecting started (null when off)
  updated_at timestamptz not null default now()
);

alter table public.raffle_config enable row level security;

-- A seller may only ever see / write their OWN row.
create policy raffle_select on public.raffle_config
  for select using (user_id = auth.uid());
create policy raffle_insert on public.raffle_config
  for insert with check (user_id = auth.uid());
create policy raffle_update on public.raffle_config
  for update using (user_id = auth.uid());
