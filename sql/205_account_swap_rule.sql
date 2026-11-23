-- 205 — ACCOUNT LIMITS V2: the 4-hour rule becomes "the first swap is free" (Jeff, 2026-11-22; replaces
-- rule (b) of sql/199). NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff).
-- Rollback: sql/205_account_swap_rule_rollback.sql. Needs sql/199 (live). Proof: scripts/sql205-behaviour.mjs (PGlite).
--
-- WHY: with rule (b) every removal held its place for 4 hours, so even the FIRST swap waited. A seller who
-- has to move platform right now (TikTok restricted → Shopee / Facebook) could not go live.
--
-- THE RULE NOW (= the rule every seller already has for TikTok names, Pages, Instagram accounts and
-- official Shopee shops since sql/84, now also for the sellers of account_limits_v2 and their paste-link
-- Shopee shops):
--   - Removing an account and adding a DIFFERENT one is immediate.
--   - The account that took a removed account's place is locked for 4 hours (account_seats.lock_until, set
--     by account_total_guard — not changed here). If it is removed inside those 4 hours, its place stays
--     used until they end: a different new account is refused ('locked' / account_limit) until then.
--   - The same account coming back is immediate. A removal never starts a wait — an admin's neither.
--     Admins and exempt sellers have no limit.
--
-- CHANGED (2 functions; each = the live text read 2026-11-22 with only the lines named; md5 pinned below)
--   account_seat_vacate   back to sql/84's text, word for word: the v2 lines that started a 4-hour wait at
--                         every removal are gone. For a seller who is NOT in v2 this is exactly what the
--                         live function already did (its v2 lines never ran for them).
--   my_account_list       + one key per account: 'lock_until' = the end of that account's own 4 hours
--                         (null when it has none, and for an admin / exempt seller). The app shows
--                         "Wait a little" with the time left instead of removing such an account.
-- NOT CHANGED: account_total_guard / run, every trigger, shopee_link_register, account_total_used,
--   account_quota, account_live_ranking, the admin functions, the switch, the preview list, every grant.
--
-- A place that is waiting under rule (b) when this file is applied keeps that wait until it ends (at most
-- 4 hours; today only the preview login and admins' sellers can have one).
begin;
set local lock_timeout = '3s';

-- ── 0) the live texts this file replaces (a = live 2026-11-22 = sql/199, b = this file) ───────────────
do $guard$
declare r record;
begin
  for r in select * from (values
    ('account_seat_vacate', 'b0f298426d92f479ee8a0c4d2c252ae0', 'c7df657990d6a5f1a866dcfc3ba1e69d'),
    ('my_account_list',     '9a1825fcd130308a84a99db83eac6feb', 'e58b41f6d2f1c4234e16ec0243172cd0')
  ) as t(fn, a, b) loop
    if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                    where ns.nspname = 'public' and p.proname = r.fn and md5(p.prosrc) in (r.a, r.b)) then
      raise exception 'sql/205: public.% is not the text this file was made from — nothing was changed', r.fn;
    end if;
  end loop;
end $guard$;

-- ── 1) a removal never starts a wait (sql/84's text) ───────────────────────────────────────────────
create or replace function public.account_seat_vacate(p_user uuid, p_platform text, p_key text)
returns void language sql security definer set search_path = public as $$
  insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
  values (p_user, p_platform, p_key, now(), now(), null, null)
  on conflict (user_id, platform, account_key) do update set removed_at = now(), replaced_at = null;
$$;
revoke all on function public.account_seat_vacate(uuid, text, text) from public, anon, authenticated;

-- ── 2) the seller's own accounts: + each account's own 4 hours ('lock_until') ──────────────────────
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
begin
  if v_uid is null then return null; end if;
  select sp.plan, sp.role into v_plan, v_role from public.seller_profiles sp where sp.auth_user_id = v_uid;
  v_limit := public.account_limit_for(v_plan);
  v_unl   := lower(coalesce(v_role, '')) = 'admin'
             or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid);
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', r.platform, 'key', r.account_key, 'rank', r.rank,
           'covered', v_unl or r.rank <= v_limit, 'added_at', r.added_at,
           'lock_until', case when v_unl then null else (
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
    'used', public.account_total_used(v_uid), 'locked', v_lock, 'next_free_at', v_next, 'now', now(),
    'accounts', v_acc);
exception when others then
  return null;
end;
$$;
revoke all on function public.my_account_list() from public, anon;
grant execute on function public.my_account_list() to authenticated;

commit;

-- Apply check (each true):
--   select md5(prosrc) = 'c7df657990d6a5f1a866dcfc3ba1e69d' from pg_proc where proname = 'account_seat_vacate';
--   select md5(prosrc) = 'e58b41f6d2f1c4234e16ec0243172cd0' from pg_proc where proname = 'my_account_list';
--   select has_function_privilege('authenticated', 'public.my_account_list()', 'execute');
--   select not has_function_privilege('authenticated', 'public.account_seat_vacate(uuid,text,text)', 'execute');
