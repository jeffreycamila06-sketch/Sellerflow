-- Rollback of sql/229 — drops the lock (trigger, guard, overlap rule, lock RPC, column) and puts
-- admin_approved_printers / admin_approve_printer / admin_set_approved_printer_active back to the live
-- texts of 2026-11-27 (sql/161 / sql/160). Every approved_printers row and value stays as it is.
begin;
set local lock_timeout = '2s';

drop trigger if exists trg_approved_printers_lock on public.approved_printers;
drop function if exists public.approved_printers_lock_guard();
drop function if exists public.admin_lock_approved_printer(uuid);

create or replace function public.admin_approved_printers()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'prefix', a.prefix, 'brand', a.brand, 'model', a.model, 'lang', a.lang,
                                                       'active', a.active, 'approved_at', a.approved_at, 'report_id', a.report_id,
                                                       'shift_mm', a.shift_mm, 'flip', a.flip)
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

drop function if exists public.approved_printer_prefix_clash(text, uuid);
alter table public.approved_printers drop column if exists locked;

commit;
