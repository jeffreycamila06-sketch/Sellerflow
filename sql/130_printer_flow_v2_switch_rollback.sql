-- ============================================================================
-- sql/130 rollback — remove the printer setup v2 switch row.
-- ============================================================================
-- Without the row the app treats the switch as OFF (fail closed), so deleting it is the same
-- as 'false' for every seller; admins + the 'test_printers' list still get the new flow.
delete from public.app_settings where key = 'printer_flow_v2';
