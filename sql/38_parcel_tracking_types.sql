-- 38_parcel_tracking_types.sql
-- Parcel tracking — add SHOPMORE shipType + specialType (from the PackageDetail
-- searchResults objects) so the Pickup Status screen can filter to CHASEABLE
-- parcels (C2C store-pickup) and skip home-delivery / return service units.
-- Repo MIRROR of what is applied to prod via Supabase MCP — do NOT re-apply.
-- ADDITIVE ONLY; the four own-scoped RLS policies from sql/37 already cover the
-- new columns.
--
-- CHASEABLE rule (enforced in server/parcelTracking.js, stored here for the UI):
--   chaseable = ship_type = 'C2C' AND (special_type is null/empty).
-- A non-empty special_type is always a non-store-pickup flow:
--   '4.店到宅服務單' / '99.C2C轉宅配(數網自訂)' = home delivery (no store pickup),
--   '0.退貨便服務單'                              = buyer return.
-- recDate is stored raw in pickup_deadline: it is 取貨截止日 for a C2C store pickup
-- (what we chase), but 退貨截止日 (return) / 寄貨截止日 (C2B) otherwise — same raw
-- field, so the screen only treats it as a chase deadline for a chaseable at_store row.

alter table public.parcel_tracking add column if not exists ship_type    text null;  -- C2C / C2B / B2C
alter table public.parcel_tracking add column if not exists special_type text null;  -- null = normal store pickup; any value = non-chaseable flow
