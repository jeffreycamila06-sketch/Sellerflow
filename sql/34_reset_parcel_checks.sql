-- 34_reset_parcel_checks.sql
-- ⚠️ DO NOT APPLY automatically — run ONCE, manually (Supabase SQL editor / MCP),
-- AFTER the chrome-extension parcel-checker fix is loaded. It re-arms every row
-- Jeff's checker previously marked 'unknown' (the cross-origin / token bugs) back
-- to NULL so the fixed extension re-checks them. NULL = "not yet tried".
--
-- Scope: Jeff's own rows only; only rows currently 'unknown' (never touches a real
-- 'open'/'full'/'ok'/'restricted' verdict, and never touches exported rows' data
-- beyond the check columns). Repeatable/idempotent.

update public.parcel_scans
set store_full_status = null,
    store_full_at = null,
    phone_check_status = null,
    phone_check_at = null,
    phone_check_message = null,
    phone_restricted_until = null
where user_id = 'ec96f3f0-093d-4dd7-b3dd-509fdf15171f'
  and (store_full_status = 'unknown' or phone_check_status = 'unknown');
