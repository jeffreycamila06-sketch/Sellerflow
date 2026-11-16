-- sql/165 — INVITE FRIENDS: invite CODE + referral reward (free plan days for the INVITER only).
-- NOT APPLIED. Rollback: sql/165_invite_referral_rollback.sql. Behaviour check:
-- scripts/sql165-behaviour.mjs (PGlite). (163 + 164 are the Seller Website, already on main.)
--
-- ADD-ONLY: new tables, new functions, ONE new AFTER trigger on seller_profiles (+ one trigger on
-- the new referral_codes table). No existing table, column, trigger or function is changed.
-- NO Render deploy (web + database only).
--
-- THE RULES (Jeff, 2026-11-15):
--   * Each seller chooses their invite code ONCE (own word or a random one). 4–12 letters/numbers,
--     stored UPPERCASE (after NFKC, so full-width letters from a Chinese keyboard work), unique,
--     case-insensitive. Reserved words = table referral_reserved_codes: 'contains' rows block any
--     code that has the word inside it (ADMIN, SELLERFLOW, SUPPORT, OFFICIAL), 'exact' rows block
--     only that exact code (SFL, HELP, TEST, SELLERFLOWLIVE — so CONTEST / HELPER still work).
--     Add one = one INSERT, no deploy. After saving the code never changes — only an admin
--     (admin_set_invite_code). The old code then stops working (kept in referral_code_retired so
--     nobody else can take it — also when the owner's account is deleted); friends already linked
--     stay linked.
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
-- plan_status, plan_expiry (named so it runs after the existing AFTER trigger
-- ..._zzz_parcel_auto_access). Any path that really changes a plan (admin UI, an admin RPC, manual
-- SQL with the plan guard off, an expiry-only change) ends in that UPDATE, so all of them are
-- covered. It acts only on a "not active paid → active paid" change of the row itself.
-- It bumps ONLY the inviter's plan_expiry. That update fires this same trigger on the INVITER row,
-- but an inviter only ever gets days while already active paid (old row active paid → the trigger
-- returns at once), so it never chains (no loop); the parcel trigger (OF plan, plan_status,
-- country) and the TikTok-total trigger (fast path on tiktok) ignore that update. The inviter's
-- plan_expiry passes seller_profiles_on_update only when the caller is an admin — the same caller
-- that gave the friend's plan; if the guard reverted it the referral is marked 'no_reward' /
-- 'not_applied' (never a fake 'rewarded'). The "had a paid plan" mark is written first, in its own
-- block, so a failure in the reward can never erase it; a failure in the reward marks the referral
-- 'no_reward' / 'error'. The plan change itself ALWAYS goes through.
--
-- "Ever had a paid plan" = referral_paid_seen, keyed by user AND lower(email) (the email stays when
-- the account is deleted, so delete + sign up again with the same email cannot earn a reward)
-- OR the current plan is a paid plan name. Back-filled below: current plan in
-- (basic, plus, pro, master), OR an audit_logs row for that seller with action 'changed plan' to a
-- paid plan name, OR action 'made admin' (emails matched as lower(btrim())). Emails with such a
-- log but NO seller_profiles row any more (deleted accounts) get an email-only row. (A free account
-- that only has an expiry date is NOT marked — e.g. a seller whose only log is 'expired seller'.)
-- Making someone admin is not a payment: the trigger marks "had a paid plan" but gives no reward.
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

-- user_id null = retired when the owner's account was deleted (nobody may take it).
create table if not exists public.referral_code_retired (
  code       text primary key,
  user_id    uuid references auth.users(id) on delete set null,
  retired_at timestamptz not null default now()
);

create table if not exists public.referral_reserved_codes (
  code  text primary key check (code = upper(code)),
  match text not null default 'exact' check (match in ('exact', 'contains'))
);
insert into public.referral_reserved_codes(code, match) values
  ('ADMIN', 'contains'), ('SELLERFLOW', 'contains'), ('SUPPORT', 'contains'), ('OFFICIAL', 'contains'),
  ('SFL', 'exact'), ('HELP', 'exact'), ('TEST', 'exact'), ('SELLERFLOWLIVE', 'exact')
on conflict do nothing;

-- One row per invited account. invitee_user_id is set null when the friend's account is deleted;
-- invitee_email / inviter_email are lower-case snapshots so the history (and Revoke) survive.
create table if not exists public.referrals (
  id              uuid primary key default gen_random_uuid(),
  invitee_user_id uuid references auth.users(id) on delete set null,
  invitee_email   text not null default '',
  inviter_user_id uuid references auth.users(id) on delete set null,
  inviter_email   text not null default '',
  created_at      timestamptz not null default now(),
  source          text not null check (source in ('signup', 'settings')),
  status          text not null default 'linked' check (status in ('linked', 'rewarded', 'no_reward', 'revoked')),
  reward_days     int not null default 0 check (reward_days >= 0),
  reward_month    date,
  rewarded_at     timestamptz,
  skip_reason     text,
  revoked_at      timestamptz,
  revoked_by      uuid,
  -- `<>` (not `is distinct from`): both null after both accounts are deleted must still pass.
  check (inviter_user_id <> invitee_user_id)
);
create unique index if not exists referrals_invitee_uidx on public.referrals (invitee_user_id);
create index if not exists referrals_inviter_idx on public.referrals (inviter_user_id, created_at desc);
create index if not exists referrals_invitee_email_idx on public.referrals (invitee_email);

create table if not exists public.invite_reward_months (
  month      date primary key check (extract(day from month) = 1),
  days       int not null check (days >= 0 and days <= 365),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- user_id set null when the account is deleted; the email stays.
create table if not exists public.referral_paid_seen (
  id            bigserial primary key,
  user_id       uuid references auth.users(id) on delete set null,
  email         text,
  first_paid_at timestamptz not null default now()
);
create unique index if not exists referral_paid_seen_user_uidx on public.referral_paid_seen (user_id);
create unique index if not exists referral_paid_seen_email_uidx on public.referral_paid_seen (email);

alter table public.referral_codes          enable row level security;
alter table public.referral_code_retired   enable row level security;
alter table public.referral_reserved_codes enable row level security;
alter table public.referrals               enable row level security;
alter table public.invite_reward_months    enable row level security;
alter table public.referral_paid_seen      enable row level security;
revoke all on public.referral_codes, public.referral_code_retired, public.referral_reserved_codes,
              public.referrals, public.invite_reward_months, public.referral_paid_seen
  from public, anon, authenticated;
revoke all on sequence public.referral_paid_seen_id_seq from public, anon, authenticated;

-- Back-fill "ever had a paid plan" (see the header).
insert into public.referral_paid_seen (user_id, email, first_paid_at)
select sp.auth_user_id, nullif(lower(btrim(coalesce(sp.email, ''))), ''), coalesce(sp.created_at, now())
  from public.seller_profiles sp
 where sp.auth_user_id is not null
   and (lower(btrim(coalesce(sp.plan, ''))) in ('basic', 'plus', 'pro', 'master')
        or exists (select 1 from public.audit_logs a
                    where lower(btrim(coalesce(a.target_email, ''))) = lower(btrim(coalesce(sp.email, '')))
                      and ((a.action = 'changed plan' and a.details::text ~* '\m(basic|plus|pro|master)\M')
                           or a.action = 'made admin')))
on conflict do nothing;

-- …and email-only rows (user_id null) for accounts already DELETED: an audit_logs paid plan /
-- 'made admin' for an email that no longer has a seller_profiles row. Signing up again with that
-- email then counts as "had a paid plan".
insert into public.referral_paid_seen (user_id, email, first_paid_at)
select null, e.email, e.first_at
  from (select lower(btrim(a.target_email)) as email, min(a.created_at) as first_at
          from public.audit_logs a
         where nullif(lower(btrim(coalesce(a.target_email, ''))), '') is not null
           and ((a.action = 'changed plan' and a.details::text ~* '\m(basic|plus|pro|master)\M')
                or a.action = 'made admin')
         group by lower(btrim(a.target_email))) e
 where not exists (select 1 from public.seller_profiles sp
                    where lower(btrim(coalesce(sp.email, ''))) = e.email)
on conflict do nothing;

-- ── small helpers ─────────────────────────────────────────────────────────────────────────
-- NFKC first: full-width letters / digits (ＢＵＤＧＥＴ１) become plain ASCII.
create or replace function public.referral_norm_code(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select upper(btrim(normalize(coalesce(p, ''), NFKC)))
$$;

create or replace function public.referral_is_paid_active(p_plan text, p_status text, p_expiry timestamptz)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select lower(btrim(coalesce(p_plan, ''))) in ('basic', 'plus', 'pro', 'master')
     and coalesce(p_status, '') = 'active'
     and p_expiry is not null and p_expiry > now()
$$;

-- First day of the Asia/Taipei month that `p_at` falls in (Nov 30 23:30 Taipei → Nov 1).
create or replace function public.referral_taipei_month(p_at timestamptz)
returns date language sql stable set search_path = public, pg_temp as $$
  select date_trunc('month', p_at at time zone 'Asia/Taipei')::date
$$;

create or replace function public.referral_email_of(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(lower(btrim(coalesce(sp.email, ''))), '') from public.seller_profiles sp where sp.auth_user_id = p_user
$$;

-- Paid before: this account, this email (also from a deleted account), or on a paid plan name now.
create or replace function public.referral_ever_paid(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.referral_paid_seen s where s.user_id = p_user)
      or exists (select 1 from public.referral_paid_seen s where s.email = public.referral_email_of(p_user))
      or exists (select 1 from public.seller_profiles sp where sp.auth_user_id = p_user
                   and lower(btrim(coalesce(sp.plan, ''))) in ('basic', 'plus', 'pro', 'master'))
$$;

create or replace function public.referral_is_reserved(p_code text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.referral_reserved_codes r
                  where (r.match = 'exact' and r.code = public.referral_norm_code(p_code))
                     or (r.match = 'contains' and position(r.code in public.referral_norm_code(p_code)) > 0))
$$;

-- '' = the code may be chosen; else 'format' | 'reserved' | 'taken'. `p_owner` = the user the
-- code would belong to (a code they themselves used before may come back, nobody else's).
create or replace function public.referral_code_problem(p_code text, p_owner uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when public.referral_norm_code(p_code) !~ '^[A-Z0-9]{4,12}$' then 'format'
    when public.referral_is_reserved(p_code) then 'reserved'
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

-- A code whose owner's account is deleted is retired (nobody else can take it). user_id null:
-- the owner is being deleted in this same statement.
create or replace function public.referral_code_retire_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.referral_code_retired (code, user_id) values (old.code, null)
    on conflict (code) do update set user_id = null, retired_at = now();
  return old;
end $$;
drop trigger if exists trg_referral_codes_retire on public.referral_codes;
create trigger trg_referral_codes_retire
  before delete on public.referral_codes
  for each row execute function public.referral_code_retire_trg();

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
  v_email   text;
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
  v_email := public.referral_email_of(v_me);
  if exists (select 1 from public.referrals where invitee_user_id = v_me)
     or (v_email is not null and exists (select 1 from public.referrals r where r.invitee_email = v_email)) then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;
  select c.user_id into v_inviter from public.referral_codes c where c.code = public.referral_norm_code(p_code);
  if v_inviter is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_inviter = v_me then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if public.referral_ever_paid(v_me) then return jsonb_build_object('ok', false, 'reason', 'already_paid'); end if;
  insert into public.referrals (invitee_user_id, invitee_email, inviter_user_id, inviter_email, source)
    values (v_me, coalesce(v_email, ''), v_inviter, coalesce(public.referral_email_of(v_inviter), ''), p_source)
    on conflict (invitee_user_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'already_linked'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Everything the Invite friends screen shows, in one call.
create or replace function public.my_referral_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := auth.uid();
  v_email text;
  v_p     public.seller_profiles%rowtype;
  v_days  int;
  v_linked boolean;
begin
  if v_me is null then return null; end if;
  select * into v_p from public.seller_profiles where auth_user_id = v_me;
  v_email := public.referral_email_of(v_me);
  v_linked := exists (select 1 from public.referrals r where r.invitee_user_id = v_me)
              or (v_email is not null and exists (select 1 from public.referrals r where r.invitee_email = v_email));
  select m.days into v_days from public.invite_reward_months m where m.month = public.referral_taipei_month(now());
  return jsonb_build_object(
    'code', (select c.code from public.referral_codes c where c.user_id = v_me),
    'month_days', coalesce(v_days, 0),
    'eligible', public.referral_is_paid_active(v_p.plan, v_p.plan_status, v_p.plan_expiry),
    'has_inviter', v_linked,
    'can_enter_code', not v_linked and not public.referral_ever_paid(v_me),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', public.referral_mask_email(r.invitee_email),
               'status', r.status,
               'days', r.reward_days,
               'date', coalesce(r.rewarded_at, r.created_at)) order by r.created_at desc)
        from (select * from public.referrals r0 where r0.inviter_user_id = v_me order by r0.created_at desc limit 200) r), '[]'::jsonb));
end $$;

-- ── the reward trigger ────────────────────────────────────────────────────────────────────
create or replace function public.referral_reward_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_first int := -1;
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
  -- 1) The "had a paid plan" mark, in its own block: nothing later can undo it.
  begin
    insert into public.referral_paid_seen (user_id, email)
      values (new.auth_user_id, nullif(lower(btrim(coalesce(new.email, ''))), ''))
      on conflict do nothing;
    get diagnostics v_first = row_count;              -- 0 = this account / email had a paid plan before
  exception when others then
    v_first := -1;
    raise warning 'referral_reward_trg paid_seen: % (%)', sqlerrm, sqlstate;
  end;
  -- 2) The reward.
  begin
    select * into v_ref from public.referrals where invitee_user_id = new.auth_user_id for update;
    if not found or v_ref.status <> 'linked' then return null; end if;
    if v_first < 0 then raise exception 'paid_seen_failed'; end if;
    v_month := public.referral_taipei_month(now());
    if lower(btrim(coalesce(new.role, ''))) = 'admin' then   -- made admin = not a payment (still marked above)
      update public.referrals set status = 'no_reward', skip_reason = 'admin', reward_month = v_month, rewarded_at = now()
       where id = v_ref.id;
      return null;
    end if;
    if v_first = 0 then
      update public.referrals set status = 'no_reward', skip_reason = 'not_first_plan', reward_month = v_month, rewarded_at = now()
       where id = v_ref.id;
      return null;
    end if;
    if v_ref.inviter_user_id is null then
      update public.referrals set status = 'no_reward', skip_reason = 'inviter_gone', reward_month = v_month, rewarded_at = now()
       where id = v_ref.id;
      return null;
    end if;
    select m.days into v_days from public.invite_reward_months m where m.month = v_month;
    if coalesce(v_days, 0) <= 0 then
      update public.referrals set status = 'no_reward', skip_reason = 'month_off', reward_month = v_month, rewarded_at = now()
       where id = v_ref.id;
      return null;
    end if;
    select * into v_inv from public.seller_profiles where auth_user_id = v_ref.inviter_user_id for update;
    if not found then
      update public.referrals set status = 'no_reward', skip_reason = 'inviter_gone', reward_month = v_month, rewarded_at = now()
       where id = v_ref.id;
      return null;
    end if;
    if not public.referral_is_paid_active(v_inv.plan, v_inv.plan_status, v_inv.plan_expiry) then
      update public.referrals set status = 'no_reward', skip_reason = 'inviter_not_paid', reward_month = v_month, rewarded_at = now()
       where id = v_ref.id;
      return null;
    end if;
    v_want := greatest(v_inv.plan_expiry, now()) + make_interval(days => v_days);
    update public.seller_profiles set plan_expiry = v_want
     where auth_user_id = v_ref.inviter_user_id
     returning plan_expiry into v_after;
    if v_after is distinct from v_want then         -- the plan guard reverted it (not an admin)
      update public.referrals set status = 'no_reward', skip_reason = 'not_applied', reward_month = v_month, rewarded_at = now()
       where id = v_ref.id;
      return null;
    end if;
    update public.referrals set status = 'rewarded', reward_days = v_days, reward_month = v_month,
           rewarded_at = now(), skip_reason = null
     where id = v_ref.id;
  exception when others then
    raise warning 'referral_reward_trg: % (%)', sqlerrm, sqlstate;   -- the plan change still goes through
    -- Done for good: this was the friend's first paid plan, so no later change may reward it.
    begin
      update public.referrals set status = 'no_reward', skip_reason = 'error',
             reward_month = public.referral_taipei_month(now()), rewarded_at = now()
       where invitee_user_id = new.auth_user_id and status = 'linked';
    exception when others then
      raise warning 'referral_reward_trg mark error: % (%)', sqlerrm, sqlstate;
    end;
  end;
  return null;
end $$;

drop trigger if exists trg_seller_profiles_zzzz_referral_reward on public.seller_profiles;
create trigger trg_seller_profiles_zzzz_referral_reward
  after update of plan, plan_status, plan_expiry on public.seller_profiles
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
    when exists (select 1 from public.referral_paid_seen s where s.user_id = p_user)
      or exists (select 1 from public.referral_paid_seen s where s.email = public.referral_email_of(p_user)) then 'not_first_plan'
    when v_ref.inviter_user_id is null or v_inv.auth_user_id is null then 'inviter_gone'
    when coalesce(v_days, 0) <= 0 then 'month_off'
    when not public.referral_is_paid_active(v_inv.plan, v_inv.plan_status, v_inv.plan_expiry) then 'inviter_not_paid'
    else '' end;
  return jsonb_build_object(
    'code', v_code, 'linked', true, 'status', v_ref.status,
    'inviter_email', coalesce(v_inv.email, nullif(v_ref.inviter_email, '')), 'inviter_plan', v_inv.plan,
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
            union select invitee_user_id from public.referrals where invitee_user_id is not null) u), '{}'::jsonb);
