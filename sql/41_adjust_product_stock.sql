-- 41_adjust_product_stock.sql
-- Quick manual stock edit (Products card − / +). Repo MIRROR of what is applied to
-- prod via Supabase MCP — do NOT re-apply blindly. ADDITIVE (a NEW function beside
-- the Auto-mode decrement RPCs; those are UNTOUCHED).
--
-- ⚠️ RACE SAFETY — this is the whole point of the RPC. The seller's manual +/-
-- taps and Auto-mode's order decrements both hit the SAME live stock. A naive
-- "read stock into JS, add 1, write back" would LOSE a concurrent auto-order's
-- decrement (oversell). This RPC does the delta as ONE atomic UPDATE
-- (stock = stock + p_delta) — Postgres row-locks the row, so a concurrent
-- decrement_product_stock(_by) and this adjust are serialized and each applies
-- EXACTLY once. Nothing is read into the client and written back.
--
-- Mirrors decrement_product_stock_by (sql/38): SECURITY DEFINER so the owner
-- UPDATE runs, but the `user_id = auth.uid()` predicate keeps it to the caller's
-- OWN product (own-scoped — never relies on RLS alone). Returns the NEW
-- authoritative stock, or -1 when the row isn't the caller's / doesn't exist.
--
-- Clamp: greatest(0, ...) — stock can NEVER go below 0 (a manual − at 0 is a no-op
-- returning 0). last_ordered_at is DELIBERATELY NOT touched: a manual correction is
-- not an order, so it must not move Auto-mode's product↔order link or the Part-2
-- stale-product purge cutoff.

CREATE OR REPLACE FUNCTION public.adjust_product_stock(p_local_id bigint, p_delta integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stock integer;
begin
  -- NULL guard + sane bound (a manual quick-edit is a small delta; reject garbage).
  if p_delta is null or p_delta < -100000 or p_delta > 100000 then
    return -1;
  end if;

  update public.products
     set stock = greatest(0, stock + p_delta),   -- atomic delta; clamp at 0
         updated_at = now()
   where user_id = auth.uid()
     and local_id = p_local_id
  returning stock into v_stock;

  if not found then
    return -1;   -- not owner / not found
  end if;

  return v_stock;
end;
$function$;

-- EXECUTE: authenticated only (Postgres grants to PUBLIC by default → revoke it).
revoke execute on function public.adjust_product_stock(bigint, integer) from public, anon;
grant  execute on function public.adjust_product_stock(bigint, integer) to authenticated;

-- Verify (as googletest): a +N then a -N returns to the start; a - at 0 stays 0;
--   SELECT public.adjust_product_stock(<local_id>::bigint,  5);   -- returns stock+5
--   SELECT public.adjust_product_stock(<local_id>::bigint, -5);   -- returns back to start
--   SELECT proname, prosecdef FROM pg_proc WHERE proname='adjust_product_stock'; -- prosecdef=true
-- Rollback:
--   DROP FUNCTION IF EXISTS public.adjust_product_stock(bigint, integer);
