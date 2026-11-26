-- sql/228 — Admin → Free tier list: the last order time of every FREE seller.
-- NOT APPLIED. Read-only for the app; changes no row, no setting, no existing function.
--
-- One new function, admin_free_tier_activity():
--   * SECURITY DEFINER (it reads public.orders across sellers), is_admin() FIRST:
--     a caller who is not an admin gets no rows (and nothing is read).
--   * one row per seller_profiles row with plan = 'free' (the same rows as
--     list_free_users_status): email + the newest public.orders.created_at of that
--     login (null = no stored order; public.orders keeps about 3 months).
--   * uses the existing index orders_user_created_idx (user_id, created_at desc).
--   * execute: authenticated only (never public / anon).
-- The app reads it ONCE when the Free tier panel opens (no timer). Before this file is
-- applied the panel still opens; it says the last order times could not be read.

create or replace function public.admin_free_tier_activity()
returns table(email text, last_order_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;

  return query
  select
    sp.email,
    (select max(o.created_at) from public.orders o where o.user_id = sp.auth_user_id) as last_order_at
  from public.seller_profiles sp
  where sp.plan = 'free';
end;
$$;

revoke all on function public.admin_free_tier_activity() from public;
revoke all on function public.admin_free_tier_activity() from anon;
grant execute on function public.admin_free_tier_activity() to authenticated;
