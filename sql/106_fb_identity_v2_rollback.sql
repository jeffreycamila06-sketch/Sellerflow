-- sql/106 ROLLBACK — removes the switch row (server and app then treat it as off).
delete from public.app_settings where key = 'fb_identity_v2';
