-- Rollback for 118.
drop trigger trg_lso_session_buyer_number on public.live_session_orders;
drop function public.lso_session_buyer_number();
