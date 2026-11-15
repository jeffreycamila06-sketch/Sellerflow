-- sql/164 — INVITE FRIENDS: invite CODE + referral reward (free plan days for the INVITER only).
-- NOT APPLIED. Rollback: sql/164_invite_referral_rollback.sql. Behaviour check:
-- scripts/sql164-behaviour.mjs (PGlite). (163 is taken by the unmerged claude/seller-website.)
--
-- ADD-ONLY: new tables, new functions, ONE new AFTER trigger on seller_profiles. No existing
-- table, column, trigger or function is changed. NO Render deploy (web + database only).
--
-- THE RULES (Jeff, 2026-11-15):
--   * Each seller chooses their invite code ONCE (own word or a random one). 4–12 letters/numbers,
--     stored UPPERCASE, unique, case-insensitive. Reserved words = table referral_reserved_codes
--     (add one = one INSERT, no deploy). After saving the code never changes — only an admin
--     (admin_set_invite_code). The old code then stops working (kept in referral_code_retired so
--     nobody else can take it); friends already linked stay linked.
--   * A friend types the code at sign-up (optional) or later in Settings (no time limit, only while
--     they have no inviter AND have never had a paid plan). One inviter per account, permanent.
--     No self-invite.
--   * Reward: ONLY the inviter, ONLY when the friend gets their FIRST paid plan
--     (basic/plus/pro/master, plan_status 'active', plan_expiry > now()). The inviter must be
--     active paid at that moment, else 0 days (NOT saved for later). Days = invite_reward_months
--     for the Asia/Taipei month at that moment; not set / 0 → nothing (reason 'month_off').
--     inviter plan_expiry = greatest(plan_expiry, now()) + N days. Plan name unchanged.
--   * Admin can revoke: subtract exactly the days given.
--
-- HOW THE REWARD FIRES: trigger trg_seller_profiles_zzzz_referral_reward, AFTER UPDATE OF plan,
-- plan_status (named so it runs after the existing AFTER trigger ..._zzz_parcel_auto_access).
-- Any path that really changes a plan (admin UI, an admin RPC, manual SQL with the plan guard
-- off) ends in that UPDATE, so all of them are covered. It bumps ONLY the inviter's plan_expiry,
-- which is not one of its own columns → it never fires itself (no loop), and the parcel trigger
-- (OF plan, plan_status, country) and the TikTok-total trigger (fast path on tiktok) are not
-- touched by that update. The inviter's plan_expiry passes seller_profiles_on_update only when
-- the caller is an admin — the same caller that gave the friend's plan; if the guard reverted
-- it the referral is marked 'no_reward' / 'not_applied' (never a fake 'rewarded'). Any error
-- inside the trigger is caught: the plan change itself ALWAYS goes through.
--
-- "Ever had a paid plan" = referral_paid_seen (filled by the trigger, back-filled below from
-- every row that is on a paid plan now or has a plan_expiry — a free account with an expiry was
-- downgraded from a plan) OR the current plan is a paid plan name.
set lock_timeout = '2s';
begin;

-- ── tables (RLS on, NO policies: browser roles reach them only through the functions) ─────
create table if not exists public.referral_codes (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  code                text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  created_at          timestamptz not null default now(),
  changed_by_admin_at timestamptz,
  previous_code       text
);

create table if not exists public.referral_code_retired (
  code       text primary key,
  user_id    uuid references auth.users(id) on delete set null,
  retired_at timestamptz not null default now()
);

create table if not exists public.referral_reserved_codes (
  code text primary key check (code = upper(code))
);
insert into public.referral_reserved_codes(code) values
  ('ADMIN'), ('SELLERFLOW'), ('SELLERFLOWLIVE'), ('SFL'), ('SUPPORT'), ('HELP'), ('OFFICIAL'), ('TEST')
on conflict do nothing;

