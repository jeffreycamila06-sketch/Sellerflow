-- ============================================================================
-- sql/229 — Lock the saved Printer list (Printer Tuning, part 1 — Jeff 2026-11-27).
-- ============================================================================
-- NOT APPLIED. Needs sql/160 + sql/161 first. Admin-only; nothing a seller's phone reads changes:
-- the seller read (loadApprovedPrinters) still selects prefix,brand,model,lang,active,shift_mm,flip.
--   1. approved_printers.locked boolean not null default false.
--   2. locked = true for every ACTIVE row — the migration REFUSES (rolls back) unless exactly 11 rows
--      were locked (the 11 active rows read on production 2026-11-27).
--   3. Trigger trg_approved_printers_lock (BEFORE UPDATE OR DELETE): a locked row can't be deleted and
--      can't change prefix, brand, model, lang, shift_mm, flip, active, report_id, approved_by,
--      approved_at (or id). locked false → true is allowed when nothing else changes. locked true →
--      false only with  set local sfl.printer_unlock = 'on'  in the same transaction (typed by hand in
--      the SQL editor — no RPC ever sets it). The check never looks at current_user / role: the admin
--      RPCs are SECURITY DEFINER and run as postgres.
--   4. admin_lock_approved_printer(p_id) — admin only (is_admin() inside); locks an ACTIVE row. There is
--      no unlock RPC.
--   5. admin_approved_printers() also returns locked.
--   6. admin_approve_printer(): refuses 'prefix_overlaps_locked' when the new name overlaps an active
--      locked row or a built-in printer name (overlap = one starts with the other, upper case, btrim).
--   7. admin_set_approved_printer_active(): putting a NOT locked row back on (active true) is refused the
--      same way when it overlaps a locked / built-in name (today: the removed duplicate "XP-470B" row).
--      A locked row: the trigger refuses ('printer_locked').
-- The built-in names = every prefix the app's built-in rules know (printerModels.ts WHITELIST +
-- NIIMBOT_NAME_PREFIXES + BUILT_IN) — pinned equal by approvedPrinterLock.test.ts.
-- ⚠️ A locked row also stops a delete of the printer test report it came from, and the delete of the
--   admin login that approved it (both foreign keys are ON DELETE SET NULL = an UPDATE of the row).
-- ⚠️ Do NOT revoke EXECUTE from `authenticated` — admins ARE `authenticated`; is_admin() inside protects it.
-- Unlock one row by hand (SQL editor):
--   begin; set local sfl.printer_unlock = 'on'; update public.approved_printers set locked = false where id = '<id>'; commit;
-- Rollback: sql/229_approved_printer_lock_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '2s';

-- the three functions this file replaces must be exactly the live ones (read 2026-11-27)
do $$
declare got text;
begin
  for got in
    select p.proname || '=' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('admin_approved_printers', 'admin_approve_printer', 'admin_set_approved_printer_active')
  loop
    if got not in ('admin_approved_printers=d392113147245bbbc9294cf15058f18d',
                   'admin_approve_printer=edaa5ed7f4f7d75efb9a0c98e047480c',
                   'admin_set_approved_printer_active=b07faad1bdfa85b22f856e452e4622d4') then
      raise exception 'sql/229: % is not the expected live text — nothing changed', got;
    end if;
  end loop;
end $$;

-- 1) the column -----------------------------------------------------------------------------
alter table public.approved_printers add column if not exists locked boolean not null default false;

-- 2) lock the working printers (exactly 11) -------------------------------------------------
do $$
declare n int;
begin
  update public.approved_printers set locked = true where active and not locked;
  get diagnostics n = row_count;
  if n <> 11 then raise exception 'sql/229: locked % rows, expected 11 — nothing changed', n; end if;
end $$;

