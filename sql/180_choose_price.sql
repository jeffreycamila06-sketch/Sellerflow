-- 180 — "Choose price before print" (per-seller list of up to 6 prices + an ON/OFF switch).
-- NOT APPLIED. Stored the same way as "Same price for all items" (sql/58 + sql/59): ONE row per
-- seller, RLS = own row only, ONE read on app open + ONE upsert per change, ZERO poll.
-- A SEPARATE table, so seller_same_price and every order / session table stay untouched.
--
-- enabled: the switch. Default false → nobody is switched on by this file.
-- prices : the seller's prices, first = default. The app keeps it to 1–6 positive, different
--          numbers; turning the switch OFF keeps the list. The check below is a backstop only.
-- Only one of this switch and seller_same_price.enabled is ON at a time — the app turns the
-- other one off (each table keeps its own values).
--
-- Before this file is applied the app reads nothing (switch shows OFF) and a save fails with
-- the normal "Couldn't save" line — 1-Click and pin-print behave exactly as before.
create table if not exists public.seller_price_choices (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default false,
  prices     numeric[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint seller_price_choices_prices_max6 check (coalesce(array_length(prices, 1), 0) <= 6)
);

alter table public.seller_price_choices enable row level security;

-- A seller may only ever see / write their OWN row (same three policies as seller_same_price).
create policy price_choices_select on public.seller_price_choices
  for select using (user_id = auth.uid());
create policy price_choices_insert on public.seller_price_choices
  for insert with check (user_id = auth.uid());
create policy price_choices_update on public.seller_price_choices
  for update using (user_id = auth.uid());
