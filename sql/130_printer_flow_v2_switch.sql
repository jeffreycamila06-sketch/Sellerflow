-- ============================================================================
-- sql/130 — printer setup v2 switch ("no switch, fewer taps"), OFF.
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Seeds one app_settings row with
-- the value 'false'; an existing row is left exactly as it is (never flipped back by a re-run).
-- The app reads it once per sign-in (src/redesign/adapters/featureSwitches.ts) and treats a
-- missing row, an error or any value other than 'true' as OFF. While OFF, only admins and
-- the 'test_printers' preview list (sql/123) get the new Printer settings flow; every other
-- seller keeps today's screen. To switch on for everyone:
--   update public.app_settings set value = 'true', updated_at = now() where key = 'printer_flow_v2';
-- Rollback: sql/130_printer_flow_v2_switch_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values
  ('printer_flow_v2', 'false')
on conflict (key) do nothing;
