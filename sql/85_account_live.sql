-- 85 — Account total, Build 2: WHO MAY GO LIVE. NOT applied from the repo — the reviewer
-- applies it (section by section is fine: every section below is safe to run alone and
-- safe to run twice). Needs sql/84 first. Rollback: sql/85_account_live_rollback.sql.
--
-- RULE
--   One total per plan across TikTok usernames + Facebook Pages + Shopee shops (the same
--   numbers as Build 1: account_limit_for). When a seller has MORE registered accounts
--   than the plan allows, only the OLDEST N may go live, counted across all platforms.
--   "Oldest" = account_seats.added_at of the account's ACTIVE seat row (Build 1 keeps it:
--   reorder / case / spaces / @ change nothing; rename or remove-and-add-back = youngest).
--   An account with no active seat row ranks YOUNGEST. Ties: tiktok, facebook, shopee,
--   then the key. Admin (role admin) and account_limit_exempt are never refused.
--   Checked only when a NEW connect starts (the server skips already-running lives).
--
-- SWITCHES (app_settings, seed nothing; missing / anything but 'true' = log only)
--   account_live_enforce               refuse a not-covered account at connect
--   account_live_unregistered_enforce  refuse a TikTok connect to a name the seller never
--                                      registered (today allowed while the list is empty)
--   Log rows (account_limit_log): would_block 'live_not_covered' (used = rank, lim = limit)
--   or 'live_unregistered' (lim = limit). Never a name, Page/shop id, token or comment.
--
-- ERRORS — account_live_check never raises: any internal error → {allowed:true, error}.
--
-- Section 5 is a ONE-TIME backfill (idempotent): accounts that existed before sql/84 get
-- an ACTIVE seat row with no lock — TikTok: seller_profiles.created_at + list position
-- × 1 ms; Pages / shops: their created_at. Existing seat rows are never touched.


-- ── 1) the switches ───────────────────────────────────────────────────────────
create or replace function public.account_switch_on(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select value into v from public.app_settings where key = p_key;
  return lower(btrim(coalesce(v, ''))) = 'true';
exception when others then
  return false;
end;
$$;
revoke all on function public.account_switch_on(text) from public, anon, authenticated;


-- ── 2) the ranking — every registered account of one seller, oldest first ────
-- TikTok keys come from the stored list through Build 1's account_tiktok_keys (the one
-- normalization); Pages / shops from their tables. added_at from the ACTIVE seat row.
create or replace function public.account_live_ranking(p_user uuid)
returns table (platform text, account_key text, added_at timestamptz, rank int)
language sql stable security definer set search_path = public as $$
  with acc as (
    select 'tiktok'::text as platform, k as account_key
      from unnest(public.account_tiktok_keys((select sp.tiktok from public.seller_profiles sp where sp.auth_user_id = p_user))) k
    union all
    select 'facebook', f.page_id::text from public.fb_pages f where f.user_id = p_user
    union all
    select 'shopee', s.shop_id::text from public.shopee_shops s where s.user_id = p_user
  )
  select a.platform, a.account_key, st.added_at,
         (row_number() over (order by coalesce(st.added_at, 'infinity'::timestamptz),
                                      case a.platform when 'tiktok' then 1 when 'facebook' then 2 else 3 end,
                                      a.account_key))::int
    from acc a
    left join public.account_seats st
      on st.user_id = p_user and st.platform = a.platform and st.account_key = a.account_key and st.removed_at is null;
$$;
revoke all on function public.account_live_ranking(uuid) from public, anon, authenticated;


