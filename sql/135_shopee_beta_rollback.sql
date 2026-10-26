-- Rollback of sql/135 (Shopee Live beta). Drops the RPCs, the table (and every beta row) and the switch.
drop function if exists public.my_shopee_beta();
drop function if exists public.admin_shopee_beta_list();
drop function if exists public.admin_shopee_beta_remove(uuid);
drop function if exists public.admin_shopee_beta_start(uuid, text);
drop table if exists public.shopee_beta;
delete from public.app_settings where key = 'shopee_live_enabled';