end $$;

-- Invite history. Emails = the live account's, else the snapshot taken at the link (a deleted
-- friend / inviter still shows). inviter_expiry = the inviter's CURRENT plan_expiry (Revoke shows
-- current → new).
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
      select r.id, r.invitee_user_id, r.inviter_user_id, r.source, r.status, r.reward_days, r.reward_month,
             r.rewarded_at, r.skip_reason, r.created_at, r.revoked_at,
             coalesce(nullif(lower(btrim(ie.email)), ''), r.invitee_email) as invitee_email,
             coalesce(nullif(lower(btrim(ir.email)), ''), r.inviter_email) as inviter_email,
             ir.plan_expiry as inviter_expiry,
             rc.code as inviter_code
        from public.referrals r
        left join public.seller_profiles ie on ie.auth_user_id = r.invitee_user_id
        left join public.seller_profiles ir on ir.auth_user_id = r.inviter_user_id
        left join public.referral_codes rc on rc.user_id = r.inviter_user_id)
    , hit as (
      select * from base
       where v_s is null
          or invitee_email like '%' || v_s || '%'
          or inviter_email like '%' || v_s || '%'
          or lower(coalesce(inviter_code, '')) like '%' || v_s || '%')
    select jsonb_build_object(
      'total', (select count(*) from hit),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'id', b.id,
                'invitee_user_id', b.invitee_user_id, 'invitee_email', b.invitee_email,
                'inviter_user_id', b.inviter_user_id, 'inviter_email', b.inviter_email, 'inviter_code', b.inviter_code,
                'inviter_expiry', b.inviter_expiry,
                'source', b.source, 'status', b.status, 'reward_days', b.reward_days, 'reward_month', b.reward_month,
                'rewarded_at', b.rewarded_at, 'skip_reason', b.skip_reason, 'created_at', b.created_at,
                'revoked_at', b.revoked_at) order by b.created_at desc)
              from (select * from hit order by created_at desc limit v_l offset v_o) b), '[]'::jsonb)));
end $$;

-- Take back a reward: subtract EXACTLY the days given from the inviter's plan_expiry. By referral
-- id, so it also works when the friend's account was deleted.
create or replace function public.admin_referral_revoke(p_referral uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_ref     public.referrals%rowtype;
  v_removed int := 0;
  v_before  timestamptz;
  v_after   timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ref from public.referrals where id = p_referral for update;
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
   where id = p_referral;
  return jsonb_build_object('ok', true, 'days_removed', v_removed, 'inviter_expiry', v_after);
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
  public.referral_taipei_month(timestamptz), public.referral_email_of(uuid), public.referral_ever_paid(uuid),
  public.referral_is_reserved(text), public.referral_code_problem(text, uuid), public.referral_random_code(),
  public.referral_mask_email(text), public.referral_code_retire_trg(), public.referral_reward_trg(),
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
  public.admin_referral_preview(uuid), public.admin_referral_overview(), public.admin_referrals_list(int, int, text),
  public.admin_referral_revoke(uuid),
  public.admin_set_invite_code(uuid, text), public.admin_invite_reward_months_get(),
  public.admin_invite_reward_months_set(date, int)
  to authenticated;

commit;
