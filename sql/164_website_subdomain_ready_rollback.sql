-- Rollback of sql/164 — the app then treats the switch as off (path address), same as 'false'.
delete from public.app_settings where key = 'website_subdomain_ready';
