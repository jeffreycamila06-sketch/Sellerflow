-- Rollback of sql/230 — removes printer tuning (functions, both tables, the report column, the switch row)
-- and puts admin_printer_test_reports() back to sql/160's text (= the live text of 2026-11-27).
-- ⚠️ Deletes every seller's saved tuning + its history (printing goes back to today's bytes for everyone).
begin;
set local lock_timeout = '2s';

drop function if exists public.my_printer_tuning();
drop function if exists public.admin_printer_tuning_reset(text, int);
drop function if exists public.admin_printer_tuning_undo(text, int);
drop function if exists public.admin_printer_tuning_set(text, jsonb, int);
drop function if exists public.admin_printer_tuning_get(text);
drop function if exists public.printer_tuning_latest_name(uuid);
drop function if exists public.printer_tuning_top_version(uuid);
drop function if exists public.printer_tuning_user(text);
drop table if exists public.printer_seller_tuning_history;
drop table if exists public.printer_seller_tuning;
drop function if exists public.printer_tuning_clean(jsonb);
drop function if exists public.printer_tuning_valid(jsonb);
drop function if exists public.printer_name_is_built_in(text);

create or replace function public.admin_printer_test_reports()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc)
                     from (select id, email, printer_name, ble_facts, lang, sticker_size, send_ok, send_code, clean, photo_path, created_at
                             from public.printer_test_reports order by created_at desc limit 200) r), '[]'::jsonb);
end;
$$;
alter table public.printer_test_reports drop constraint if exists printer_test_reports_tuning_version_check;
alter table public.printer_test_reports drop column if exists tuning_version;

delete from public.app_settings where key = 'printer_tuning_enabled';

commit;
