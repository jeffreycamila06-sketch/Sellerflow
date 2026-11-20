-- 190 — BLACKLIST (sellers outside Taiwan): the seller's OWN list of buyers who did not check out
-- or returned an item. Shown on the live comment rows as a reminder only (the order still prints).
-- NOT APPLIED. ADD-ONLY: one new table, its insert trigger, two small seller functions, one switch
-- row and one tester key. No existing table, trigger or order / print / session object is changed.
-- Safe to run twice (nothing changes the second time).
--
-- Who can see what (row level security):
--   * a signed-in seller reads, adds and deletes ONLY their own rows (user_id = auth.uid());
--   * nobody can UPDATE a row (no policy, no grant) — a wrong entry is removed and added again;
--   * visitors who are not signed in have no access at all;
--   * NO admin rule: an admin account sees only its own list, never another seller's (the server's
--     service key is the only thing above RLS, and no server code reads this table).
--
-- "Already added today": the same buyer + the same reason counts ONCE per seller-local calendar day.
-- The day is worked out by blacklist_add() from the time zone the phone sends (checked; an unknown
-- or far-off zone → UTC). The unique constraint buyer_blacklist_once_a_day makes the database refuse
-- a second row for the same day, from any phone.
--
-- Buyer key (exact match only — the app uses the same rule for the live rows):
--   TikTok   = the username, trimmed, ONE leading "@" removed, lower case (no spaces allowed);
--   Facebook = the name, trimmed, lower case (otherwise exactly as written).
--
-- Switch + testers (the app shows Blacklist only OUTSIDE Taiwan):
--   app_settings blacklist_enabled = 'false' (created by this file; exact 'true' = on for every seller
--   outside Taiwan, all plans) · tester key 'blacklist' in feature_access_emails (my_feature_access) ·
--   admins see it without the key.
--   Turn on for one tester (LOGIN email, lower case):
--     insert into public.feature_access_emails (feature, email, is_prefix) values ('blacklist', '<login email>', false) on conflict do nothing;
--   Turn on for every seller outside Taiwan:
--     update public.app_settings set value = 'true', updated_at = now() where key = 'blacklist_enabled';
--   The seller fully closes and reopens the app to see a change (both are read once per sign-in).
--
-- ⚠️ my_feature_access(): build it from the LIVE definition at apply time
--   (select pg_get_functiondef('public.my_feature_access'::regproc)) keeping EVERY key it already has
--   + 'blacklist'. The version below = the live list read on 2026-11-20 (25 keys) + 'blacklist'.
--
-- Before this file is applied the app shows nothing (switch row and key missing = off).
-- Apply check:
--   select public.my_feature_access() ? 'blacklist';                                  -- true
--   select value from public.app_settings where key = 'blacklist_enabled';            -- false
--   select relrowsecurity from pg_class where oid = 'public.buyer_blacklist'::regclass;  -- true
-- Rollback: sql/190_buyer_blacklist_rollback.sql (drops the table and everything in it).
begin;

insert into public.app_settings (key, value) values ('blacklist_enabled', 'false')
on conflict (key) do nothing;

-- The key rule. Same as the app (adapters/blacklist.ts blacklistKey).
create or replace function public.buyer_blacklist_key(p_platform text, p_label text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_platform = 'tiktok'
      then lower(btrim(regexp_replace(btrim(coalesce(p_label, ''), E' \t\r\n 　'), '^@', ''), E' \t\r\n 　'))
    else lower(btrim(coalesce(p_label, ''), E' \t\r\n 　'))
  end;
$$;

create table if not exists public.buyer_blacklist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform    text not null,
  buyer_label text not null,
  buyer_key   text not null,
  reason      text not null,
  added_day   date not null,
  created_at  timestamptz not null default now()
);

alter table public.buyer_blacklist drop constraint if exists buyer_blacklist_platform;
alter table public.buyer_blacklist drop constraint if exists buyer_blacklist_reason;
alter table public.buyer_blacklist drop constraint if exists buyer_blacklist_label_len;
alter table public.buyer_blacklist drop constraint if exists buyer_blacklist_key_len;
alter table public.buyer_blacklist drop constraint if exists buyer_blacklist_tiktok_no_space;
alter table public.buyer_blacklist drop constraint if exists buyer_blacklist_once_a_day;
alter table public.buyer_blacklist
  add constraint buyer_blacklist_platform        check (platform in ('tiktok', 'facebook')),
  add constraint buyer_blacklist_reason          check (reason in ('not_checked_out', 'returned')),
  add constraint buyer_blacklist_label_len       check (char_length(buyer_label) between 1 and 100),
  add constraint buyer_blacklist_key_len         check (char_length(buyer_key) between 1 and 100),
  add constraint buyer_blacklist_tiktok_no_space check (platform <> 'tiktok' or buyer_label !~ '[[:space:]]'),
  add constraint buyer_blacklist_once_a_day      unique (user_id, platform, buyer_key, reason, added_day);

