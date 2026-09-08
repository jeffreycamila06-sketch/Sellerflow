-- 26_parcel_scans_emap_check.sql
-- Parcel Scan A2 — 7-11 E-Map store-code check. Applied to prod via Supabase
-- MCP 2026-09-08 (this file is the repo mirror). ADDITIVE ONLY.
--
-- After a scan saves, the client asks the server to look the 6-digit 7-11 store
-- code up against 7-11's public E-Map (EMapSDK.aspx) — best-effort, never
-- blocking — so a wrong/typo'd store code is flagged at scan time instead of at
-- the laptop. The verdict lands in store_check_status:
--   'valid'      — E-Map returned the store
--   'not_found'  — E-Map has no such store (wrong code)
--   'unknown'    — E-Map unreachable / timeout / parse-fail (NEVER blocks)
-- ('no_service' is intentionally NOT produced: EMapSDK.aspx is the general store
--  locator and does not expose 交貨便 parcel-accept / full status — the greyed
--  stores in the official byArea map come from a separate availability service.
--  Full-store detection stays checkout-time, where the encode status button
--  already covers store_full. A full store like 198002 reads here as 'valid'
--  because E-Map only confirms the store EXISTS.)
--
-- 'wrong_store_code' is added to the ROW status enum for future/manual use; the
-- A1 client writes only store_check_status and leaves status = 'confirmed'.
--
-- Egress shape: one E-Map lookup per scan-save (+ manual re-check). ZERO poll.

alter table public.parcel_scans add column if not exists store_check_status text null;
alter table public.parcel_scans add column if not exists store_check_at timestamptz null;

alter table public.parcel_scans drop constraint if exists parcel_scans_status_check;
alter table public.parcel_scans add constraint parcel_scans_status_check
  check (status = any (array[
    'pending', 'confirmed', 'encoded_ok', 'store_full',
    'restricted_number', 'printed', 'wrong_store_code'
  ]));

-- RLS unchanged — the four own-scoped policies from sql/25 already cover the
-- new columns (a seller reads/writes only their own rows).
