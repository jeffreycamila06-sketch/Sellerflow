-- Rollback of sql/136 — restores the LIVE check_and_increment_free_order() exactly as read from
-- production on 2026-10-27 (no Shopee exemption). The trigger is untouched by both files.
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
