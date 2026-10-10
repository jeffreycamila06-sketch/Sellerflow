-- ============================================================================
-- sql/114 — switch for the self-service password reset with a 6-digit email code
-- (reset_code_enabled). Seeded OFF. NOT APPLIED.
-- ============================================================================
-- The Forgot-password modal runs BEFORE login, and app_settings is readable only by
-- signed-in users (sql/32 / sql/67). So the app reads this ONE switch through a small public
-- function that returns only true/false (no other setting is exposed). Only the exact string
-- 'true' turns it on; anything else, no row, or the function missing = off (today's Telegram
-- modal). Owner preview without the switch: open the app with ?reset_preview=1.
-- Turn on:  update public.app_settings set value = 'true' where key = 'reset_code_enabled';
-- Rollback: sql/114_reset_code_switch_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('reset_code_enabled', 'false')
on conflict (key) do nothing;

create or replace function public.reset_code_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.value = 'true' from public.app_settings s where s.key = 'reset_code_enabled'), false);
$$;

revoke all on function public.reset_code_enabled() from public;
grant execute on function public.reset_code_enabled() to anon, authenticated;