-- 3) the guard ------------------------------------------------------------------------------
create or replace function public.approved_printers_lock_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.locked then raise exception 'printer_locked' using errcode = '55000'; end if;
    return old;
  end if;
  if (old.locked or new.locked)
     and (new.id, new.prefix, new.brand, new.model, new.lang, new.shift_mm, new.flip, new.active, new.report_id, new.approved_by, new.approved_at)
         is distinct from
         (old.id, old.prefix, old.brand, old.model, old.lang, old.shift_mm, old.flip, old.active, old.report_id, old.approved_by, old.approved_at) then
    raise exception 'printer_locked' using errcode = '55000';
  end if;
  if old.locked and not new.locked and coalesce(current_setting('sfl.printer_unlock', true), '') <> 'on' then
    raise exception 'printer_locked' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.approved_printers_lock_guard() from public, anon, authenticated;
drop trigger if exists trg_approved_printers_lock on public.approved_printers;
create trigger trg_approved_printers_lock before update or delete on public.approved_printers
  for each row execute function public.approved_printers_lock_guard();

-- the overlap rule (one starts with the other) against active locked rows + the built-in names
create or replace function public.approved_printer_prefix_clash(p_prefix text, p_except uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  with p as (select upper(btrim(coalesce(p_prefix, ''))) as v),
  taken(k) as (
    select upper(btrim(a.prefix)) from public.approved_printers a where a.active and a.locked and a.id is distinct from p_except
    union all
    select upper(b) from unnest(array['D520BT', 'Y41BT', 'B1 Pro-', 'B1-', 'B21-', 'B203-', 'B3S-', 'XP-420B']) b
  )
  select exists (select 1 from taken, p where p.v <> '' and taken.k <> '' and (left(p.v, length(taken.k)) = taken.k or left(taken.k, length(p.v)) = p.v));
$$;
revoke all on function public.approved_printer_prefix_clash(text, uuid) from public, anon, authenticated;

-- 4) lock one row (admin) -------------------------------------------------------------------
create or replace function public.admin_lock_approved_printer(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.approved_printers set locked = true where id = p_id and active and not locked;
  return found;
end;
$$;
revoke all on function public.admin_lock_approved_printer(uuid) from public, anon;
grant execute on function public.admin_lock_approved_printer(uuid) to authenticated;

-- 5) the admin list also returns locked -----------------------------------------------------
create or replace function public.admin_approved_printers()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'prefix', a.prefix, 'brand', a.brand, 'model', a.model, 'lang', a.lang,
                                                       'active', a.active, 'approved_at', a.approved_at, 'report_id', a.report_id,
                                                       'shift_mm', a.shift_mm, 'flip', a.flip, 'locked', a.locked)
                                    order by a.approved_at desc)
                     from public.approved_printers a), '[]'::jsonb);
end;
$$;

-- 6) approve: no name that overlaps a locked / built-in printer ------------------------------
create or replace function public.admin_approve_printer(p_report uuid, p_prefix text, p_brand text, p_model text, p_lang text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid; nid uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into rid from public.printer_test_reports where id = p_report and clean;
  if rid is null then raise exception 'report_not_clean' using errcode = '22023'; end if;
  if public.approved_printer_prefix_clash(p_prefix, null) then raise exception 'prefix_overlaps_locked' using errcode = '22023'; end if;
  insert into public.approved_printers (prefix, brand, model, lang, report_id, approved_by)
  values (btrim(p_prefix), coalesce(nullif(btrim(p_brand), ''), 'Other'), coalesce(nullif(btrim(p_model), ''), btrim(p_prefix)), p_lang, rid, auth.uid())
  returning id into nid;
  return nid;
end;
$$;

-- 7) add back: not when it overlaps a locked / built-in printer ------------------------------
create or replace function public.admin_set_approved_printer_active(p_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_active, false) and exists (select 1 from public.approved_printers a where a.id = p_id and not a.locked and not a.active
                                             and public.approved_printer_prefix_clash(a.prefix, a.id)) then
    raise exception 'prefix_overlaps_locked' using errcode = '22023';
  end if;
  update public.approved_printers set active = coalesce(p_active, false) where id = p_id;
  return found;
end;
$$;

commit;
