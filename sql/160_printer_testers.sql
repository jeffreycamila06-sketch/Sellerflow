-- ============================================================================
-- sql/160 — Printer testers + Admin-approved printers + the web-side scan filter (Jeff 2026-11-15).
-- ============================================================================
-- NOT APPLIED. Jeff / chat applies via Supabase MCP after review. ADD-ONLY (nothing existing is
-- changed except my_feature_access(), which gains ONE key):
--   1. app_settings  printer_scan_web_filter = 'false'  — 'true' = the normal Printer settings Scan asks
--      the phone for every device and the WEB keeps only the listed printers (fixes a Niimbot B1 Pro that
--      needed "Show all"). 'false' = today's scan call and list exactly.
--   2. my_feature_access() gains the key  printer_tester  (feature_access_emails, like the others).
--   3. is_printer_tester() — true for the signed-in LOGIN email on that list (security definer).
--   4. printer_test_reports — one row per tester report. RLS: a tester inserts ONLY their own row
--      (the tester flag is checked here, server-side); admins read / update; nobody else reads.
--      `email` is set by a trigger from auth.users (never trusted from the app). No buyer data:
--      printer name, the phone's BLE facts for it, language, sticker size, send result, clean, photo path.
--   5. approved_printers — the Admin-approved list. Every signed-in device reads the ACTIVE rows (the
--      app's scan whitelist = built-in list first + these). Written ONLY through the admin RPCs below.
--   6. Admin-only RPCs (security definer, is_admin() inside, search_path set): testers list / add /
--      remove, reports list, approved list, approve a CLEAN report, set a row active / inactive.
--   7. Storage bucket  printer-test-photos  (PRIVATE, 2 MB, images). A tester uploads into their own
--      folder (<uid>/…) only; only admins can read (signed URLs). No update / delete policy.
--
-- ⚠️ my_feature_access(): build it from the LIVE definition at apply time
--   (select pg_get_functiondef('public.my_feature_access'::regproc)) keeping EVERY key it already has +
--   'printer_tester'. The version below = sql/155's list + the one.
-- ⚠️ Do NOT revoke EXECUTE on the admin RPCs from `authenticated` — admins ARE `authenticated`;
--   the protection is the is_admin() check inside each function.
--
-- Add a tester (LOGIN email, lower case) — or from Admin → Printer testers:
--   insert into public.feature_access_emails (feature, email, is_prefix) values ('printer_tester', '<login email>', false) on conflict do nothing;
-- Rollback: sql/160_printer_testers_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- 1) the switch (starts OFF) ---------------------------------------------------------------
insert into public.app_settings (key, value) values ('printer_scan_web_filter', 'false')
on conflict (key) do nothing;

-- 2) the feature key ------------------------------------------------------------------------
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- 3) is_printer_tester() --------------------------------------------------------------------
create or replace function public.is_printer_tester()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  )
  select exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = 'printer_tester' and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  );
$$;
revoke all on function public.is_printer_tester() from public, anon;
grant execute on function public.is_printer_tester() to authenticated;

-- 4) printer_test_reports -------------------------------------------------------------------
create table if not exists public.printer_test_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email        text not null default '',
  printer_name text not null check (char_length(printer_name) between 1 and 120),
  ble_facts    jsonb not null default '{}'::jsonb check (jsonb_typeof(ble_facts) = 'object' and pg_column_size(ble_facts) <= 4000),
  lang         text not null check (lang in ('tspl', 'escpos', 'cpcl')),
  sticker_size text not null default '' check (char_length(sticker_size) <= 40),
  send_ok      boolean not null,
  send_code    text null check (send_code is null or char_length(send_code) <= 60),
  clean        boolean not null,
  photo_path   text null check (photo_path is null or char_length(photo_path) <= 200),
  created_at   timestamptz not null default now(),
  constraint printer_test_reports_clean_photo check (not clean or photo_path is not null),
  constraint printer_test_reports_own_photo check (photo_path is null or left(photo_path, 37) = user_id::text || '/')
);
create index if not exists printer_test_reports_created_idx on public.printer_test_reports (created_at desc);
alter table public.printer_test_reports enable row level security;

-- the login email, from auth.users (the app's value is ignored)
create or replace function public.printer_test_reports_set_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.email := lower(btrim(coalesce((select u.email from auth.users u where u.id = new.user_id), '')));
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.printer_test_reports_set_email() from public, anon, authenticated;
drop trigger if exists trg_printer_test_reports_email on public.printer_test_reports;
create trigger trg_printer_test_reports_email before insert on public.printer_test_reports
  for each row execute function public.printer_test_reports_set_email();

revoke all on public.printer_test_reports from anon, authenticated;
grant insert, select, update on public.printer_test_reports to authenticated;
drop policy if exists ptr_insert_own_tester on public.printer_test_reports;
create policy ptr_insert_own_tester on public.printer_test_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_printer_tester());
drop policy if exists ptr_select_admin on public.printer_test_reports;
create policy ptr_select_admin on public.printer_test_reports for select to authenticated
  using (public.is_admin());
