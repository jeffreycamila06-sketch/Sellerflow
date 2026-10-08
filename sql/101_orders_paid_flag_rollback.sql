-- sql/101 ROLLBACK — removes the paid flag. Run only with orders_paid_flag_enabled off (the
-- Orders screen names paid_at only while the switch is on).
delete from public.app_settings where key = 'orders_paid_flag_enabled';
alter table public.live_session_orders drop column paid_at;
