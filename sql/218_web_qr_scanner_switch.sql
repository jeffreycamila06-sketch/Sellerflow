-- ============================================================================
-- sql/218 — In-page live QR scanner kill switch (2026-11-25).
-- ============================================================================
-- NOT APPLIED. Jeff / chat applies via Supabase MCP after review. NO schema change, NO new table,
-- NO function, NO policy. ONE app_settings row:
--   web_qr_scanner_enabled = 'false'  (OFF for every seller until it is turned on).
-- What it does when 'true': in the ANDROID app that has NO built-in scanner (app 1.9 and older),
-- every "Scan" (7-11 Parcel Scan, FamilyMart Parcel Scan, Blacklist) opens a live camera scanner
-- drawn by the web page, and Orders shows its Scan button. Anything but exactly 'true' (or no row,
-- or a failed read) → every Scan opens today's photo flow, as now. An app build WITH the built-in
-- scanner, an iPhone, a laptop and a browser are never affected by this row.
-- No new app build is needed to switch it.
--
-- Turn on for every seller (new app opens at once; open apps: after a full close-open):
--   update public.app_settings set value = 'true', updated_at = now() where key = 'web_qr_scanner_enabled';
-- Turn off again: same update with 'false'.
-- Apply check:
--   select value from public.app_settings where key = 'web_qr_scanner_enabled';   -- false
-- Rollback: sql/218_web_qr_scanner_switch_rollback.sql.
-- ============================================================================
begin;

insert into public.app_settings (key, value) values ('web_qr_scanner_enabled', 'false')
on conflict (key) do nothing;

commit;
