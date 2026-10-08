-- ============================================================================
-- sql/93 — the four new feature switches, all OFF.
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Seeds app_settings rows with the
-- value 'false'; an existing row is left exactly as it is (never flipped back by a re-run).
-- The app reads them once per sign-in (src/redesign/adapters/featureSwitches.ts) and treats a
-- missing row, an error or any value other than 'true' as OFF; the server reads
-- fb_soldout_enabled the same way as fb_enabled (cached 60 s). To switch one on:
--   update public.app_settings set value = 'true', updated_at = now() where key = '<key>';
-- Rollback: sql/93_feature_switches_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values
  ('sales_platform_enabled', 'false'),
  ('fb_soldout_enabled',     'false'),
  ('fb_waitlist_enabled',    'false'),
  ('inventory_v2_enabled',   'false')
on conflict (key) do nothing;