-- The app reads a seller's list newest first.
create index if not exists buyer_blacklist_user_created_idx on public.buyer_blacklist (user_id, created_at desc);

-- Every insert (from blacklist_add or straight from the browser): the label is trimmed (TikTok: one
-- "@" removed), the key is made by the database itself, the time is the database's, and the day must
-- be a real "today" somewhere on Earth (the UTC date ± 1). Nothing a phone sends can choose another day.
create or replace function public.buyer_blacklist_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_utc date := (now() at time zone 'UTC')::date;
begin
  new.buyer_label := btrim(coalesce(new.buyer_label, ''), E' \t\r\n 　');
  if new.platform = 'tiktok' then
    new.buyer_label := btrim(regexp_replace(new.buyer_label, '^@', ''), E' \t\r\n 　');
  end if;
  new.buyer_key := public.buyer_blacklist_key(new.platform, new.buyer_label);
  new.created_at := now();
  new.added_day := coalesce(new.added_day, v_utc);
  if new.added_day < v_utc - 1 or new.added_day > v_utc + 1 then
    raise exception 'blacklist_bad_day' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_buyer_blacklist_before_insert on public.buyer_blacklist;
create trigger trg_buyer_blacklist_before_insert
  before insert on public.buyer_blacklist
  for each row execute function public.buyer_blacklist_before_insert();

alter table public.buyer_blacklist enable row level security;

drop policy if exists buyer_blacklist_select on public.buyer_blacklist;
drop policy if exists buyer_blacklist_insert on public.buyer_blacklist;
drop policy if exists buyer_blacklist_delete on public.buyer_blacklist;
create policy buyer_blacklist_select on public.buyer_blacklist
  for select to authenticated using (user_id = (select auth.uid()));
create policy buyer_blacklist_insert on public.buyer_blacklist
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy buyer_blacklist_delete on public.buyer_blacklist
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on table public.buyer_blacklist from public, anon;
revoke all on table public.buyer_blacklist from authenticated;
grant select, insert, delete on table public.buyer_blacklist to authenticated;

-- ADD: one buyer + one reason for the seller's own "today". Runs as the signed-in seller (row level
-- security applies). Answers {"result":"added","id":…,"day":…} or {"result":"already_today","day":…}.
-- p_tz = the phone's time zone name (e.g. 'Asia/Manila'); unknown, odd or missing → UTC.
create or replace function public.blacklist_add(p_platform text, p_label text, p_reason text, p_tz text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tz  text := btrim(coalesce(p_tz, ''));
  v_utc date := (now() at time zone 'UTC')::date;
  v_day date;
  v_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_tz = '' or char_length(v_tz) > 64 or v_tz !~ '^[A-Za-z][A-Za-z0-9_+/-]*$' then
    v_tz := 'UTC';
  end if;
  begin
    v_day := (now() at time zone v_tz)::date;
  exception when others then
    v_day := v_utc;
  end;
  if v_day < v_utc - 1 or v_day > v_utc + 1 then
    v_day := v_utc;
  end if;
  insert into public.buyer_blacklist (user_id, platform, buyer_label, buyer_key, reason, added_day)
  values (auth.uid(), p_platform, coalesce(p_label, ''), '', p_reason, v_day)
  on conflict on constraint buyer_blacklist_once_a_day do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('result', 'already_today', 'day', v_day);
  end if;
  return jsonb_build_object('result', 'added', 'id', v_id, 'day', v_day);
end;
$$;

-- REMOVE: every row of one buyer (all reasons, all days) from the seller's own list. Answers how many
-- rows went. Runs as the signed-in seller (row level security applies).
create or replace function public.blacklist_remove(p_platform text, p_label text)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  delete from public.buyer_blacklist
  where user_id = auth.uid()
    and platform = p_platform
    and buyer_key = public.buyer_blacklist_key(p_platform, p_label);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.buyer_blacklist_key(text, text) from public, anon;
revoke all on function public.buyer_blacklist_before_insert() from public, anon, authenticated;
revoke all on function public.blacklist_add(text, text, text, text) from public, anon;
revoke all on function public.blacklist_remove(text, text) from public, anon;
grant execute on function public.buyer_blacklist_key(text, text) to authenticated;
grant execute on function public.blacklist_add(text, text, text, text) to authenticated;
grant execute on function public.blacklist_remove(text, text) to authenticated;

-- The tester key: the live list of 2026-11-20 + 'blacklist'.
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

commit;
