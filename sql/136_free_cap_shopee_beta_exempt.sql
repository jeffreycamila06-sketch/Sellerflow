-- ============================================================================
-- sql/136 — FREE-TIER ORDER CAP: exempt Shopee orders of an ACTIVE Shopee-beta seller.
-- MIRROR ONLY — NOT APPLIED. chat-Claude applies via MCP after review. Needs sql/135 first
-- (the shopee_beta table). Rollback: sql/136_free_cap_shopee_beta_exempt_rollback.sql.
-- ============================================================================
-- Owner decision (2026-10-27): during the Shopee Live beta, an order with platform = 'Shopee'
-- by a user who has a shopee_beta row with expires_at > now() is NEITHER blocked by the free
-- cap NOR counted against it. Everything else in check_and_increment_free_order() is
-- byte-identical to the LIVE definition (read from production on 2026-10-27 — the lifetime
-- variant, cap = free_tier_cap() = 20, near = 15; NOT the older rolling-30-day text in sql/04).
--
-- The ONLY change = the block marked "sql/136" below, placed right after the free-plan early
-- exit, so paid users keep the same single SELECT and the same path as before; a free seller
-- pays one extra EXISTS only when the order's platform is 'Shopee'. The function is
-- SECURITY DEFINER, so the shopee_beta read ignores RLS (sellers can only SELECT their own
-- row anyway). A NULL platform (legacy rows) is never 'Shopee' → unchanged.
--
-- BEFORE (live):                              AFTER (this file):
--   select plan, free_orders_count …           select plan, free_orders_count …
--   if user_plan is null or <> 'free' then     if user_plan is null or <> 'free' then
--     return new; end if;                        return new; end if;
--                                              if new.platform = 'Shopee' and exists (shopee_beta
--                                                 row, expires_at > now()) then return new; end if;
--   cap := free_tier_cap(); … (unchanged)      cap := free_tier_cap(); … (unchanged)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_and_increment_free_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  user_plan     text;
  current_count integer;
  cap           integer;
begin
  select plan, free_orders_count
    into user_plan, current_count
  from public.seller_profiles
  where auth_user_id = new.user_id;

  if user_plan is null or user_plan <> 'free' then
    return new;
  end if;

  -- sql/136: Shopee Live beta — a Shopee order by a seller whose beta window is active is
  -- neither blocked nor counted (the client mirrors this in freeCapAppliesTo).
  if new.platform = 'Shopee' and exists (
    select 1 from public.shopee_beta b
    where b.user_id = new.user_id and b.expires_at > now()
  ) then
    return new;
  end if;

  cap := public.free_tier_cap();

  if current_count >= cap then
    raise exception 'free_tier_cap_reached'
      using errcode = 'P0001',
            hint = 'Free tier ' || cap || '-order lifetime limit reached';
  end if;

  update public.seller_profiles
    set free_orders_count = free_orders_count + 1
    where auth_user_id = new.user_id;

  return new;
end;
$function$;

-- The trigger itself is unchanged (BEFORE INSERT ON public.orders FOR EACH ROW).
-- Verify:
--   select pg_get_functiondef('public.check_and_increment_free_order()'::regprocedure);
--   -- as a free beta seller: an orders INSERT with platform='Shopee' must succeed at/over the cap
--   -- and leave seller_profiles.free_orders_count unchanged; platform='TikTok' still counts/blocks.
