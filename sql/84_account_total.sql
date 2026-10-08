-- 84 — ONE combined account limit per plan, across TikTok usernames
-- (seller_profiles.tiktok) + Facebook Pages (fb_pages) + Shopee shops (shopee_shops).
-- Build 1 = ADDING accounts only (going live is untouched). NOT applied from the repo —
-- chat-Claude applies it. Rollback: sql/84_account_total_rollback.sql.
--
-- RULE
--   free 1 · trial 1 · basic 1 · plus 2 · pro 3 · master 5 · unknown/empty → 1
--   (plan NAME only; expiry is handled by plan enforcement at connect).
--   Admin (role admin, or an admin making the change) and account_limit_exempt → no limit.
--   Only ADDING a new account is blocked when the total (incl. locked seats) would
--   exceed the limit. Removing / reordering / re-saving / re-authorizing always pass.
--   Nothing is ever removed automatically. seller_profiles.facebook is NOT counted.
--
-- REPLACEMENT LOCK (today's slot cooldown, by account name, across all platforms)
--   An account added into never-used capacity has NO lock. An account that takes a seat
--   another account vacated (a replacement) is locked for 4 hours from when it was added.
--   A vacated seat whose account is still locked stays USED until that lock ends; one
--   whose account was not locked (or whose lock is over) is free at once — but the
--   account that takes it gets the lock. The same account coming back while its lock
--   runs is not new and never extends its lock. Accounts that exist when this file is
--   applied (and signup names) have no row = never locked.
--
-- SWITCH — app_settings.account_total_enforce: 'true' = enforce (raise 'account_limit');
--   anything else / missing = LOG ONLY (never blocks; one row in account_limit_log).
--   Seat bookkeeping runs in BOTH modes. In log-only mode a trigger never fails a write.
--
-- Instagram later = one more table + the same two triggers calling account_total_run
-- with platform 'instagram', and one more count line in account_total_used.

begin;
set local lock_timeout = '3s';

-- ── 1) tables ─────────────────────────────────────────────────────────────────
create table if not exists public.account_limit_exempt (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.account_limit_exempt enable row level security;
revoke all on public.account_limit_exempt from public, anon, authenticated;
insert into public.account_limit_exempt (user_id, note)
values ('880a7987-f1b5-4970-82d0-06938cefd4f6', 'owner test account')
on conflict (user_id) do nothing;

-- One row per account the triggers have seen (by name / id). Written ONLY by triggers.
--   removed_at   null = registered now; set = its seat was vacated at that time
--   lock_until   set when the account took a vacated seat (a replacement): until then a
--                vacated seat of this account still counts as used
--   replaced_at  set on a vacated seat once a new account has taken it
create table if not exists public.account_seats (
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null check (platform in ('tiktok', 'facebook', 'shopee')),
  account_key text not null,
  added_at    timestamptz not null default now(),
  removed_at  timestamptz,
  lock_until  timestamptz,
  replaced_at timestamptz,
  primary key (user_id, platform, account_key)
);
create index if not exists account_seats_vacated_idx on public.account_seats (user_id, removed_at) where removed_at is not null and replaced_at is null;
alter table public.account_seats enable row level security;
revoke all on public.account_seats from public, anon, authenticated;

-- What WOULD have been blocked (log-only) — counts only, never names / page names.
create table if not exists public.account_limit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  platform    text,
  would_block text,   -- over_total | seat_locked | error:<sqlstate>
  used        int,
  lim         int,
  created_at  timestamptz not null default now()
);
create index if not exists account_limit_log_created_idx on public.account_limit_log (created_at desc);
alter table public.account_limit_log enable row level security;
revoke all on public.account_limit_log from public, anon, authenticated;

-- ── 2) counting — ALL in one place ────────────────────────────────────────────
-- The replacement lock length. The ONLY place it is written.
create or replace function public.account_lock_length()
returns interval language sql immutable as $$ select interval '4 hours' $$;

create or replace function public.account_limit_for(p_plan text)
returns int language sql immutable as $$
  select case lower(btrim(coalesce(p_plan, '')))
    when 'plus' then 2 when 'pro' then 3 when 'master' then 5 else 1 end;
$$;

-- Normalized, de-duplicated TikTok usernames, like normalizeAccount: trim the way
-- JavaScript String.trim does (plus U+200B), strip leading @, lowercase. Split on comma /
-- newline; blanks dropped.
create or replace function public.account_tiktok_keys(p_list text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct k), '{}')
  from (select lower(regexp_replace(
                 regexp_replace(x, '^[[:space:]\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+|[[:space:]\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'),
                 '^@+', '')) as k
          from regexp_split_to_table(coalesce(p_list, ''), '[,\n]') as x) s
  where k <> '';
$$;

