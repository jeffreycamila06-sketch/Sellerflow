-- ============================================================================
-- SellerFlow — READ-ONLY inspection of current Supabase state
-- ============================================================================
-- SAFE TO RUN: this file ONLY reads metadata. It contains no CREATE, ALTER,
-- DROP, DELETE, UPDATE, or INSERT. It will not change anything.
--
-- HOW TO USE:
--   1. Open Supabase -> SQL Editor -> New query.
--   2. Paste this whole file and click "Run".
--   3. Copy each result table back to Claude so we can design Step 2 (RLS)
--      against the REAL schema (orders/customers/products are not in the repo).
-- ============================================================================


-- 1) All tables in the public schema + whether RLS is enabled --------------
select
  c.relname                         as table_name,
  c.relrowsecurity                  as rls_enabled,
  c.relforcerowsecurity             as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;


-- 2) Columns for every public table (so we can see owner columns, if any) ---
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;


-- 3) Every RLS policy currently defined in the public schema ----------------
--    This reveals the open `anon ... using(true)` policies and any others.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd            as command,
  qual           as using_expression,
  with_check     as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- 4) Row counts per public table (helps plan any backfill of owner columns) -
--    Uses live counts; fine for small/medium tables.
do $$
declare
  r record;
  n bigint;
begin
  raise notice 'table_name | approx_rows';
  raise notice '-----------+-----------';
  for r in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    execute format('select count(*) from public.%I', r.relname) into n;
    raise notice '% | %', rpad(r.relname, 28), n;
  end loop;
end $$;


-- 5) Does a seller_profiles table already exist? (it should NOT yet) --------
select exists (
  select 1
  from information_schema.tables
  where table_schema = 'public' and table_name = 'seller_profiles'
) as seller_profiles_exists;


-- 6) How many users already exist in Supabase Auth? ------------------------
--    Tells us whether anyone has signed up through Supabase Auth yet.
select count(*) as auth_users_count from auth.users;


-- 7) Foreign keys referencing auth.users (to see existing Auth wiring) ------
select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema as referenced_schema,
  ccu.table_name   as referenced_table,
  ccu.column_name  as referenced_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_schema = 'auth'
order by tc.table_name, kcu.column_name;
