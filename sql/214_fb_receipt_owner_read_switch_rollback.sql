-- Rollback of sql/214: the switch row is removed (= off; the server treats a missing row as off).
begin;

delete from public.app_settings where key = 'fb_receipt_owner_read_enabled';

commit;
