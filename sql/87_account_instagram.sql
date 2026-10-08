-- 87 — Instagram Live, phase 1 (admin / preview only): the Instagram account table, the
-- tester list, the ig_enabled switch (OFF), and the account total (sql/84 + sql/85)
-- counting Instagram accounts too. NOT applied from the repo — the reviewer applies it.
-- Needs sql/84 and sql/85 first. Rollback: sql/87_account_instagram_rollback.sql.
-- NO Render deploy is needed for this file itself (the server half is separate).
--
-- Every section is safe to run twice. Run the sections in order: sections 3–7 use the
-- table from section 1 (each one alone, on a database that already has section 1, is safe).
-- Nothing here is a backfill: no ig_accounts row exists before this file.
--
-- What the account total gains (TikTok / Facebook / Shopee behaviour is unchanged):
--   • account_seats accepts platform 'instagram'
--   • account_total_used + account_quota count ig_accounts rows
--   • a NEW ig_accounts row is checked like a new Facebook Page; an existing
--     (user, ig_user_id) row is a re-authorization and passes
--   • deleting an ig_accounts row vacates its seat (key = ig_user_id)
--   • account_live_ranking lists Instagram accounts; tie-break order tiktok 1,
--     facebook 2, shopee 3, instagram 4 (existing ranks unchanged)
--   • account_live_check / account_live_coverage need no change (generic)


-- ── 1) tables + the switch ────────────────────────────────────────────────────
-- One row per Instagram professional account a seller authorized (found through a
-- Facebook Page it is linked to). access_token = AES-256-GCM ciphertext (server only).
create table if not exists public.ig_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  ig_user_id        text not null,
  ig_username       text,
  page_id           text,
  page_name         text,
  access_token      text,
  token_expires_at  timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, ig_user_id)
);
create index if not exists ig_accounts_user on public.ig_accounts (user_id);
create index if not exists ig_accounts_active_expiry on public.ig_accounts (active, token_expires_at);
alter table public.ig_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ig_accounts' and policyname = 'ig_accounts_select') then
    create policy ig_accounts_select on public.ig_accounts for select using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ig_accounts' and policyname = 'ig_accounts_delete') then
    create policy ig_accounts_delete on public.ig_accounts for delete using (user_id = (select auth.uid()));
  end if;
end
$$;
-- Browser roles: read own rows WITHOUT the token column, delete own rows. No insert /
-- update (only the server's service role writes).
revoke all on table public.ig_accounts from anon;
revoke all on table public.ig_accounts from authenticated;
grant select (id, user_id, ig_user_id, ig_username, page_id, page_name, token_expires_at, active,
  created_at, updated_at) on public.ig_accounts to authenticated;
grant delete on public.ig_accounts to authenticated;

-- Testers without a code change (like fb_tester_access): service role only.
create table if not exists public.ig_tester_access (
  email      text primary key check (email = lower(email)),
  enabled    boolean not null default true,
  note       text,
  created_at timestamptz default now()
);
alter table public.ig_tester_access enable row level security;
revoke all on table public.ig_tester_access from anon;
revoke all on table public.ig_tester_access from authenticated;

-- The switch stays OFF.
insert into public.app_settings (key, value) values ('ig_enabled', 'false')
  on conflict (key) do nothing;


-- ── 2) account_seats accepts 'instagram' ──────────────────────────────────────
-- Swaps the platform CHECK only when it does not already allow 'instagram'.
do $$
declare v_name text; v_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
    from pg_constraint c
   where c.conrelid = 'public.account_seats'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%platform%';
  if v_def is null or v_def not like '%instagram%' then
    if v_name is not null then
      execute format('alter table public.account_seats drop constraint %I', v_name);
    end if;
    alter table public.account_seats add constraint account_seats_platform_check
      check (platform in ('tiktok', 'facebook', 'shopee', 'instagram'));
  end if;
end
$$;


-- ── 3) counting: + Instagram accounts ─────────────────────────────────────────
create or replace function public.account_total_used(p_user uuid, p_tiktok_count int default null, p_extra int default 0)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p_tiktok_count,
           (select cardinality(public.account_tiktok_keys(sp.tiktok)) from public.seller_profiles sp where sp.auth_user_id = p_user), 0)
       + (select count(*)::int from public.fb_pages f where f.user_id = p_user)
       + (select count(*)::int from public.shopee_shops s where s.user_id = p_user)
       + (select count(*)::int from public.ig_accounts i where i.user_id = p_user)
       + public.account_locked_seats(p_user)
       + coalesce(p_extra, 0);
$$;
revoke all on function public.account_total_used(uuid, int, int) from public, anon, authenticated;


-- ── 4) a new Instagram account is an add; re-authorization passes ────────────
create or replace function public.account_total_ig_ins_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.ig_accounts i where i.user_id = new.user_id and i.ig_user_id = new.ig_user_id) then return new; end if;
  perform public.account_total_run(new.user_id, 'instagram', array[new.ig_user_id::text], '{}', null, 1);
  return new;
end;
$$;
revoke all on function public.account_total_ig_ins_trg() from public, anon, authenticated;
create or replace trigger trg_ig_accounts_account_total before insert on public.ig_accounts
  for each row execute function public.account_total_ig_ins_trg();
create or replace trigger trg_ig_accounts_account_total_del after delete on public.ig_accounts
  for each row execute function public.account_total_del_trg('instagram');


-- ── 5) the vacated seat reads ig_user_id for 'instagram' ─────────────────────
-- Facebook / Shopee branches are unchanged.
create or replace function public.account_total_del_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;
  begin
    -- jsonb read: a direct old.shop_id on an fb_pages row would raise.
    perform public.account_seat_vacate(old.user_id, tg_argv[0],
      to_jsonb(old) ->> (case when tg_argv[0] = 'facebook' then 'page_id' when tg_argv[0] = 'instagram' then 'ig_user_id' else 'shop_id' end));
  exception when others then null;
  end;
  return old;
end;
$$;
revoke all on function public.account_total_del_trg() from public, anon, authenticated;


-- ── 6) the seller's own numbers: + Instagram ──────────────────────────────────
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
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  return jsonb_build_object(
    'plan', coalesce(v_plan, ''),
    'limit', public.account_limit_for(v_plan),
    'used', coalesce(v_tt, 0) + v_fb + v_sh + v_ig + v_lock,
    'unlimited', lower(coalesce(v_role, '')) = 'admin'
                 or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid),
    'tiktok', coalesce(v_tt, 0), 'facebook', v_fb, 'shopee', v_sh, 'instagram', v_ig,
    'locked', v_lock,
    'next_free_at', v_next);
end;
$$;
revoke all on function public.account_quota() from public, anon;
grant execute on function public.account_quota() to authenticated;


-- ── 7) who may go live: Instagram accounts in the ranking ────────────────────
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
    union all
    select 'instagram', i.ig_user_id::text from public.ig_accounts i where i.user_id = p_user
  )
  select a.platform, a.account_key, st.added_at,
         (row_number() over (order by coalesce(st.added_at, 'infinity'::timestamptz),
                                      case a.platform when 'tiktok' then 1 when 'facebook' then 2 when 'shopee' then 3 else 4 end,
                                      a.account_key))::int
    from acc a
    left join public.account_seats st
      on st.user_id = p_user and st.platform = a.platform and st.account_key = a.account_key and st.removed_at is null;
$$;
revoke all on function public.account_live_ranking(uuid) from public, anon, authenticated;
