-- Rollback of sql/218: remove the in-page QR scanner switch row. The app then reads "off" and every
-- Scan opens today's photo flow (no app build needed).
begin;
delete from public.app_settings where key = 'web_qr_scanner_enabled';
commit;
