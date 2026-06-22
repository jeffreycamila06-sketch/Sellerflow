-- 05_live_session_orders.sql
-- Cross-device live-session store: persists today's buyer numbers + orders per
-- SELLER ACCOUNT (user_id), so a refresh / app restart / logout-login / switch
-- to a different device all restore the same session — until the Asia/Taipei
-- calendar day rolls over (then a fresh #1).
--
-- SEPARATE from public.orders, which is the billing / free-tier-cap ledger
-- (BEFORE INSERT trigger check_and_increment_free_order). That table and its
-- trigger are intentionally LEFT UNTOUCHED — this is additive only.
--
-- Reset model: NO cron. The load query filters `session_date = <Taipei today>`,
-- so yesterday's rows simply aren't loaded. An optional retention cleanup of
-- old rows can be added later; it is not needed for the daily reset.
--
-- Egress model: write on the 1-click order create, read once on app open /
-- login. NO polling.

create table if not exists public.live_session_orders (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  session_date  date not null,            -- Asia/Taipei calendar day (taipeiDayId)
  buyer_number  int  not null,            -- per (user_id, session_date)
  handle        text not null default '', -- buyer @handle = buyer identity
  customer_name text not null default '',
  platform      text not null default '', -- TikTok / Facebook
  product       text not null default '', -- price code / item
  price         numeric not null default 0,
  created_at    timestamptz not null default now()
);

-- The only read pattern: this seller's rows for today.
create index if not exists idx_lso_user_day
  on public.live_session_orders(user_id, session_date);

alter table public.live_session_orders enable row level security;

-- A seller may only ever see / write their OWN rows.
create policy lso_select on public.live_session_orders
  for select using (user_id = auth.uid());
create policy lso_insert on public.live_session_orders
  for insert with check (user_id = auth.uid());
create policy lso_update on public.live_session_orders
  for update using (user_id = auth.uid());
create policy lso_delete on public.live_session_orders
  for delete using (user_id = auth.uid());
