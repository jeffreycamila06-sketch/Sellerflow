-- ============================================================================
-- sql/230 — Printer Tuning (part 2): per-seller printer settings + the Test Print report (Jeff 2026-11-27).
-- ============================================================================
-- NOT APPLIED. Needs sql/160 + sql/161 + sql/229. Admin-only writes; OFF by default.
--   1. app_settings  printer_tuning_enabled = 'false'  (insert if missing; no other key touched).
--   2. printer_seller_tuning — ONE row per seller: settings (jsonb, every key optional, checked by
--      printer_tuning_valid), version (+1 at every change), updated_at, updated_by. RLS: a seller SELECTs
--      only their own row; nobody writes it except the admin RPCs below (security definer).
--   3. printer_seller_tuning_history — every set / undo / reset (settings before + after). No seller access.
--   4. printer_test_reports.tuning_version (nullable) — the tuning version a Test Print report was made with;
--      admin_printer_test_reports() returns it (= sql/160's text + that one key, md5 guard).
--   5. Admin RPCs (is_admin() inside): admin_printer_tuning_get / _set / _undo / _reset. A tuning belongs to ONE
--      printer: _set stores the seller's latest tested printer name (printer_name) and refuses 'no_printer' when
--      the seller has no test report yet; the app applies it only to a saved printer with exactly that name. _set refuses
--      'built_in_printer' when the seller's latest tested printer is a built-in name, 'stale_version' when
--      someone else saved first, 'bad_settings' for an unknown key / a wrong type. Numbers are CLAMPED to
--      the ranges and rounded to the steps (never refused for being out of range).
--   6. my_printer_tuning() → {enabled, tester, settings, version, printer_name}: the caller's OWN row (rows are only ever
--      made by an Admin) — it keeps printing after the seller leaves the testers list. Switch value 'off' =
--      settings null for everyone (instant stop = today's bytes).
--   7. The switch app_settings.printer_tuning_enabled (created 'false'): 'true' = Admin may tune any seller;
--      anything else = Admin may save a NEW setting only for a seller on the printer testers list
--      ('not_tester'); 'off' = additionally nothing is applied anywhere.
-- Settings keys (all optional): gap_mm 0–6 step 0.5 · sensor gap|bline|continuous · shift_mm -5..5 step 0.5
-- (+ = left, - = right) · flip true|false · density 0–15 · speed 1–6 · send_speed normal|slow.
-- The built-in names = printerModels.ts WHITELIST + NIIMBOT_NAME_PREFIXES + BUILT_IN (pinned by
-- printerTuningSql.test.ts) — those printers are never tuned (the app never applies tuning to them either).
-- ⚠️ Do NOT revoke EXECUTE from `authenticated` — admins ARE `authenticated`; is_admin() inside protects it.
-- Rollback: sql/230_printer_tuning_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- admin_printer_test_reports must be exactly the live text (read 2026-11-27 = sql/160's) — or this file's own
-- text (a second run changes nothing)
do $$
declare got text;
begin
  select md5(pg_get_functiondef(p.oid)) into got from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_printer_test_reports';
  if got is null or got not in ('3484fbe3e4e1b451fbebc1d9f043edf4', '6993f8e8054b203045cfa45c3e537f6b') then
    raise exception 'sql/230: admin_printer_test_reports is not the expected live text (%) — nothing changed', got;
  end if;
end $$;

-- 1) the switch (starts OFF) ---------------------------------------------------------------
insert into public.app_settings (key, value) values ('printer_tuning_enabled', 'false')
on conflict (key) do nothing;

-- 2) the settings rule ---------------------------------------------------------------------
-- true = an object whose keys are all known, each of the right type and inside its range / step.
create or replace function public.printer_tuning_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare k text; v jsonb; n numeric;
begin
  if s is null or jsonb_typeof(s) <> 'object' or pg_column_size(s) > 600 then return false; end if;
  for k, v in select * from jsonb_each(s) loop
    if k in ('gap_mm', 'shift_mm', 'density', 'speed') then
      if jsonb_typeof(v) <> 'number' then return false; end if;
      n := (v #>> '{}')::numeric;
      if k = 'gap_mm' and not (n between 0 and 6 and n * 2 = trunc(n * 2)) then return false; end if;
      if k = 'shift_mm' and not (n between -5 and 5 and n * 2 = trunc(n * 2)) then return false; end if;
      if k = 'density' and not (n between 0 and 15 and n = trunc(n)) then return false; end if;
      if k = 'speed' and not (n between 1 and 6 and n = trunc(n)) then return false; end if;
    elsif k = 'flip' then
      if jsonb_typeof(v) <> 'boolean' then return false; end if;
    elsif k = 'sensor' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('gap', 'bline', 'continuous') then return false; end if;
    elsif k = 'send_speed' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('normal', 'slow') then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- the cleaner the admin RPC uses: clamps numbers into range, rounds to the step, drops JSON nulls;
-- an unknown key or a wrong type raises 'bad_settings'.
create or replace function public.printer_tuning_clean(s jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare k text; v jsonb; n numeric; out jsonb := '{}'::jsonb;
begin
  if s is null or jsonb_typeof(s) <> 'object' then raise exception 'bad_settings' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(s) loop
    continue when jsonb_typeof(v) = 'null';
    if k in ('gap_mm', 'shift_mm', 'density', 'speed') then
      if jsonb_typeof(v) <> 'number' then raise exception 'bad_settings' using errcode = '22023'; end if;
      n := (v #>> '{}')::numeric;
      if k = 'gap_mm' then n := least(6, greatest(0, round(n * 2) / 2));
      elsif k = 'shift_mm' then n := least(5, greatest(-5, round(n * 2) / 2));
      elsif k = 'density' then n := least(15, greatest(0, round(n)));
      else n := least(6, greatest(1, round(n)));
      end if;
      out := out || jsonb_build_object(k, n);
    elsif k = 'flip' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'bad_settings' using errcode = '22023'; end if;
      out := out || jsonb_build_object(k, v);
    elsif k = 'sensor' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('gap', 'bline', 'continuous') then raise exception 'bad_settings' using errcode = '22023'; end if;
      out := out || jsonb_build_object(k, v);
    elsif k = 'send_speed' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('normal', 'slow') then raise exception 'bad_settings' using errcode = '22023'; end if;
      out := out || jsonb_build_object(k, v);
    else
      raise exception 'bad_settings' using errcode = '22023';
    end if;
  end loop;
  return out;
end;
$$;

-- a printer name the app's built-in rules know (the same 8 prefixes as sql/229's overlap rule)
create or replace function public.printer_name_is_built_in(p_name text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(btrim(p_name), '') <> '' and exists (
    select 1 from unnest(array['D520BT', 'Y41BT', 'B1 Pro-', 'B1-', 'B21-', 'B203-', 'B3S-', 'XP-420B']) b
     where left(upper(btrim(p_name)), length(b)) = upper(b));
$$;

-- 3) the tables ----------------------------------------------------------------------------
create table if not exists public.printer_seller_tuning (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  settings   jsonb not null check (public.printer_tuning_valid(settings)),
  printer_name text null check (printer_name is null or length(printer_name) <= 120), -- the printer this was made for (its test name)
  version    int not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);
alter table public.printer_seller_tuning enable row level security;
revoke all on public.printer_seller_tuning from anon, authenticated;
grant select on public.printer_seller_tuning to authenticated;
drop policy if exists pst_select_own on public.printer_seller_tuning;
create policy pst_select_own on public.printer_seller_tuning for select to authenticated
  using (user_id = (select auth.uid()));
-- no insert / update / delete policy: written only by the admin RPCs below

create table if not exists public.printer_seller_tuning_history (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  action          text not null check (action in ('set', 'undo', 'reset')),
  settings_before jsonb null,
  settings_after  jsonb null,
  version_after   int null,
  undone          boolean not null default false,
  changed_by      uuid null references auth.users(id) on delete set null,
  changed_at      timestamptz not null default now()
);
create index if not exists pst_history_user_idx on public.printer_seller_tuning_history (user_id, id desc);
alter table public.printer_seller_tuning_history enable row level security;
revoke all on public.printer_seller_tuning_history from anon, authenticated;
revoke all on sequence public.printer_seller_tuning_history_id_seq from anon, authenticated;
-- no policy at all: only the admin RPCs (security definer) read / write it

-- 4) the report knows which tuning it was made with ----------------------------------------
alter table public.printer_test_reports add column if not exists tuning_version int null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'printer_test_reports_tuning_version_check') then
    alter table public.printer_test_reports add constraint printer_test_reports_tuning_version_check check (tuning_version is null or tuning_version >= 1);
  end if;
