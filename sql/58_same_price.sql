-- 58 — "Same price for all items" (per-seller fixed unit price override).
-- Mirrors the raffle_config / seller_session_config pattern: user_id PK, RLS
-- scoped to the signed-in user, ONE read on app open + ONE upsert per Save/Clear.
-- ZERO poll. Additive + isolated (a SEPARATE table, NOT a column on
-- seller_session_config) so the sacred buyer#/session read path is untouched.
--
-- same_price: nullable numeric. NULL (or a Clear) = feature OFF = normal
-- code/comment pricing. When set (> 0), the client overrides the price INPUT of
-- every NEW 1-Click and Auto order to this value before it reaches the pure
-- builder (buildOrderFromComment) — total = same_price * qty, so Auto qty N →
-- same_price × N. Enterprise pre-fills this value but a seller-typed price wins.
-- Blank/0/negative are treated as "not set" by the client (normalizeSamePrice).
--
-- Production App.tsx never reads this table (additive only). No auto-clear on a
-- new session — the row persists until the seller taps Clear.
create table if not exists public.seller_same_price (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  same_price numeric null,                       -- null = off; > 0 = fixed unit price
  updated_at timestamptz not null default now()
);

alter table public.seller_same_price enable row level security;

-- A seller may only ever see / write their OWN row.
create policy same_price_select on public.seller_same_price
  for select using (user_id = auth.uid());
create policy same_price_insert on public.seller_same_price
  for insert with check (user_id = auth.uid());
create policy same_price_update on public.seller_same_price
  for update using (user_id = auth.uid());

-- ROLLBACK: drop policies + table (no dependents; additive).
