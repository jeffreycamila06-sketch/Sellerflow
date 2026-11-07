-- ============================================================================
-- sql/143 rollback — remove the two one-sticker switch rows.
-- ============================================================================
-- Without the rows the app treats both switches as OFF (fail closed): every device prints today's
-- sticker (a device that saved the new pattern keeps its saved choice but it is ignored), and only
-- admins see the new Live print pattern screen.
delete from public.app_settings where key in ('one_sticker_enabled', 'sticker_all_scripts_enabled');
