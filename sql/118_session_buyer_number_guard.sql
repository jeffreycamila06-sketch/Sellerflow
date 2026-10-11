-- 118 — buyer-number guard on live_session_orders (session_id rows only). NOT applied yet.
-- 2026-10-11 bug: one device numbered new buyers from a board that was hours old, so new
-- buyers got #9, #10… that other buyers already owned (73 numbers with two buyers in one
-- session). The app now reloads the session's buyers on every reconnect; this trigger is the
-- database backstop, under one lock per (seller, session) so two devices can't race:
--   • a buyer (handle + platform) who already has a number in this session keeps it;
--   • a new buyer whose number already belongs to someone else gets the session's highest + 1.
-- Legacy rows (session_id null) are untouched. Existing rows are never changed.
-- If the database changes a number, the printed sticker may still show the app's number —
-- this only keeps the saved data from mixing two buyers under one number.
create or replace function public.lso_session_buyer_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_existing integer;
begin
  if new.session_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || new.session_id::text, 118));
  select o.buyer_number into v_existing
    from public.live_session_orders o
   where o.user_id = new.user_id and o.session_id = new.session_id
     and o.handle = new.handle and o.platform = new.platform
   order by o.created_at, o.id
   limit 1;
  if v_existing is not null then
    new.buyer_number := v_existing;
  elsif exists (select 1 from public.live_session_orders o
                 where o.user_id = new.user_id and o.session_id = new.session_id
                   and o.buyer_number = new.buyer_number) then
    select coalesce(max(o.buyer_number), 0) + 1 into new.buyer_number
      from public.live_session_orders o
     where o.user_id = new.user_id and o.session_id = new.session_id;
  end if;
  return new;
end;
$$;

create trigger trg_lso_session_buyer_number
  before insert on public.live_session_orders
  for each row execute function public.lso_session_buyer_number();