drop policy if exists ptr_update_admin on public.printer_test_reports;
create policy ptr_update_admin on public.printer_test_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 5) approved_printers ----------------------------------------------------------------------
create table if not exists public.approved_printers (
  id          uuid primary key default gen_random_uuid(),
  prefix      text not null check (char_length(btrim(prefix)) between 2 and 40),
  brand       text not null default 'Other' check (char_length(brand) between 1 and 40),
  model       text not null check (char_length(model) between 1 and 80),
  lang        text not null check (lang in ('tspl', 'escpos', 'cpcl')),
  report_id   uuid null references public.printer_test_reports(id) on delete set null,
  approved_by uuid null references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  active      boolean not null default true
);
alter table public.approved_printers enable row level security;
revoke all on public.approved_printers from anon, authenticated;
grant select on public.approved_printers to authenticated;
drop policy if exists ap_select on public.approved_printers;
create policy ap_select on public.approved_printers for select to authenticated
  using (active or public.is_admin());
-- no insert / update / delete policy: written only by the admin RPCs below (security definer)

-- 6) admin RPCs -----------------------------------------------------------------------------
create or replace function public.admin_printer_testers()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email', f.email, 'created_at', f.created_at) order by f.created_at desc, f.email)
                     from public.feature_access_emails f where f.feature = 'printer_tester'), '[]'::jsonb);
end;
$$;

create or replace function public.admin_printer_tester_add(p_email text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(e) > 254 then raise exception 'bad_email' using errcode = '22023'; end if;
  insert into public.feature_access_emails (feature, email, is_prefix) values ('printer_tester', e, false)
  on conflict (feature, email) do nothing;
  return true;
end;
$$;

create or replace function public.admin_printer_tester_remove(p_email text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.feature_access_emails where feature = 'printer_tester' and email = lower(btrim(coalesce(p_email, '')));
  return found;
end;
$$;

create or replace function public.admin_printer_test_reports()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc)
                     from (select id, email, printer_name, ble_facts, lang, sticker_size, send_ok, send_code, clean, photo_path, created_at
                             from public.printer_test_reports order by created_at desc limit 200) r), '[]'::jsonb);
end;
$$;

create or replace function public.admin_approved_printers()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'prefix', a.prefix, 'brand', a.brand, 'model', a.model, 'lang', a.lang,
                                                       'active', a.active, 'approved_at', a.approved_at, 'report_id', a.report_id)
                                    order by a.approved_at desc)
                     from public.approved_printers a), '[]'::jsonb);
end;
$$;

create or replace function public.admin_approve_printer(p_report uuid, p_prefix text, p_brand text, p_model text, p_lang text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid; nid uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into rid from public.printer_test_reports where id = p_report and clean;
  if rid is null then raise exception 'report_not_clean' using errcode = '22023'; end if;
  insert into public.approved_printers (prefix, brand, model, lang, report_id, approved_by)
  values (btrim(p_prefix), coalesce(nullif(btrim(p_brand), ''), 'Other'), coalesce(nullif(btrim(p_model), ''), btrim(p_prefix)), p_lang, rid, auth.uid())
  returning id into nid;
  return nid;
end;
$$;

create or replace function public.admin_set_approved_printer_active(p_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.approved_printers set active = coalesce(p_active, false) where id = p_id;
  return found;
end;
$$;

revoke all on function public.admin_printer_testers() from public, anon;
revoke all on function public.admin_printer_tester_add(text) from public, anon;
revoke all on function public.admin_printer_tester_remove(text) from public, anon;
revoke all on function public.admin_printer_test_reports() from public, anon;
revoke all on function public.admin_approved_printers() from public, anon;
revoke all on function public.admin_approve_printer(uuid, text, text, text, text) from public, anon;
revoke all on function public.admin_set_approved_printer_active(uuid, boolean) from public, anon;
grant execute on function public.admin_printer_testers() to authenticated;
grant execute on function public.admin_printer_tester_add(text) to authenticated;
grant execute on function public.admin_printer_tester_remove(text) to authenticated;
grant execute on function public.admin_printer_test_reports() to authenticated;
grant execute on function public.admin_approved_printers() to authenticated;
grant execute on function public.admin_approve_printer(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_set_approved_printer_active(uuid, boolean) to authenticated;

-- 7) the private photo bucket ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('printer-test-photos', 'printer-test-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists printer_test_photos_insert_own_tester on storage.objects;
create policy printer_test_photos_insert_own_tester on storage.objects for insert to authenticated
  with check (bucket_id = 'printer-test-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.is_printer_tester());
drop policy if exists printer_test_photos_read_admin on storage.objects;
create policy printer_test_photos_read_admin on storage.objects for select to authenticated
  using (bucket_id = 'printer-test-photos' and public.is_admin());

commit;
