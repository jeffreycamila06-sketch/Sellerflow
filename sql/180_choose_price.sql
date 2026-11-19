-- 180 — "Choose price before print" (per-seller list of up to 6 prices + an ON/OFF switch).
-- NOT APPLIED. Stored the same way as "Same price for all items" (sql/58 + sql/59): ONE row per
-- seller, own row only, ONE read per sign-in + ONE upsert per change, ZERO poll.
-- ADD-ONLY: a new table + one small helper function. seller_same_price and every order /
-- session table stay untouched. Safe to run twice (nothing changes the second time).
--
-- enabled: the switch. Default false → nobody is switched on by this file.
-- prices : the seller's prices, first = default. Turning the switch OFF keeps the list.
-- The app already keeps the list clean; the checks below make the database refuse anything else:
--   at most 6 · one plain list · no empty entry · every price above 0 · no price twice ·
--   the switch can be ON only with at least 1 price.
-- Only one of this switch and seller_same_price.enabled is ON at a time — the app turns the
-- other one off (each table keeps its own values).
--
-- Before this file is applied the app reads nothing (switch shows OFF) and a save fails with
-- the normal "Couldn't save" line — 1-Click and pin-print behave exactly as before.
-- Rollback: sql/180_choose_price_rollback.sql
begin;

-- true when no value appears twice (39 and 39.0 are the same price). Used by a check below.
create or replace function public.seller_price_choices_distinct(p numeric[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select count(*) = count(distinct x) from unnest(p) as x;
$$;

create table if not exists public.seller_price_choices (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default false,
  prices     numeric[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.seller_price_choices drop constraint if exists seller_price_choices_prices_max6;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_prices_flat;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_prices_no_null;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_prices_positive;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_prices_distinct;
alter table public.seller_price_choices drop constraint if exists seller_price_choices_on_needs_price;
alter table public.seller_price_choices
  add constraint seller_price_choices_prices_max6     check (cardinality(prices) <= 6),
  add constraint seller_price_choices_prices_flat     check (coalesce(array_ndims(prices), 1) = 1),
  add constraint seller_price_choices_prices_no_null  check (array_position(prices, null) is null),
  add constraint seller_price_choices_prices_positive check (0 < all (prices)),
  add constraint seller_price_choices_prices_distinct check (public.seller_price_choices_distinct(prices)),
  add constraint seller_price_choices_on_needs_price  check (not enabled or cardinality(prices) >= 1);

alter table public.seller_price_choices enable row level security;

-- A signed-in seller may only ever see / write their OWN row. No delete from the browser.
drop policy if exists price_choices_select on public.seller_price_choices;
drop policy if exists price_choices_insert on public.seller_price_choices;
drop policy if exists price_choices_update on public.seller_price_choices;
create policy price_choices_select on public.seller_price_choices
  for select to authenticated using (user_id = (select auth.uid()));
create policy price_choices_insert on public.seller_price_choices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy price_choices_update on public.seller_price_choices
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Signed-in sellers only: nothing for visitors who are not signed in.
revoke all on table public.seller_price_choices from public, anon;
revoke all on table public.seller_price_choices from authenticated;
grant select, insert, update on table public.seller_price_choices to authenticated;

commit;