create table if not exists public.referrals (
  invitee_user_id uuid primary key references auth.users(id) on delete cascade,
  inviter_user_id uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  source          text not null check (source in ('signup', 'settings')),
  status          text not null default 'linked' check (status in ('linked', 'rewarded', 'no_reward', 'revoked')),
  reward_days     int not null default 0 check (reward_days >= 0),
  reward_month    date,
  rewarded_at     timestamptz,
  skip_reason     text,
  revoked_at      timestamptz,
  revoked_by      uuid,
  check (inviter_user_id is distinct from invitee_user_id)
);
create index if not exists referrals_inviter_idx on public.referrals (inviter_user_id, created_at desc);

create table if not exists public.invite_reward_months (
  month      date primary key check (extract(day from month) = 1),
  days       int not null check (days >= 0 and days <= 365),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.referral_paid_seen (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  first_paid_at timestamptz not null default now()
);

alter table public.referral_codes          enable row level security;
alter table public.referral_code_retired   enable row level security;
alter table public.referral_reserved_codes enable row level security;
alter table public.referrals               enable row level security;
alter table public.invite_reward_months    enable row level security;
alter table public.referral_paid_seen      enable row level security;
revoke all on public.referral_codes, public.referral_code_retired, public.referral_reserved_codes,
              public.referrals, public.invite_reward_months, public.referral_paid_seen
  from public, anon, authenticated;

-- Back-fill "ever had a paid plan" (see the header).
insert into public.referral_paid_seen (user_id, first_paid_at)
select sp.auth_user_id, coalesce(sp.created_at, now())
  from public.seller_profiles sp
 where sp.auth_user_id is not null
   and (lower(btrim(coalesce(sp.plan, ''))) in ('basic', 'plus', 'pro', 'master')
        or (sp.plan_expiry is not null and lower(btrim(coalesce(sp.plan, ''))) <> 'trial'))
on conflict do nothing;

-- ── small helpers ─────────────────────────────────────────────────────────────────────────
create or replace function public.referral_norm_code(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select upper(btrim(coalesce(p, '')))
$$;

create or replace function public.referral_is_paid_active(p_plan text, p_status text, p_expiry timestamptz)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select lower(btrim(coalesce(p_plan, ''))) in ('basic', 'plus', 'pro', 'master')
     and coalesce(p_status, '') = 'active'
     and p_expiry is not null and p_expiry > now()
$$;

-- First day of the Asia/Taipei month that `p_at` falls in (Nov 30 23:30 Taipei → Nov 1).
create or replace function public.referral_taipei_month(p_at timestamptz)
returns date language sql immutable set search_path = public, pg_temp as $$
  select date_trunc('month', p_at at time zone 'Asia/Taipei')::date
$$;

create or replace function public.referral_ever_paid(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.referral_paid_seen s where s.user_id = p_user)
      or exists (select 1 from public.seller_profiles sp where sp.auth_user_id = p_user
                   and lower(btrim(coalesce(sp.plan, ''))) in ('basic', 'plus', 'pro', 'master'))
$$;

-- '' = the code may be chosen; else 'format' | 'reserved' | 'taken'. `p_owner` = the user the
-- code would belong to (a code they themselves used before may come back, nobody else's).
create or replace function public.referral_code_problem(p_code text, p_owner uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when public.referral_norm_code(p_code) !~ '^[A-Z0-9]{4,12}$' then 'format'
    when exists (select 1 from public.referral_reserved_codes r where r.code = public.referral_norm_code(p_code)) then 'reserved'
    when exists (select 1 from public.referral_codes c where c.code = public.referral_norm_code(p_code)
                   and c.user_id is distinct from p_owner) then 'taken'
    when exists (select 1 from public.referral_code_retired x where x.code = public.referral_norm_code(p_code)
                   and x.user_id is distinct from p_owner) then 'taken'
    else '' end
$$;

-- 6 characters, uppercase, no 0 / O / 1 / I.
create or replace function public.referral_random_code()
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  i int;
begin
  for attempt in 1..50 loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    if public.referral_code_problem(v_code, null) = '' then return v_code; end if;
  end loop;
  raise exception 'no_random_code';
end $$;

create or replace function public.referral_mask_email(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p, '') = '' then '' else left(p, 3) || '…' end
$$;

-- ── seller / sign-up functions ────────────────────────────────────────────────────────────
-- Sign-up "Code found / Not found". Only true/false, never who owns it; never raises.
create or replace function public.check_invite_code(p_code text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.referral_norm_code(p_code) !~ '^[A-Z0-9]{4,12}$' then return false; end if;
  return exists (select 1 from public.referral_codes c where c.code = public.referral_norm_code(p_code));
exception when others then
  return false;
end $$;

-- Choose-code screen live check: '' = free to take, else 'format' | 'reserved' | 'taken'
-- (| 'not_signed_in').
create or replace function public.invite_code_available(p_code text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return 'not_signed_in'; end if;
  return public.referral_code_problem(p_code, auth.uid());
end $$;

-- Save MY code, once. p_code null/'' = a random code. → {ok:true, code} | {ok:false, reason}
-- reason: not_signed_in | no_profile | already_set | format | reserved | taken
create or replace function public.set_my_invite_code(p_code text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := auth.uid();
  v_code text;
  v_prob text;
  v_n    int;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if not exists (select 1 from public.seller_profiles where auth_user_id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;
  if exists (select 1 from public.referral_codes where user_id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'already_set');
  end if;
  if public.referral_norm_code(p_code) = '' then
    v_code := public.referral_random_code();
  else
    v_code := public.referral_norm_code(p_code);
    v_prob := public.referral_code_problem(v_code, v_me);
    if v_prob <> '' then return jsonb_build_object('ok', false, 'reason', v_prob); end if;
  end if;
  begin
    insert into public.referral_codes (user_id, code) values (v_me, v_code) on conflict (user_id) do nothing;
    get diagnostics v_n = row_count;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'already_set'); end if;
  delete from public.referral_code_retired where code = v_code and user_id = v_me;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- Link ME to the owner of p_code. → {ok:true} | {ok:false, reason}
-- reason: not_signed_in | bad_source | no_profile | not_found | self | already_linked | already_paid
create or replace function public.claim_referral(p_code text, p_source text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me      uuid := auth.uid();
  v_inviter uuid;
  v_n       int;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if coalesce(p_source, '') not in ('signup', 'settings') then
    return jsonb_build_object('ok', false, 'reason', 'bad_source');
  end if;
  -- Lock MY profile row: an admin giving me a plan at the same moment waits for this (or this
  -- waits for it and then sees the plan) — a link can never slip in after a first plan.
  perform 1 from public.seller_profiles where auth_user_id = v_me for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_profile'); end if;
  if exists (select 1 from public.referrals where invitee_user_id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;
  select c.user_id into v_inviter from public.referral_codes c where c.code = public.referral_norm_code(p_code);
  if v_inviter is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_inviter = v_me then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if public.referral_ever_paid(v_me) then return jsonb_build_object('ok', false, 'reason', 'already_paid'); end if;
  insert into public.referrals (invitee_user_id, inviter_user_id, source)
    values (v_me, v_inviter, p_source) on conflict (invitee_user_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'already_linked'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Everything the Invite friends screen shows, in one call.
create or replace function public.my_referral_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := auth.uid();
  v_p    public.seller_profiles%rowtype;
  v_days int;
begin
  if v_me is null then return null; end if;
  select * into v_p from public.seller_profiles where auth_user_id = v_me;
  select m.days into v_days from public.invite_reward_months m where m.month = public.referral_taipei_month(now());
  return jsonb_build_object(
    'code', (select c.code from public.referral_codes c where c.user_id = v_me),
    'month_days', coalesce(v_days, 0),
    'eligible', public.referral_is_paid_active(v_p.plan, v_p.plan_status, v_p.plan_expiry),
    'has_inviter', exists (select 1 from public.referrals r where r.invitee_user_id = v_me),
    'can_enter_code', not exists (select 1 from public.referrals r where r.invitee_user_id = v_me)
                      and not public.referral_ever_paid(v_me),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', public.referral_mask_email(sp.email),
               'status', r.status,
               'days', r.reward_days,
               'date', coalesce(r.rewarded_at, r.created_at)) order by r.created_at desc)
        from (select * from public.referrals r0 where r0.inviter_user_id = v_me order by r0.created_at desc limit 200) r
        left join public.seller_profiles sp on sp.auth_user_id = r.invitee_user_id), '[]'::jsonb));
end $$;

-- ── the reward trigger ────────────────────────────────────────────────────────────────────
create or replace function public.referral_reward_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_first int;
  v_ref   public.referrals%rowtype;
  v_month date;
  v_days  int;
  v_inv   public.seller_profiles%rowtype;
  v_want  timestamptz;
  v_after timestamptz;
begin
  if new.auth_user_id is null then return null; end if;
  if not public.referral_is_paid_active(new.plan, new.plan_status, new.plan_expiry)
     or public.referral_is_paid_active(old.plan, old.plan_status, old.plan_expiry) then
    return null;                                     -- not a "not paid → active paid" change
  end if;
  begin
    insert into public.referral_paid_seen (user_id) values (new.auth_user_id) on conflict do nothing;
    get diagnostics v_first = row_count;              -- 0 = had a paid plan before (a renewal)
    select * into v_ref from public.referrals where invitee_user_id = new.auth_user_id for update;
    if not found or v_ref.status <> 'linked' then return null; end if;
    v_month := public.referral_taipei_month(now());
    if v_first = 0 then
      update public.referrals set status = 'no_reward', skip_reason = 'not_first_plan', reward_month = v_month, rewarded_at = now()
       where invitee_user_id = new.auth_user_id;
      return null;
    end if;
    if v_ref.inviter_user_id is null then
      update public.referrals set status = 'no_reward', skip_reason = 'inviter_gone', reward_month = v_month, rewarded_at = now()
       where invitee_user_id = new.auth_user_id;
      return null;
    end if;
    select m.days into v_days from public.invite_reward_months m where m.month = v_month;
    if coalesce(v_days, 0) <= 0 then
      update public.referrals set status = 'no_reward', skip_reason = 'month_off', reward_month = v_month, rewarded_at = now()
       where invitee_user_id = new.auth_user_id;
      return null;
    end if;
    select * into v_inv from public.seller_profiles where auth_user_id = v_ref.inviter_user_id for update;
    if not found then
      update public.referrals set status = 'no_reward', skip_reason = 'inviter_gone', reward_month = v_month, rewarded_at = now()
       where invitee_user_id = new.auth_user_id;
      return null;
    end if;
    if not public.referral_is_paid_active(v_inv.plan, v_inv.plan_status, v_inv.plan_expiry) then
      update public.referrals set status = 'no_reward', skip_reason = 'inviter_not_paid', reward_month = v_month, rewarded_at = now()
       where invitee_user_id = new.auth_user_id;
      return null;
    end if;
    v_want := greatest(v_inv.plan_expiry, now()) + make_interval(days => v_days);
    update public.seller_profiles set plan_expiry = v_want
     where auth_user_id = v_ref.inviter_user_id
     returning plan_expiry into v_after;
    if v_after is distinct from v_want then         -- the plan guard reverted it (not an admin)
      update public.referrals set status = 'no_reward', skip_reason = 'not_applied', reward_month = v_month, rewarded_at = now()
       where invitee_user_id = new.auth_user_id;
      return null;
    end if;
    update public.referrals set status = 'rewarded', reward_days = v_days, reward_month = v_month,
           rewarded_at = now(), skip_reason = null
     where invitee_user_id = new.auth_user_id;
  exception when others then
    raise warning 'referral_reward_trg: % (%)', sqlerrm, sqlstate;   -- the plan change still goes through
  end;
  return null;
end $$;

drop trigger if exists trg_seller_profiles_zzzz_referral_reward on public.seller_profiles;
create trigger trg_seller_profiles_zzzz_referral_reward
  after update of plan, plan_status on public.seller_profiles
  for each row execute function public.referral_reward_trg();

-- ── admin functions (is_admin() inside — do NOT revoke EXECUTE from authenticated) ────────
-- What happens to p_user's inviter if the admin gives p_user a paid plan NOW (internal; the two
-- admin functions below call it after their is_admin() check).
create or replace function public.referral_preview_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ref    public.referrals%rowtype;
  v_inv    public.seller_profiles%rowtype;
  v_days   int;
  v_code   text;
  v_reason text := '';
begin
  select c.code into v_code from public.referral_codes c where c.user_id = p_user;
  select * into v_ref from public.referrals where invitee_user_id = p_user;
  if not found then
    return jsonb_build_object('code', v_code, 'linked', false);
  end if;
  select * into v_inv from public.seller_profiles where auth_user_id = v_ref.inviter_user_id;
  select m.days into v_days from public.invite_reward_months m where m.month = public.referral_taipei_month(now());
  v_reason := case
    when v_ref.status <> 'linked' then 'already_done'
    when exists (select 1 from public.referral_paid_seen s where s.user_id = p_user) then 'not_first_plan'
    when v_ref.inviter_user_id is null or v_inv.auth_user_id is null then 'inviter_gone'
    when coalesce(v_days, 0) <= 0 then 'month_off'
    when not public.referral_is_paid_active(v_inv.plan, v_inv.plan_status, v_inv.plan_expiry) then 'inviter_not_paid'
    else '' end;
  return jsonb_build_object(
    'code', v_code, 'linked', true, 'status', v_ref.status,
    'inviter_email', v_inv.email, 'inviter_plan', v_inv.plan,
    'reward_days', v_ref.reward_days,
    'would_reward', v_reason = '', 'days', case when v_reason = '' then v_days else 0 end,
    'reason', v_reason);
end $$;

create or replace function public.admin_referral_preview(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return public.referral_preview_for(p_user);
end $$;

-- The Manage sellers panel in ONE call: { "<user id>": preview } for every seller that has a code
-- or an inviter (sellers with neither are left out).
create or replace function public.admin_referral_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_object_agg(u.id, public.referral_preview_for(u.id))
      from (select user_id as id from public.referral_codes
            union select invitee_user_id from public.referrals) u), '{}'::jsonb);
end $$;

create or replace function public.admin_referrals_list(p_limit int default 50, p_offset int default 0, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_s text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_l int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_o int := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with base as (
      select r.*, ie.email as invitee_email, ir.email as inviter_email, rc.code as inviter_code
        from public.referrals r
        left join public.seller_profiles ie on ie.auth_user_id = r.invitee_user_id
        left join public.seller_profiles ir on ir.auth_user_id = r.inviter_user_id
        left join public.referral_codes rc on rc.user_id = r.inviter_user_id
       where v_s is null
          or lower(coalesce(ie.email, '')) like '%' || v_s || '%'
          or lower(coalesce(ir.email, '')) like '%' || v_s || '%'
          or lower(coalesce(rc.code, '')) like '%' || v_s || '%')
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'invitee_user_id', b.invitee_user_id, 'invitee_email', b.invitee_email,
                'inviter_user_id', b.inviter_user_id, 'inviter_email', b.inviter_email, 'inviter_code', b.inviter_code,
                'source', b.source, 'status', b.status, 'reward_days', b.reward_days, 'reward_month', b.reward_month,
                'rewarded_at', b.rewarded_at, 'skip_reason', b.skip_reason, 'created_at', b.created_at,
                'revoked_at', b.revoked_at) order by b.created_at desc)
              from (select * from base order by created_at desc limit v_l offset v_o) b), '[]'::jsonb)));
