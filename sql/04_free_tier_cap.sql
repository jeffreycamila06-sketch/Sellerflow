-- ============================================================================
-- SellerFlow — Step 4: Freemium "free" tier with a 100-order / 30-day cap
-- ============================================================================
-- Replaces the old 7-day trial for NEW sign-ups with a lifetime FREE tier that
-- has full features but a usage cap of 100 CREATED orders per rolling 30-day
-- cycle (cycle anchored at the seller's free_cycle_started_at = signup time).
--
-- SAFETY / GRANDFATHER GUARANTEE:
--   * This file only CREATES/REPLACES functions, ADDS columns (with defaults),
--     and adds triggers. It contains NO `UPDATE seller_profiles SET ...` on
--     existing rows, so the 9 existing PAID users (basic/pro/master/admin) are
--     untouched: same plan, plan_status, plan_expiry, profile.
--   * The order cap trigger's FIRST action is an early-exit for any user whose
--     plan is not exactly 'free'. Paid users never hit the counter, the cap
--     check, or the RAISE EXCEPTION — their order inserts behave exactly as
--     they do today.
--   * The legacy `seller_users` table is NOT touched (dead table, app reads
--     `seller_profiles` only).
--
-- HOW TO CHANGE THE CAP LATER (single source of truth):
--   Just re-run ONE statement in the Supabase SQL Editor, e.g. to make it 250:
--     create or replace function public.free_tier_cap()
--     returns integer language sql immutable as $$ select 250 $$;
--   No frontend rebuild, no Render restart — it takes effect immediately.
--
-- Idempotent: safe to run the whole file more than once.
-- Run AFTER 01_seller_profiles.sql / 02 / 03, in the Supabase SQL Editor.
-- ============================================================================


-- 1) Cap value — THE ONE place the cap number lives ---------------------------
-- Live values as of 2026-07-02: cap=100, near-cap warn=75. Cap was manually
-- changed 200→100 in prod; near_cap fixed 150→75 (was unreachable).
create or replace function public.free_tier_cap()
returns integer
language sql
immutable
as $$ select 100 $$;

-- Near-cap warning threshold (used by the admin dashboard + status RPC).
create or replace function public.free_tier_near_cap()
returns integer
language sql
immutable
as $$ select 75 $$;


-- 2) New columns on seller_profiles (non-destructive, defaults only) ----------
alter table public.seller_profiles
  add column if not exists free_orders_count integer not null default 0;

alter table public.seller_profiles
  add column if not exists free_cycle_started_at timestamptz;

-- One-time warning-shown flag so the near-cap pop-up appears once per cycle only.
alter table public.seller_profiles
  add column if not exists free_warned_at timestamptz;


-- 3) New sign-ups default to the FREE tier (was: 'trial') ---------------------
-- Only the INSERT branch for brand-new sellers changes. Existing rows are not
-- re-run through this trigger, so paid users are unaffected.
create or replace function public.seller_profiles_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count bigint;
begin
  select count(*) into existing_count from public.seller_profiles;

  if existing_count = 0 then
    -- First account ever = the owner/admin.
    new.role             := 'admin';
    new.plan             := 'master';
    new.plan_status      := 'active';
    new.plan_expiry      := now() + interval '120 months';
    new.trial_started_at := now();
  else
    -- Everyone else starts as a pending FREE seller, awaiting admin approval.
    new.role                   := 'seller';
    new.plan                   := 'free';
    new.plan_status            := 'pending';
    new.plan_expiry            := null;
    new.free_cycle_started_at  := now();
    new.free_orders_count      := 0;
    new.free_warned_at         := null;
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_seller_profiles_insert on public.seller_profiles;
create trigger trg_seller_profiles_insert
before insert on public.seller_profiles
for each row execute function public.seller_profiles_on_insert();


-- 4) HARD CAP: enforce the free-tier order cap on the orders table ----------------
-- BEFORE INSERT on orders. Paid users early-exit on the very first check.
create or replace function public.check_and_increment_free_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_plan     text;
  cycle_start   timestamptz;
  current_count integer;
  cap           integer;
begin
  select plan, free_cycle_started_at, free_orders_count
    into user_plan, cycle_start, current_count
  from public.seller_profiles
  where auth_user_id = new.user_id;

  -- ===== GRANDFATHER / PAID-USER PROTECTION ==============================
  -- Any non-free user (basic/pro/master/admin) — and any order whose owner
  -- has no profile row — passes straight through. No counter, no cap, no
  -- exception. Behaviour identical to before this migration.
  if user_plan is null or user_plan <> 'free' then
    return new;
  end if;

  -- Roll the cycle over if 30 days have elapsed since it started.
  if cycle_start is null or (now() - cycle_start) >= interval '30 days' then
    cycle_start   := now();
    current_count := 0;
    update public.seller_profiles
      set free_cycle_started_at = cycle_start,
          free_orders_count     = 0,
          free_warned_at        = null   -- new cycle re-arms the near-cap warning
      where auth_user_id = new.user_id;
  end if;

  cap := public.free_tier_cap();

  -- HARD STOP at the cap. The frontend also soft-blocks, but this is the
  -- authoritative limit that a dev-tools bypass cannot get around.
  if current_count >= cap then
    raise exception 'free_tier_cap_reached'
      using errcode = 'P0001',
            hint = 'Free tier ' || cap || '-order cycle limit reached';
  end if;

  -- Atomic increment for this seller's cycle.
  update public.seller_profiles
    set free_orders_count = free_orders_count + 1
    where auth_user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_orders_free_tier_check on public.orders;