-- Vacated seats that still count as used: not taken by a new account, lock not over.
create or replace function public.account_locked_seats(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.account_seats a
   where a.user_id = p_user and a.removed_at is not null and a.replaced_at is null and a.lock_until > now();
$$;
revoke all on function public.account_locked_seats(uuid) from public, anon, authenticated;

-- current accounts + locked vacated seats. p_tiktok_count overrides the stored TikTok
-- count (a BEFORE trigger still sees the old row); p_extra = the account being inserted.
create or replace function public.account_total_used(p_user uuid, p_tiktok_count int default null, p_extra int default 0)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p_tiktok_count,
           (select cardinality(public.account_tiktok_keys(sp.tiktok)) from public.seller_profiles sp where sp.auth_user_id = p_user), 0)
       + (select count(*)::int from public.fb_pages f where f.user_id = p_user)
       + (select count(*)::int from public.shopee_shops s where s.user_id = p_user)
       + public.account_locked_seats(p_user)
       + coalesce(p_extra, 0);
$$;
revoke all on function public.account_total_used(uuid, int, int) from public, anon, authenticated;

-- The switch. Never raises: an unreadable or missing key = log only.
create or replace function public.account_total_enforced()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select value into v from public.app_settings where key = 'account_total_enforce';
  return lower(btrim(coalesce(v, ''))) = 'true';
exception when others then
  return false;
end;
$$;
revoke all on function public.account_total_enforced() from public, anon, authenticated;

-- A vacated seat: remembered even when the account had no row (it existed before this
-- file, or came from signup). Keeps its lock_until.
create or replace function public.account_seat_vacate(p_user uuid, p_platform text, p_key text)
returns void language sql security definer set search_path = public as $$
  insert into public.account_seats (user_id, platform, account_key, added_at, removed_at, lock_until, replaced_at)
  values (p_user, p_platform, p_key, now(), now(), null, null)
  on conflict (user_id, platform, account_key) do update set removed_at = now(), replaced_at = null;
$$;
revoke all on function public.account_seat_vacate(uuid, text, text) from public, anon, authenticated;

-- ── 3) the guard: lock → vacate → same-account-back → decide → seat bookkeeping ──
-- p_added / p_removed = account keys for p_platform. p_tiktok_after = the TikTok count
-- after this change (TikTok only); p_extra = 1 for a Page/shop being inserted.
-- p_row_plan / p_row_role (signup insert): the plan / role the new row ends up with.
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
            case when v_repl then now() + public.account_lock_length() end, null)
    on conflict (user_id, platform, account_key) do update
      set added_at = excluded.added_at, removed_at = null, replaced_at = null, lock_until = excluded.lock_until;
  end loop;
end;
$$;
revoke all on function public.account_total_guard(uuid, text, text[], text[], int, int, boolean, text, text, boolean) from public, anon, authenticated;

-- Runs the guard. ENFORCE + something added: any error (incl. account_limit and an
-- unreadable count) propagates → the write fails (fail closed). Otherwise (LOG ONLY, or
-- a pure removal) it never fails the write: an internal error is logged (sqlstate only).
create or replace function public.account_total_run(
  p_user uuid, p_platform text, p_added text[], p_removed text[], p_tiktok_after int, p_extra int,
  p_row_plan text default null, p_row_role text default null, p_from_row boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_enforce boolean := public.account_total_enforced();
begin
  if v_enforce and coalesce(cardinality(p_added), 0) > 0 then
    perform public.account_total_guard(p_user, p_platform, p_added, p_removed, p_tiktok_after, p_extra, true, p_row_plan, p_row_role, p_from_row);
    return;
  end if;
  begin
    perform public.account_total_guard(p_user, p_platform, p_added, p_removed, p_tiktok_after, p_extra, false, p_row_plan, p_row_role, p_from_row);
  exception when others then
    begin
      insert into public.account_limit_log (user_id, platform, would_block, used, lim)
      values (p_user, p_platform, 'error:' || sqlstate, null, null);
    exception when others then null;
    end;
  end;
end;
$$;
revoke all on function public.account_total_run(uuid, text, text[], text[], int, int, text, text, boolean) from public, anon, authenticated;

-- ── 4) triggers ───────────────────────────────────────────────────────────────
-- TikTok usernames, on INSERT (signup) and UPDATE. Named so it fires AFTER
-- trg_seller_profiles_insert / trg_seller_profiles_update (BEFORE triggers run in name
-- order): it sees the plan / role those set and never changes a column itself.
create or replace function public.account_total_tiktok_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old   text[] := '{}';
  v_new   text[];
  v_added text[];
  v_rem   text[];
begin
  if tg_op = 'UPDATE' then
    if new.tiktok is not distinct from old.tiktok then return new; end if;   -- fast path
    v_old := public.account_tiktok_keys(old.tiktok);
  end if;
  v_new := public.account_tiktok_keys(new.tiktok);
  select coalesce(array_agg(k), '{}') into v_added from unnest(v_new) k where not (k = any(v_old));
  select coalesce(array_agg(k), '{}') into v_rem   from unnest(v_old) k where not (k = any(v_new));
  if cardinality(v_added) = 0 and cardinality(v_rem) = 0 then return new; end if;  -- reorder / re-save / no names
  if tg_op = 'INSERT' then
    perform public.account_total_run(new.auth_user_id, 'tiktok', v_added, '{}', cardinality(v_new), 0, new.plan, new.role, true);
  else
    perform public.account_total_run(new.auth_user_id, 'tiktok', v_added, v_rem, cardinality(v_new), 0);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_seller_profiles_zz_account_total on public.seller_profiles;
