-- 216 — FREE PLAN: no 4-hour lock on changing or removing the live account (Jeff, 2026-11-25).
-- NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff). Rollback: sql/216_free_no_account_lock_rollback.sql.
-- Proof: scripts/sql216-behaviour.mjs (PGlite). Database only: no table, no trigger, no setting, no row is changed.
--
-- THE RULE
--   A seller whose plan is 'free' can change the TikTok username, or remove the account and add a different
--   one (TikTok, Facebook Page, Instagram, Shopee shop), at any time, as many times as they want.
--   Paid plans: nothing changes — the same 4 hours as today. The plan at the moment of the action decides:
--   a free seller who upgrades gets the normal lock from the next change onward.
--   Still 1 account on the Free plan (account_limit_for — not touched).
--
-- HOW (one new function, six live functions changed — each = the live text read 2026-11-25 with only the
-- lines marked "sql/216"; md5 pinned below). "Free" is always read by the database from the seller's own row
-- (seller_profiles.plan — a seller cannot write it: seller_profiles_on_update puts it back), never from what
-- the app sends. A paid seller therefore cannot switch the lock off.
--   account_no_lock(plan)   NEW. true when the plan is 'free' (trimmed, any letter case). Nothing else.
--   touch_tiktok_slot       Free → no 'cooldown_active', and the slot's change time is not kept.
--   tiktok_slot_cooldowns   Free → answers no rows (the app then offers "Change" on every saved name).
--   account_total_guard     Free → the account that takes a removed account's place gets no lock_until.
--   account_locked_seats    Free → 0 (a lock left from before — a paid time, or before this file — holds no place).
--   my_account_list         Free → 'lock_until' null on every account, 'locked' 0, 'next_free_at' null,
--                           + one new key 'no_lock' (true for Free) so the app leaves the 4-hour sentence out.
--   account_quota           Free → 'locked' 0, 'next_free_at' null, and 'used' without held places.
-- NOT CHANGED: account_limit_for, account_lock_length, account_total_run / _used, account_seat_vacate, every
--   trigger, shopee_link_register (its 'locked' answer needs account_locked_seats > 0), the live rule
--   (account_live_check), every free-order rule (check_and_increment_free_order, free_account_save_check, the
--   free_account_* triggers and tables — an account whose free orders are used is still refused on a free
--   login), every grant, every app_settings value.
-- Safe to run twice (the second run writes the same texts). Either order with the web is safe.
begin;
set local lock_timeout = '3s';

-- ── 0) the live texts this file replaces (a = live 2026-11-25, b = this file) ───────────────────────
do $guard$
declare r record;
begin
  for r in select * from (values
    ('account_locked_seats',  'e61fe2ed48210f58d280ebe898b8f4da', '64ad0e4b42b480212411d5f94313654f'),
    ('account_total_guard',   '2651114c2a7bbc2e7ad2010cee972b1d', '7f19cedc7f7b141f4934276cf0285794'),
    ('my_account_list',       'e58b41f6d2f1c4234e16ec0243172cd0', 'ebf1f743efe45f24f35dffb603b6887e'),
    ('account_quota',         '408aca297609a19d83613850f0689be3', '4d63f874fb3c11e91558a0c56539e2ae'),
    ('touch_tiktok_slot',     'fbd2dcd3909b53906c963cbeb5d39cfa', 'e1124bcd0891e488f7a0b8fb68b423f3'),
    ('tiktok_slot_cooldowns', '9276e8db2e0b7508bbcf0cd33ff16a80', '7aa74ecac5133bad5874962f5c7ddcb5')
  ) as t(fn, a, b) loop
    if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                    where ns.nspname = 'public' and p.proname = r.fn and md5(p.prosrc) in (r.a, r.b)) then
      raise exception 'sql/216: public.% is not the text this file was made from — nothing was changed', r.fn;
    end if;
  end loop;
end $guard$;

-- ── 1) which plan has no lock ───────────────────────────────────────────────────────────────────────
create or replace function public.account_no_lock(p_plan text)
returns boolean language sql immutable as $$
  select lower(btrim(coalesce(p_plan, ''))) = 'free';
$$;

