-- ============================================================================
-- sql/135 — SHOPEE LIVE BETA (share-link reader). MIRROR ONLY — NOT APPLIED.
-- chat-Claude applies via MCP after review. Additive and idempotent.
-- ============================================================================
-- What it adds
--   • public.shopee_beta — who may use the Shopee Live beta (30-day windows, admin-managed):
--       user_id (pk → auth.users), started_at, expires_at (= started_at + 30 days), note, added_by,
--       + the seller's Shopee account captured by the server at Connect: shopee_uid, shopee_region,
--         last_session_id, last_connect_at.
--     RLS: a seller can SELECT their own row. No INSERT/UPDATE/DELETE for anon/authenticated —
--     writes happen only through the two admin RPCs below (is_admin() guarded) or the service
--     role (the server, at Connect).
--   • RPC admin_shopee_beta_start(p_user uuid) — starts or EXTENDS by 30 days (an active window
--     is extended from its current expires_at; an expired/missing one restarts from now()).
--   • RPC admin_shopee_beta_remove(p_user uuid) — deletes the row (Shopee locked at once).
--   • RPC admin_shopee_beta_list() — every row (admin only) for the seller cards' "days left".
--   • RPC my_shopee_beta() — the caller's own row (SECURITY INVOKER, auth.uid() filter) for the
--     client gate; the server re-checks the same row with the service role.
--   • app_settings 'shopee_live_enabled' = 'false' — the server kill switch (fail-closed: the
--     reader refuses to connect unless the value is exactly 'true').
-- Access rule (client + server): Shopee allowed = admin OR (row exists AND expires_at > now()).
-- Not plan-based; no order cap on Shopee during the beta; the Shopee account does not count
-- against the plan's account limit (it is NOT written to account_seats).
-- Rollback: sql/135_shopee_beta_rollback.sql.
-- ============================================================================

create table if not exists public.shopee_beta (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '30 days'),
  note             text,
  added_by         uuid,
  shopee_uid       text,
  shopee_region    text check (shopee_region is null or shopee_region in ('tw', 'ph')),
  last_session_id  text,
  last_connect_at  timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.shopee_beta enable row level security;
revoke all on public.shopee_beta from anon, authenticated;
grant select on public.shopee_beta to authenticated;
drop policy if exists shopee_beta_select_own on public.shopee_beta;
create policy shopee_beta_select_own on public.shopee_beta
  for select to authenticated using (user_id = auth.uid());
-- no insert/update/delete policies on purpose (admin RPCs + service role only)

-- Start or extend 30 days (admin only).
create or replace function public.admin_shopee_beta_start(p_user uuid, p_note text default null)
returns public.shopee_beta
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.shopee_beta;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.shopee_beta (user_id, started_at, expires_at, note, added_by)
  values (p_user, now(), now() + interval '30 days', p_note, auth.uid())
  on conflict (user_id) do update
    set expires_at = greatest(public.shopee_beta.expires_at, now()) + interval '30 days',
        started_at = case when public.shopee_beta.expires_at > now() then public.shopee_beta.started_at else now() end,
        note       = coalesce(excluded.note, public.shopee_beta.note),
        added_by   = auth.uid(),
        updated_at = now()
  returning * into r;
  return r;
end;
$$;
revoke all on function public.admin_shopee_beta_start(uuid, text) from public, anon;
grant execute on function public.admin_shopee_beta_start(uuid, text) to authenticated; -- admins ARE 'authenticated'; the guard is is_admin() inside

-- Remove (admin only).
create or replace function public.admin_shopee_beta_remove(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.shopee_beta where user_id = p_user;
  return found;
end;
$$;
revoke all on function public.admin_shopee_beta_remove(uuid) from public, anon;
grant execute on function public.admin_shopee_beta_remove(uuid) to authenticated;

-- Every beta row (admin only) — the seller cards' "days left".
create or replace function public.admin_shopee_beta_list()
returns setof public.shopee_beta
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.shopee_beta order by expires_at desc;
end;
$$;
revoke all on function public.admin_shopee_beta_list() from public, anon;
grant execute on function public.admin_shopee_beta_list() to authenticated;

-- The caller's own beta row (null when none).
create or replace function public.my_shopee_beta()
returns public.shopee_beta
language sql
security invoker
stable
set search_path = public
as $$
  select * from public.shopee_beta where user_id = auth.uid();
$$;
revoke all on function public.my_shopee_beta() from public, anon;
grant execute on function public.my_shopee_beta() to authenticated;

insert into public.app_settings (key, value) values ('shopee_live_enabled', 'false')
on conflict (key) do nothing;

-- Verify:
--   select value from public.app_settings where key = 'shopee_live_enabled';     -- 'false'
--   select user_id, expires_at > now() as active from public.shopee_beta;        -- empty at first
-- Switch on for the beta testers: update public.app_settings set value = 'true', updated_at = now() where key = 'shopee_live_enabled';