end $$;

-- Take back a reward: subtract EXACTLY the days given from the inviter's plan_expiry.
create or replace function public.admin_referral_revoke(p_invitee uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_ref     public.referrals%rowtype;
  v_removed int := 0;
  v_before  timestamptz;
  v_after   timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ref from public.referrals where invitee_user_id = p_invitee for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_ref.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'already_revoked'); end if;
  if v_ref.status = 'rewarded' and v_ref.reward_days > 0 and v_ref.inviter_user_id is not null then
    select plan_expiry into v_before from public.seller_profiles where auth_user_id = v_ref.inviter_user_id for update;
    if v_before is not null then
      update public.seller_profiles set plan_expiry = v_before - make_interval(days => v_ref.reward_days)
       where auth_user_id = v_ref.inviter_user_id returning plan_expiry into v_after;
      if v_after is distinct from v_before - make_interval(days => v_ref.reward_days) then
        raise exception 'revoke_not_applied';
      end if;
      v_removed := v_ref.reward_days;
    end if;
  end if;
  update public.referrals set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   where invitee_user_id = p_invitee;
  return jsonb_build_object('ok', true, 'days_removed', v_removed);
end $$;

-- Admin-only code change (or first code). Old code → referral_code_retired: it stops working and
-- nobody else can take it. Links already made are keyed by user id → they stay.
create or replace function public.admin_set_invite_code(p_user uuid, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_code text := public.referral_norm_code(p_code);
  v_old  text;
  v_prob text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.seller_profiles where auth_user_id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;
  v_prob := public.referral_code_problem(v_code, p_user);
  if v_prob <> '' then return jsonb_build_object('ok', false, 'reason', v_prob); end if;
  select code into v_old from public.referral_codes where user_id = p_user for update;
  if v_old = v_code then return jsonb_build_object('ok', true, 'code', v_code); end if;
  begin
    if v_old is null then
      insert into public.referral_codes (user_id, code, changed_by_admin_at) values (p_user, v_code, now());
    else
      insert into public.referral_code_retired (code, user_id) values (v_old, p_user)
        on conflict (code) do update set user_id = excluded.user_id, retired_at = now();
      update public.referral_codes set previous_code = v_old, code = v_code, changed_by_admin_at = now()
       where user_id = p_user;
    end if;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;
  delete from public.referral_code_retired where code = v_code and user_id = p_user;
  return jsonb_build_object('ok', true, 'code', v_code, 'previous_code', v_old);
end $$;

-- The current Taipei month + the next 5. days null = never set ("Off").
create or replace function public.admin_invite_reward_months_get()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_now date := public.referral_taipei_month(now());
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select jsonb_agg(jsonb_build_object('month', g.m, 'days', m.days, 'is_now', g.m = v_now) order by g.m)
            from (select (v_now + make_interval(months => i))::date as m from generate_series(0, 5) i) g
            left join public.invite_reward_months m on m.month = g.m);