-- ── 2) the TikTok username: no 4-hour wait on the Free plan ─────────────────────────────────────────
create or replace function public.touch_tiktok_slot(p_platform text, p_slot_index smallint)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
DECLARE
  uid uuid := (select auth.uid());
  prev timestamptz;
  is_admin_caller boolean := public.is_admin();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_platform NOT IN ('tiktok','facebook') THEN
    RAISE EXCEPTION 'bad_platform';
  END IF;
  IF p_slot_index < 0 THEN
    RAISE EXCEPTION 'bad_slot';
  END IF;

  -- sql/216: Free plan → no 4-hour wait, and no change time is kept (the first change after an upgrade starts the wait).
  IF NOT is_admin_caller AND EXISTS (SELECT 1 FROM public.seller_profiles sp
                                      WHERE sp.auth_user_id = uid AND public.account_no_lock(sp.plan)) THEN
    DELETE FROM public.tiktok_account_changes
     WHERE user_id = uid AND platform = p_platform AND slot_index = p_slot_index;
    RETURN now();
  END IF;

  SELECT last_changed_at INTO prev
  FROM public.tiktok_account_changes
  WHERE user_id = uid AND platform = p_platform AND slot_index = p_slot_index;

  IF prev IS NOT NULL AND NOT is_admin_caller AND (now() - prev) < interval '4 hours' THEN
    RAISE EXCEPTION 'cooldown_active';
  END IF;

  INSERT INTO public.tiktok_account_changes (user_id, platform, slot_index, last_changed_at)
  VALUES (uid, p_platform, p_slot_index, now())
  ON CONFLICT (user_id, platform, slot_index)
  DO UPDATE SET last_changed_at = now();

  RETURN now();
END;
$$;
-- create or replace keeps the function's existing EXECUTE grants untouched.

create or replace function public.tiktok_slot_cooldowns()
returns table(platform text, slot_index smallint, last_changed_at timestamptz, server_now timestamptz)
language sql stable as $$
  SELECT c.platform, c.slot_index, c.last_changed_at, now() AS server_now
  FROM public.tiktok_account_changes c
  WHERE c.user_id = (select auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.seller_profiles sp          -- sql/216: Free plan → no wait to show
                     WHERE sp.auth_user_id = (select auth.uid()) AND public.account_no_lock(sp.plan));
$$;