end $$;

create or replace function public.admin_printer_test_reports()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc)
                     from (select id, email, printer_name, ble_facts, lang, sticker_size, send_ok, send_code, clean, photo_path, created_at, tuning_version
                             from public.printer_test_reports order by created_at desc limit 200) r), '[]'::jsonb);
end;
$$;

-- 5) admin RPCs ----------------------------------------------------------------------------
-- the seller's login id from the email (lower case, trimmed); raises 'no_user'
create or replace function public.printer_tuning_user(p_email text)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  select u.id into uid from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if uid is null then raise exception 'no_user' using errcode = '22023'; end if;
  return uid;
end;
$$;

-- the highest version this seller ever had (row or history) — versions never repeat, so a report's
-- tuning_version always names ONE settings set, also after a reset / an undo to nothing
create or replace function public.printer_tuning_top_version(p_user uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(coalesce((select t.version from public.printer_seller_tuning t where t.user_id = p_user), 0),
                  coalesce((select max(h.version_after) from public.printer_seller_tuning_history h where h.user_id = p_user), 0));
$$;

-- the seller's latest tested printer name ('' when none)
create or replace function public.printer_tuning_latest_name(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select r.printer_name from public.printer_test_reports r where r.user_id = p_user
                    order by r.created_at desc limit 1), '');
