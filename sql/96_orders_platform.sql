-- ============================================================================
-- sql/96 — orders.platform (sales per platform over 2 months). Additive only.
-- ============================================================================
-- ⚠️ APPLY BEFORE THE WEB DEPLOY. The new web code sends `platform` on every order insert;
-- if this column does not exist yet, that insert fails (column not found) — and public.orders
-- is the billing ledger the free-tier cap counts. NOT APPLIED. Jeff applies via Supabase MCP.
--
-- One nullable column. Old rows stay NULL (they count only in "All"). Old app bundles omit
-- the column → NULL. The CHECK allows NULL and the four live platforms only.
-- Nothing else changes: the free-tier trigger (trg_orders_free_tier_check) reads only
-- new.user_id; RLS is row-level; INSERT is granted on the whole table (no column grants).
-- Rollback: sql/96_orders_platform_rollback.sql.
-- ============================================================================

alter table public.orders add column if not exists platform text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_platform_check') then
    alter table public.orders add constraint orders_platform_check
      check (platform is null or platform in ('TikTok', 'Facebook', 'Shopee', 'Instagram'));
  end if;
end $$;