-- ── 3) the account that takes a removed account's place: no lock on the Free plan ───────────────────
create or replace function public.account_total_guard(
  p_user uuid, p_platform text, p_added text[], p_removed text[],
  p_tiktok_after int, p_extra int, p_enforce boolean,
  p_row_plan text default null, p_row_role text default null, p_from_row boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_new    text[] := '{}';
  v_k      text;
  v_plan   text;
  v_role   text;
  v_limit  int;
  v_used   int;
  v_lock   int;
  v_reason text;
  v_seat   record;
  v_repl   boolean;
begin
  if p_user is null then return; end if;
  -- Serialize every add/remove for this seller: a second simultaneous add waits here,
  -- then recounts what the first one committed.
  perform pg_advisory_xact_lock(hashtextextended('account_total:' || p_user::text, 0));

  foreach v_k in array coalesce(p_removed, '{}') loop
    perform public.account_seat_vacate(p_user, p_platform, v_k);
  end loop;

  foreach v_k in array coalesce(p_added, '{}') loop
    -- (a) The same account back while its own lock runs: not new, lock unchanged.
    update public.account_seats set removed_at = null, replaced_at = null
     where user_id = p_user and platform = p_platform and account_key = v_k
       and removed_at is not null and lock_until > now();
    if not found then v_new := v_new || v_k; end if;
  end loop;

  if cardinality(v_new) = 0 then return; end if;   -- nothing genuinely new → no check

  -- (b) decide: admin / admin caller / exempt → never blocked.
  if p_from_row then
    v_plan := p_row_plan; v_role := p_row_role;
  else
    select plan, role into v_plan, v_role from public.seller_profiles where auth_user_id = p_user;
  end if;
  if not (public.is_admin()
          or lower(coalesce(v_role, '')) = 'admin'
          or exists (select 1 from public.account_limit_exempt e where e.user_id = p_user)) then
    v_limit := public.account_limit_for(v_plan);   -- no profile / empty plan → 1
    v_used  := public.account_total_used(p_user, p_tiktok_after, p_extra);
    if v_used > v_limit then
      v_lock   := public.account_locked_seats(p_user);
      v_reason := case when v_used - v_lock <= v_limit then 'seat_locked' else 'over_total' end;
      if p_enforce then
        raise exception 'account_limit'
          using errcode = 'P0001', detail = format('used=%s limit=%s reason=%s', v_used, v_limit, v_reason);
      end if;
      insert into public.account_limit_log (user_id, platform, would_block, used, lim)
      values (p_user, p_platform, v_reason, v_used, v_limit);
    end if;
  end if;

  -- (c) seats: a new account that takes a vacated, unlocked seat is a replacement and is
  -- locked; one that takes never-used capacity is not.
  foreach v_k in array v_new loop
    select platform, account_key into v_seat from public.account_seats
     where user_id = p_user and removed_at is not null and replaced_at is null
       and (lock_until is null or lock_until <= now())
     order by removed_at, added_at limit 1;
    v_repl := found;
    if v_repl then
      update public.account_seats set replaced_at = now()
       where user_id = p_user and platform = v_seat.platform and account_key = v_seat.account_key;
    end if;
    insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
    values (p_user, p_platform, v_k, now(), null,
            case when v_repl and not public.account_no_lock(v_plan) then now() + public.account_lock_length() end, null)   -- sql/216: Free plan → no lock
    on conflict (user_id, platform, account_key) do update
      set added_at = excluded.added_at, removed_at = null, replaced_at = null, lock_until = excluded.lock_until;
  end loop;
end;
$$;
revoke all on function public.account_total_guard(uuid, text, text[], text[], int, int, boolean, text, text, boolean) from public, anon, authenticated;

create or replace function public.account_locked_seats(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.seller_profiles sp
                            where sp.auth_user_id = p_user and public.account_no_lock(sp.plan)) then 0 else (   -- sql/216: Free plan → no held place
  select count(*)::int from public.account_seats a
   where a.user_id = p_user and a.removed_at is not null and a.replaced_at is null and a.lock_until > now()) end;
$$;
revoke all on function public.account_locked_seats(uuid) from public, anon, authenticated;

-- ── 4) what the app reads: no lock for the Free plan ────────────────────────────────────────────────
create or replace function public.my_account_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_role  text;
  v_limit int;
  v_unl   boolean;
  v_lock  int;
  v_next  timestamptz;
  v_acc   jsonb;
  v_free  boolean;   -- sql/216: Free plan → no lock
begin
  if v_uid is null then return null; end if;
  select sp.plan, sp.role into v_plan, v_role from public.seller_profiles sp where sp.auth_user_id = v_uid;
  v_limit := public.account_limit_for(v_plan);
  v_free  := public.account_no_lock(v_plan);
  v_unl   := lower(coalesce(v_role, '')) = 'admin'
             or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid);
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  if v_free then v_lock := 0; v_next := null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', r.platform, 'key', r.account_key, 'rank', r.rank,
           'covered', v_unl or r.rank <= v_limit, 'added_at', r.added_at,
           'lock_until', case when v_unl or v_free then null else (
                           select st.lock_until from public.account_seats st
                            where st.user_id = v_uid and st.platform = r.platform and st.account_key = r.account_key
                              and st.removed_at is null and st.lock_until > now() limit 1) end,
           'link', r.platform = 'shopee' and position(':' in r.account_key) > 0,
           'id', case r.platform
                   when 'facebook'  then (select f.id::text from public.fb_pages f where f.user_id = v_uid and f.page_id::text = r.account_key limit 1)
                   when 'instagram' then (select i.id::text from public.ig_accounts i where i.user_id = v_uid and i.ig_user_id::text = r.account_key limit 1)
                   when 'shopee'    then coalesce(
                                           (select s.id::text from public.shopee_shops s where s.user_id = v_uid and s.shop_id::text = r.account_key limit 1),
                                           (select l.id::text from public.shopee_link_shops l where l.user_id = v_uid and l.region || ':' || l.shopee_uid = r.account_key limit 1))
                   else null end,
           'name', case r.platform
                   when 'facebook'  then (select nullif(btrim(f.page_name), '') from public.fb_pages f where f.user_id = v_uid and f.page_id::text = r.account_key limit 1)
                   when 'instagram' then (select coalesce(nullif(btrim(i.ig_username), ''), nullif(btrim(i.page_name), '')) from public.ig_accounts i where i.user_id = v_uid and i.ig_user_id::text = r.account_key limit 1)
                   when 'shopee'    then coalesce(
                                           (select nullif(btrim(s.shop_name), '') from public.shopee_shops s where s.user_id = v_uid and s.shop_id::text = r.account_key limit 1),
                                           (select nullif(btrim(l.shop_name), '') from public.shopee_link_shops l where l.user_id = v_uid and l.region || ':' || l.shopee_uid = r.account_key limit 1))
                   else r.account_key end) order by r.rank), '[]'::jsonb)
    into v_acc from public.account_live_ranking(v_uid) r;
  return jsonb_build_object(
    'v2', public.account_limits_v2_on(v_uid),
    'plan', coalesce(v_plan, ''), 'limit', v_limit, 'unlimited', v_unl,
    'used', public.account_total_used(v_uid), 'locked', v_lock, 'next_free_at', v_next, 'now', now(), 'no_lock', v_free,
    'accounts', v_acc);