$$;

-- is this login email on the printer testers list (sql/160 feature_access_emails, prefix rows too)
create or replace function public.printer_tuning_is_tester(p_email text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.feature_access_emails f where f.feature = 'printer_tester'
                   and (f.email = lower(btrim(coalesce(p_email, ''))) or (f.is_prefix and left(lower(btrim(coalesce(p_email, ''))), length(f.email)) = f.email)));
$$;

create or replace function public.admin_printer_tuning_get(p_email text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid; t public.printer_seller_tuning%rowtype; latest text; e text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  uid := public.printer_tuning_user(p_email);
  e := lower(btrim(p_email));
  select * into t from public.printer_seller_tuning where user_id = uid;
  latest := public.printer_tuning_latest_name(uid);
  return jsonb_build_object(
    'settings', t.settings,
    'tuned_for', t.printer_name,
    'version', coalesce(t.version, 0),
    'updated_at', t.updated_at,
    'switch_on', coalesce((select a.value from public.app_settings a where a.key = 'printer_tuning_enabled'), '') = 'true',
    'tester', public.printer_tuning_is_tester(e),
    'printer_name', nullif(latest, ''),
    'built_in', public.printer_name_is_built_in(latest),
    'locked_name', (select a.model from public.approved_printers a where a.active and a.locked and latest <> ''
                     and left(upper(latest), length(upper(btrim(a.prefix)))) = upper(btrim(a.prefix))
                     order by length(a.prefix) desc limit 1),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'before', h.settings_before,
                                  'after', h.settings_after, 'version', h.version_after, 'undone', h.undone, 'at', h.changed_at) order by h.id desc)
                           from (select * from public.printer_seller_tuning_history where user_id = uid order by id desc limit 20) h), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'printer_name', r.printer_name, 'sticker_size', r.sticker_size,
                                  'lang', r.lang, 'created_at', r.created_at, 'clean', r.clean, 'send_ok', r.send_ok,
                                  'tuning_version', r.tuning_version, 'app_build', r.ble_facts -> 'app_build') order by r.created_at desc)
                           from (select * from public.printer_test_reports where user_id = uid order by created_at desc limit 10) r), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_printer_tuning_set(p_email text, p_settings jsonb, p_expected_version int)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; cur public.printer_seller_tuning%rowtype; clean jsonb; nv int; v_name text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  uid := public.printer_tuning_user(p_email);
  perform pg_advisory_xact_lock(hashtext('printer_tuning_' || uid::text));
  v_name := nullif(btrim(coalesce(public.printer_tuning_latest_name(uid), '')), '');
  if v_name is null then raise exception 'no_printer' using errcode = '22023'; end if;
  if public.printer_name_is_built_in(v_name) then
    raise exception 'built_in_printer' using errcode = '22023';
  end if;
  if coalesce((select a.value from public.app_settings a where a.key = 'printer_tuning_enabled'), '') <> 'true'
     and not public.printer_tuning_is_tester(p_email) then
    raise exception 'not_tester' using errcode = '22023';
  end if;
  clean := public.printer_tuning_clean(p_settings);
  select * into cur from public.printer_seller_tuning where user_id = uid for update;
  if coalesce(cur.version, 0) <> coalesce(p_expected_version, -1) then
    raise exception 'stale_version' using errcode = '40001';
  end if;
  nv := public.printer_tuning_top_version(uid) + 1;
  insert into public.printer_seller_tuning (user_id, settings, printer_name, version, updated_at, updated_by)
  values (uid, clean, left(v_name, 120), nv, now(), auth.uid())
  on conflict (user_id) do update set settings = excluded.settings, printer_name = excluded.printer_name, version = excluded.version,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.printer_seller_tuning_history (user_id, action, settings_before, settings_after, version_after, changed_by)
  values (uid, 'set', cur.settings, clean, nv, auth.uid());
  return nv;
end;
$$;