-- ── 3) the connect check (the server asks this once per NEW connect) ─────────
-- p_platform: 'tiktok' | 'facebook' | 'shopee'; p_key: the TikTok name as typed / the
-- Page id / the shop id. The caller's own account only (auth.uid()).
create or replace function public.account_live_check(p_platform text, p_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_enf     boolean;
  v_unreg   boolean;
  v_plan    text;
  v_role    text;
  v_limit   int;
  v_key     text;
  v_rank    int;
  v_plat    text := lower(btrim(coalesce(p_platform, '')));
begin
  if v_uid is null then return jsonb_build_object('allowed', true, 'error', 'no_user'); end if;
  v_enf   := public.account_switch_on('account_live_enforce');
  v_unreg := public.account_switch_on('account_live_unregistered_enforce');
  select sp.plan, sp.role into v_plan, v_role from public.seller_profiles sp where sp.auth_user_id = v_uid;
  if lower(coalesce(v_role, '')) = 'admin'
     or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid) then
    return jsonb_build_object('allowed', true, 'covered', true, 'registered', true, 'exempt', true,
                              'enforce', v_enf, 'unregistered_enforce', v_unreg);
  end if;
  v_key := case when v_plat = 'tiktok' then (public.account_tiktok_keys(p_key))[1] else btrim(coalesce(p_key, '')) end;
  if v_key is null or v_key = '' then                       -- empty name: the route's own 400
    return jsonb_build_object('allowed', true, 'registered', false, 'enforce', v_enf, 'unregistered_enforce', v_unreg);
  end if;
  v_limit := public.account_limit_for(v_plan);
  select r.rank into v_rank from public.account_live_ranking(v_uid) r
   where r.platform = v_plat and r.account_key = v_key;
  if v_rank is null then
    if v_plat <> 'tiktok' then                               -- Page / shop rows are checked by the route
      return jsonb_build_object('allowed', true, 'registered', false, 'enforce', v_enf, 'unregistered_enforce', v_unreg);
    end if;
    insert into public.account_limit_log (user_id, platform, would_block, used, lim)
    values (v_uid, v_plat, 'live_unregistered', null, v_limit);
    return jsonb_build_object('allowed', not v_unreg, 'registered', false, 'limit', v_limit,
                              'enforce', v_enf, 'unregistered_enforce', v_unreg);
  end if;
  if v_rank > v_limit then
    insert into public.account_limit_log (user_id, platform, would_block, used, lim)
    values (v_uid, v_plat, 'live_not_covered', v_rank, v_limit);
    return jsonb_build_object('allowed', not v_enf, 'registered', true, 'covered', false,
                              'rank', v_rank, 'limit', v_limit, 'enforce', v_enf, 'unregistered_enforce', v_unreg);
  end if;
  return jsonb_build_object('allowed', true, 'registered', true, 'covered', true,
                            'rank', v_rank, 'limit', v_limit, 'enforce', v_enf, 'unregistered_enforce', v_unreg);
exception when others then
  return jsonb_build_object('allowed', true, 'error', sqlstate);
end;
$$;
revoke all on function public.account_live_check(text, text) from public, anon;
grant execute on function public.account_live_check(text, text) to authenticated;


-- ── 4) the seller's own coverage (the app: picker order, Manage view, labels) ─
-- {enforce, limit, unlimited, total, accounts:[{platform, key, rank, covered}]}.
-- null when there is no session or on any error (the app then behaves as today).
create or replace function public.account_live_coverage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_role  text;
  v_limit int;
  v_unl   boolean;
  v_acc   jsonb;
begin
  if v_uid is null then return null; end if;
  select sp.plan, sp.role into v_plan, v_role from public.seller_profiles sp where sp.auth_user_id = v_uid;
  v_limit := public.account_limit_for(v_plan);
  v_unl   := lower(coalesce(v_role, '')) = 'admin'
             or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('platform', r.platform, 'key', r.account_key, 'rank', r.rank,
                                               'covered', v_unl or r.rank <= v_limit) order by r.rank), '[]'::jsonb)
    into v_acc from public.account_live_ranking(v_uid) r;
  return jsonb_build_object('enforce', public.account_switch_on('account_live_enforce'),
                            'limit', v_limit, 'unlimited', v_unl,
                            'total', jsonb_array_length(v_acc), 'accounts', v_acc);
exception when others then
  return null;
end;
$$;
revoke all on function public.account_live_coverage() from public, anon;
grant execute on function public.account_live_coverage() to authenticated;


-- ── 5) one-time backfill: accounts older than sql/84 get an ACTIVE seat row ──
-- Idempotent: on conflict do nothing (an existing seat row, active or vacated, is never
-- touched; a second run inserts nothing). No lock. Rows whose user no longer exists are
-- skipped (account_seats references auth.users).
insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
select t.user_id, 'tiktok', t.k, t.created_at + (t.pos * interval '1 millisecond'), null, null, null
  from (
    select sp.auth_user_id as user_id, sp.created_at, n.k,
           (row_number() over (partition by sp.auth_user_id order by min(n.ord)) - 1)::int as pos
      from public.seller_profiles sp
      cross join lateral (
        select (public.account_tiktok_keys(x.part))[1] as k, x.ord
          from regexp_split_to_table(coalesce(sp.tiktok, ''), '[,' || chr(10) || ']') with ordinality as x(part, ord)
      ) n
     where n.k is not null
       and sp.auth_user_id is not null
       and exists (select 1 from auth.users u where u.id = sp.auth_user_id)
     group by sp.auth_user_id, sp.created_at, n.k
  ) t
on conflict (user_id, platform, account_key) do nothing;

insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
select f.user_id, 'facebook', f.page_id::text, f.created_at, null, null, null
  from public.fb_pages f
 where exists (select 1 from auth.users u where u.id = f.user_id)
on conflict (user_id, platform, account_key) do nothing;

insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
select s.user_id, 'shopee', s.shop_id::text, s.created_at, null, null, null
  from public.shopee_shops s
 where exists (select 1 from auth.users u where u.id = s.user_id)
on conflict (user_id, platform, account_key) do nothing;