exception when others then
  return null;
end;
$$;
revoke all on function public.my_account_list() from public, anon;
grant execute on function public.my_account_list() to authenticated;

create or replace function public.account_quota()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_role  text;
  v_tt    int;
  v_fb    int;
  v_sh    int;
  v_ig    int;
  v_sl    int := 0;
  v_lock  int;
  v_next  timestamptz;
begin
  if v_uid is null then return null; end if;
  select plan, role, cardinality(public.account_tiktok_keys(tiktok))
    into v_plan, v_role, v_tt
    from public.seller_profiles where auth_user_id = v_uid;
  select count(*)::int into v_fb from public.fb_pages where user_id = v_uid;
  select count(*)::int into v_sh from public.shopee_shops where user_id = v_uid;
  select count(*)::int into v_ig from public.ig_accounts where user_id = v_uid;
  if public.account_limits_v2_on(v_uid) then
    select count(*)::int into v_sl from public.shopee_link_shops where user_id = v_uid;
  end if;
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  if public.account_no_lock(v_plan) then v_lock := 0; v_next := null; end if;   -- sql/216: Free plan → no held place
  return jsonb_build_object(
    'plan', coalesce(v_plan, ''),
    'limit', public.account_limit_for(v_plan),
    'used', coalesce(v_tt, 0) + v_fb + v_sh + v_ig + v_sl + v_lock,
    'unlimited', lower(coalesce(v_role, '')) = 'admin'
                 or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid),
    'tiktok', coalesce(v_tt, 0), 'facebook', v_fb, 'shopee', v_sh + v_sl, 'instagram', v_ig,
    'locked', v_lock,
    'next_free_at', v_next);
end;
$$;
revoke all on function public.account_quota() from public, anon;
grant execute on function public.account_quota() to authenticated;

commit;

-- Apply check (each true):
--   select md5(prosrc) = '64ad0e4b42b480212411d5f94313654f' from pg_proc where proname = 'account_locked_seats';
--   select md5(prosrc) = '7f19cedc7f7b141f4934276cf0285794' from pg_proc where proname = 'account_total_guard';
--   select md5(prosrc) = 'ebf1f743efe45f24f35dffb603b6887e' from pg_proc where proname = 'my_account_list';
--   select md5(prosrc) = '4d63f874fb3c11e91558a0c56539e2ae' from pg_proc where proname = 'account_quota';
--   select md5(prosrc) = 'e1124bcd0891e488f7a0b8fb68b423f3' from pg_proc where proname = 'touch_tiktok_slot';
--   select md5(prosrc) = '7aa74ecac5133bad5874962f5c7ddcb5' from pg_proc where proname = 'tiktok_slot_cooldowns';
--   select public.account_no_lock('free') and public.account_no_lock(' Free ') and not public.account_no_lock('basic') and not public.account_no_lock(null);
--   select not has_function_privilege('authenticated', 'public.account_total_guard(uuid,text,text[],text[],integer,integer,boolean,text,text,boolean)', 'execute');
--   select not has_function_privilege('authenticated', 'public.account_locked_seats(uuid)', 'execute');