-- Undo = put back the settings from before the latest change that is not undone yet (repeat = further back).
-- Answers the new version; 0 = the row was removed (settings before = none → today's printing);
-- null = nothing to undo.
create or replace function public.admin_printer_tuning_undo(p_email text, p_expected_version int default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; cur public.printer_seller_tuning%rowtype; h public.printer_seller_tuning_history%rowtype; nv int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  uid := public.printer_tuning_user(p_email);
  perform pg_advisory_xact_lock(hashtext('printer_tuning_' || uid::text));
  select * into cur from public.printer_seller_tuning where user_id = uid for update;
  if p_expected_version is not null and coalesce(cur.version, 0) <> p_expected_version then
    raise exception 'stale_version' using errcode = '40001';
  end if;
  select * into h from public.printer_seller_tuning_history
   where user_id = uid and action in ('set', 'reset') and not undone order by id desc limit 1;
  if h.id is null then return null; end if;
  if h.settings_before is not null and public.printer_name_is_built_in(public.printer_tuning_latest_name(uid)) then
    raise exception 'built_in_printer' using errcode = '22023';
  end if;
  update public.printer_seller_tuning_history set undone = true where id = h.id;
  nv := public.printer_tuning_top_version(uid) + 1;
  if h.settings_before is null then
    delete from public.printer_seller_tuning where user_id = uid;
  else
    insert into public.printer_seller_tuning (user_id, settings, printer_name, version, updated_at, updated_by)
    values (uid, h.settings_before, left(coalesce(nullif(btrim(coalesce(public.printer_tuning_latest_name(uid), '')), ''), cur.printer_name), 120), nv, now(), auth.uid())
    on conflict (user_id) do update set settings = excluded.settings, printer_name = excluded.printer_name, version = excluded.version,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  end if;
  insert into public.printer_seller_tuning_history (user_id, action, settings_before, settings_after, version_after, changed_by)
  values (uid, 'undo', cur.settings, h.settings_before, case when h.settings_before is null then null else nv end, auth.uid());
  return case when h.settings_before is null then 0 else nv end;
end;
$$;

-- Reset = remove the seller's row (history kept). Nothing to reset → false.
create or replace function public.admin_printer_tuning_reset(p_email text, p_expected_version int default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; cur public.printer_seller_tuning%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  uid := public.printer_tuning_user(p_email);
  perform pg_advisory_xact_lock(hashtext('printer_tuning_' || uid::text));
  select * into cur from public.printer_seller_tuning where user_id = uid for update;
  if cur.user_id is null then return false; end if;
  if p_expected_version is not null and cur.version <> p_expected_version then
    raise exception 'stale_version' using errcode = '40001';
  end if;
  delete from public.printer_seller_tuning where user_id = uid;
  insert into public.printer_seller_tuning_history (user_id, action, settings_before, settings_after, version_after, changed_by)
  values (uid, 'reset', cur.settings, null, null, auth.uid());
  return true;
end;
$$;

-- 6) the seller's read ---------------------------------------------------------------------
create or replace function public.my_printer_tuning()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); v_sw text; v_tester boolean; t public.printer_seller_tuning%rowtype;
begin
  if uid is null then return jsonb_build_object('enabled', false, 'tester', false, 'settings', null, 'version', null, 'printer_name', null); end if;
  v_sw := coalesce((select a.value from public.app_settings a where a.key = 'printer_tuning_enabled'), '');
  v_tester := public.is_printer_tester();
  select * into t from public.printer_seller_tuning where user_id = uid;
  return jsonb_build_object(
    'enabled', v_sw = 'true',
    'tester', v_tester,
    'settings', case when v_sw <> 'off' then t.settings else null end,
    'version', case when v_sw <> 'off' and t.user_id is not null then t.version else null end,
    'printer_name', case when v_sw <> 'off' then t.printer_name else null end);
end;
$$;

revoke all on function public.printer_tuning_valid(jsonb) from public, anon, authenticated;
revoke all on function public.printer_tuning_clean(jsonb) from public, anon, authenticated;
revoke all on function public.printer_name_is_built_in(text) from public, anon, authenticated;
revoke all on function public.printer_tuning_user(text) from public, anon, authenticated;
revoke all on function public.printer_tuning_latest_name(uuid) from public, anon, authenticated;
revoke all on function public.printer_tuning_top_version(uuid) from public, anon, authenticated;
revoke all on function public.printer_tuning_is_tester(text) from public, anon, authenticated;
revoke all on function public.admin_printer_tuning_get(text) from public, anon;
revoke all on function public.admin_printer_tuning_set(text, jsonb, int) from public, anon;
revoke all on function public.admin_printer_tuning_undo(text, int) from public, anon;
revoke all on function public.admin_printer_tuning_reset(text, int) from public, anon;
revoke all on function public.my_printer_tuning() from public, anon;
grant execute on function public.admin_printer_tuning_get(text) to authenticated;
grant execute on function public.admin_printer_tuning_set(text, jsonb, int) to authenticated;
grant execute on function public.admin_printer_tuning_undo(text, int) to authenticated;
grant execute on function public.admin_printer_tuning_reset(text, int) to authenticated;
grant execute on function public.my_printer_tuning() to authenticated;

commit;
