-- parcel_tracking column lockdown — seller (authenticated) role may write ONLY the
-- handle-link columns; the poller (service_role) owns the live-status columns.
--
-- WHY: RLS already scopes rows to auth.uid(), but the `authenticated` role holds
-- table-level INSERT/UPDATE on EVERY column. Once sellers can upsert their own rows
-- (the in-app 匯出報表 "Sync from 賣貨便"), a forged client JWT could otherwise set
-- status='picked_up' / rewrite pickup_deadline. Lock writes to the columns the seller
-- side actually sends; the SECURITY of the poller's fields moves from "nobody writes
-- them yet" to "the DB won't accept a seller write". (Free-tier-cap S1 lesson: a
-- table-level grant overrides a column REVOKE, so revoke the table grant FIRST.)
--
-- Seller-writable set (covers both the in-app upload {user_id,tracking_no,buyer_username}
-- AND the Chrome extension scraper {…,cm_order_no,recipient_name,store_id,order_amount}):
--   user_id, tracking_no, buyer_username, cm_order_no, recipient_name, store_id,
--   order_amount, shipping_entry_id
-- POLLER-ONLY (never granted to authenticated/anon): status, status_message, terminal,
--   pickup_deadline, arrived_at, rec_store, last_polled_at, ship_type, special_type,
--   recipient_phone, picked_up_at/returned_at (if present), created_at, updated_at, id.
-- service_role / postgres retain ALL privileges (the poller runs as service role).

revoke insert, update on public.parcel_tracking from authenticated;
revoke insert, update on public.parcel_tracking from anon; -- anon has no legit write path (RLS needs a uid)

grant insert (user_id, tracking_no, buyer_username, cm_order_no, recipient_name, store_id, order_amount, shipping_entry_id)
  on public.parcel_tracking to authenticated;
grant update (user_id, tracking_no, buyer_username, cm_order_no, recipient_name, store_id, order_amount, shipping_entry_id)
  on public.parcel_tracking to authenticated;

-- SELECT + DELETE grants are unchanged (RLS still scopes them to auth.uid()).