end $$;

-- p_days null or 0 = Off (stored as 0).
create or replace function public.admin_invite_reward_months_set(p_month date, p_days int)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_month date := date_trunc('month', p_month)::date;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_month is null then return jsonb_build_object('ok', false, 'reason', 'month'); end if;
  if coalesce(p_days, 0) < 0 or coalesce(p_days, 0) > 365 then return jsonb_build_object('ok', false, 'reason', 'days'); end if;
  insert into public.invite_reward_months (month, days, updated_at, updated_by)
    values (v_month, coalesce(p_days, 0), now(), auth.uid())
  on conflict (month) do update set days = excluded.days, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true, 'month', v_month, 'days', coalesce(p_days, 0));
end $$;

-- ── execute rights ────────────────────────────────────────────────────────────────────────
revoke execute on function
  public.referral_norm_code(text), public.referral_is_paid_active(text, text, timestamptz),
  public.referral_taipei_month(timestamptz), public.referral_ever_paid(uuid),
  public.referral_code_problem(text, uuid), public.referral_random_code(), public.referral_mask_email(text),
  public.referral_reward_trg(),
  public.check_invite_code(text), public.invite_code_available(text), public.set_my_invite_code(text),
  public.claim_referral(text, text), public.my_referral_summary(),
  public.referral_preview_for(uuid), public.admin_referral_preview(uuid), public.admin_referral_overview(),
  public.admin_referrals_list(int, int, text), public.admin_referral_revoke(uuid),
  public.admin_set_invite_code(uuid, text), public.admin_invite_reward_months_get(),
  public.admin_invite_reward_months_set(date, int)
  from public, anon, authenticated;
grant execute on function public.check_invite_code(text) to anon, authenticated;
grant execute on function
  public.invite_code_available(text), public.set_my_invite_code(text), public.claim_referral(text, text),
  public.my_referral_summary(),
  public.admin_referral_preview(uuid), public.admin_referral_overview(), public.admin_referrals_list(int, int, text), public.admin_referral_revoke(uuid),
  public.admin_set_invite_code(uuid, text), public.admin_invite_reward_months_get(),
  public.admin_invite_reward_months_set(date, int)
  to authenticated;

commit;
