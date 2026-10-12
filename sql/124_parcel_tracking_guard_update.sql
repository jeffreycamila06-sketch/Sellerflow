-- 124 — parcel_tracking: the tracking-number guard also runs on UPDATE. NOT APPLIED — chat-Claude applies.
-- Rollback: sql/124_parcel_tracking_guard_update_rollback.sql (back to BEFORE INSERT only, as in sql/62).
--
-- Audit Oct 13 item 11. trg_parcel_tracking_guard_insert was BEFORE INSERT only, and the
-- authenticated role may UPDATE tracking_no / user_id (sql/42 column grants). A seller could insert
-- a row with an unused number, then UPDATE its tracking_no to another seller's parcel number —
-- the foreign_tracking_no check never ran. The trigger now also fires on UPDATE OF tracking_no,
-- user_id. The function public.parcel_tracking_guard_insert() is NOT changed:
--   • service role (auth.uid() null) → passes, as before
--   • a seller without upload access → not_allowed
--   • the number already belongs to another seller → foreign_tracking_no
-- An update that does not set tracking_no / user_id (e.g. buyer_username) does not fire it.
begin;
set local lock_timeout = '5s';

drop trigger trg_parcel_tracking_guard_insert on public.parcel_tracking;
create trigger trg_parcel_tracking_guard_insert
  before insert or update of tracking_no, user_id on public.parcel_tracking
  for each row execute function public.parcel_tracking_guard_insert();

commit;
