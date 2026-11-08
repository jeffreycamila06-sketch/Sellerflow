-- ============================================================================
-- sql/144 — ONE STICKER switches (printer fix Branch 1), both OFF.
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Seeds two app_settings rows with the
-- value 'false'; an existing row is left exactly as it is (never flipped back by a re-run). The
-- app reads them once per sign-in (src/redesign/adapters/featureSwitches.ts) and treats a missing
-- row, an error or any value other than 'true' as OFF.
--
--   one_sticker_enabled         the NEW Live print pattern screen (one sticker, same on every
--                               printer + laptop). OFF = only admins see it. ON = every seller sees
--                               it — but EACH DEVICE keeps printing today's sticker until the seller
--                               taps Save on the new screen on that device.
--   sticker_all_scripts_enabled every language prints on today's sticker too (Japanese kana, 、。「」,
--                               full-width, Korean, Thai, Arabic, Cyrillic on the AIMO, "fancy"
--                               letters as normal letters). Goes to everyone at once; English /
--                               Chinese stickers do not change (byte-identical, tested).
--
-- Switch on:
--   update public.app_settings set value = 'true', updated_at = now() where key = 'sticker_all_scripts_enabled';
--   update public.app_settings set value = 'true', updated_at = now() where key = 'one_sticker_enabled';
-- Rollback: sql/144_one_sticker_switches_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values
  ('one_sticker_enabled', 'false'),
  ('sticker_all_scripts_enabled', 'false')
on conflict (key) do nothing;
