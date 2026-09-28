-- 60 — Parcel Tracking Stage-1 hardening (poll allowlist, kill switch, run health).
-- MIRROR of the migration applied via Supabase MCP. Additive only; no existing row
-- or column changes. The feature stays CLOSED: the allowlist is seeded with the
-- owner + googletest, i.e. exactly who is polled today.
--
-- 1) parcel_tracking_access — WHO the SHOPMORE poller polls. Service role only:
--    RLS on with NO policies + every grant revoked from anon/authenticated. Sellers
--    learn their OWN flag through my_parcel_tracking_access() (SECURITY DEFINER,
--    own row only) — the client can never list or write the table.
-- 2) app_settings keys (existing table, sql/32):
--      parcel_tracking_enabled        'true' | 'false'  — kill switch, read at the
--                                      start of every run. Anything but 'true'
--                                      (incl. a missing row) = OFF.
--      parcel_tracking_cooldown_until  ISO timestamp — set by the poller's circuit
--                                      breaker (3 consecutive failures → +4h).
-- 3) parcel_tracking_health — one row per poll run (incl. disabled/cooldown skips),
--    trimmed to the newest 200 by a statement trigger. Service role only.

-- ── 1) allowlist ──────────────────────────────────────────────────────────────
create table if not exists public.parcel_tracking_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.parcel_tracking_access enable row level security;
revoke all on public.parcel_tracking_access from anon, authenticated;

insert into public.parcel_tracking_access (user_id, enabled, note)
select auth_user_id, true, note
from (values
  ('camilajeffrey1@gmail.com', 'owner — Phase 1 dogfood'),
  ('googletest@gmail.com',     'test account')
) as v(email, note)
join public.seller_profiles p on lower(p.email) = v.email
on conflict (user_id) do nothing;

-- Own-row read for the client gate (Part B). Returns false when there is no row.
create or replace function public.my_parcel_tracking_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select a.enabled from public.parcel_tracking_access a where a.user_id = auth.uid()),
    false
  );
$$;
revoke all on function public.my_parcel_tracking_access() from public, anon;
grant execute on function public.my_parcel_tracking_access() to authenticated;

-- ── 2) kill switch (seeded ON = today's behaviour) ───────────────────────────
insert into public.app_settings (key, value)
values ('parcel_tracking_enabled', 'true')
on conflict (key) do nothing;

-- ── 3) run health ────────────────────────────────────────────────────────────
create table if not exists public.parcel_tracking_health (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  reason      text,
  queries     integer not null default 0,
  updated     integer not null default 0,
  errors      integer not null default 0,
  duration_ms integer not null default 0
);
alter table public.parcel_tracking_health enable row level security;
revoke all on public.parcel_tracking_health from anon, authenticated;

create or replace function public.parcel_tracking_health_trim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.parcel_tracking_health
   where id not in (select id from public.parcel_tracking_health order by ran_at desc, id desc limit 200);
  return null;
end;
$$;
revoke all on function public.parcel_tracking_health_trim() from public, anon, authenticated;

drop trigger if exists parcel_tracking_health_trim on public.parcel_tracking_health;
create trigger parcel_tracking_health_trim
  after insert on public.parcel_tracking_health
  for each statement execute function public.parcel_tracking_health_trim();

-- ── Poll ordering (stalest first across sellers) ─────────────────────────────
create index if not exists parcel_tracking_poll_order_idx
  on public.parcel_tracking (last_polled_at asc nulls first, id)
  where terminal = false;
