-- ============================================================================
-- sql/150 — Customers: "one username = one record" on a parcel save (Jeff 2026-11-12).
-- ============================================================================
-- NOT APPLIED. Jeff / chat applies via Supabase MCP after review. Needs sql/149 first (the switch row
-- scan_qr_lookup_enabled and the feature key scan_qr_lookup). NO table, column, index, trigger or policy
-- is created or changed — only the two functions the existing triggers already call, + two small helpers:
--   public.upsert_parcel_customer()      parcel_scans    → parcel_customers      (7-11)
--   public.upsert_fm_parcel_customer()   fm_parcel_scans → fm_parcel_customers   (FamilyMart)
--   public.scan_qr_username_key(text)    rule #4: which username a contact text stands for
--   public.scan_qr_lookup_on(uuid)       is Scan QR lookup on for this seller (switch OR listed login)
--
-- Built from the LIVE definitions read on 2026-11-12 (pg_get_functiondef). Every statement of the live
-- functions is kept, in the same order: blank phone = nothing; a restricted phone removes the buyer; a
-- store that is not valid / unchecked / unknown is not added; "store full" is no reason; the insert … on
-- conflict statement is unchanged, character for character.
--
-- WHAT IS NEW — only for a seller whose account has Scan QR lookup on (switch 'true' OR login listed):
--   When the saved parcel has a username (rule #4), and its app is TikTok or none:
--     · the seller's records of that same username in that table are found (rule #4, TikTok or no app);
--     · none → exactly as before (same phone + name decides);
--     · some → ONE stays and takes the parcel's name, phone, store, full contact text and app, updated now:
--         – normally the NEWEST of them;
--         – but if a record with the parcel's phone + name already exists, THAT one stays (it is the
--           record the unchanged statement writes to; the unique index allows no second one) — a safe merge;
--       the seller's OTHER records of that username in that table are deleted.
--   A parcel with no contact / "no social handle" / another app (LINE, WhatsApp …) / a contact that is not
--   a username (rule #4) → exactly as before. A seller without Scan QR lookup → exactly as before.
--   Any error inside the new part → exactly as before, and the clean-up is skipped. The parcel save never
--   fails because of it.
--
-- Old data is NOT touched in bulk: no backfill, no mass delete. A username is tidied only when a new parcel
-- of that username is saved. Editing a buyer on the Customer Details screen is not affected (parcel save only).
--
-- The DO block below STOPS the whole file if either function is no longer the version this file was built
-- from (and is not already this file's version) — then rebuild sql/150 from the live definition first.
--
-- Apply check (nothing is changed by these):
--   select public.scan_qr_username_key('@Pedro123 (U)');                       -- pedro123
--   select position('sql/150' in pg_get_functiondef('public.upsert_parcel_customer'::regproc)) > 0;      -- true
--   select position('sql/150' in pg_get_functiondef('public.upsert_fm_parcel_customer'::regproc)) > 0;   -- true
--   select has_function_privilege('authenticated', 'public.scan_qr_lookup_on(uuid)', 'EXECUTE');          -- false
-- Proof on a temporary database (never the live one): scripts/sql150-behaviour.mjs.
-- Rollback: sql/150_one_username_one_record_rollback.sql (records already merged are not brought back).
-- ============================================================================
begin;

do $check$
declare
  f record;
begin
  for f in
    select * from (values
      ('public.upsert_parcel_customer()',    '0b295f54f336ea3afb163410a09e83e8'),
      ('public.upsert_fm_parcel_customer()', 'b2cd4f054ab79c2983482f39e1a9f764')
    ) as v(fn, built_from)
  loop
    if position('sql/150' in pg_get_functiondef(f.fn::regprocedure)) = 0
       and md5(pg_get_functiondef(f.fn::regprocedure)) <> f.built_from then
      raise exception 'sql/150: % is not the version this file was built from (2026-11-12). Rebuild sql/150 from the live definition first.', f.fn;
    end if;
  end loop;
end
$check$;

-- Rule #4 — the username a saved contact text stands for (lower case), or NULL when it stands for none.
--   'pedro123' / '@pedro123' / '@Pedro123'                                  → pedro123   (the text is the username)
--   '@pedro123 (U)' / '@pedro123 #3' / '@ pedro123' / '@pedro123 Garcia (NA)' → pedro123   ('@' + that FIRST word)
--   '@pedro12' → pedro12 · '@pedro1234' → pedro1234                          (other usernames)
--   '(U) @pedro123' / 'Pedro Garcia' / 'pedro123 (U)' / '@pedro123(U)' / 'unknown' / ''  → NULL
-- "Space" = plain space, tab and new lines only. MUST stay equal to usernameKeyOf() in
-- src/redesign/adapters/scanQrLookup.ts — the same example list is run against both.
create or replace function public.scan_qr_username_key(p_text text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $fn$
  select nullif(lower(coalesce(
    substring(p_text from '^[ \t\n\r\f\v]*([A-Za-z0-9._]{1,50})[ \t\n\r\f\v]*$'),
    substring(p_text from '^[ \t\n\r\f\v]*@[ \t\n\r\f\v]*([A-Za-z0-9._]{1,50})(?:[ \t\n\r\f\v].*)?$')
  )), 'unknown');
$fn$;

-- Is "Scan QR lookup" on for this seller? The switch for everyone (sql/149) OR this seller's login on the
-- list (feature 'scan_qr_lookup' — the SAME match as my_feature_access()). Missing row / no email = off.
create or replace function public.scan_qr_lookup_on(p_user uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $fn$
  select coalesce((select s.value = 'true' from public.app_settings s where s.key = 'scan_qr_lookup_enabled'), false)
      or exists (
        select 1
          from auth.users u
          join public.feature_access_emails f on f.feature = 'scan_qr_lookup'
         where u.id = p_user
           and lower(btrim(coalesce(u.email, ''))) <> ''
           and (lower(btrim(coalesce(u.email, ''))) = f.email
                or (f.is_prefix and left(lower(btrim(coalesce(u.email, ''))), length(f.email)) = f.email))
      );
$fn$;

-- Only the two trigger functions (owner) call these — no browser role needs them.
revoke all on function public.scan_qr_username_key(text) from public, anon, authenticated;
revoke all on function public.scan_qr_lookup_on(uuid)    from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_parcel_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_name  text := nullif(trim(coalesce(new.customer_name, '')), '');
  v_notes text := nullif(trim(coalesce(new.notes, '')), '');
  -- sql/150 — one username = one record (only for accounts with Scan QR lookup on)
  v_key   text;              -- the username this parcel's contact stands for (rule #4), or null
  v_ids   uuid[];            -- this seller's records of that username, newest first
  v_keep  uuid;              -- the one record that stays
  v_done  boolean := false;  -- true = the parcel is already written into v_keep
begin
  if v_phone = '' then
    return new;
  end if;

  -- Rule 2: restricted verdict arrived → remove this buyer from the phonebook.
  if new.phone_check_status = 'restricted' then
    delete from public.parcel_customers
     where user_id = new.user_id
       and phone = v_phone
       and lower(trim(coalesce(name, ''))) = lower(trim(coalesce(v_name, '')));
    return new;
  end if;

  -- Rule 1: explicit non-valid store check → do not add.
  if new.store_check_status is not null
     and new.store_check_status not in ('valid', 'unchecked', 'unknown') then
    return new;
  end if;

  -- sql/150 — one username = one record. Runs only when this parcel has a username (rule #4), its app is
  -- TikTok or none, and the seller's account has Scan QR lookup on. Anything else, and ANY error in here,
  -- falls through to the statement below exactly as before — the parcel save itself can never fail from this.
  begin
    v_key := public.scan_qr_username_key(v_notes);
    if v_key is not null
       and (new.contact_platform is null or new.contact_platform = 'tiktok')
       and public.scan_qr_lookup_on(new.user_id) then
      select array_agg(c.id order by c.updated_at desc, c.id)
        into v_ids
        from public.parcel_customers c
       where c.user_id = new.user_id
         and (c.contact_platform is null or c.contact_platform = 'tiktok')
         and c.notes is not null
         and position(v_key in lower(c.notes)) > 0
         and public.scan_qr_username_key(c.notes) = v_key;
      if v_ids is not null then
        -- The record the statement below writes to (same phone + name), if there is one. It must take the
        -- parcel (the unique index allows no second one), so it is the record that stays.
        select c.id
          into v_keep
          from public.parcel_customers c
         where c.user_id = new.user_id
           and c.phone = v_phone
           and lower(trim(coalesce(c.name, ''))) = lower(trim(coalesce(v_name, '')));
        if v_keep is null then
          -- No such record: the NEWEST record of this username takes the new name, phone, store and contact.
          v_keep := v_ids[1];
          update public.parcel_customers c
             set name             = v_name,
                 phone            = v_phone,
                 store_id         = coalesce(nullif(trim(coalesce(new.store_id,'')), ''), c.store_id),
                 notes            = v_notes,
                 contact_platform = new.contact_platform,
                 updated_at       = now()
           where c.id = v_keep
             and c.user_id = new.user_id;
          if found then
            v_done := true;
          else
            v_ids := null; v_keep := null;  -- the record went away meanwhile → as before, no clean-up
          end if;
        end if;
      end if;
    end if;
  exception when others then
    v_ids := null; v_keep := null; v_done := false;  -- as before, no clean-up
  end;

  if not v_done then
  insert into public.parcel_customers (user_id, phone, name, store_id, notes, contact_platform, updated_at)
  values (
    new.user_id,
    v_phone,
    v_name,
    nullif(trim(coalesce(new.store_id,'')), ''),
    v_notes,
    case when v_notes is null then null else new.contact_platform end,
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id         = coalesce(excluded.store_id, parcel_customers.store_id),
        notes            = coalesce(excluded.notes,    parcel_customers.notes),
        contact_platform = case when excluded.notes is null then parcel_customers.contact_platform else excluded.contact_platform end,
        updated_at       = now();
  end if;

  -- sql/150 — the other records of this username go (only after the parcel is safely in v_keep).
  if v_ids is not null and v_keep is not null then
    begin
      delete from public.parcel_customers c
       where c.user_id = new.user_id
         and c.id = any(v_ids)
         and c.id <> v_keep
         and (c.contact_platform is null or c.contact_platform = 'tiktok')
         and public.scan_qr_username_key(c.notes) = v_key;
    exception when others then
      null;  -- the clean-up is skipped; the parcel and its record are already saved
    end;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_fm_parcel_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_user  text := nullif(trim(coalesce(new.buyer_username, '')), '');
  -- sql/150 — one username = one record (only for accounts with Scan QR lookup on)
  v_name  text := nullif(trim(coalesce(new.recipient_name, '')), '');
  v_key   text;              -- the username this parcel's contact stands for (rule #4), or null
  v_ids   uuid[];            -- this seller's records of that username, newest first
  v_keep  uuid;              -- the one record that stays
  v_done  boolean := false;  -- true = the parcel is already written into v_keep
begin
  if v_phone = '' then
    return new;
  end if;
  -- sql/150 — one username = one record. Runs only when this parcel has a username (rule #4), its app is
  -- TikTok or none, and the seller's account has Scan QR lookup on. Anything else, and ANY error in here,
  -- falls through to the statement below exactly as before — the parcel save itself can never fail from this.
  begin
    v_key := public.scan_qr_username_key(v_user);
    if v_key is not null
       and (new.contact_platform is null or new.contact_platform = 'tiktok')
       and public.scan_qr_lookup_on(new.user_id) then
      select array_agg(c.id order by c.updated_at desc, c.id)
        into v_ids
        from public.fm_parcel_customers c
       where c.user_id = new.user_id
         and (c.contact_platform is null or c.contact_platform = 'tiktok')
         and c.buyer_username is not null
         and position(v_key in lower(c.buyer_username)) > 0
         and public.scan_qr_username_key(c.buyer_username) = v_key;
      if v_ids is not null then
        -- The record the statement below writes to (same phone + name), if there is one. It must take the
        -- parcel (the unique index allows no second one), so it is the record that stays.
        select c.id
          into v_keep
          from public.fm_parcel_customers c
         where c.user_id = new.user_id
           and c.phone = v_phone
           and lower(trim(coalesce(c.name, ''))) = lower(trim(coalesce(v_name, '')));
        if v_keep is null then
          -- No such record: the NEWEST record of this username takes the new name, phone, store and contact.
          v_keep := v_ids[1];
          update public.fm_parcel_customers c
             set name             = v_name,
                 phone            = v_phone,
                 store_id         = coalesce(nullif(trim(coalesce(new.store_id, '')), ''), c.store_id),
                 buyer_username   = v_user,
                 contact_platform = new.contact_platform,
                 updated_at       = now()
           where c.id = v_keep
             and c.user_id = new.user_id;
          if found then
            v_done := true;
          else
            v_ids := null; v_keep := null;  -- the record went away meanwhile → as before, no clean-up
          end if;
        end if;
      end if;
    end if;
  exception when others then
    v_ids := null; v_keep := null; v_done := false;  -- as before, no clean-up
  end;

  if not v_done then
  insert into public.fm_parcel_customers (user_id, phone, name, store_id, buyer_username, contact_platform, updated_at)
  values (
    new.user_id,
    v_phone,
    nullif(trim(coalesce(new.recipient_name, '')), ''),
    nullif(trim(coalesce(new.store_id, '')), ''),
    v_user,
    case when v_user is null then null else new.contact_platform end,
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id         = coalesce(excluded.store_id, fm_parcel_customers.store_id),
        buyer_username   = coalesce(excluded.buyer_username, fm_parcel_customers.buyer_username),
        contact_platform = case when excluded.buyer_username is null then fm_parcel_customers.contact_platform else excluded.contact_platform end,
        updated_at       = now();
  end if;

  -- sql/150 — the other records of this username go (only after the parcel is safely in v_keep).
  if v_ids is not null and v_keep is not null then
    begin
      delete from public.fm_parcel_customers c
       where c.user_id = new.user_id
         and c.id = any(v_ids)
         and c.id <> v_keep
         and (c.contact_platform is null or c.contact_platform = 'tiktok')
         and public.scan_qr_username_key(c.buyer_username) = v_key;
    exception when others then
      null;  -- the clean-up is skipped; the parcel and its record are already saved
    end;
  end if;
  return new;
end;
$function$;

commit;
