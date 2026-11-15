-- Rollback of sql/161 — drops shift_mm, flip and the layout RPC; admin_approved_printers() back to sql/160's.
begin;
set local lock_timeout = '2s';

drop function if exists public.admin_set_approved_printer_layout(uuid, numeric, boolean);
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
alter table public.approved_printers drop constraint if exists approved_printers_shift_mm_range;
alter table public.approved_printers drop column if exists shift_mm;
alter table public.approved_printers drop column if exists flip;

commit;
