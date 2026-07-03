-- 09_shipping_entries.sql
-- 7-11 交貨便 shipping export (P1) — one row per BUYER GROUP per session window
-- ("one bag = one buyer group = one Excel row = one 寄件單"). Applied to prod via
-- MCP (not from code) — same flow as 06/08.
--
-- Egress shape: ONE select per Shipping-screen open (rows for the current
-- session_key) + one upsert per encode save. ZERO poll. Production App.tsx never
-- reads this table (additive only).
--
-- session_key = the live-session window key ("<windowStart>~<N>d" for an active
-- multi-day window, else the Taipei day id) — groups consolidate across a 2/3-day
-- window exactly like the buyer numbers do.
--
-- status lifecycle: draft → encoded → exported. P2 adds the plan-quota RPC
-- check_and_export_shipping(entry_ids uuid[]) (SECURITY DEFINER, counts exported
-- rows in a 30-day SLIDING window: exported_at >= now() - interval '30 days').

create table if not exists public.shipping_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  session_key        text not null,
  buyer_number       int  not null,
  bag_number         int  not null default 1,          -- splits (P3): 1/2, 2/2 …
  included_order_ids jsonb not null default '[]',      -- orderNum epoch-ms list
  recipient_name     text,
  phone              text,
  store_id           text,
  temp_layer         text not null default '常溫',
  product_desc       text,                             -- auto-gen, seller-editable, ≤200
  order_amount       numeric not null default 0,
  shipping_fee       numeric not null default 60,
  buyer_username     text,
  status             text not null default 'draft',    -- draft → encoded → exported
  export_batch_id    uuid,
  exported_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One entry per (user, session window, buyer, bag) — the upsert target.
create unique index if not exists shipping_entries_group_key
  on public.shipping_entries (user_id, session_key, buyer_number, bag_number);

alter table public.shipping_entries enable row level security;

-- A seller may only ever see / write their OWN rows.
create policy shp_select on public.shipping_entries
  for select using (user_id = auth.uid());
create policy shp_insert on public.shipping_entries
  for insert with check (user_id = auth.uid());
create policy shp_update on public.shipping_entries
  for update using (user_id = auth.uid());
create policy shp_delete on public.shipping_entries
  for delete using (user_id = auth.uid());
