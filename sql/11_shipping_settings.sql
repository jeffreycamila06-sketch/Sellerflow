-- 11_shipping_settings.sql
-- P3b — per-seller shipping defaults, DB-BACKED (cross-device; replaces the
-- per-device localStorage sfl_rd_ship_fee as source of truth). Mirrors the
-- seller_session_config / raffle_config pattern: user_id PK, RLS scoped to the
-- signed-in user. Apply via Supabase MCP (not from code). ADDITIVE ONLY —
-- production never had this table; App.tsx never reads it.
--
-- Egress shape: ONE read per Shipping-screen open (folded into the existing
-- load) + one upsert per settings change. ZERO poll.
--
--   default_fee    — the fee prefilled into NEW entries and restored by the
--                    Free-shipping toggle (0 ↔ default_fee). Factory NT$38 =
--                    the standard OPEN POINT/賣貨便 fee (NOT a promo).
--                    Client clamps to the 賣貨便 range 0–100.
--   free_threshold — free-shipping auto-rule: when set (non-null), buyer
--                    groups whose ORDER TOTAL ≥ threshold get fee 0 at encode.
--                    NULL = rule OFF (the default). The ≥NT$55 row-total rule
--                    still validates — a qualifying group below 55 total is
--                    blocked at save like any other entry.

create table if not exists public.seller_shipping_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  default_fee    numeric not null default 38,
  free_threshold numeric null,
  updated_at     timestamptz not null default now()
);

alter table public.seller_shipping_settings enable row level security;

-- A seller may only ever see / write their OWN row.
create policy sss_select on public.seller_shipping_settings
  for select using (user_id = auth.uid());
create policy sss_insert on public.seller_shipping_settings
  for insert with check (user_id = auth.uid());
create policy sss_update on public.seller_shipping_settings
  for update using (user_id = auth.uid());