create trigger trg_orders_free_tier_check
before insert on public.orders
for each row execute function public.check_and_increment_free_order();


-- 5) Status RPC for the frontend (counter, days-left, near-cap, capped) -------
-- The app calls supabase.rpc('free_tier_status_for_user'). Returns is_free=false
-- for paid users so the UI shows nothing extra for them.
create or replace function public.free_tier_status_for_user(target_user uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid           uuid := coalesce(target_user, auth.uid());
  user_plan     text;
  cycle_start   timestamptz;
  count_val     integer;
  warned_at     timestamptz;
  cap           integer := public.free_tier_cap();
  near          integer := public.free_tier_near_cap();
  days_left     integer;
begin
  -- A seller may only read their OWN status; admins may read anyone's.
  if uid <> auth.uid() and not public.is_admin() then
    return json_build_object('is_free', false, 'error', 'forbidden');
  end if;

  select plan, free_cycle_started_at, free_orders_count, free_warned_at
    into user_plan, cycle_start, count_val, warned_at
  from public.seller_profiles
  where auth_user_id = uid;

  if user_plan is null or user_plan <> 'free' then
    return json_build_object('is_free', false);
  end if;

  -- Reflect a pending cycle-rollover in the *reported* numbers without writing
  -- (the real reset happens atomically on the next order insert).
  if cycle_start is null or (now() - cycle_start) >= interval '30 days' then
    count_val := 0;
    days_left := 30;
  else
    days_left := greatest(0, 30 - floor(extract(epoch from (now() - cycle_start)) / 86400)::int);
  end if;

  return json_build_object(
    'is_free',              true,
    'count',                count_val,
    'cap',                  cap,
    'near_cap_threshold',   near,
    'near_cap',             count_val >= near,
    'capped',               count_val >= cap,
    'cycle_resets_in_days', days_left,
    'warning_shown',        warned_at is not null
  );
end;
$$;


-- 6) Mark the near-cap warning as shown (called once by the frontend) -----
create or replace function public.free_tier_mark_warned()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.seller_profiles
    set free_warned_at = now()
    where auth_user_id = auth.uid()
      and plan = 'free'
      and free_warned_at is null;
end;
$$;


-- 7) Admin-only: list every free user with their cycle status -----------------
-- Powers the "Free Users Near Cap" panel in the Admin dashboard.
create or replace function public.list_free_users_status()
returns table (
  email                 text,
  store_name            text,
  full_name             text,
  count                 integer,
  cap                   integer,
  near_cap              boolean,
  capped                boolean,
  cycle_resets_in_days  integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;  -- non-admins get an empty set
  end if;

  return query
  select
    sp.email,
    sp.store_name,
    sp.full_name,
    case when sp.free_cycle_started_at is null
              or (now() - sp.free_cycle_started_at) >= interval '30 days'
         then 0 else sp.free_orders_count end                              as count,
    public.free_tier_cap()                                                 as cap,
    (case when sp.free_cycle_started_at is null
               or (now() - sp.free_cycle_started_at) >= interval '30 days'
          then 0 else sp.free_orders_count end) >= public.free_tier_near_cap() as near_cap,
    (case when sp.free_cycle_started_at is null
               or (now() - sp.free_cycle_started_at) >= interval '30 days'
          then 0 else sp.free_orders_count end) >= public.free_tier_cap()      as capped,
    case when sp.free_cycle_started_at is null
              or (now() - sp.free_cycle_started_at) >= interval '30 days'
         then 30
         else greatest(0, 30 - floor(extract(epoch from (now() - sp.free_cycle_started_at)) / 86400)::int)
    end                                                                    as cycle_resets_in_days
  from public.seller_profiles sp
  where sp.plan = 'free'
  order by count desc;
end;
$$;

-- ============================================================================
-- NOTE: No migration UPDATE is included on purpose. All 9 existing users are
-- paid (basic/pro/master/admin) and must stay exactly as they are. Only NEW
-- sign-ups (section 3) become 'free'. Verified pre-deploy:
--   select plan, count(*) from public.seller_profiles group by plan;
-- ============================================================================
