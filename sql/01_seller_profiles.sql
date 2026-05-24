-- ============================================================================
-- SellerFlow — Step 1: seller_profiles table for Supabase Auth
-- ============================================================================
-- This REPLACES the old `seller_users` (email + bcrypt password) model.
-- Supabase Auth now owns passwords; this table only holds the seller's
-- business profile, keyed by their Supabase Auth user id.
--
-- SAFETY: This script only CREATES new objects. It does NOT touch, drop, or
-- delete `seller_users` or any existing data. Run the whole file once in the
-- Supabase SQL Editor. It is safe to re-run (idempotent).
--
-- SECURITY MODEL (locked down from the start, not open like the old anon RLS):
--   * A seller can read/update ONLY their own profile row.
--   * Sensitive columns (role, plan, plan_status, plan_expiry) are NOT
--     editable by sellers — a trigger reverts any seller attempt to change
--     them, so a malicious client cannot self-promote to admin or master plan.
--   * The FIRST account ever created becomes role='admin' + master plan
--     (enforced server-side by a trigger, not by the client).
--   * Admins can read/update/delete ALL profiles.
-- ============================================================================


-- 1) Table --------------------------------------------------------------------
create table if not exists public.seller_profiles (
  auth_user_id       uuid primary key references auth.users(id) on delete cascade,
  email              text not null,
  full_name          text not null default '',
  store_name         text not null default '',
  phone              text not null default '',
  tiktok             text not null default '',
  facebook           text not null default '',
  plan               text not null default 'trial',
  plan_status        text not null default 'pending',
  plan_expiry        timestamptz,
  trial_started_at   timestamptz,
  role               text not null default 'seller',
  connected_accounts text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists seller_profiles_email_key
  on public.seller_profiles (lower(email));


-- 2) Admin check (SECURITY DEFINER avoids RLS recursion) ----------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.seller_profiles
    where auth_user_id = auth.uid() and role = 'admin'
  );
$$;


-- 3) On INSERT: server decides role + plan (client cannot choose) -------------
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
    -- Everyone else starts as a pending seller, awaiting admin approval.
    new.role             := 'seller';
    new.plan             := 'trial';
    new.plan_status      := 'pending';
    new.plan_expiry      := now();
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


-- 4) On UPDATE: protect sensitive columns from non-admins ---------------------
create or replace function public.seller_profiles_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    -- A seller may edit profile fields, but never these:
    new.role        := old.role;
    new.plan        := old.plan;
    new.plan_status := old.plan_status;
    new.plan_expiry := old.plan_expiry;
    new.auth_user_id := old.auth_user_id;
    new.email       := old.email;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_seller_profiles_update on public.seller_profiles;
create trigger trg_seller_profiles_update
before update on public.seller_profiles
for each row execute function public.seller_profiles_on_update();


-- 5) Row Level Security -------------------------------------------------------
alter table public.seller_profiles enable row level security;

drop policy if exists "seller_profiles_select_own_or_admin" on public.seller_profiles;
create policy "seller_profiles_select_own_or_admin"
on public.seller_profiles
for select
to authenticated
using (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists "seller_profiles_insert_self" on public.seller_profiles;
create policy "seller_profiles_insert_self"
on public.seller_profiles
for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "seller_profiles_update_own_or_admin" on public.seller_profiles;
create policy "seller_profiles_update_own_or_admin"
on public.seller_profiles
for update
to authenticated
using (auth_user_id = auth.uid() or public.is_admin())
with check (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists "seller_profiles_delete_admin" on public.seller_profiles;
drop policy if exists "seller_profiles_delete_own_or_admin" on public.seller_profiles;
create policy "seller_profiles_delete_own_or_admin"
on public.seller_profiles
for delete
to authenticated
using (auth_user_id = auth.uid() or public.is_admin());
-- Note: deleting the profile row revokes app access. Fully removing the
-- underlying auth.users record needs a server-side service_role call (added in
-- the backend step); until then a self-deleted user could log back in and a
-- fresh minimal profile would be created.

-- Note: no policy is granted to the `anon` role, so logged-out/anon-key-only
-- requests cannot read or write this table at all. This is the opposite of the
-- old open `to anon ... using(true)` policies.
