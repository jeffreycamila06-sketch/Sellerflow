-- 38 — AUTO MODE Rules 1/2/3: quantity + one-order-per-(session,handle,code) dedup.
-- ⚠️ REPO MIRROR of what is ALREADY APPLIED LIVE on production Supabase
-- (project sqeuyuktdpidmlfpqgoc) via MCP. Fetched byte-exact with
-- pg_get_functiondef / pg_indexes / information_schema so the repo matches prod.
-- ADDITIVE + reversible; production App.tsx ignores these (auto orders are a
-- redesign-only feature). Legacy/manual rows keep qty=1 / auto_code NULL.
--
-- Rule 2 (quantity): live_session_orders.qty. Rule 1 (dedup): auto_code + the
-- partial unique index — one auto order per (user, session, handle, code). Stock:
-- decrement_product_stock_by decrements by N atomically (own-scoped), rejecting
-- the WHOLE order (no partial) when stock < qty or qty is outside 1..99.

-- ── Columns (additive) ───────────────────────────────────────────────────────
alter table public.live_session_orders
  add column if not exists qty integer not null default 1;
alter table public.live_session_orders
  add column if not exists auto_code text;  -- NULL for manual / legacy / non-auto rows

-- ── Rule 1 hard guarantee: one auto order per (user, session, handle, code) ────
-- Case-insensitive on handle + code; scoped to a session instance; ignores every
-- legacy/manual row (auto_code NULL) and every pre-session row (session_id NULL).
-- The SECOND same-code write by the same buyer in the same session violates this
-- and fails harmlessly (the app treats the violation as a duplicate).
create unique index if not exists ux_lso_session_handle_code
  on public.live_session_orders
  using btree (user_id, session_id, lower(handle), lower(auto_code))
  where ((auto_code is not null) and (session_id is not null));

-- ── Quantity-aware atomic stock decrement (mirrors decrement_product_stock) ────
-- Own-scoped (auth.uid()); returns the NEW stock, or -1 when qty is outside 1..99
-- OR stock < qty (reject the whole order — NO partial fill). SECURITY DEFINER so
-- the RLS-owner update runs, but the auth.uid() + local_id predicate keeps it to
-- the caller's own product.
CREATE OR REPLACE FUNCTION public.decrement_product_stock_by(p_local_id bigint, p_qty integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stock integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return -1;
  end if;

  update public.products
     set stock = stock - p_qty,
         last_ordered_at = now(),
         updated_at = now()
   where user_id = auth.uid()
     and local_id = p_local_id
     and stock >= p_qty
  returning stock into v_stock;

  if not found then
    return -1;
  end if;

  return v_stock;
end;
$function$;

-- ── Rollback (reference) ──────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS public.ux_lso_session_handle_code;
--   DROP FUNCTION IF EXISTS public.decrement_product_stock_by(bigint, integer);
--   ALTER TABLE public.live_session_orders DROP COLUMN IF EXISTS auto_code;
--   ALTER TABLE public.live_session_orders DROP COLUMN IF EXISTS qty;
