-- ============================================================================
-- sql/208 — Native QR scanner kill switch (Jeff 2026-11-22).
-- ============================================================================
-- NOT APPLIED. Jeff / chat applies via Supabase MCP after review. NO schema change, NO new table,
-- NO function, NO policy. ONE app_settings row:
--   native_qr_scanner_enabled = 'true'  (on for every seller).
-- What it does: in a phone app build that has the live scanner (iOS build 15+, Android versionCode 11+),
-- every "Scan" (7-11 Parcel Scan, FamilyMart Parcel Scan, Blacklist, Orders) opens the live camera
-- scanner. Anything but exactly 'true' (or no row, or a failed read) → every Scan opens today's photo
-- flow — the same as a laptop or an older app version. No new app build is needed to switch it.
-- ⚠️ Until this row exists the app reads "off" (the app fails closed), so the live scanner only starts
-- once this is applied — the photo flow keeps working the whole time.
--
-- Turn off for every seller (instant for new app opens; open apps: after a full close-open):
--   update public.app_settings set value = 'false', updated_at = now() where key = 'native_qr_scanner_enabled';
-- Turn on again: same update with 'true'.
-- Apply check:
--   select value from public.app_settings where key = 'native_qr_scanner_enabled';   -- true
-- Rollback: sql/208_native_qr_scanner_switch_rollback.sql.
-- ============================================================================
begin;

insert into public.app_settings (key, value) values ('native_qr_scanner_enabled', 'true')
on conflict (key) do nothing;

commit;
