-- ============================================================================
-- SellerFlow — Step 2: per-seller RLS for orders + customers
-- ============================================================================
-- Adds a user_id owner column, backfills existing rows to the owner/admin,
-- removes the old open anon policies, and locks each table to "own rows or
-- admin". Safe to re-run. Run AFTER 01_seller_profiles.sql.
--
-- NOTE: app code (src/db.ts) must stamp user_id = auth.uid() on insert — ship
-- the db.ts change together with this file or new saves will fail RLS.
-- ============================================================================

-- ===== ORDERS ===============================================================
alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

update public.orders
set user_id = (
  select auth_user_id from public.seller_profiles
  where role = 'admin' order by created_at limit 1
)
where user_id is null;

create index if not exists orders_user_id_idx on public.orders (user_id);

-- drop EVERY existing policy on orders (kills the old open anon policy
-- regardless of its name), then add clean ones.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'orders'
  loop
    execute format('drop policy if exists %I on public.orders', p.policyname);
  end loop;
end $$;

alter table public.orders enable row level security;

create policy "orders_select_own_or_admin" on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "orders_insert_own" on public.orders
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "orders_update_own_or_admin" on public.orders
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "orders_delete_own_or_admin" on public.orders
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ===== CUSTOMERS ============================================================
alter table public.customers
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

update public.customers
set user_id = (
  select auth_user_id from public.seller_profiles
  where role = 'admin' order by created_at limit 1
)
where user_id is null;

create index if not exists customers_user_id_idx on public.customers (user_id);

-- Move uniqueness from global-handle to per-seller handle.
-- The old global unique constraint/index name may differ in your DB — if these
-- drops are no-ops, check your sql/00 output for the real name and add it here.
alter table public.customers drop constraint if exists customers_handle_key;
drop index if exists public.customers_handle_key;

-- per-seller, case-insensitive handle uniqueness.
-- If this errors, two existing rows share a handle (case-insensitively) under
-- the same owner — resolve those rows, then re-run.
create unique index if not exists customers_user_handle_key
  on public.customers (user_id, lower(handle));

do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'customers'
  loop
    execute format('drop policy if exists %I on public.customers', p.policyname);
  end loop;
end $$;

alter table public.customers enable row level security;

create policy "customers_select_own_or_admin" on public.customers
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "customers_insert_own" on public.customers
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "customers_update_own_or_admin" on public.customers
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "customers_delete_own_or_admin" on public.customers
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
