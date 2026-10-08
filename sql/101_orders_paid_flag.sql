-- ============================================================================
-- sql/101 — paid flag on a live order (B2): live_session_orders.paid_at + its switch.
-- ============================================================================
-- NOT APPLIED. Order: any time (independent of 99 / 100). Additive, nullable, no backfill.
-- paid_at is set ONLY by a later update (Orders → Mark paid / Unpaid); the order insert never
-- names it, so creating orders is unchanged. live_session_orders already grants the owner
-- update and its row policy lso_update (user_id = auth.uid()) covers every column, so the new
-- column needs no grant, policy or RPC. Nothing is ever sent to a buyer.
-- app_settings orders_paid_flag_enabled = 'false' (only the exact string 'true' is on).
-- Rollback: sql/101_orders_paid_flag_rollback.sql.
-- ============================================================================
alter table public.live_session_orders add column if not exists paid_at timestamptz;

insert into public.app_settings (key, value) values ('orders_paid_flag_enabled', 'false')
on conflict (key) do nothing;
