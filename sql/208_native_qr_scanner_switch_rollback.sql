-- Rollback of sql/208: remove the native QR scanner switch row. The app then reads "off" and every
-- Scan opens today's photo flow (no app build needed).
begin;
delete from public.app_settings where key = 'native_qr_scanner_enabled';
commit;
