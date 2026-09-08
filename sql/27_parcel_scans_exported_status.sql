-- 27_parcel_scans_exported_status.sql
-- Parcel Scan → 賣貨便 訂單匯入 Excel export. Applied to prod via Supabase MCP
-- 2026-09-08 (this file is the repo mirror). ADDITIVE ONLY.
--
-- Adds 'exported' to the parcel_scans row status enum so a successful Excel
-- export can flip the exported READY rows to status='exported' — re-exports
-- then skip them, and the saved list can tag them. All prior states kept; RLS
-- unchanged (the four own-scoped policies from sql/25 already cover it).

alter table public.parcel_scans drop constraint if exists parcel_scans_status_check;
alter table public.parcel_scans add constraint parcel_scans_status_check
  check (status = any (array[
    'pending', 'confirmed', 'encoded_ok', 'store_full',
    'restricted_number', 'printed', 'wrong_store_code', 'exported'
  ]));