create trigger trg_seller_profiles_zz_account_total
  before insert or update on public.seller_profiles
  for each row execute function public.account_total_tiktok_trg();

-- Facebook Pages / Shopee shops: a NEW row is an add; an existing (user, id) row is a
-- re-authorization (an upsert's ON CONFLICT path) → pass.
create or replace function public.account_total_fb_ins_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.fb_pages f where f.user_id = new.user_id and f.page_id = new.page_id) then return new; end if;
  perform public.account_total_run(new.user_id, 'facebook', array[new.page_id::text], '{}', null, 1);
  return new;
end;
$$;
create or replace function public.account_total_shop_ins_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.shopee_shops s where s.user_id = new.user_id and s.shop_id = new.shop_id) then return new; end if;
  perform public.account_total_run(new.user_id, 'shopee', array[new.shop_id::text], '{}', null, 1);
  return new;
end;
$$;
-- The vacated seat. Never blocks a delete. Skipped when the user itself is being deleted
-- (account deletion cascades): a seat row for a deleted user would break the cascade.
create or replace function public.account_total_del_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;
  begin
    -- jsonb read: a direct old.shop_id on an fb_pages row would raise.
    perform public.account_seat_vacate(old.user_id, tg_argv[0],
      to_jsonb(old) ->> (case when tg_argv[0] = 'facebook' then 'page_id' else 'shop_id' end));
  exception when others then null;
  end;
  return old;
end;
$$;

drop trigger if exists trg_fb_pages_account_total on public.fb_pages;
create trigger trg_fb_pages_account_total before insert on public.fb_pages
  for each row execute function public.account_total_fb_ins_trg();
drop trigger if exists trg_fb_pages_account_total_del on public.fb_pages;
create trigger trg_fb_pages_account_total_del after delete on public.fb_pages
  for each row execute function public.account_total_del_trg('facebook');

drop trigger if exists trg_shopee_shops_account_total on public.shopee_shops;
create trigger trg_shopee_shops_account_total before insert on public.shopee_shops
  for each row execute function public.account_total_shop_ins_trg();
drop trigger if exists trg_shopee_shops_account_total_del on public.shopee_shops;
create trigger trg_shopee_shops_account_total_del after delete on public.shopee_shops
  for each row execute function public.account_total_del_trg('shopee');

revoke all on function public.account_total_tiktok_trg() from public, anon, authenticated;
revoke all on function public.account_total_fb_ins_trg() from public, anon, authenticated;
revoke all on function public.account_total_shop_ins_trg() from public, anon, authenticated;
revoke all on function public.account_total_del_trg() from public, anon, authenticated;

-- ── 5) the seller's own numbers (the "Accounts used: X of Y" line) ────────────
create or replace function public.account_quota()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_plan  text;
  v_role  text;
  v_tt    int;
  v_fb    int;
  v_sh    int;
  v_lock  int;
  v_next  timestamptz;
begin
  if v_uid is null then return null; end if;
  select plan, role, cardinality(public.account_tiktok_keys(tiktok))
    into v_plan, v_role, v_tt
    from public.seller_profiles where auth_user_id = v_uid;
  select count(*)::int into v_fb from public.fb_pages where user_id = v_uid;
  select count(*)::int into v_sh from public.shopee_shops where user_id = v_uid;
  select count(*)::int, min(lock_until) into v_lock, v_next
    from public.account_seats
   where user_id = v_uid and removed_at is not null and replaced_at is null and lock_until > now();
  return jsonb_build_object(
    'plan', coalesce(v_plan, ''),
    'limit', public.account_limit_for(v_plan),
    'used', coalesce(v_tt, 0) + v_fb + v_sh + v_lock,
    'unlimited', lower(coalesce(v_role, '')) = 'admin'
                 or exists (select 1 from public.account_limit_exempt e where e.user_id = v_uid),
    'tiktok', coalesce(v_tt, 0), 'facebook', v_fb, 'shopee', v_sh,
    'locked', v_lock,
    'next_free_at', v_next);
end;
$$;
revoke all on function public.account_quota() from public, anon;
grant execute on function public.account_quota() to authenticated;

-- ── 6) the 4-hour slot cooldown table: database functions only ────────────────
-- No app code writes tiktok_account_changes directly (only these two functions), so
-- the direct write rights go and touch_tiktok_slot runs as definer with auth.uid().
-- Its logic is byte-for-byte sql/24's; only the definer / search_path lines are new.
revoke insert, update on public.tiktok_account_changes from authenticated;
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

commit;
