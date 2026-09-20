-- 7-day-after-terminal retention for parcel_tracking (Pickup Status).
--
-- The poller records WHEN a parcel became terminal so the cleanup pass can count 7
-- days from that moment. Additive + nullable; no backfill (the table was cleared for
-- the clean slate, and a NULL timestamp is never matched by the retention DELETE).
--
--   picked_up_at — set by the poller the first time it detects status = 'picked_up'
--   returned_at  — set by the poller the first time it detects status = 'returned'
--
-- Terminal rows (picked_up / returned) are never re-polled (the poller selects
-- terminal = false), so each stamp is written exactly once, at the transition.
-- The 7-day DELETE lives in the poller (server/parcelTrackingRunner.js), owner-scoped,
-- and can NEVER match a non-terminal row (in_transit / at_store / created / …).

alter table public.parcel_tracking
  add column if not exists picked_up_at timestamptz,
  add column if not exists returned_at  timestamptz;
