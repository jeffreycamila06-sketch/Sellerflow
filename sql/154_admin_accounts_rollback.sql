-- Rollback of sql/154. Functions only — no data is touched. The admin card then shows TikTok
-- only again, and a plan downgrade changes the plan without removing anything.
set lock_timeout = '2s';
begin;
drop function if exists public.admin_downgrade_remove(uuid, text, text, timestamptz, timestamptz, jsonb);
drop function if exists public.admin_seller_accounts(uuid);
drop function if exists public.admin_connected_accounts();
commit;
