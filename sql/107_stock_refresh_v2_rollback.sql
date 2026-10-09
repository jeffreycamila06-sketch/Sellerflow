-- sql/107 ROLLBACK — removes the switch row (the app then treats it as off).
delete from public.app_settings where key = 'stock_refresh_v2';
