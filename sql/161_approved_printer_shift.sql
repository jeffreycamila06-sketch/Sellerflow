-- ============================================================================
-- sql/161 — Approved printers: "Shift left (mm)" + "Flip 180°" (Jeff 2026-11-15).
-- ============================================================================
-- NOT APPLIED. Needs sql/160 first. ADD-ONLY:
--   1. approved_printers.shift_mm numeric(3,1) not null default 0, 0–8 mm. The app moves the finished
--      sticker bitmap LEFT by round(shift_mm × 8) dots for a SAVED printer whose name matches an ACTIVE
--      row (field case: Clabel CT221B cuts the right ~3 mm). 0 = no change (every existing row).
--      Built-in printers never read an approved row (the app's built-in list always wins).
--   2. approved_printers.flip boolean not null default false — the app turns the finished sticker bitmap
--      180° (same size) BEFORE the shift; the shift is applied last, on the bitmap that is sent.
--   3. admin_approved_printers() also returns shift_mm + flip.
--   4. admin_set_approved_printer_layout(p_id, p_shift, p_flip) — admin only (is_admin() inside).
-- The app reads shift_mm + flip with the active rows; before this file it reads the rows without them
-- (no shift, no flip). flip false + shift 0 = exactly today's bytes.
-- ⚠️ Do NOT revoke EXECUTE from `authenticated` — admins ARE `authenticated`; is_admin() inside protects it.
-- Rollback: sql/161_approved_printer_shift_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '2s';

alter table public.approved_printers
  add column if not exists shift_mm numeric(3,1) not null default 0,
  add column if not exists flip boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'approved_printers_shift_mm_range') then
    alter table public.approved_printers add constraint approved_printers_shift_mm_range check (shift_mm between 0 and 8);
  end if;
end $$;

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

create or replace function public.admin_set_approved_printer_layout(p_id uuid, p_shift numeric, p_flip boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_shift is null or p_shift < 0 or p_shift > 8 then raise exception 'shift_out_of_range' using errcode = '22023'; end if;
  update public.approved_printers set shift_mm = round(p_shift, 1), flip = coalesce(p_flip, false) where id = p_id;
  return found;
end;
$$;
revoke all on function public.admin_set_approved_printer_layout(uuid, numeric, boolean) from public, anon;
grant execute on function public.admin_set_approved_printer_layout(uuid, numeric, boolean) to authenticated;

commit;
