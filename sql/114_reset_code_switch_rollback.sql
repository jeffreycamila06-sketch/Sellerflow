-- sql/114 ROLLBACK — removes the reset-code switch (the app then shows the Telegram modal).
drop function public.reset_code_enabled();
delete from public.app_settings where key = 'reset_code_enabled';
