-- 33_parcel_extension_checks.sql
-- Parcel Scan — session-bound 賣貨便 checks written by the Chrome extension.
-- Applied to prod via Supabase MCP (this file is the repo MIRROR — do NOT
-- re-apply; raffle_config / seller_shipping_settings pattern). ADDITIVE ONLY.
--
-- Two checks the SERVER cannot do (they need Jeff's logged-in 賣貨便 session):
--   1. FULL STORE   — 交貨便 store accepting parcels?  (byIDData enable/disable)
--   2. RESTRICTED    — buyer phone flagged for repeated no-shows? (CheckoutValidation)
-- A separate Chrome extension runs on Jeff's 24/7 laptop, checks each new scan
-- with his session, and writes the verdicts here. THIS APP ONLY DISPLAYS them
-- (badges + Full/Restricted tabs + export exclusion + a per-row recheck that
-- just nulls the columns so the extension re-checks). The app never calls 賣貨便.
--
-- ⚠️ FAIL-SAFE: NULL and 'unknown' are NOT 'ok'. An unchecked / can't-verify
-- parcel must look unchecked (no ✅, no exclusion), never clean. Only explicit
-- 'open' / 'ok' clears; only explicit 'full' / 'restricted' excludes from export.
--
-- Verdicts live in their OWN columns — the row `status` column (export lifecycle:
-- confirmed / exported) is untouched, same as store_check_status in sql/26.
--
-- Egress shape (app side): the columns ride the ONE existing select in
-- loadParcelScans (screen open) — ZERO new poll from the app. The extension's
-- own poll is separate (its build).

alter table public.parcel_scans add column if not exists store_full_status     text null;        -- 'open' | 'full' | 'unknown' | null
alter table public.parcel_scans add column if not exists store_full_at          timestamptz null;
alter table public.parcel_scans add column if not exists phone_check_status     text null;        -- 'ok' | 'restricted' | 'unknown' | null
alter table public.parcel_scans add column if not exists phone_check_at         timestamptz null;
alter table public.parcel_scans add column if not exists phone_check_message    text null;        -- raw 賣貨便 Message on 'restricted'
alter table public.parcel_scans add column if not exists phone_restricted_until date null;        -- parsed \d{4}年\d{2}月\d{2}日

-- Partial index for the extension's "which rows are not yet checked?" query
-- (unchecked = either verdict still null). Own-scoped reads via RLS.
create index if not exists parcel_scans_unchecked_idx
  on public.parcel_scans (user_id, created_at desc)
  where store_full_status is null or phone_check_status is null;

-- RLS unchanged — the four own-scoped policies from sql/25 already cover the new
-- columns (a seller reads/writes only their own rows; the extension carries the
-- seller's JWT, so it can only ever write that seller's rows).
