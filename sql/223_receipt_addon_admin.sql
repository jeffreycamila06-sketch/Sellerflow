-- 223 — ADMIN "RECEIPT ADD-ON" LIST (Jeff, 2026-11-26). NOT applied.
--
-- "Receipt add-on" = an enabled fb_receipt_access row (sql/73). No new table, no new column, no
-- price, no date of its own: the add-on simply ends with the seller's plan (plan_expiry).
-- Three admin-only functions for Admin → Controls → Receipt add-on:
--   admin_receipt_addon_list()              every ENABLED row + the seller's shop / email / plan
--   admin_receipt_addon_set(email, on, note) on = insert or re-enable · off = enabled false (row kept)
--   admin_receipt_addon_note(user, note)    edit the note of an existing row
-- Each one asks is_admin() FIRST and does nothing for anyone else (list → [], writes →
-- {ok:false, error:'not_admin'}). SECURITY DEFINER because browser roles have no access to
-- fb_receipt_access at all (sql/73 revoked it); anon cannot call them, authenticated can.
--
-- This file changes NO row of fb_receipt_access and NO app_settings value. The server's own read
-- (server.js hasReceiptAccess: enabled = true) is unchanged — "Remove" here = that read says no.
-- Re-enabling a removed row keeps its first created_at (the "since" date stays the first one).
-- Rollback: sql/223_receipt_addon_admin_rollback.sql (drops the three functions).

begin;

create or replace function public.admin_receipt_addon_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_admin(), false) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id',     a.user_id,
             'email',       p.email,
             'shop',        nullif(btrim(p.store_name), ''),
             'plan',        p.plan,
             'plan_status', p.plan_status,
             'plan_expiry', p.plan_expiry,
             'since',       a.created_at,
             'note',        a.note)
           order by a.created_at desc, a.user_id)
      from public.fb_receipt_access a
      left join public.seller_profiles p on p.auth_user_id = a.user_id
     where a.enabled
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_receipt_addon_set(p_email text, p_on boolean, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_was  boolean;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
begin
  if not coalesce(public.is_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  select p.auth_user_id into v_user
    from public.seller_profiles p
   where lower(btrim(p.email)) = lower(btrim(coalesce(p_email, '')))
   limit 1;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select a.enabled into v_was from public.fb_receipt_access a where a.user_id = v_user;

  if coalesce(p_on, false) then
    if v_was is true then
      return jsonb_build_object('ok', true, 'result', 'already', 'user_id', v_user);
    end if;
    if v_was is null then
      insert into public.fb_receipt_access (user_id, enabled, note) values (v_user, true, v_note);
      return jsonb_build_object('ok', true, 'result', 'added', 'user_id', v_user);
    end if;
    update public.fb_receipt_access
       set enabled = true, note = coalesce(v_note, note)
     where user_id = v_user;
    return jsonb_build_object('ok', true, 'result', 'enabled', 'user_id', v_user);
  end if;

  if v_was is not true then
    return jsonb_build_object('ok', true, 'result', 'not_enabled', 'user_id', v_user);
  end if;
  update public.fb_receipt_access set enabled = false where user_id = v_user;
  return jsonb_build_object('ok', true, 'result', 'removed', 'user_id', v_user);
end;
$$;

create or replace function public.admin_receipt_addon_note(p_user uuid, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not coalesce(public.is_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  update public.fb_receipt_access
     set note = nullif(left(btrim(coalesce(p_note, '')), 200), '')
   where user_id = p_user;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_receipt_addon_list() from public, anon;
revoke all on function public.admin_receipt_addon_set(text, boolean, text) from public, anon;
revoke all on function public.admin_receipt_addon_note(uuid, text) from public, anon;
grant execute on function public.admin_receipt_addon_list() to authenticated;
grant execute on function public.admin_receipt_addon_set(text, boolean, text) to authenticated;
grant execute on function public.admin_receipt_addon_note(uuid, text) to authenticated;

commit;
