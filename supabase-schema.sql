-- ============================================================================
-- DO NOT RUN THIS FILE  --  OBSOLETE AND INSECURE
-- ============================================================================
-- This is the ORIGINAL setup script from BEFORE the security migration.
-- It is kept only for historical reference. It is NOT safe to run.
--
-- Running it would RE-CREATE the old, insecure state, including:
--   * the dead `seller_users` table (with a plaintext-style `password` column), and
--   * OPEN "to anon ... using (true)" row-level-security policies on
--     seller_users, support_messages, and audit_logs -- which expose those
--     tables to the public anonymous API key.
--
-- That would UNDO the security hardening performed by:
--   * sql/01_seller_profiles.sql              (Supabase Auth + seller_profiles + is_admin)
--   * sql/02_orders_customers_rls.sql         (per-seller row-level security on orders/customers)
--   * sql/03_audit_support_seller_users_rls.sql (locks down the tables above)
--
-- The CURRENT, correct schema and security live in sql/01, sql/02, and sql/03.
-- Run those three (in order) instead. Do NOT run this file.
--
-- SAFETY GUARD: the statement below aborts execution immediately if this file
-- is ever run, so it cannot silently re-open the tables. Remove the guard only
-- if you fully understand the consequences.
-- ============================================================================

do $$
begin
  raise exception
    'supabase-schema.sql is OBSOLETE and INSECURE and must not be run. Use sql/01, sql/02, sql/03 instead.';
end $$;

-- ----------------------------------------------------------------------------
-- Original, obsolete schema kept below for reference only (do not run).
-- ----------------------------------------------------------------------------

create table if not exists public.seller_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password text not null,
  full_name text not null default '',
  store_name text not null default '',
  phone text not null default '',
  tiktok text not null default '',
  facebook text not null default '',
  plan text not null default 'trial',
  plan_status text not null default 'active',
  plan_expiry timestamptz not null default (now() + interval '7 days'),
  trial_started_at timestamptz,
  connected_accounts text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.seller_users add column if not exists trial_started_at timestamptz;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  email text not null,
  subject text not null default '',
  message text not null default '',
  has_proof boolean not null default false,
  status text not null default 'pending',
  admin_reply text not null default '',
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.support_messages add column if not exists admin_reply text not null default '';
alter table public.support_messages add column if not exists replied_at timestamptz;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null default '',
  action text not null default '',
  target_email text not null default '',
  details text not null default '',
  created_at timestamptz not null default now()
);

alter table public.seller_users enable row level security;
alter table public.support_messages enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "seller_users_anon_all" on public.seller_users;
create policy "seller_users_anon_all"
on public.seller_users
for all
to anon
using (true)
with check (true);

drop policy if exists "support_messages_anon_all" on public.support_messages;
create policy "support_messages_anon_all"
on public.support_messages
for all
to anon
using (true)
with check (true);

drop policy if exists "audit_logs_anon_all" on public.audit_logs;
create policy "audit_logs_anon_all"
on public.audit_logs
for all
to anon
using (true)
with check (true);
