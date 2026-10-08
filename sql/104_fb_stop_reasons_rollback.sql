-- sql/104 ROLLBACK — removes the switch row (the app and the server then treat it as off).
delete from public.app_settings where key = 'fb_stop_reasons';
