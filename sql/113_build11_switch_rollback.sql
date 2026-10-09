-- sql/113 ROLLBACK — removes the switch row (the app then treats it as off).
delete from public.app_settings where key = 'build11_enabled';
